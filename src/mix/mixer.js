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
