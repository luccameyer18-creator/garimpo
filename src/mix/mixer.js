/**
 * Mixer — dois canais, crossfader e master.
 *
 * Topologia por canal, na ordem do Pioneer (e por bons motivos):
 *
 *   deck → trim → EQ isolador → filtro de cor → fader → ganho do crossfader → master
 *                                    │
 *                                    └→ medidor (pós-EQ, PRÉ-fader)
 *
 * O trim vem primeiro pra que os boosts do EQ partam de um nível normalizado.
 * O filtro vem depois do EQ porque é assim no hardware, e porque filtrar antes
 * do EQ faria o kill de grave agir sobre um sinal já cortado.
 *
 * O medidor tapa PÓS-EQ e PRÉ-fader: é o que permite ver o que está entrando
 * no canal mesmo com o fader embaixo — que é exatamente a situação de quem
 * está preparando a próxima faixa.
 */

import { EQ3, FiltroCor, curvaCrossfader } from '../audio/eq3.js';

class Canal extends EventTarget {
  constructor(ctx, id, master) {
    super();
    this.ctx = ctx;
    this.id = id;

    this.entrada = ctx.createGain();      // o deck conecta aqui
    this.trim = ctx.createGain();
    this.eq = new EQ3(ctx);
    this.filtro = new FiltroCor(ctx);
    this.fader = ctx.createGain();
    this.xf = ctx.createGain();

    this.entrada.connect(this.trim);
    this.trim.connect(this.eq.entrada);
    this.eq.connect(this.filtro.entrada);
    this.filtro.connect(this.fader);
    this.fader.connect(this.xf).connect(master);

    /**
     * Tap de pré-escuta, PÓS-EQ e PRÉ-fader — igual ao medidor, e pelo mesmo
     * motivo: o ponto de um fone de DJ é ouvir a faixa que você está preparando
     * com o fader embaixo. Se o tap fosse pós-fader, o fone ficaria mudo
     * exatamente quando ele é útil.
     */
    this.cue = ctx.createGain();
    this.cue.gain.value = 0;           // fora até você pedir
    this.filtro.connect(this.cue);

    // medidor pós-EQ, pré-fader
    this.medidor = ctx.createAnalyser();
    this.medidor.fftSize = 256;
    this._buf = new Float32Array(this.medidor.fftSize);
    this.filtro.connect(this.medidor);

    this.valores = { trim: 0, fader: 1 };
    this.setFader(1);
  }

  /** dB, −24 a +12. */
  setTrim(db) {
    this.valores.trim = db;
    this.#rampa(this.trim.gain, Math.pow(10, db / 20));
  }

  /**
   * Fader de canal com curva. Linear no fader deixa o último quarto do curso
   * fazendo quase nada de audível; potência 1.6 aproxima a percepção.
   */
  setFader(v01) {
    this.valores.fader = v01;
    this.#rampa(this.fader.gain, Math.pow(Math.max(0, Math.min(1, v01)), 1.6));
  }

  /** Liga/desliga este canal na pré-escuta. */
  setCue(on) { this.cueLigado = !!on; this.#rampa(this.cue.gain, on ? 1 : 0); }

  setEq(banda, v) { this.eq.set(banda, v); }
  setKill(banda, on) { this.eq.setKill(banda, on); }
  setFiltro(k) { this.filtro.set(k); }

  /** Nível pós-EQ, pré-fader, em 0..1. */
  get nivel() {
    this.medidor.getFloatTimeDomainData(this._buf);
    let s = 0;
    for (let i = 0; i < this._buf.length; i++) s += this._buf[i] * this._buf[i];
    return Math.sqrt(s / this._buf.length);
  }

  #rampa(param, alvo) {
    const t = this.ctx.currentTime;
    try { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); } catch {}
    param.linearRampToValueAtTime(alvo, t + 0.012);
  }
}

