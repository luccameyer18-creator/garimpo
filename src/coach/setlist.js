/**
 * O set inteiro, montado pelo professor — e tocado por ele, se você quiser.
 *
 * Nasceu de um teste: pra provar que as transições encaixavam, montei à mão uma
 * corrente de 11 faixas de 30 minutos alternando disco, house, funk, brega e
 * reggaeton, e rodei. Funcionou (3 ms de erro de fase nas três transições
 * medidas), e a pergunta seguinte foi óbvia: por que isso é um script meu e não
 * um botão?
 *
 * A montagem é busca gulosa com quatro custos, nesta ordem de peso:
 *
 *   HARMONIA   — roda de Camelot. Tom brigando é o erro que mais se ouve.
 *   ANDAMENTO  — a próxima tem que caber no pitch (±4%) e empurrar o BPM
 *                devagar pra cima, que é como energia sobe sem parecer pressa.
 *   VARIEDADE  — repetir o mesmo gênero seguido custa caro (peso 6), e repetir
 *                o de duas faixas atrás custa um pouco (peso 2). É o que faz um
 *                set alternar ritmo em vez de virar uma faixa de 30 minutos.
 *   REPETIÇÃO  — faixa já usada não volta. Óbvio, e eu esqueci disso no
 *                primeiro teste: o set repetiu uma música.
 *
 * A semente é escolhida testando VÁRIAS: monta-se uma corrente a partir de cada
 * candidata plausível e fica a que rende mais faixas, mais gêneros distintos e
 * duração perto da pedida. Montar 40 correntes de 11 passos é barato — são
 * contas sobre metadata que já está na memória.
 */

import { keyCompatible, trending, crateBr } from '../sources/audius.js';

/** As pilhas que o professor conhece, e como buscar cada uma. */
export const PILHAS = [
  { nome: 'Disco',     buscar: () => trending({ genre: 'Disco', limit: 50 }) },
  { nome: 'House',     buscar: () => trending({ genre: 'House', limit: 50 }) },
  { nome: 'Deep house',buscar: () => trending({ genre: 'Deep House', limit: 50 }) },
  { nome: 'Tech house',buscar: () => trending({ genre: 'Tech House', limit: 50 }) },
  { nome: 'Techno',    buscar: () => trending({ genre: 'Techno', limit: 50 }) },
  { nome: 'Funk BR',   buscar: () => crateBr('Funk', { limite: 50 }) },
  { nome: 'Brega',     buscar: () => crateBr('Brega funk', { limite: 50 }) },
  { nome: 'Reggaeton', buscar: () => crateBr('Reggaeton', { limite: 50 }) },
  { nome: 'Guaracha',  buscar: () => crateBr('Guaracha', { limite: 50 }) },
  { nome: 'Pagode',    buscar: () => crateBr('Pagode', { limite: 50 }) },
];

/**
 * Junta candidatas de várias pilhas, já filtradas pelo que serve num deck.
 *
 * A faixa de BPM não é decoração: misturar 95 com 130 não é set alternado, é
 * duas festas. O que dá pra alternar de verdade é ritmo e gênero DENTRO de uma
 * faixa de andamento comum — que é como um DJ de pista trabalha.
 */
export async function juntarCandidatas({ pilhas = null, bpmMin = 118, bpmMax = 134,
                                         durMin = 90, durMax = 420, signal } = {}) {
  const quero = pilhas?.length ? PILHAS.filter((p) => pilhas.includes(p.nome)) : PILHAS;
  const fora = [];
  const vistas = new Set();
  for (const p of quero) {
    try {
      for (const t of await p.buscar({ signal })) {
        if (!t.bpm || !t.camelot || t.isLongMix) continue;
        if (t.duration < durMin || t.duration > durMax) continue;
        if (t.bpm < bpmMin || t.bpm > bpmMax) continue;
        if (vistas.has(t.id)) continue;
        vistas.add(t.id);
        fora.push({ ...t, pilha: p.nome });
      }
    } catch { /* uma pilha fora do ar não derruba o set */ }
  }
  return fora;
}

/** Uma corrente a partir de uma semente. */
function corrente(semente, candidatas, { minutos, energia }) {
  const usadas = new Set([semente.id]);
  const fila = [semente];
  // 0.8 porque as transições se sobrepõem: ninguém toca a faixa inteira
  let dur = semente.duration * 0.8;
  let atual = semente;

  const passo = energia === 'subir' ? 1.012 : energia === 'descer' ? 0.988 : 1;

  while (dur < minutos * 60 && fila.length < 24) {
    const alvo = atual.bpm * passo;
    const cands = candidatas.filter((t) => {
      if (usadas.has(t.id)) return false;
      if (Math.abs(t.bpm / atual.bpm - 1) > 0.04) return false;
      return keyCompatible({ camelot: atual.camelot }, { camelot: t.camelot }).ok;
    });
    if (!cands.length) break;

    const anterior = fila[fila.length - 2];
    const custo = (t) => {
      const h = keyCompatible({ camelot: atual.camelot }, { camelot: t.camelot });
      return (h.distance ?? 0) * 3
           + Math.abs(t.bpm - alvo) / atual.bpm * 60
           + (t.pilha === atual.pilha ? 6 : 0)
           + (anterior && t.pilha === anterior.pilha ? 2 : 0);
    };
    cands.sort((a, b) => custo(a) - custo(b));
    const esc = cands[0];
    fila.push({ ...esc, deOndeVem: atual.title,
      motivo: keyCompatible({ camelot: atual.camelot }, { camelot: esc.camelot }).reason,
      pitch: esc.bpm / atual.bpm - 1 });
    usadas.add(esc.id);
    dur += esc.duration * 0.8;
    atual = esc;
  }
  return { fila, minutos: dur / 60 };
}

/**
 * Monta o set. Devolve a fila e como ela ficou.
 *
 * @param {object[]} candidatas  de juntarCandidatas()
 * @param {object} pref
 * @param {number} pref.minutos   duração alvo
 * @param {string} pref.energia   'subir' | 'estavel' | 'descer'
 * @param {object} pref.semente   faixa inicial; sem ela, o professor escolhe
 */
export function montarSet(candidatas, { minutos = 30, energia = 'subir', semente = null } = {}) {
  if (!candidatas?.length) return { fila: [], minutos: 0, generos: 0 };

  const sementes = semente ? [semente]
    : candidatas.filter((t) => t.bpm <= (energia === 'descer' ? 134 : 125))
                .slice(0, 40);
  if (!sementes.length) sementes.push(candidatas[0]);

  let melhor = null;
  for (const s of sementes) {
    const r = corrente(s, candidatas, { minutos, energia });
    const generos = new Set(r.fila.map((x) => x.pilha)).size;
    // quantas faixas, quantos gêneros, e quão perto da duração pedida
    const pontos = r.fila.length + generos * 4
                 + (Math.abs(r.minutos - minutos) < 6 ? 8 : 0)
                 - Math.abs(r.minutos - minutos) / 3;
    if (!melhor || pontos > melhor.pontos) melhor = { ...r, pontos, generos };
  }
  return { fila: melhor.fila, minutos: +melhor.minutos.toFixed(1), generos: melhor.generos };
}

/** Resumo em uma linha. */
export function resumoSet(s) {
  if (!s?.fila?.length) return 'sem set';
  const de = s.fila[0].bpm, ate = s.fila[s.fila.length - 1].bpm;
  return `${s.fila.length} faixas · ${s.generos} gêneros · ${de} → ${ate} BPM · ~${Math.round(s.minutos)} min`;
}
