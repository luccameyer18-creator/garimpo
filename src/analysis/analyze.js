/**
 * Análise de faixa: BPM, beat grid e tom, no navegador, sem serviço externo.
 *
 * Destrava três coisas: arquivos locais passam a ter os mesmos dados que as
 * faixas do Audius; catálogos sem metadata (Internet Archive) viram usáveis;
 * e o SYNC e o professor ganham o beat grid, que é pré-requisito deles.
 *
 * Roda em Web Worker. A análise leva centenas de ms e travaria a interface.
 */

import { snapBpm, bpmWindow } from '../sources/audius.js';

const TAXA_ANALISE = 11025;   // 4x menos que 44.1k: suficiente até ~5 kHz
let worker = null;
let proximoId = 1;
const pendentes = new Map();

function obterWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./analyzer-worker.js', import.meta.url));
  worker.onmessage = (e) => {
    const p = pendentes.get(e.data.id);
    if (!p) return;
    pendentes.delete(e.data.id);
    e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.erro));
  };
  worker.onerror = (e) => {
    for (const p of pendentes.values()) p.rej(new Error('worker: ' + e.message));
    pendentes.clear();
    worker = null;   // deixa recriar na próxima
  };
  return worker;
}

/**
 * Mono decimado. Decimar reduz o custo em ~4x sem perder o que importa:
 * pulso mora abaixo de 200 Hz e a harmonia relevante abaixo de 2 kHz.
 * A média dos grupos serve de anti-aliasing barato — pular amostras direto
 * dobraria frequências altas pra dentro da banda e sujaria o cromagrama.
 */
function monoDecimado(buffer, taxaAlvo = TAXA_ANALISE) {
  const fator = Math.max(1, Math.round(buffer.sampleRate / taxaAlvo));
  const sr = buffer.sampleRate / fator;
  const canais = Math.min(2, buffer.numberOfChannels);
  const n = Math.floor(buffer.length / fator);
  const saida = new Float32Array(n);

  const dados = [];
  for (let c = 0; c < canais; c++) dados.push(buffer.getChannelData(c));

  for (let i = 0; i < n; i++) {
    let s = 0;
    const ini = i * fator;
    for (let c = 0; c < canais; c++) {
      const d = dados[c];
      for (let k = 0; k < fator; k++) s += d[ini + k] || 0;
    }
    saida[i] = s / (fator * canais);
  }
  return { mono: saida, sr };
}

/**
 * @param {AudioBuffer} buffer
 * @param {object} opts
 * @param {string|null} opts.genero  estreita a janela de BPM e desambigua oitava
 * @param {number|null} opts.bpmConhecido  se o Audius já deu, usamos como âncora
 */
