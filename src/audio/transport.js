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

/**
 * Promessa com prazo. Sem isto, qualquer ida e volta ao AudioWorklet trava pra
 * sempre se o contexto estiver suspenso — e travar é pior que falhar, porque
 * não há erro pra capturar nem pra mostrar.
 */
function comPrazo(promessa, ms, oQue) {
  let t;
  return Promise.race([
    Promise.resolve(promessa).finally(() => clearTimeout(t)),
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`${oQue} não respondeu em ${ms} ms`)), ms);
    }),
  ]);
}

const XFADE = 0.008; // 8 ms de crossfade no handoff
const SLAB_BITS = 19;
const SLAB = 1 << SLAB_BITS;

/**
 * Ganho sem clique: a trajetória do ganho tem que ser contínua.
 *
 * cancelAndHoldAtTime nao existe em todo navegador (historicamente o Safari
 * nao tinha). Sem guarda isso LANCA e derruba o handoff inteiro, em vez de
 * degradar. O plano B — cancelScheduledValues + fixar o valor atual — e um
 * pouco menos preciso mas nunca quebra.
 */
const TEM_HOLD = typeof AudioParam !== 'undefined' &&
                 typeof AudioParam.prototype.cancelAndHoldAtTime === 'function';

function ramp(param, alvo, quando, dur = 0.012) {
  try {
    if (TEM_HOLD) param.cancelAndHoldAtTime(quando);
    else { param.cancelScheduledValues(quando); param.setValueAtTime(param.value, quando); }
  } catch {
    try { param.setValueAtTime(param.value, quando); } catch {}
  }
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
      // analisador ENTRE o stretch e o ganho: mede o que o stretch produz, sem
      // ser enganado pelo próprio crossfade. É o sensor do cão de guarda abaixo.
      this.lockAnalyser = ctx.createAnalyser();
      this.lockAnalyser.fftSize = 256;
      this._buf = new Float32Array(this.lockAnalyser.fftSize);
      stretch.connect(this.lockAnalyser).connect(this.lockGain);
      this.lockGain.connect(destination);
    }
    this._cao = null;
    this.caoDerrubou = false;

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
  static async create(ctx, { destination, comKeylock = true, timeoutMs = 2500 } = {}) {
    let stretch = null, latency = 0;
    if (comKeylock) {
      try {
        // CADA await aqui e uma ida e volta de mensagem ate o AudioWorklet, e
        // worklet de contexto SUSPENSO nao processa mensagem. No iOS (onde todo
        // navegador e WebKit, inclusive o Chrome) o contexto fica suspenso ate
        // um gesto valido, entao latency() NUNCA resolvia e o create travava
        // pra sempre — sem erro, porque nao ha excecao, so um await eterno.
        // O deck nunca nascia e o app parecia morto.
        //
        // Regra: nada relacionado a keylock pode bloquear a criacao do deck.
        // Um deck sem keylock e um deck; nenhum deck e um app quebrado.
        const mod = await comPrazo(
          import('https://cdn.jsdelivr.net/npm/signalsmith-stretch@1.3.2/SignalsmithStretch.mjs'),
          timeoutMs, 'baixar o signalsmith');
        stretch = await comPrazo(mod.default(ctx), timeoutMs, 'criar o nó');
        await comPrazo(stretch.configure({ blockMs: AUDIO.keylockBlockMs }), timeoutMs, 'configure()');
        latency = await comPrazo(stretch.latency(), timeoutMs, 'latency()');
        // num contexto ao vivo o nó precisa ser iniciado; offline a renderização
        // puxa sozinha, e foi por isso que o gate não pegou isto.
        await comPrazo(stretch.start(), timeoutMs, 'start()').catch(() => {});
      } catch (e) {
        console.warn('[transport] seguindo sem keylock:', e.message);
        try { stretch?.disconnect(); } catch {}
        stretch = null;
        latency = 0;
      }
    }
    return new Transport(ctx, { destination, stretch, stretchLatency: latency });
  }

  /** Tenta ligar o keylock depois, quando o contexto já estiver rodando. */
  async tentarKeylockDepois() {
    if (this.stretch || this.ctx.state !== 'running') return false;
    try {
      const mod = await comPrazo(
        import('https://cdn.jsdelivr.net/npm/signalsmith-stretch@1.3.2/SignalsmithStretch.mjs'),
        2500, 'signalsmith');
      const st = await comPrazo(mod.default(this.ctx), 2500, 'nó');
      await comPrazo(st.configure({ blockMs: AUDIO.keylockBlockMs }), 2500, 'configure');
      this.stretchLatency = await comPrazo(st.latency(), 2500, 'latency');
      await comPrazo(st.start(), 2500, 'start').catch(() => {});
      this.lockAnalyser = this.ctx.createAnalyser();
      this.lockAnalyser.fftSize = 256;
      this._buf = new Float32Array(this.lockAnalyser.fftSize);
      st.connect(this.lockAnalyser).connect(this.lockGain);
      this.stretch = st;
      this.dispatchEvent(new CustomEvent('keylockDisponivel'));
      return true;
    } catch { return false; }
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
      // descarta o material da faixa anterior: sem isto o stretch acumula
      // buffers a cada carga e a posicao de entrada deixa de bater
      try { await this.stretch.dropBuffers(1e9); } catch {}
      // addBuffers recebe ARRAY de Float32Array. AudioBuffer dá DataCloneError.
      const canais = [];
      for (let c = 0; c < 2; c++) {
        canais.push(audioBuffer.getChannelData(Math.min(c, audioBuffer.numberOfChannels - 1)).slice());
      }
      await this.stretch.addBuffers(canais);
    }

    this.map = new TimeMap({ time: this.ctx.currentTime, pos: 0, rate: 0 });
    this.cuePoint = 0;
    this.caoDerrubou = false;   // faixa nova, chance nova
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
  get keylockPossivel() { return !this.motivoSemKeylock; }

  /**
   * POR QUE o keylock nao esta ativo, ou null se estiver tudo bem.
   * Antes a UI assumia que o unico motivo era a janela de qualidade, e mostrava
   * "suspenso fora de 0.70x-1.45x" mesmo com o pitch em +0.87% — mentira que o
   * usuario pegou na hora. Um motivo errado e pior que nenhum.
   */
  get motivoSemKeylock() {
    if (!this.stretch) return 'o motor de keylock não carregou';
    if (this.caoDerrubou) return 'desligado sozinho: o motor não produziu áudio';
    if (this.tocandoPrato) return 'suspenso enquanto você segura o prato';
    if (this.nominalRate < AUDIO.keylockMin || this.nominalRate > AUDIO.keylockMax) {
      return `fora da faixa de qualidade (${AUDIO.keylockMin}×–${AUDIO.keylockMax}×)`;
    }
    return null;
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
      if (this.playing) this.#soltarCao(T);
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

  /**
   * Cão de guarda do keylock.
   *
   * O gate offline aprovou o handoff, mas offline a renderização puxa o grafo
   * sozinha e esconde problemas que só existem com relógio ao vivo. Se o stretch
   * não produzir som depois da troca, o deck fica MUDO — e mudo é pior do que
   * tocar com o tom deslocado. Então: mede o que o stretch está produzindo e,
   * se for silêncio, volta pro vinil e avisa.
   */
  #soltarCao(T) {
    clearTimeout(this._cao);
    if (!this.lockAnalyser) return;
    const espera = Math.max(0, (T - this.ctx.currentTime) * 1000) + 400;
    this._cao = setTimeout(() => {
      if (this.tocando !== 'lock' || !this.playing) return;
      const ler = () => {
        this.lockAnalyser.getFloatTimeDomainData(this._buf);
        let s = 0;
        for (let i = 0; i < this._buf.length; i++) s += this._buf[i] * this._buf[i];
        return Math.sqrt(s / this._buf.length);
      };
      // DUAS leituras separadas por 250 ms: uma so pode cair num vale do sinal
      // (silencio entre batidas, breakdown) e condenar o keylock por engano
      const a1 = ler();
      if (a1 >= 1e-4) return;
      setTimeout(() => {
        if (this.tocando !== 'lock' || !this.playing) return;
        const a2 = ler();
        if (a2 >= 1e-4) return;
        this.caoDerrubou = true;
        this.#trocarMotor('vinyl');
        // NAO zera keylockPedido: o usuario pediu, e ao trocar de faixa ou
        // recarregar a gente tenta de novo em vez de desistir pra sempre
        this.dispatchEvent(new CustomEvent('keylockFalhou', {
          detail: { rms: a2, motivo: 'o motor de keylock ficou mudo; voltei pro vinil pra você não perder o som' },
        }));
      }, 250);
    }, espera);
  }

  #agendarStretch(quando, pos, taxa) {
    if (!this.stretch) return;
    const p = pos ?? this.map.positionAt(quando);
    // não await: estamos no caminho crítico. A latência já foi medida no init.
    this.stretch.schedule({ output: quando, active: true, input: p, rate: taxa, semitones: 0 })
      .catch((e) => this.dispatchEvent(new CustomEvent('keylockFalhou', {
        detail: { rms: null, motivo: 'schedule() rejeitou: ' + e.message },
      })));
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
