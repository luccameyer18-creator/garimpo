/**
 * turntable-reader — o leitor de prato do Garimpo.
 *
 * REGRAS DURAS (quebrar qualquer uma causa glitch ou quebra silenciosa):
 *   1. ZERO import. Este arquivo é carregado por addModule() e roda no
 *      AudioWorkletGlobalScope. Constantes compartilhadas vêm por processorOptions.
 *   2. ZERO alocação dentro de process(). Nada de new, nada de literal de array/objeto.
 *   3. ZERO postMessage por quantum. Reportar a ~60 Hz, não a 375 Hz.
 *   4. process() SEMPRE retorna true. Silêncio se produz lendo zeros, nunca morrendo.
 *   5. ZERO console.log.
 *
 * Ele é a VERDADE da posição. A thread principal mantém um mapa de tempo que é
 * re-ancorado por estas mensagens; nunca o contrário.
 *
 * Posições em mensagens: SEGUNDOS de entrada (double).
 * Posições internas: FRAMES de entrada (double).
 */

const SLAB_BITS = 19;
const SLAB = 1 << SLAB_BITS; // 524288 frames ~ 10.9 s @ 48 kHz
const MASK = SLAB - 1;
const XF_LEN = 128; // crossfade de descontinuidade (~2.7 ms)
const RATE_EPS = 1e-6; // abaixo disso o prato está parado => silêncio
const MAX_RATE = 8; // sanidade: busca rápida não precisa de fidelidade

