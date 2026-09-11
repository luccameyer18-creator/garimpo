/**
 * TimeMap — mapa de tempo linear por segmentos: segundos de SAÍDA → segundos de
 * ENTRADA. É como a thread principal sabe onde o deck está sem integrar taxa a
 * 60 Hz (o que derivaria sem limite, porque o áudio consome a 48 kHz).
 *
 * Um segmento é { t0, p0, rate } e vale de t0 até o t0 do próximo:
 *
 *     pos(t) = p0 + (t - t0) * rate
 *
 * O worklet é a VERDADE e re-ancora este mapa ~60 vezes por segundo. Entre
 * âncoras o mapa extrapola analiticamente — exato enquanto a taxa está sob
 * controle agendado, e uma estimativa (que só afeta o desenho, nunca o áudio)
 * enquanto o usuário está girando o prato.
 *
 * glideTo() é a ÚNICA primitiva de mudança. Nudge de fase do SYNC, beat jump,
 * volta pro cue, catch-up do jog e a troca de keylock são todos uma chamada a
 * ela. É isso que mantém o transporte pequeno.
 *
 * Tempos em segundos do AudioContext. Posições em segundos de entrada (double).
 */

export class TimeMap {
  constructor({ pos = 0, rate = 0, time = 0 } = {}) {
    /** @type {{t0:number,p0:number,rate:number}[]} sempre ordenado por t0, nunca vazio */
    this.segs = [{ t0: time, p0: pos, rate }];
  }

  /** Posição de entrada no instante de saída `t`. */
  positionAt(t) {
    const s = this.segmentAt(t);
    return s.p0 + (t - s.t0) * s.rate;
  }

  /** Taxa vigente em `t`. */
  rateAt(t) {
    return this.segmentAt(t).rate;
  }

  /** O segmento que governa `t` (o último cujo t0 <= t; o primeiro se t for anterior). */
  segmentAt(t) {
    const segs = this.segs;
    if (t <= segs[0].t0) return segs[0];
    // busca binária: positionAt é chamado a cada frame de animação, por 2 decks
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].t0 <= t) lo = mid; else hi = mid - 1;
    }
    return segs[lo];
  }

  /**
   * Verdade vinda do worklet: substitui o passado, preserva o que está agendado
   * à frente. Sem isso o mapa é só um palpite; com isso ele é exato.
   */
  anchor({ time, pos, rate }) {
    const futuros = this.segs.filter((s) => s.t0 > time);
    this.segs = [{ t0: time, p0: pos, rate }, ...futuros];
    return this;
  }

  /**
   * Agenda uma mudança. Descarta qualquer coisa já agendada em t0 ou depois —
   * o comando mais recente vence.
   */
  push({ t0, p0, rate }) {
    const i = this.segs.findIndex((s) => s.t0 >= t0);
    if (i >= 0) this.segs.length = Math.max(i, 1); // nunca esvazia
    this.segs.push({ t0, p0, rate });
    return this;
  }

  /**
   * A primitiva. Estar EXATAMENTE em `targetPos` no instante `atTime`, partindo
   * de onde quer que estejamos, e depois seguir em `resumeRate`.
   *
   * Devolve o desvio de taxa que isso exige — o chamador pode recusar se for
   * grande demais. Correção de fase acima de ~6% é audível; abaixo disso soa
   * como um DJ acertando no jog, que é exatamente o que queremos.
   *
   * Um salto duro seria ouvido como engasgo. Um glide é desvio de taxa limitado.
   */
  glideTo(targetPos, atTime, resumeRate, { lookahead = 0.04, now = 0 } = {}) {
    const t0 = now + lookahead;
    if (atTime <= t0) {
      // sem janela pra deslizar: vira salto (só aceitável parado ou no cue)
      this.push({ t0: atTime, p0: targetPos, rate: resumeRate });
      return Infinity;
    }
    const p0 = this.positionAt(t0);
    const rate = (targetPos - p0) / (atTime - t0);
    this.push({ t0, p0, rate });
    this.push({ t0: atTime, p0: targetPos, rate: resumeRate });
    return rate - resumeRate; // desvio em relação ao que estaríamos fazendo
  }

  /**
   * Quanto tempo de saída até chegar em `pos`, na taxa vigente. Serve pro tempo
   * restante da faixa e pro aviso de fim. null se nunca chegar.
   */
  timeUntil(pos, from) {
    const s = this.segmentAt(from);
    if (s.rate === 0) return null;
    const dt = (pos - this.positionAt(from)) / s.rate;
    return dt >= 0 ? dt : null;
  }

  /** Poda segmentos que já passaram, deixando um de contexto. Evita crescer sem fim. */
  prune(before) {
    let i = 0;
    while (i + 1 < this.segs.length && this.segs[i + 1].t0 <= before) i++;
    if (i > 0) this.segs.splice(0, i);
    return this;
  }

  get length() { return this.segs.length; }
}