export async function analisar(buffer, { genero = null, bpmConhecido = null, timeoutMs = 20000 } = {}) {
  const { mono, sr } = monoDecimado(buffer);

  // DUAS janelas diferentes, e confundi-las foi um erro meu que o teste pegou:
  //
  //   busca  — o intervalo onde o detector procura. Tem que ser LARGO. Usar a
  //            janela do gênero aqui faz o detector nao ENXERGAR nada fora
  //            dela: com House [112,135], 140 e 96 BPM ambos vinham como 137.
  //   snap   — o intervalo que desambigua oitava DEPOIS de detectar. Aí sim o
  //            gênero entra, porque 130 e 65 são o mesmo andamento e só o
  //            gênero diz qual dos dois escrever.
  //
  // A exceção é quando o BPM já é conhecido (metadata do Audius): aí a análise
  // serve pra achar a ÂNCORA e confirmar, não pra discordar, e a busca estreita
  // impede que ela "corrija" pra outra oitava.
  const janelaBusca = bpmConhecido
    ? { min: bpmConhecido * 0.94, max: bpmConhecido * 1.06 }
    : { min: 70, max: 190 };
  const janelaSnap = bpmConhecido
    ? { min: bpmConhecido * 0.9, max: bpmConhecido * 1.1 }
    : bpmWindow(genero);
  const janela = janelaBusca;

  const id = proximoId++;
  const w = obterWorker();

  const resultado = await new Promise((res, rej) => {
    pendentes.set(id, { res, rej });
    const t = setTimeout(() => {
      pendentes.delete(id);
      rej(new Error(`análise não respondeu em ${timeoutMs} ms`));
    }, timeoutMs);
    const limpar = (f) => (v) => { clearTimeout(t); f(v); };
    pendentes.set(id, { res: limpar(res), rej: limpar(rej) });
    w.postMessage({ id, mono: mono.buffer, sr, janela, bpmForcado: bpmConhecido }, [mono.buffer]);
  });

  /**
   * Quando o metadata existe e concorda em OITAVA, ele vence no valor fino.
   *
   * Isto contraria o que eu tinha escrito aqui antes ("metadata costuma ser
   * mais preciso" mas a grade usando a analise assim mesmo) — e contrariava a
   * medicao. Pontuei as duas hipoteses contra os ataques reais do audio, em
   * tres janelas de 20 s por faixa, em 10 faixas:
   *
   *   metadata venceu 6 · empate 4 · analise venceu 0
   *
   * e todo "empate" era caso em que as duas concordavam dentro de 0.15%. Ou
   * seja: quando discordam, a analise e que esta errada. Faz sentido — o
   * detector do Audius rodou no arquivo inteiro e o meu roda numa
   * autocorrelacao decimada, boa pra OITAVA e fraca pro valor fino.
   *
   * O erro custava caro: com a grade em 133 e a faixa em 129.8, o ENCAIXAR
   * alinhava contra uma grade errada e as batidas escorregavam logo depois.
   *
   * A ancora vem refeita NO BPM ESCOLHIDO pelo worker (bpmForcado), porque
   * grade com BPM de uma fonte e ancora de outra e grade incoerente.
   */
  let bpm = resultado.bpmBruto ? snapBpm(resultado.bpmBruto, janelaSnap) : null;
  let bpmFonte = 'analise';
  if (bpm && bpmConhecido) {
    const razao = bpmConhecido / bpm;
    const ehOitava = Math.abs(razao - 2) < 0.12 || Math.abs(razao - 0.5) < 0.06;
    if (!ehOitava && Math.abs(razao - 1) < 0.08) { bpm = bpmConhecido; bpmFonte = 'metadata'; }
  }

  /**
   * Trim sugerido pra faixa chegar no alvo. -14 dBFS RMS e o ponto onde
   * sobra espaco pro pico sem o limitador do master trabalhar o tempo todo.
   * Limitado a +/-12 dB: alem disso e faixa quebrada, e amplificar ruido.
   */
  const ALVO_DB = -14;
  let trimDb = 0;
  if (resultado.lufsAprox > -60) {
    trimDb = Math.max(-12, Math.min(12, ALVO_DB - resultado.lufsAprox));
    // nao deixa o pico estourar depois do trim
    const picoDepois = (resultado.pico || 0) * Math.pow(10, trimDb / 20);
    if (picoDepois > 0.99) trimDb -= 20 * Math.log10(picoDepois / 0.99);
  }

  return {
    volumeDb: Math.round(resultado.lufsAprox * 10) / 10,
    pico: Math.round((resultado.pico || 0) * 1000) / 1000,
    trimDb: Math.round(trimDb * 10) / 10,
    bpm,
    bpmFonte,
    bpmDetectado: resultado.bpmDetectado ? Math.round(resultado.bpmDetectado * 100) / 100 : null,
    bpmBruto: resultado.bpmBruto ? Math.round(resultado.bpmBruto * 100) / 100 : null,
    confianca: Math.round(resultado.confianca * 100) / 100,
    ancora: Math.round(resultado.ancora * 1000) / 1000,
    // envelope de ataque, pra quem for medir fase depois (ver mixer.faseLocal)
    onset: resultado.onset ? new Float32Array(resultado.onset) : null,
    taxaOnset: resultado.taxaOnset || null,
    tom: resultado.tom,
    camelot: resultado.camelot,
    forcaDoTom: Math.round(resultado.forcaDoTom * 100) / 100,
    ms: resultado.ms,
  };
}

/** Instante da batida de índice n, a partir do grid. */
export function tempoDaBatida(ancora, bpm, n) {
  return ancora + (n * 60) / bpm;
}

/** Fase dentro do compasso (0..1) numa posição qualquer. */
export function faseEm(ancora, bpm, pos) {
  const p = (pos - ancora) / (60 / bpm);
  return p - Math.floor(p);
}