class TurntableReader extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};

    // --- PCM em lajes, uma lista por canal ---
    this.ch = [[], []];
    this.len = 0; // frames disponíveis (cresce durante streaming)

    // --- posição e taxa (a verdade) ---
    this.pos = 0; // frame de entrada fracionário
    this.shadow = 0; // playhead do SLIP: anda no nominal, ignora loop e scratch
    this.rate = 0; // taxa instantânea, suavizada
    this.target = 0; // taxa comandada
    this.nominal = 1; // taxa "tocando normal" (pitch aplicado)
    this.active = false; // false => saída zerada sem perder a posição

    // one-pole por sample na taxa: mata o ruído de zíper do jog
    const tau = o.rateTau || 0.004;
    this.k = 1 - Math.exp(-1 / (tau * sampleRate));

    // --- loop / slip ---
    this.loopOn = false;
    this.loopStart = 0; // frames
    this.loopEnd = 0;
    this.slip = false;

    // --- crossfade de descontinuidade (seek, volta de loop, hot cue) ---
    this.xfN = 0;
    this.xfPos = 0;
    this.xfRate = 0;

    // --- segmentos agendados pela thread principal ---
    // arrays paralelos para não alocar objetos em process()
    this.segFrame = [];
    this.segPos = [];
    this.segRate = [];
    this.segNominal = [];

    // --- telemetria ---
    this.reportEvery = Math.max(1, (sampleRate / 60) | 0);
    this.reportIn = 0;
    this.seq = 0;
    this.underruns = 0; // leituras fora do PCM disponível com active=true

    // Detector de falha de áudio que NÃO depende de AudioContext.renderCapacity
    // (ausente no Chrome 152 — medido). Se a thread de render perder o prazo, o
    // quantum seguinte chega com currentFrame adiantado: o buraco é exatamente
    // o áudio que não foi produzido. É medição direta, não estimativa.
    this.lastEnd = 0;
    this.glitchFrames = 0;
    this.glitchCount = 0;

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  // ───────────────────────────────── mensagens ─────────────────────────────────
  onMessage(m) {
    switch (m.t) {
      case 'slab': {
        // laje de PCM, ArrayBuffer transferido (zero-copy)
        this.ch[m.c][m.index] = new Float32Array(m.data);
        if (m.len > this.len) this.len = m.len;
        break;
      }
      case 'clear':
        this.ch[0].length = 0;
        this.ch[1].length = 0;
        this.len = 0;
        this.pos = 0;
        this.shadow = 0;
        this.rate = 0;
        this.target = 0;
        this.active = false;
        this.loopOn = false;
        this.slip = false;
        this.xfN = 0;
        this.segFrame.length = 0;
        this.segPos.length = 0;
        this.segRate.length = 0;
        this.segNominal.length = 0;
        this.underruns = 0;
        break;
      case 'seg': // mudança agendada de posição e/ou taxa
        this.pushSeg(m.frame, m.pos, m.rate, m.nominal);
        break;
      case 'rate': // mudança imediata de taxa (jog, pitch ao vivo)
        this.target = this.clampRate(m.rate);
        if (m.nominal !== undefined) this.nominal = m.nominal;
        break;
      case 'jump': // seek imediato com crossfade
        this.armXf();
        this.pos = m.pos * sampleRate;
        if (m.alsoShadow !== false) this.shadow = this.pos;
        break;
      case 'active':
        this.active = !!m.on;
        if (!m.on) this.target = 0;
        break;
      case 'loop':
        this.loopOn = !!m.on;
        if (m.start !== undefined) this.loopStart = m.start * sampleRate;
        if (m.end !== undefined) this.loopEnd = m.end * sampleRate;
        break;
      case 'slip':
        if (!!m.on === this.slip) break;
        this.slip = !!m.on;
        if (this.slip) this.shadow = this.pos; // a sombra começa onde estamos
        else {
          this.armXf(); // colapsa na sombra
          this.pos = this.shadow;
        }
        break;
      case 'ping':
        this.report();
        break;
    }
  }

  pushSeg(frame, pos, rate, nominal) {
    // descarta segmentos já agendados em frame >= este (substituição)
    while (this.segFrame.length && this.segFrame[this.segFrame.length - 1] >= frame) {
      this.segFrame.pop();
      this.segPos.pop();
      this.segRate.pop();
      this.segNominal.pop();
    }
    this.segFrame.push(frame);
    this.segPos.push(pos === undefined ? null : pos); // segundos, ou null = manter posição
    this.segRate.push(rate === undefined ? null : rate);
    this.segNominal.push(nominal === undefined ? null : nominal);
  }

  clampRate(r) {
    if (!(r === r)) return 0; // NaN
    if (r > MAX_RATE) return MAX_RATE;
    if (r < -MAX_RATE) return -MAX_RATE;
    return r;
  }

  armXf() {
    this.xfPos = this.pos;
    this.xfRate = this.rate;
    this.xfN = XF_LEN;
  }

  // ───────────────────────────────── leitura ─────────────────────────────────
  /** Hermite cúbico de 4 pontos (Catmull-Rom). Linear abafa a oitava de cima em 1.08x. */
  read(c, p) {
    const i = Math.floor(p);
    const f = p - i;
    const y0 = this.sample(c, i - 1);
    const y1 = this.sample(c, i);
    const y2 = this.sample(c, i + 1);
    const y3 = this.sample(c, i + 2);
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }

  sample(c, i) {
    if (i < 0 || i >= this.len) return 0;
    const slab = this.ch[c][i >>> SLAB_BITS];
    if (slab === undefined) return 0; // laje ainda não chegou (streaming)
    return slab[i & MASK];
  }

  wrap() {
    const span = this.loopEnd - this.loopStart;
    if (span <= 0) return;
    if (this.rate >= 0) {
      if (this.pos >= this.loopEnd) {
        this.armXf();
        this.pos -= span;
      }
    } else if (this.pos < this.loopStart) {
      this.armXf();
      this.pos += span;
    }
  }

  applySegsAt(frame) {
    while (this.segFrame.length && this.segFrame[0] <= frame) {
      this.segFrame.shift();
      const p = this.segPos.shift();
      const r = this.segRate.shift();
      const n = this.segNominal.shift();
      if (p !== null) {
        const target = p * sampleRate;
        if (Math.abs(target - this.pos) > 1) this.armXf();
        this.pos = target;
        if (!this.slip) this.shadow = this.pos;
      }
      if (r !== null) {
        this.target = this.clampRate(r);
        this.rate = this.target; // mudança agendada é exata, não suavizada
      }
      if (n !== null) this.nominal = n;
    }
  }

  // ───────────────────────────────── process ─────────────────────────────────
  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out.length > 1 ? out[1] : out[0];
    const n = L.length;
    const base = currentFrame;

    // buraco entre o fim do quantum anterior e o início deste = áudio perdido
    if (this.lastEnd && base > this.lastEnd) {
      this.glitchFrames += base - this.lastEnd;
      this.glitchCount++;
    }
    this.lastEnd = base + n;

    for (let i = 0; i < n; i++) {
      if (this.segFrame.length && this.segFrame[0] <= base + i) this.applySegsAt(base + i);

      // suavização da taxa: é isto que impede crackle no jog
      this.rate += (this.target - this.rate) * this.k;
      if (this.rate > -RATE_EPS && this.rate < RATE_EPS) this.rate = 0;

      // prato parado não faz som (e não deixa DC na saída)
      if (!this.active || (this.rate === 0 && this.xfN === 0)) {
        L[i] = 0;
        R[i] = 0;
        if (this.slip) this.shadow += this.nominal;
        continue;
      }

      let l = this.read(0, this.pos);
      let r = this.read(1, this.pos);

      if (this.xfN > 0) {
        // equal-gain: some o clique de toda descontinuidade
        const a = this.xfN / XF_LEN;
        l = l * (1 - a) + this.read(0, this.xfPos) * a;
        r = r * (1 - a) + this.read(1, this.xfPos) * a;
        this.xfPos += this.xfRate;
        this.xfN--;
      }

      L[i] = l;
      R[i] = r;

      if (this.pos < 0 || this.pos >= this.len) this.underruns++;

      this.pos += this.rate;
      this.shadow += this.nominal;
      if (this.loopOn) this.wrap(); // no slip, pos faz loop e shadow segue reto
    }

    this.reportIn -= n;
    if (this.reportIn <= 0) {
      this.reportIn = this.reportEvery;
      this.report();
    }
    return true;
  }

  report() {
    this.port.postMessage({
      t: 'anchor',
      time: currentTime,
      frame: currentFrame,
      pos: this.pos / sampleRate,
      shadow: this.shadow / sampleRate,
      rate: this.rate,
      nominal: this.nominal,
      active: this.active,
      len: this.len / sampleRate,
      underruns: this.underruns,
      glitchCount: this.glitchCount,
      glitchMs: (this.glitchFrames / sampleRate) * 1000,
      seq: ++this.seq,
    });
  }
}

registerProcessor('turntable-reader', TurntableReader);