export class Mixer extends EventTarget {
  constructor(ctx, { destination }) {
    super();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;

    /**
     * Limitador. NÃO é brickwall — o DynamicsCompressorNode deixa passar
     * transiente curto. Está aqui pra segurar o pico quando os dois decks
     * tocam juntos, que é onde o clipping aparece, não pra masterizar.
     */
    this.limitador = ctx.createDynamicsCompressor();
    this.limitador.threshold.value = -3;
    this.limitador.knee.value = 0;
    this.limitador.ratio.value = 20;
    this.limitador.attack.value = 0.003;
    this.limitador.release.value = 0.1;

    this.master.connect(this.limitador).connect(destination);

    this.medidorMaster = ctx.createAnalyser();
    this.medidorMaster.fftSize = 256;
    this._bufM = new Float32Array(this.medidorMaster.fftSize);
    this.limitador.connect(this.medidorMaster);

    this.canais = {
      A: new Canal(ctx, 'A', this.master),
      B: new Canal(ctx, 'B', this.master),
    };

    /**
     * Pré-escuta (fone) — segunda saída de áudio, sem segundo AudioContext.
     *
     * O caminho óbvio seria um AudioContext novo com `setSinkId` no fone. Não
     * dá: dois contextos têm relógios independentes e os nós de um não se
     * conectam ao outro, então os decks não poderiam alimentar os dois.
     *
     * O caminho que funciona é este: o barramento de cue continua NO MESMO
     * contexto (mesmo relógio, zero deriva), desagua num
     * MediaStreamAudioDestinationNode, e um <audio> toca esse stream com
     * `setSinkId(fone)`. A saída principal segue intocada.
     *
     * PREÇO, e é medido em `latenciaFone`: o trajeto pelo MediaStream acrescenta
     * atraso só no fone. Pra CONFERIR a batida serve; pra casar de ouvido só
     * pelo fone, não — o medidor de encaixe continua sendo a referência exata.
     * Por isso a pré-escuta nasce desligada e com aviso na tela.
     */
    this.cueBus = ctx.createGain();
    this.cueBus.gain.value = 0.8;
    for (const c of Object.values(this.canais)) c.cue.connect(this.cueBus);
    this.cueSaida = ctx.createMediaStreamDestination();
    this.cueBus.connect(this.cueSaida);
    this.foneEl = null;
    this.foneDeviceId = null;

    this.crossfader = 0.5;
    this.curva = 'suave';
    this.setCrossfader(0.5);
  }

  canal(id) { return this.canais[id]; }

  setCrossfader(x) {
    this.crossfader = Math.max(0, Math.min(1, x));
    const { a, b } = curvaCrossfader(this.crossfader, this.curva);
    const t = this.ctx.currentTime;
    for (const [id, g] of [['A', a], ['B', b]]) {
      const p = this.canais[id].xf.gain;
      try { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); } catch {}
      p.linearRampToValueAtTime(g, t + 0.012);
    }
    this.dispatchEvent(new CustomEvent('crossfader', { detail: { x: this.crossfader, a, b } }));
  }

  setCurva(c) { this.curva = c; this.setCrossfader(this.crossfader); }
  setMaster(v01) {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(Math.pow(v01, 1.6), t + 0.02);
  }

  get nivelMaster() {
    this.medidorMaster.getFloatTimeDomainData(this._bufM);
    let s = 0;
    for (let i = 0; i < this._bufM.length; i++) s += this._bufM[i] * this._bufM[i];
    return Math.sqrt(s / this._bufM.length);
  }

  /** Quanto o limitador está segurando, em dB. Acima de ~6 dB é sinal de trim alto. */
  get reducao() { return -this.limitador.reduction; }

  // ─────────────────────────── pré-escuta (fone) ───────────────────────────

  /** Liga o canal na pré-escuta. Vários canais ao mesmo tempo somam, como no hardware. */
  setCue(id, on) { this.canais[id]?.setCue(on); }
  get cueAtivos() { return Object.keys(this.canais).filter((k) => this.canais[k].cueLigado); }
  setCueVolume(v) {
    const t = this.ctx.currentTime;
    try { this.cueBus.gain.cancelScheduledValues(t); this.cueBus.gain.setValueAtTime(this.cueBus.gain.value, t); } catch {}
    this.cueBus.gain.linearRampToValueAtTime(Math.max(0, Math.min(1.5, v)), t + 0.02);
  }

  /**
   * Manda a pré-escuta pra um dispositivo de saída específico.
   *
   * `setSinkId` no <audio> é o que existe no navegador; no AudioContext ele
   * trocaria a saída PRINCIPAL, que é o oposto do que queremos.
   *
   * @returns {Promise<{ok:boolean, motivo?:string, latenciaMs:number}>}
   */
  async ligarFone(deviceId = null) {
    if (!this.foneEl) {
      const el = new Audio();
      el.srcObject = this.cueSaida.stream;
      el.autoplay = true;
      el.muted = false;
      this.foneEl = el;
    }
    try {
      if (deviceId && this.foneEl.setSinkId) await this.foneEl.setSinkId(deviceId);
      else if (deviceId && !this.foneEl.setSinkId) {
        return { ok: false, motivo: 'este navegador não deixa escolher a saída (setSinkId)', latenciaMs: 0 };
      }
      await this.foneEl.play();
      this.foneDeviceId = deviceId;
      return { ok: true, latenciaMs: this.latenciaFone };
    } catch (e) {
      return { ok: false, motivo: e?.message || String(e), latenciaMs: 0 };
    }
  }

  desligarFone() {
    try { this.foneEl?.pause(); } catch {}
    for (const id of Object.keys(this.canais)) this.setCue(id, false);
  }

  /**
   * Atraso extra do fone em relação à saída principal, em ms.
   *
   * É uma ESTIMATIVA: o trajeto MediaStream → <audio> → dispositivo não é
   * exposto pelo navegador. Usa a latência de saída do contexto como proxy e
   * soma um quantum de buffer do stream. Serve pra avisar a ordem de grandeza,
   * não pra compensar nada — e é por isso que não compenso nada com ela.
   */
  get latenciaFone() {
    const base = (this.ctx.outputLatency || this.ctx.baseLatency || 0.01) * 1000;
    return Math.round(base + 20);
  }

  /** Saídas de áudio disponíveis. Rótulo só aparece depois de permissão de microfone. */
  static async saidas() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const ds = await navigator.mediaDevices.enumerateDevices();
    return ds.filter((d) => d.kind === 'audiooutput')
             .map((d, i) => ({ id: d.deviceId, nome: d.label || `saída ${i + 1} (nome oculto)` }));
  }
}

