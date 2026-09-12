/**
 * EQ de 3 bandas — ISOLADOR, não controle de tom.
 *
 * Por que não usar lowshelf/peaking/highshelf, que seria o óbvio:
 *
 *  1. Um lowshelf em −40 dB NÃO mata o grave. A banda de transição vaza, e
 *     numa troca de graves — a transição mais usada em DJ — você ouve os dois
 *     bumbos brigando mesmo com o knob no fim do curso.
 *  2. A fase de um shelf distorce o bumbo em relação às outras bandas.
 *  3. Dois shelves mais um peaking NÃO somam plano em ganho unitário, então a
 *     posição "neutra" já colore o som.
 *
 * DJ espera comportamento de isolador: três bandas complementares, cada uma
 * silenciável por completo. Isso se faz com uma árvore de crossovers
 * Linkwitz-Riley de 4ª ordem — dois Butterworth em cascata (Q = 0.7071) por
 * ramo. Um par LR4 passa-baixa/passa-alta soma PLANO em magnitude com a mesma
 * polaridade, que é o que faz a posição neutra ser de fato transparente.
 *
 *            ┌─ LP(fLM) → LP(fLM) ─────────────────────→ ganhoGrave ─┐
 *   entrada ─┤                                                       │
 *            └─ HP(fLM) → HP(fLM) ─┬─ LP(fMH) → LP(fMH) → ganhoMedio ┼→ saída
 *                                  └─ HP(fMH) → HP(fMH) → ganhoAgudo ┘
 */

/**
 * ARMADILHA DO WEB AUDIO, medida e confirmada:
 * para lowpass e highpass, o BiquadFilterNode interpreta Q em DECIBEIS, nao
 * como fator Q. Passar 0.7071 esperando Butterworth da um filtro RESSONANTE —
 * medi +1.41 dB na frequencia de corte onde deveria dar -3 dB, e a arvore LR4
 * somava +6.79 dB em 3 kHz em vez de plana.
 *
 * Butterworth exige fator Q = 1/sqrt(2), que em dB e:
 *   20 * log10(1/sqrt(2)) = -3.0103
 */
const Q_BUTTER = -3.0103;

/** Ganho sem clique: linear pode atravessar o zero; exponencial não chega nele. */
function rampa(param, alvo, ctx, ms = 12) {
  const t = ctx.currentTime;
  try { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); } catch {}
  param.linearRampToValueAtTime(alvo, t + ms / 1000);
}

export class EQ3 {
  /**
   * @param {AudioContext} ctx
   * @param {object} opts
   * @param {number} opts.fLM  corte grave/médio
   * @param {number} opts.fMH  corte médio/agudo
   */
  constructor(ctx, { fLM = 300, fMH = 2500 } = {}) {
    this.ctx = ctx;
    const filtro = (tipo, hz) => {
      const b = ctx.createBiquadFilter();
      b.type = tipo;
      b.frequency.value = hz;
      b.Q.value = Q_BUTTER;
      return b;
    };

    this.entrada = ctx.createGain();
    this.saida = ctx.createGain();

    // ramo grave
    const lp1 = filtro('lowpass', fLM), lp2 = filtro('lowpass', fLM);
    this.ganhoGrave = ctx.createGain();
    this.entrada.connect(lp1).connect(lp2).connect(this.ganhoGrave).connect(this.saida);

    // tudo acima do corte grave/médio
    const hp1 = filtro('highpass', fLM), hp2 = filtro('highpass', fLM);
    this.entrada.connect(hp1).connect(hp2);

    // ramo médio
    const lp3 = filtro('lowpass', fMH), lp4 = filtro('lowpass', fMH);
    this.ganhoMedio = ctx.createGain();
    hp2.connect(lp3).connect(lp4).connect(this.ganhoMedio).connect(this.saida);

    // ramo agudo
    const hp3 = filtro('highpass', fMH), hp4 = filtro('highpass', fMH);
    this.ganhoAgudo = ctx.createGain();
    hp2.connect(hp3).connect(hp4).connect(this.ganhoAgudo).connect(this.saida);

    this.ganhos = { grave: this.ganhoGrave, medio: this.ganhoMedio, agudo: this.ganhoAgudo };
    this.valores = { grave: 0.5, medio: 0.5, agudo: 0.5 };
    this.kill = { grave: false, medio: false, agudo: false };
    for (const b of ['grave', 'medio', 'agudo']) this.set(b, 0.5);
  }

