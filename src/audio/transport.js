/**
 * Transport — o único módulo autorizado a mudar posição ou taxa de um deck.
 *
 * Dois motores tocam o MESMO PCM, somados por dois ganhos:
 *
 *   turntable-reader  ──→ vinylGain ─┐
 *                                     ├─→ saída
 *   signalsmith       ──→ lockGain  ─┘
 *
 * Exatamente um está em unidade; o outro em zero E inativo (pra não gastar CPU).
 * A troca é um crossfade AGENDADO de 8 ms na MESMA posição de entrada — a
 * posição lógica nunca salta, então grid, sync e display ficam contínuos.
 *
 * O leitor é dono da linha do tempo em todos os modos. O signalsmith só produz
 * som quando keylock está ligado e o prato não está sendo tocado, porque um
 * phase vocoder com playhead de slip e taxa negativa seria difícil e inútil.
 *
 * MEDIDO (ver ACHADOS.md):
 *  - toda a API do signalsmith é assíncrona: latency() devolve Promise. Medimos
 *    UMA vez no init e cacheamos; não dá pra esperar await no caminho do handoff.
 *  - o padrão dele é blockMs 120 (240 ms de lookahead). Usamos 40.
 *  - a thread de render do Chrome demora ~900 ms pra partir depois do resume:
 *    o AudioContext tem que nascer com o app e NUNCA ser suspenso.
 *  - qualidade do keylock só vale entre 0.70x e 1.45x; fora disso, vinil.
 */

import { TimeMap } from './timemap.js';
import { AUDIO } from '../config.js';

const XFADE = 0.008; // 8 ms de crossfade no handoff
const SLAB_BITS = 19;
const SLAB = 1 << SLAB_BITS;

/** Ganho sem clique: a trajetória do ganho tem que ser contínua. */
function ramp(param, alvo, quando, dur = 0.012) {
  param.cancelAndHoldAtTime(quando);
  param.linearRampToValueAtTime(alvo, quando + dur);
}

export class Transport extends EventTarget {
  /**
   * @param {AudioContext} ctx
   * @param {object} opts
   * @param {AudioNode} opts.destination  para onde a soma dos dois motores vai
   * @param {object|null} opts.stretch    nó do signalsmith, ou null (sem keylock)
   * @param {number} opts.stretchLatency  latência JÁ medida, em segundos
   */
  constructor(ctx, { destination, stretch = null, stretchLatency = 0 }) {
    super();
    this.ctx = ctx;
    this.stretch = stretch;
    this.stretchLatency = stretchLatency;

    this.map = new TimeMap({ time: ctx.currentTime, pos: 0, rate: 0 });

    this.reader = new AudioWorkletNode(ctx, 'turntable-reader', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { rateTau: AUDIO.rateTau },
    });
    this.vinylGain = ctx.createGain();
    this.lockGain = ctx.createGain();
    this.vinylGain.gain.value = 1;
    this.lockGain.gain.value = 0;

    this.reader.connect(this.vinylGain).connect(destination);
    if (stretch) {
      stretch.connect(this.lockGain);
      this.lockGain.connect(destination);
    }

    // estado
    this.duration = 0;
    this.playing = false;
    this.pitch = 0;            // fração: -0.08 .. +0.08
    this.pitchRange = 0.08;
    this.keylockPedido = false;
    this.keylockAtivo = false;
    this.tocando = 'vinyl';    // 'vinyl' | 'lock'
    this.cuePoint = 0;
    this.cueVeioDoBotao = false;
    this.tocandoPrato = false;
    this.ultimoAnchor = null;
    this.underrunsAvisados = 0;