/**
 * Diferença de fase entre dois decks, em frações de tempo com SINAL.
 *
 * É a medida que o professor vai usar, e é também o que o medidor de fase
 * desenha. Positivo = B está adiantado.
 *
 * Devolve null quando falta grid: é honesto dizer "não sei" em vez de
 * desenhar um número inventado.
 */
/**
 * TENTATIVA ABANDONADA, registrada porque o motivo importa.
 *
 * Escrevi aqui um medidor de encaixe que nao usava a grade: estimava a fase de
 * cada deck direto do envelope de ataque, em volta do ponteiro. A ideia era
 * contornar ancoras erradas.
 *
 * Duas versoes, as duas medidas e as duas descartadas:
 *
 *   1. Correlacao cruzada dos dois envelopes. Pico 0.11 contra segundo pico
 *      0.089 — proeminencia 1.24, ou seja ruido. Obvio em retrospecto: duas
 *      MUSICAS DIFERENTES nao tem por que ter envelopes parecidos, mesmo
 *      perfeitamente encaixadas. A pergunta estava errada.
 *
 *   2. Fase local de cada deck contra ele mesmo. Melhor, mas instavel: com os
 *      dois decks sincronizados e ninguem mexendo em nada, a leitura pulou de
 *      -9 ms pra 206 ms entre amostras (ambiguidade de contratempo), e num
 *      teste de calibracao adiantar o B em 60 ms mudou a leitura em 268 ms.
 *      Um medidor que erra 4x o que voce mandou nao pode comandar o ENCAIXAR —
 *      e nao comandou bem: a transicao que ele ajustou soou pior, e quem estava
 *      ouvindo percebeu antes de eu olhar o numero.
 *
 * O que resolveu de verdade foi outra coisa: a analise estava rodando so nos
 * primeiros 52 s (o prefixo que o deck baixa pra tocar rapido) e nunca era
 * refeita no arquivo completo. A grade da musica inteira saia da INTRODUCAO.
 * Corrigido isso (deck.js re-analisa no swap), a grade passou a bater com a
 * medida independente dentro de 13-28 ms, e e estavel por construcao, porque e
 * aritmetica e nao estimativa.
 *
 * Fica a licao: o medidor elaborado existia pra compensar um defeito que tinha
 * outra causa. Consertada a causa, ele nao tinha mais razao de existir.
 */

export function erroDeFase(deckA, deckB) {
  const gA = deckA?.grid, gB = deckB?.grid;
  if (!gA?.bpm || !gB?.bpm) return null;

  const faseDe = (deck, g) => {
    const pos = deck.displayPosition;
    const per = 60 / g.bpm;
    const p = (pos - g.ancora) / per;
    return p - Math.floor(p);
  };

  let d = faseDe(deckB, gB) - faseDe(deckA, gA);
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;

  const perMs = (60 / gA.bpm) * 1000;
  return { emTempos: d, emMs: d * perMs, bpmA: deckA.bpmEfetivo, bpmB: deckB.bpmEfetivo };
}
