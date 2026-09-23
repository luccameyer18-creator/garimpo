/**
 * O Jev decidindo como o DJ toca — um pedido por SET, não por transição.
 *
 * Divisão de trabalho, que é a da própria TypeSafe: o CÓDIGO executa (fase em
 * 0–6 ms, EQ, filtro, loop, andamento — medição e mecânica, onde código é
 * exato), e o JEV JULGA o que código não sabe julgar: qual técnica combina com
 * AQUELA dupla de músicas, no estilo escolhido.
 *
 * CUSTO. Como a fila do set é montada antes de tocar, todas as transições cabem
 * num pedido só: uma pergunta de técnica e uma de duração por transição, todas
 * sobre o mesmo estado. A TypeSafe avalia perguntas do mesmo pedido em
 * paralelo e cobra só os tokens extras delas. Medido: um par de faixas custou
 * 549 tokens de entrada e 507 ms; um set de 12 transições é UM pedido.
 *
 * POLÍTICA FICA NO CÓDIGO. O Jev escolhe a técnica, mas "tom que briga não se
 * sobrepõe" é regra de ofício, não gosto: se ele escolher mistura longa numa
 * dupla de tons incompatíveis, o código troca por eco. É o "keep policy
 * explicit" da documentação deles, e é o que impede um julgamento de gosto de
 * produzir 64 tempos de duas tonalidades brigando.
 *
 * SEM IA, NADA QUEBRA. Se o proxy não responder (sem chave, sem rede, sem
 * Worker ainda), `decidirSet` devolve null e o piloto usa o escolhedor por
 * estilo. A IA melhora o set; a ausência dela não o impede.
 */

import { TECNICAS, ESTILOS } from './tecnicas.js';

/**
 * Onde está o proxy. A chave NUNCA fica na página: a TypeSafe recusa chamada
 * de navegador (CORS) e o site é público.
 *   - local: o dev-server.mjs expõe /_jev lendo a chave de ~/.garimpo
 *   - publicado: o Worker da Cloudflare (URL definida quando ele existir)
 */
export const JEV_WORKER = '';   // ← preencher com a URL do Worker
export function urlJev() {
  if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return '/_jev';
  return JEV_WORKER || null;
}

const DURACOES = { curta: 16, frase: 32, longa: 64 };

/**
 * Cada técnica tem uma faixa de duração que faz sentido — e isso é regra, não
 * gosto, então fica no código.
 *
 * A técnica e a duração são perguntas separadas no mesmo pedido, e perguntas
 * do mesmo pedido "rodam em paralelo e não veem a resposta umas das outras"
 * (documentação da TypeSafe). Medido: o estilo turntablista voltou com
 * "mistura longa de EQ em 16 tempos", que é contraditório. A duração pedida é
 * respeitada quando cabe, e presa à faixa válida quando não cabe.
 */
const FAIXA_DURACAO = {
  corte: [8, 8], eco: [16, 16], loop: [16, 32],
  graves: [16, 64], filtro: [16, 64], blend: [32, 64],
};
function duracaoValida(tecnica, pedida) {
  const f = FAIXA_DURACAO[tecnica];
  if (!f) return pedida || null;
  const v = pedida || f[1];
  return Math.max(f[0], Math.min(f[1], v));
}

/** O que cada técnica é, em linguagem que o modelo entende. */
function criteriosTecnica() {
  const c = {};
  for (const [id, t] of Object.entries(TECNICAS)) c[id] = `${t.nome}: ${t.quando}`;
  return c;
}

/** Só o que ajuda a julgar — título e artista carregam muito do "clima". */
function resumoFaixa(f) {
  return {
    titulo: f.title, artista: f.artist, genero: f.genre || null,
    bpm: f.bpm, tom: f.camelot || null,
  };
}

/**
 * Decide técnica e duração de cada transição do set, num pedido só.
 *
 * @param {object[]} fila  faixas na ordem em que vão tocar
 * @param {string} estilo  chave de ESTILOS
 * @returns {Promise<null | { decisoes: object[], ms: number, tokens: object }>}
 */
export async function decidirSet(fila, estilo = 'pista', { signal } = {}) {
  const url = urlJev();
  if (!url || !fila || fila.length < 2) return null;
  const est = ESTILOS[estilo] || ESTILOS.pista;

  const state = {
    estilo_do_dj: { nome: est.nome, escola: est.escola, como_toca: est.como },
    faixas: fila.map(resumoFaixa),
  };

  const questions = {};
  for (let i = 0; i < fila.length - 1; i++) {
    const par = `from \`faixas[${i}]\` into \`faixas[${i + 1}]\``;
    questions[`t${i}_tecnica`] = {
      type: 'choice',
      instructions: `A DJ playing in the style described in \`estilo_do_dj\` is mixing ${par}. ` +
        'Which transition technique would this DJ use for this specific pair of tracks, ' +
        'considering both tracks\' genre, tempo, key and feel?',
      criteria: criteriosTecnica(),
    };
    questions[`t${i}_duracao`] = {
      type: 'choice',
      instructions: `How long should the overlap be when mixing ${par}, for a DJ in the style ` +
        'described in `estilo_do_dj`?',
      criteria: {
        curta: 'short: about 16 beats, a quick switch',
        frase: 'one phrase: about 32 beats, the standard dance-music transition',
        longa: 'long: about 64 beats, the two tracks play together for a while',
      },
    };
  }

  const t0 = performance.now();
  let r;
  try {
    r = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions }),
    });
  } catch { return null; }
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j?.answers) return null;

  const decisoes = [];
  for (let i = 0; i < fila.length - 1; i++) {
    const tec = j.answers[`t${i}_tecnica`];
    const dur = j.answers[`t${i}_duracao`];
    let tecnica = TECNICAS[tec?.choice] ? tec.choice : null;
    let porque = tecnica ? `${TECNICAS[tecnica].nome} (${Math.round((tec.probabilities?.[tecnica] ?? 0) * 100)}%)` : null;

    // política no código: tom que briga não se sobrepõe, diga o Jev o que disser
    const entra = fila[i + 1];
    const brigam = entra?.harmonicamenteOk === false || (entra?.nivel ?? 0) >= 2;
    if (tecnica && brigam && !['eco', 'corte'].includes(tecnica)) {
      porque = `Jev quis ${TECNICAS[tecnica].nome}, mas os tons brigam — virou echo out`;
      tecnica = 'eco';
    }

    decisoes.push({
      tecnica,
      tempos: duracaoValida(tecnica, DURACOES[dur?.choice]),
      confianca: tec?.confidence ?? null,
      porqueIA: porque,
    });
  }
  return { decisoes, ms: Math.round(performance.now() - t0), tokens: j.usage || null };
}

/**
 * Aplica as decisões na fila: a faixa i+1 carrega como entrar.
 * O piloto lê `faixa.tecnica` e `faixa.tempos` na hora da transição.
 */
export function aplicarDecisoes(fila, resultado) {
  if (!resultado?.decisoes) return fila;
  return fila.map((f, i) => {
    if (i === 0) return f;
    const d = resultado.decisoes[i - 1];
    return d?.tecnica ? { ...f, tecnica: d.tecnica, tempos: d.tempos, porqueIA: d.porqueIA } : f;
  });
}
