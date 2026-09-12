/**
 * Analisador de BPM, beat grid e tom. Roda em Web Worker.
 *
 * Worker clássico de propósito (não módulo): o import dentro de worker tem
 * suporte irregular, e este arquivo não precisa de nada de fora.
 *
 * Recebe PCM mono já decimado. NUNCA roda na thread principal nem na de áudio:
 * a análise leva centenas de ms e travaria a interface ou engasgaria o som.
 *
 * Saída: { bpm, confianca, ancora, batidas, tom, camelot, forcaDoTom }
 *   bpm      — arredondado pra valor musical
 *   ancora   — segundos até a PRIMEIRA batida. Sem isto o BPM sozinho não
 *              posiciona o grid, e o SYNC não tem fase pra alinhar.
 */

// ─────────────────────────── envelope de onset ───────────────────────────

/**
 * Passa-baixa de um polo, aplicado N vezes. Barato e suficiente pra isolar
 * o bumbo, que é o que carrega o pulso em música eletrônica.
 */
function passaBaixa(x, sr, corte, vezes = 2) {
  const y = Float32Array.from(x);
  const dt = 1 / sr, rc = 1 / (2 * Math.PI * corte), a = dt / (rc + dt);
  for (let v = 0; v < vezes; v++) {
    let ant = y[0];
    for (let i = 1; i < y.length; i++) { ant += a * (y[i] - ant); y[i] = ant; }
  }
  return y;
}

function passaAlta(x, sr, corte) {
  const y = new Float32Array(x.length);
  const dt = 1 / sr, rc = 1 / (2 * Math.PI * corte), a = rc / (rc + dt);
  let antX = x[0], antY = 0;
  for (let i = 1; i < x.length; i++) {
    antY = a * (antY + x[i] - antX);
    antX = x[i];
    y[i] = antY;
  }
  return y;
}

/**
 * Função de onset: energia em duas bandas, derivada e retificada.
 *
 * Duas bandas porque só o grave perde a batida em faixas sem bumbo marcado,
 * e só o agudo confunde hi-hat com batida. A soma se comporta melhor que
 * qualquer uma sozinha.
 */
function envelopeDeOnset(mono, sr, hop) {
  const grave = passaBaixa(mono, sr, 180, 2);
  const agudo = passaAlta(mono, sr, 4000);
  const n = Math.floor(mono.length / hop);
  const eGrave = new Float32Array(n), eAgudo = new Float32Array(n);

  for (let f = 0; f < n; f++) {
    let sg = 0, sa = 0;
    const ini = f * hop, fim = ini + hop;
    for (let i = ini; i < fim; i++) { sg += grave[i] * grave[i]; sa += agudo[i] * agudo[i]; }
    eGrave[f] = Math.sqrt(sg / hop);
    eAgudo[f] = Math.sqrt(sa / hop);
  }

  // derivada com retificação de meia-onda: só o que SOBE marca ataque
  const onset = new Float32Array(n);
  for (let f = 1; f < n; f++) {
    const dg = eGrave[f] - eGrave[f - 1];
    const da = eAgudo[f] - eAgudo[f - 1];
    onset[f] = Math.max(0, dg) * 2 + Math.max(0, da);
  }

  // normaliza pela média móvel: um refrão alto não pode dominar a intro
  const jan = Math.round(sr / hop * 1.5);
  const saida = new Float32Array(n);
  let soma = 0;
  for (let f = 0; f < n; f++) {
    soma += onset[f];
    if (f >= jan) soma -= onset[f - jan];
    const media = soma / Math.min(f + 1, jan);
    saida[f] = media > 1e-9 ? Math.max(0, onset[f] / media - 1) : 0;
  }
  return saida;
}

// ─────────────────────────── tempo ───────────────────────────

/**
 * Autocorrelação com soma harmônica.
 *
 * Autocorrelação crua confunde oitava: 120 BPM pontua alto em 60 e em 240.
 * Somar o valor em lag, lag/2, lag*2 e lag*3 privilegia o andamento que
 * explica TODOS os múltiplos, que é o verdadeiro.
 */
function estimarBpm(onset, taxaQuadro, { min = 70, max = 190 } = {}) {
  const lagMin = Math.floor(taxaQuadro * 60 / max);
  const lagMax = Math.ceil(taxaQuadro * 60 / min);
  const n = onset.length;
  if (lagMax >= n / 2) return { bpm: null, confianca: 0 };

  const ac = new Float32Array(lagMax + 1);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += onset[i] * onset[i + lag];
    ac[lag] = s / (n - lag);
  }

  let melhor = -1, melhorLag = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let pont = ac[lag];
    for (const m of [2, 3, 4]) {                 // múltiplos: meia, um terço...
      const l = Math.round(lag / m);
      if (l >= lagMin) pont += ac[l] * (1 / m);
    }
    for (const m of [2, 3]) {                    // submúltiplos
      const l = lag * m;
      if (l <= lagMax) pont += ac[l] * (1 / m);
    }
    if (pont > melhor) { melhor = pont; melhorLag = lag; }
  }
  if (!melhorLag) return { bpm: null, confianca: 0 };

  // interpolação parabólica: o pico verdadeiro fica entre dois lags inteiros,
  // e sem isto o erro chega a 1 BPM — o bastante pra descolar um mix longo
  const y0 = ac[melhorLag - 1] || 0, y1 = ac[melhorLag], y2 = ac[melhorLag + 1] || 0;
  const den = y0 - 2 * y1 + y2;
  const ajuste = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
  const lagFino = melhorLag + Math.max(-0.5, Math.min(0.5, ajuste));

  let media = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) media += ac[lag];
  media /= (lagMax - lagMin + 1);

  return {
    bpm: taxaQuadro * 60 / lagFino,
    confianca: media > 1e-12 ? Math.min(1, (melhor / media - 1) / 4) : 0,
  };
}

