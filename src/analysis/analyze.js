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
    w.postMessage({ id, mono: mono.buffer, sr, janela }, [mono.buffer]);
  });

  const bpm = resultado.bpmBruto ? snapBpm(resultado.bpmBruto, janelaSnap) : null;

  return {
    bpm,
    bpmBruto: resultado.bpmBruto ? Math.round(resultado.bpmBruto * 100) / 100 : null,
    confianca: Math.round(resultado.confianca * 100) / 100,
    ancora: Math.round(resultado.ancora * 1000) / 1000,
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