  /**
   * Lei do knob: 0 → silêncio total, 0.5 → unitário, 1 → +6 dB.
   *
   * O expoente 2.5 no corte existe porque mapeamento linear deixa o terço
   * inferior do curso inútil — some tudo cedo demais. E abaixo de −26 dB a
   * gente FIXA em zero: "tudo à esquerda" tem que ser silêncio de verdade,
   * senão a troca de graves vaza.
   */
  static lei(v) {
    if (v <= 0.5) {
      const g = Math.pow(v * 2, 2.5);
      return g < 0.05 ? 0 : g;
    }
    return 1 + (v - 0.5) * 2 * (Math.pow(10, 6 / 20) - 1);
  }

  set(banda, v01) {
    this.valores[banda] = v01;
    if (this.kill[banda]) return;               // kill vence o knob
    rampa(this.ganhos[banda].gain, EQ3.lei(v01), this.ctx);
  }

  /** Kill instantâneo, com a rampa de 12 ms que evita o clique. */
  setKill(banda, ligado) {
    this.kill[banda] = ligado;
    rampa(this.ganhos[banda].gain, ligado ? 0 : EQ3.lei(this.valores[banda]), this.ctx);
  }

  get(banda) { return this.valores[banda]; }
  connect(n) { return this.saida.connect(n); }
  disconnect() { try { this.saida.disconnect(); } catch {} }
}

/**
 * Filtro de um knob só, como o Color FX do Pioneer.
 *
 * k ∈ [−1, +1], centro = passagem livre. À esquerda fecha o passa-baixa, à
 * direita abre o passa-alta. Dois polos por lado (24 dB/oitava) — é isso que
 * faz soar como filtro de DJ e não como controle de tom.
 */
export class FiltroCor {
  constructor(ctx) {
    this.ctx = ctx;
    const f = (tipo, hz) => {
      const b = ctx.createBiquadFilter();
      b.type = tipo; b.frequency.value = hz; b.Q.value = Q_BUTTER;
      return b;
    };
    this.entrada = ctx.createGain();
    this.lp1 = f('lowpass', 22050); this.lp2 = f('lowpass', 22050);
    this.hp1 = f('highpass', 16);   this.hp2 = f('highpass', 16);
    this.entrada.connect(this.lp1).connect(this.lp2)
                .connect(this.hp1).connect(this.hp2);
    this.saida = this.hp2;
    this.k = 0;
  }

  set(k) {
    this.k = Math.max(-1, Math.min(1, k));
    const exp = (a, b, x) => a * Math.pow(b / a, x);
    const lp = this.k <= 0 ? exp(30, 22050, 1 + this.k) : 22050;
    const hp = this.k >= 0 ? exp(16, 10000, this.k) : 16;
    // ressonância cresce com o curso: sem isso o filtro soa morto no extremo.
    // Em dB, porque e assim que o lowpass/highpass do Web Audio le o Q.
    const q = Q_BUTTER + 9 * Math.pow(Math.abs(this.k), 2);
    const t = this.ctx.currentTime, d = 0.02;
    for (const b of [this.lp1, this.lp2]) {
      b.frequency.cancelScheduledValues(t);
      b.frequency.exponentialRampToValueAtTime(Math.max(20, lp), t + d);
      b.Q.linearRampToValueAtTime(q, t + d);
    }
    for (const b of [this.hp1, this.hp2]) {
      b.frequency.cancelScheduledValues(t);
      b.frequency.exponentialRampToValueAtTime(Math.max(16, hp), t + d);
      b.Q.linearRampToValueAtTime(q, t + d);
    }
  }

  connect(n) { return this.saida.connect(n); }
  disconnect() { try { this.saida.disconnect(); } catch {} }
}

/**
 * Curvas de crossfader. `x` vai de 0 (só A) a 1 (só B).
 * `suave` mantém potência constante — é a de mixar. `dura` corta rápido nas
 * pontas — é a de scratch. `media` fica no meio.
 */
export function curvaCrossfader(x, curva = 'suave') {
  const t = Math.max(0, Math.min(1, x));
  if (curva === 'dura') {
    const a = t < 0.48 ? 1 : t > 0.52 ? 0 : (0.52 - t) / 0.04;
    const b = t > 0.52 ? 1 : t < 0.48 ? 0 : (t - 0.48) / 0.04;
    return { a, b };
  }
  if (curva === 'media') return { a: 1 - t, b: t };
  // potência constante: a soma dos quadrados é 1, então o volume percebido
  // não afunda no meio do curso
  return { a: Math.cos(t * Math.PI / 2), b: Math.sin(t * Math.PI / 2) };
}