/** Fase do grid: qual deslocamento faz as batidas caírem nos onsets. */
function acharAncora(onset, taxaQuadro, bpm) {
  const periodo = taxaQuadro * 60 / bpm;
  const passos = Math.max(8, Math.round(periodo));
  let melhor = -1, melhorFase = 0;
  for (let p = 0; p < passos; p++) {
    const fase = (p / passos) * periodo;
    let soma = 0, k = 0;
    for (let t = fase; t < onset.length; t += periodo, k++) {
      const i = Math.round(t);
      // janela de 1 quadro pra cada lado: o onset nunca cai exato no inteiro
      soma += Math.max(onset[i - 1] || 0, onset[i] || 0, onset[i + 1] || 0);
    }
    if (k && soma / k > melhor) { melhor = soma / k; melhorFase = fase; }
  }
  return melhorFase / taxaQuadro;   // segundos
}

// ─────────────────────────── tom ───────────────────────────

const NOTAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Krumhansl-Schmuckler: perfis de quanto cada grau "pertence" a uma tonalidade
const PERFIL_MAIOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PERFIL_MENOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MINOR_CAMELOT = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
const MAJOR_CAMELOT = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];

/** Goertzel: energia numa frequência só. Mais barato que FFT quando são poucas. */
function goertzel(x, ini, n, sr, hz) {
  const w = 2 * Math.PI * hz / sr, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0, s0;
  const fim = Math.min(ini + n, x.length);
  for (let i = ini; i < fim; i++) { s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

function cromagrama(mono, sr) {
  const croma = new Float64Array(12);
  const jan = Math.round(sr * 0.25);            // 250 ms por janela
  const passo = jan * 4;                        // amostra 1 em cada 4: basta
  // 3 oitavas a partir de C3: onde mora a harmonia em música de pista
  const oitavas = [3, 4, 5];
  for (let ini = 0; ini + jan < mono.length; ini += passo) {
    for (let pc = 0; pc < 12; pc++) {
      let e = 0;
      for (const oit of oitavas) {
        const hz = 440 * Math.pow(2, (pc - 9) / 12 + (oit - 4));
        if (hz < sr / 2.2) e += goertzel(mono, ini, jan, sr, hz);
      }
      croma[pc] += Math.sqrt(e);
    }
  }
  const soma = croma.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < 12; i++) croma[i] /= soma;
  return croma;
}

function correlacao(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function detectarTom(mono, sr) {
  const croma = cromagrama(mono, sr);
  let melhor = -2, pc = 0, menor = false;
  for (let r = 0; r < 12; r++) {
    const girado = new Float64Array(12);
    for (let i = 0; i < 12; i++) girado[i] = croma[(i + r) % 12];
    const cM = correlacao(girado, PERFIL_MAIOR);
    const cm = correlacao(girado, PERFIL_MENOR);
    if (cM > melhor) { melhor = cM; pc = r; menor = false; }
    if (cm > melhor) { melhor = cm; pc = r; menor = true; }
  }
  return {
    tom: `${NOTAS[pc]} ${menor ? 'min' : 'maj'}`,
    camelot: (menor ? MINOR_CAMELOT : MAJOR_CAMELOT)[pc] + (menor ? 'A' : 'B'),
    forcaDoTom: Math.max(0, melhor),
  };
}

// ─────────────────────────── entrada ───────────────────────────

self.onmessage = (e) => {
  const { mono, sr, janela, id } = e.data;
  const t0 = performance.now();
  try {
    const x = new Float32Array(mono);
    const hop = 128;
    const taxaQuadro = sr / hop;

    const onset = envelopeDeOnset(x, sr, hop);
    const { bpm: bruto, confianca } = estimarBpm(onset, taxaQuadro, janela);
    let bpm = null, ancora = 0;
    if (bruto) {
      bpm = bruto;
      ancora = acharAncora(onset, taxaQuadro, bpm);
    }
    const tom = detectarTom(x, sr);

    self.postMessage({
      id, ok: true, bpmBruto: bpm, confianca, ancora,
      ...tom, ms: Math.round(performance.now() - t0),
    });
  } catch (err) {
    self.postMessage({ id, ok: false, erro: err.message });
  }
};
