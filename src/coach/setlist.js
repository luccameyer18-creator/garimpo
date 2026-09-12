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

/**
 * Distância entre dois tons na roda de Camelot, em passos.
 *
 * `keyCompatible` responde "encaixa ou não" — o que basta pra escolher a
 * próxima faixa, mas não pra CAMINHAR até uma faixa distante. 1A e 7A são
 * incompatíveis, e sem saber que estão a 6 passos um do outro o montador fica
 * vagando: pedi um set de 30 min com uma faixa fixa em 7A e ele encadeou 24
 * faixas sem nunca chegar lá.
 *
 * A roda tem 12 posições; trocar a letra (menor/maior) custa 1 passo a mais.
 */
function distanciaCamelot(a, b) {
  const ler = (c) => {
    const m = /^(\d{1,2})([AB])$/.exec(String(c || '').trim().toUpperCase());
    return m ? { n: +m[1], l: m[2] } : null;
  };
  const x = ler(a), y = ler(b);
  if (!x || !y) return 6;                       // desconhecido: trata como longe
  let d = Math.abs(x.n - y.n);
  if (d > 6) d = 12 - d;                        // a roda fecha em 12
  return d + (x.l === y.l ? 0 : 1);
}

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

/**
 * Uma corrente a partir de uma semente.
 *
 * `obrigatorias` são as faixas que VOCÊ escolheu e que o professor tem que
 * tocar. Elas não entram na ponta da fila de qualquer jeito: a cada passo, se
 * uma obrigatória ainda pendente encaixa (tom e andamento), ela ganha de
 * qualquer candidata livre. Se nenhuma encaixa agora, o professor põe uma faixa
 * de ligação e tenta de novo no passo seguinte — que é exatamente o que um DJ
 * faz pra chegar numa música que quer tocar mas que ainda não cabe.
 *
 * Uma obrigatória que nunca encaixa é devolvida em `naoCoube`, com o motivo. É
 * melhor dizer "esta não entrou porque está a 96 BPM e o set está em 128" do
 * que enfiá-la no meio e estragar o set em silêncio.
 */