    this.reader.port.onmessage = (e) => this.#onAnchor(e.data);
  }

  // ─────────────────────────── construção ───────────────────────────

  /**
   * Cria um Transport com o signalsmith já configurado e medido.
   * Se o signalsmith falhar, devolve um Transport sem keylock em vez de
   * quebrar: um deck sem keylock ainda é um deck.
   */
  static async create(ctx, { destination, comKeylock = true } = {}) {
    let stretch = null, latency = 0;
    if (comKeylock) {
      try {
        const mod = await import('https://cdn.jsdelivr.net/npm/signalsmith-stretch@1.3.2/SignalsmithStretch.mjs');
        stretch = await mod.default(ctx);
        await stretch.configure({ blockMs: AUDIO.keylockBlockMs });
        latency = await stretch.latency();   // async: medir uma vez, cachear
      } catch (e) {
        console.warn('[transport] keylock indisponível:', e.message);
        stretch = null;
      }
    }
    return new Transport(ctx, { destination, stretch, stretchLatency: latency });
  }

  // ─────────────────────────── carga ───────────────────────────

  /**
   * Entrega o PCM aos dois motores.
   * Transfere em lajes, e NUNCA guarda uma segunda cópia: 6 min estéreo a
   * 48 kHz são 138 MB, e dois decks mais análise já passam de 350 MB.
   */
  async load(audioBuffer) {
    const len = audioBuffer.length;
    this.duration = audioBuffer.duration;
    this.reader.port.postMessage({ t: 'clear' });

    for (let c = 0; c < 2; c++) {
      const src = audioBuffer.getChannelData(Math.min(c, audioBuffer.numberOfChannels - 1));
      for (let off = 0; off < len; off += SLAB) {
        const laje = src.slice(off, Math.min(off + SLAB, len));
        this.reader.port.postMessage(
          { t: 'slab', c, index: off / SLAB, data: laje.buffer, len },
          [laje.buffer]
        );
      }
    }

    if (this.stretch) {
      // addBuffers recebe ARRAY de Float32Array. AudioBuffer dá DataCloneError.
      const canais = [];
      for (let c = 0; c < 2; c++) {
        canais.push(audioBuffer.getChannelData(Math.min(c, audioBuffer.numberOfChannels - 1)).slice());
      }
      await this.stretch.addBuffers(canais);
    }

    this.map = new TimeMap({ time: this.ctx.currentTime, pos: 0, rate: 0 });
    this.cuePoint = 0;
    this.dispatchEvent(new CustomEvent('loaded', { detail: { duration: this.duration } }));
  }

  // ─────────────────────────── relógio ───────────────────────────

  #onAnchor(m) {
    if (m.t !== 'anchor') return;
    this.ultimoAnchor = m;
    this.map.anchor({ time: m.time, pos: m.pos, rate: m.rate });
    this.map.prune(m.time - 1);
    if (m.glitchCount > this.underrunsAvisados) {
      this.underrunsAvisados = m.glitchCount;
      this.dispatchEvent(new CustomEvent('glitch', { detail: { count: m.glitchCount, ms: m.glitchMs } }));
    }
  }

  /** Posição de entrada agora. */
  get position() { return this.map.positionAt(this.ctx.currentTime); }

  /**
   * A posição que o usuário está OUVINDO agora. É esta que o waveform usa.
   * Sem compensar outputLatency o playhead desenha adiantado (40 ms nesta
   * máquina) e o usuário reporta o beat grid como errado.
   */
  get displayPosition() {
    return this.map.positionAt(this.ctx.currentTime - (this.ctx.outputLatency || 0));
  }

  /** Taxa de saída→entrada quando tocando: 1 + pitch. */
  get nominalRate() { return 1 + this.pitch; }

  /** Instante mínimo seguro pra agendar qualquer coisa. */
  get lookahead() { return Math.max(3 * 128 / this.ctx.sampleRate, 0.02); }

  #frame(t) { return Math.round(t * this.ctx.sampleRate); }

  // ─────────────────────────── transporte ───────────────────────────

  play({ at = null } = {}) {
    if (this.playing) return;
    const t = at ?? this.ctx.currentTime + this.lookahead;
    const pos = this.map.positionAt(t);
    this.playing = true;
    this.#aplicar(t, pos, this.nominalRate);
    this.dispatchEvent(new CustomEvent('playing', { detail: { playing: true } }));
  }

  /** brake > 0 faz a taxa cair até 0 ao longo de `brake` segundos: parada de vinil. */
  pause({ brake = 0 } = {}) {
    if (!this.playing) return;
    const t0 = this.ctx.currentTime + this.lookahead;
    this.playing = false;
    if (brake > 0) {
      const t1 = t0 + brake;
      // a taxa cai linear; a posição final é a integral, ou seja metade da média
      const posFim = this.map.positionAt(t0) + (this.nominalRate * brake) / 2;
      this.map.push({ t0, p0: this.map.positionAt(t0), rate: this.nominalRate / 2 });
      this.map.push({ t0: t1, p0: posFim, rate: 0 });
      this.reader.port.postMessage({ t: 'seg', frame: this.#frame(t0), rate: this.nominalRate / 2 });
      this.reader.port.postMessage({ t: 'seg', frame: this.#frame(t1), pos: posFim, rate: 0 });
      this.#pararStretch(t1);
    } else {
      this.#aplicar(t0, null, 0);
      this.#pararStretch(t0);
    }
    this.dispatchEvent(new CustomEvent('playing', { detail: { playing: false } }));
  }

  /** Salto duro. Só use parado ou no cue: tocando, um salto se ouve como engasgo. */
  seek(pos) {
    const t = this.ctx.currentTime + this.lookahead;
    const p = Math.max(0, Math.min(pos, this.duration));
    this.map.push({ t0: t, p0: p, rate: this.playing ? this.nominalRate : 0 });
    this.reader.port.postMessage({ t: 'seg', frame: this.#frame(t), pos: p, rate: this.playing ? this.nominalRate : 0 });
    if (this.tocando === 'lock') this.#agendarStretch(t, p, this.playing ? this.nominalRate : 0);
  }

  setCuePoint(pos = this.position) { this.cuePoint = Math.max(0, Math.min(pos, this.duration)); }

  /** Segurar toca a partir do cue; soltar volta pro cue. É o cue de CDJ. */
  cuePress() {
    if (this.playing) { this.pause(); this.seek(this.cuePoint); this.cueVeioDoBotao = false; return; }
    this.seek(this.cuePoint);
    this.cueVeioDoBotao = true;
    this.play();
  }

  cueRelease() {
    if (!this.cueVeioDoBotao) return;
    this.cueVeioDoBotao = false;
    this.pause();
    this.seek(this.cuePoint);
  }

  // ─────────────────────────── pitch e keylock ───────────────────────────

  setPitchRange(r) { this.pitchRange = r; this.setPitch(this.pitch); }

  setPitch(fracao) {
    this.pitch = Math.max(-this.pitchRange, Math.min(this.pitchRange, fracao));
    const taxa = this.playing ? this.nominalRate : 0;
    this.reader.port.postMessage({ t: 'rate', rate: taxa, nominal: this.nominalRate });
    const t = this.ctx.currentTime;
    this.map.push({ t0: t, p0: this.map.positionAt(t), rate: taxa });
    if (this.tocando === 'lock') this.#agendarStretch(t + this.lookahead, null, taxa);
    this.#reavaliarKeylock();
    this.dispatchEvent(new CustomEvent('rate', { detail: { pitch: this.pitch, rate: this.nominalRate } }));
  }

  /** Fora de 0.70x–1.45x o phase vocoder borra; nessa faixa o keylock se desliga. */
  get keylockPossivel() {
    return !!this.stretch && !this.tocandoPrato &&
           this.nominalRate >= AUDIO.keylockMin && this.nominalRate <= AUDIO.keylockMax;
  }

  setKeylock(ligado) {
    this.keylockPedido = !!ligado;
    this.#reavaliarKeylock();
  }

  #reavaliarKeylock() {
    const querLock = this.keylockPedido && this.keylockPossivel;
    const alvo = querLock ? 'lock' : 'vinyl';
    if (alvo === this.tocando) {
      if (this.keylockAtivo !== querLock) {
        this.keylockAtivo = querLock;
        this.dispatchEvent(new CustomEvent('keylock', { detail: { pedido: this.keylockPedido, ativo: querLock } }));
      }
      return;
    }
    this.#trocarMotor(alvo);
  }

  /**
   * A troca. Os dois motores ficam na MESMA posição de entrada durante o
   * crossfade, então o único artefato é ~8 ms de leve filtro-pente entre o sinal
   * direto e o do vocoder — menos audível do que o que hardware comercial faz.
   */
  #trocarMotor(alvo) {
    const L = this.stretchLatency;
    const agora = this.ctx.currentTime;

    if (alvo === 'lock') {
      // entrar no stretch exige pré-roll: ele tem latência própria
      const T = agora + Math.max(0.15, 2 * L);
      const pos = this.map.positionAt(T);
      this.#agendarStretch(T, pos, this.playing ? this.nominalRate : 0);
      ramp(this.lockGain.gain, 1, T, XFADE);
      ramp(this.vinylGain.gain, 0, T, XFADE);
    } else {
      // sair é imediato: o leitor já está na posição certa o tempo todo
      const T = agora + this.lookahead;
      ramp(this.vinylGain.gain, 1, T, XFADE);
      ramp(this.lockGain.gain, 0, T, XFADE);
      this.#pararStretch(T + XFADE);
    }

    this.tocando = alvo;
    this.keylockAtivo = alvo === 'lock';
    this.dispatchEvent(new CustomEvent('keylock', {
      detail: { pedido: this.keylockPedido, ativo: this.keylockAtivo },
    }));
  }

  #agendarStretch(quando, pos, taxa) {
    if (!this.stretch) return;
    const p = pos ?? this.map.positionAt(quando);
    // não await: estamos no caminho crítico. A latência já foi medida no init.
    this.stretch.schedule({ output: quando, active: true, input: p, rate: taxa, semitones: 0 })
      .catch(() => {});
  }

  #pararStretch(quando) {
    if (!this.stretch) return;
    this.stretch.schedule({ output: quando, active: false }).catch(() => {});
  }

  #aplicar(t, pos, taxa) {
    this.map.push({ t0: t, p0: pos ?? this.map.positionAt(t), rate: taxa });
    const msg = { t: 'seg', frame: this.#frame(t), rate: taxa, nominal: this.nominalRate };
    if (pos !== null && pos !== undefined) msg.pos = pos;
    this.reader.port.postMessage(msg);
    this.reader.port.postMessage({ t: 'active', on: taxa !== 0 || this.playing });
    if (this.tocando === 'lock') this.#agendarStretch(t, pos, taxa);
  }

  // ─────────────────────────── prato / jog ───────────────────────────

  /** Pegar o prato tira do keylock na hora: scratch sempre roda no leitor. */
  touchStart() {
    this.tocandoPrato = true;
    if (this.tocando === 'lock') this.#trocarMotor('vinyl');
    this.reader.port.postMessage({ t: 'active', on: true });
  }

  /** @param {number} taxa taxa instantânea com sinal; negativa toca ao contrário */
  setScratchRate(taxa) {
    if (!this.tocandoPrato) return;
    this.reader.port.postMessage({ t: 'rate', rate: taxa });
    const t = this.ctx.currentTime;
    this.map.push({ t0: t, p0: this.map.positionAt(t), rate: taxa });
  }

  touchEnd() {
    this.tocandoPrato = false;
    const taxa = this.playing ? this.nominalRate : 0;
    this.reader.port.postMessage({ t: 'rate', rate: taxa, nominal: this.nominalRate });
    const t = this.ctx.currentTime;
    this.map.push({ t0: t, p0: this.map.positionAt(t), rate: taxa });
    if (!this.playing) this.reader.port.postMessage({ t: 'active', on: false });
    this.#reavaliarKeylock();
  }

  // ─────────────────────────── loop ───────────────────────────

  setLoop({ start, end, on = true }) {
    this.reader.port.postMessage({ t: 'loop', on, start, end });
    if (this.stretch && this.tocando === 'lock') {
      this.stretch.schedule({
        output: this.ctx.currentTime + this.lookahead, active: true,
        input: this.map.positionAt(this.ctx.currentTime + this.lookahead),
        rate: this.playing ? this.nominalRate : 0, semitones: 0,
        loopStart: on ? start : 0, loopEnd: on ? end : 0,
      }).catch(() => {});
    }
  }

  clearLoop() { this.reader.port.postMessage({ t: 'loop', on: false }); }
  setSlip(on) { this.reader.port.postMessage({ t: 'slip', on }); }

  dispose() {
    this.reader.port.postMessage({ t: 'clear' });
    this.reader.disconnect();
    this.vinylGain.disconnect();
    this.lockGain.disconnect();
    try { this.stretch?.disconnect(); } catch {}
  }
}