function corrente(semente, candidatas, { minutos, energia, obrigatorias = [],
                                        recentes = null, sorte = 0 }) {
  const usadas = new Set([semente.id]);
  const fila = [semente];
  // 0.8 porque as transições se sobrepõem: ninguém toca a faixa inteira
  let dur = semente.duration * 0.8;
  let atual = semente;

  const pendentes = obrigatorias.filter((t) => t && t.id !== semente.id);
  const passo = energia === 'subir' ? 1.012 : energia === 'descer' ? 0.988 : 1;

  const encaixa = (de, t) =>
    !usadas.has(t.id) && t.bpm && Math.abs(t.bpm / de.bpm - 1) <= 0.04 &&
    keyCompatible({ camelot: de.camelot }, { camelot: t.camelot }).ok;

  /**
   * Teto de duração: o set pode esticar pra encaixar uma faixa que você
   * escolheu, mas não virar outro set. 25% além do pedido é a folga; passou
   * disso, quem sobrou vai pro `naoCoube` com o motivo.
   *
   * Sem este teto, um set de 30 min com uma faixa fixa inalcançável encadeava
   * 24 faixas — quase uma hora — atrás dela.
   */
  const teto = minutos * 60 * 1.25;

  while ((dur < minutos * 60 || (pendentes.length && dur < teto)) && fila.length < 24) {
    let esc = null;

    // 1. alguma obrigatória encaixa agora? ela tem prioridade absoluta
    const i = pendentes.findIndex((t) => encaixa(atual, t));
    if (i >= 0) esc = pendentes.splice(i, 1)[0];

    // 2. senão, a melhor candidata livre — e se ainda há obrigatória pendente,
    //    prefere a que APROXIMA o BPM da próxima obrigatória: é a faixa-ponte
    if (!esc) {
      const cands = candidatas.filter((t) => encaixa(atual, t));
      if (!cands.length) break;
      const alvo = pendentes.length
        ? (atual.bpm + pendentes[0].bpm) / 2     // caminha na direção dela
        : atual.bpm * passo;
      const anterior = fila[fila.length - 2];
      const custo = (t) => {
        const h = keyCompatible({ camelot: atual.camelot }, { camelot: t.camelot });
        let c = (h.distance ?? 0) * 3
              + Math.abs(t.bpm - alvo) / atual.bpm * 60
              + (t.pilha === atual.pilha ? 6 : 0)
              + (anterior && t.pilha === anterior.pilha ? 2 : 0)
              /**
               * MEMÓRIA e SORTE — é o que faz dois sets seguidos não serem o
               * mesmo set.
               *
               * O montador era puramente determinístico: mesmo pote, mesma
               * corrente, sempre. Quem apertou play três vezes ouviu as mesmas
               * duas faixas três vezes, e com razão reclamou.
               *
               * `recentes` são as faixas tocadas ultimamente — custam caro, mas
               * não são proibidas: num catálogo pequeno, proibir esvaziaria o
               * pote e o set morreria no terceiro passo.
               *
               * `sorte` é um empurrãozinho aleatório por candidata. Pequeno de
               * propósito: grande demais e ele escolheria mal só pra variar.
               * Com 3.5, faixas quase empatadas trocam de ordem e as claramente
               * melhores continuam ganhando.
               */
              + (recentes?.has(t.id) ? 14 : 0)
              + Math.random() * sorte;
        if (pendentes.length) {
          // ponte boa é a que CAMINHA até a obrigatória: menos passos de roda
          // que a faixa atual, e melhor ainda se já a deixa alcançável
          const agora = distanciaCamelot(atual.camelot, pendentes[0].camelot);
          const depois = distanciaCamelot(t.camelot, pendentes[0].camelot);
          c += (depois - agora) * 5;
          if (!encaixa(t, pendentes[0])) c += 4;
        }
        return c;
      };
      cands.sort((a, b) => custo(a) - custo(b));
      esc = cands[0];
    }

    fila.push({ ...esc, deOndeVem: atual.title,
      obrigatoria: obrigatorias.some((t) => t.id === esc.id),
      motivo: keyCompatible({ camelot: atual.camelot }, { camelot: esc.camelot }).reason,
      pitch: esc.bpm / atual.bpm - 1 });
    usadas.add(esc.id);
    dur += esc.duration * 0.8;
    atual = esc;
  }

  const naoCoube = pendentes.map((t) => ({
    ...t,
    porque: `${t.bpm} BPM ${t.camelot} não encaixou em nenhum ponto do set`,
  }));
  return { fila, minutos: dur / 60, naoCoube };
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
export function montarSet(candidatas, { minutos = 30, energia = 'subir', semente = null,
                                        obrigatorias = [], recentes = [], sorte = 3.5 } = {}) {
  const jaOuvidas = new Set(recentes || []);
  if (!candidatas?.length) return { fila: [], minutos: 0, generos: 0, naoCoube: obrigatorias };

  /**
   * As escolhidas à mão entram no pote, senão a corrente não tem como chegar
   * nelas. E elas ganham `pilha`: vieram da lista, não de `juntarCandidatas`,
   * então não tinham esse campo e apareciam como "[undefined]" no set — e, pior
   * que o rótulo feio, sem pilha elas escapavam do custo de variedade que
   * impede duas do mesmo gênero em sequência.
   */
  const pote = [...candidatas];
  for (const o of obrigatorias) {
    if (!o) continue;
    const jaTem = candidatas.find((t) => t.id === o.id);
    if (jaTem) continue;
    pote.push({ ...o, pilha: o.pilha || jaTem?.pilha || o.genre || 'escolhida' });
  }

  /**
   * Semente: se você escolheu faixas, a primeira delas abre o set — é o que
   * você esperaria de "quero que ele toque estas". Senão testa várias e fica
   * com a corrente mais rica.
   */
  const comPilha = (t) => pote.find((x) => x.id === t?.id) || t;
  /**
   * Sementes: embaralhadas, e as já ouvidas vão pro fim da fila.
   *
   * Pegar `.slice(0, 40)` de uma lista sempre na mesma ordem é o que fazia todo
   * set começar igual. Embaralhar antes de cortar é a correção de uma linha.
   */
  const baralhar = (a) => {
    const x = [...a];
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  };
  const sementes = semente ? [comPilha(semente)]
    : obrigatorias.length ? [comPilha(obrigatorias[0])]
    : baralhar(pote.filter((t) => t.bpm <= (energia === 'descer' ? 134 : 125)))
        .sort((a, b) => (jaOuvidas.has(a.id) ? 1 : 0) - (jaOuvidas.has(b.id) ? 1 : 0))
        .slice(0, 40);
  if (!sementes.length) sementes.push(pote[0]);

  let melhor = null;
  for (const s of sementes) {
    const r = corrente(s, pote, { minutos, energia, obrigatorias, recentes: jaOuvidas, sorte });
    const generos = new Set(r.fila.map((x) => x.pilha)).size;
    // quantas faixas, quantos gêneros, quantas escolhidas entraram, e quão
    // perto da duração pedida. As suas escolhas pesam mais que tudo.
    const novas = r.fila.filter((x) => !jaOuvidas.has(x.id)).length;
    const pontos = r.fila.length + generos * 4 + novas * 2
                 + (obrigatorias.length - r.naoCoube.length) * 20
                 + (Math.abs(r.minutos - minutos) < 6 ? 8 : 0)
                 - Math.abs(r.minutos - minutos) / 3;
    if (!melhor || pontos > melhor.pontos) melhor = { ...r, pontos, generos };
  }
  return { fila: melhor.fila, minutos: +melhor.minutos.toFixed(1),
           generos: melhor.generos, naoCoube: melhor.naoCoube };
}

/** Resumo em uma linha. */
export function resumoSet(s) {
  if (!s?.fila?.length) return 'sem set';
  const de = s.fila[0].bpm, ate = s.fila[s.fila.length - 1].bpm;
  return `${s.fila.length} faixas · ${s.generos} gêneros · ${de} → ${ate} BPM · ~${Math.round(s.minutos)} min`;
}
