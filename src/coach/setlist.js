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

/**
 * QUALIDADE de uma faixa, de 0 a 1 — "essa é boa?" sem ouvir.
 *
 * O montador só olhava tom, andamento e gênero: qualquer faixa que encaixasse
 * servia, e o set saía cheio de rascunho com 12 plays. Agora pesa o que a
 * galera do Audius já disse:
 *   ALCANCE  — log dos plays (10 mil plays = nota cheia)
 *   CARINHO  — curtidas + 2×reposts sobre plays: quem ouviu GOSTOU? (12% = cheia)
 *   CORPO    — faixa com menos de 2:30 costuma ser edit curto ou esboço, sem
 *              introdução nem saída pra mixar
 * Sem sinais (sem rede, arquivo local): 0,5, neutro — nem premia nem pune.
 */
export function qualidade(t) {
  const corpo = Math.min(1, (t?.duration || 0) / 150);
  const s = t?.sinais;
  if (!s) return 0.35 + 0.15 * corpo;
  const plays = s.plays ?? 0;
  const amor = (s.curtidas ?? 0) + 2 * (s.reposts ?? 0);
  const alcance = Math.min(1, Math.log10(plays + 1) / 4);
  const carinho = Math.min(1, (amor / Math.max(20, plays)) * 8);
  return 0.45 * alcance + 0.35 * carinho + 0.2 * corpo;
}

/**
 * A RAIZ de uma música: o título sem versão. "Stop It (Bessey Remix)" e
 * "Stop It (Zanon Remix)" são a mesma música — um set com as duas soa como
 * disco riscado. Tira o que está entre parênteses/colchetes, o "Artista - "
 * da frente e as palavras de versão.
 */
export function raiz(t) {
  let s = String(t?.title || '').toLowerCase().replace(/[([][^)\]]*[)\]]/g, ' ');
  const partes = s.split(/\s[-–—]\s/);
  if (partes.length > 1) s = partes.slice(1).join(' ');
  s = s.replace(/\b(remix|edit|bootleg|flip|rework|vip|extended|original mix|radio|version|feat\.?|ft\.?)\b.*$/, '');
  return s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || String(t?.id);
}

/**
 * FAMÍLIA de som de uma faixa — pelo gênero marcado (`pilha`) e pelo gênero
 * do Audius. O montador cobrava caro repetir gênero e premiava o set com mais
 * gêneros: pulava de pagode pra techno pra reggaeton, e as transições não
 * faziam sentido ("as músicas nada a ver uma com a outra"). Agora o set fica
 * numa família e só passa pra uma vizinha, devagar.
 */
const FAMILIAS = [
  ['slowed', /slw:|slowed|sped ?up|nightcore/],
  ['funkbr', /br:funk|funk rj|brega|megafunk|mega disco|mega house|trap br|montagem|baile|gen:funk|funk/],
  ['rap', /rap|hip-hop|boombap|\btrap\b/],
  ['latino', /reggaeton|perreo|dembow|guaracha|moombah|cumbia|salsa|bachata|amapiano|latin/],
  ['brasil', /pagode|samba|sertanejo|ax[eé]|pagod[aã]o|world|forr[oó]|piseiro/],
  ['house', /tech house|deep house|house|disco|garage|progressive/],
  ['techno', /techno|trance|psy|minimal|hard/],
  ['bass', /dubstep|drum|bass|future|electro\b|jungle/],
  ['chill', /ambient|lo-?fi|downtempo|chill|vaporwave|classical|piano|new age/],
  ['eletronico', /electronic|edm|dance/],
  ['pop', /\bpop\b|k-pop/],
  ['rock', /rock|alternative|metal|punk|indie|grunge/],
  ['soul', /jazz|soul|r&b|blues|gospel|devotional|funk ?soul/],
];
/** Famílias de PISTA: com "tudo" marcado, o set só pega destas (rock, jazz e
 *  chill entram quando você marca o gênero de propósito). */
export const FAMILIAS_PISTA = new Set(['house', 'techno', 'bass', 'eletronico', 'funkbr', 'latino', 'rap', 'brasil', 'pop']);
const famMemo = new Map();          // "pilha gênero" → família (poucas combinações)
export function familia(t) {
  const s = `${t?.pilha || ''} ${t?.genre || ''}`.toLowerCase();
  if (famMemo.has(s)) return famMemo.get(s);
  let fam = null;
  for (const [f, re] of FAMILIAS) if (re.test(s)) { fam = f; break; }
  famMemo.set(s, fam);
  return fam;
}
/** Quanto custa passar de uma família pra outra: vizinhas custam pouco. */
const VIZINHAS = {
  'house|techno': 4, 'house|eletronico': 1, 'techno|eletronico': 1, 'bass|eletronico': 2, 'house|bass': 6,
  'techno|bass': 5, 'funkbr|rap': 5, 'funkbr|latino': 5, 'rap|latino': 6, 'latino|house': 7, 'brasil|funkbr': 6,
  'chill|eletronico': 4, 'chill|house': 6, 'slowed|rap': 6, 'slowed|funkbr': 6,
  'pop|house': 5, 'pop|latino': 5, 'pop|rap': 5, 'pop|eletronico': 4, 'soul|rap': 5, 'soul|chill': 4,
  'soul|house': 6, 'rock|pop': 5,
};
export function custoFamilia(a, b) {
  const fa = familia(a), fb = familia(b);
  if (fa === fb && fa) return 0;
  // sem família conhecida não é "combina com tudo": é um risco (antes custava 0,
  // e um set "coeso" misturava vaporwave, rock e cumbia)
  if (!fa || !fb) return 7;
  return VIZINHAS[`${fa}|${fb}`] ?? VIZINHAS[`${fb}|${fa}`] ?? 10;
}

/**
 * AFINIDADE entre duas faixas, de 0 a 1: as TAGS que os artistas puseram
 * (Jaccard) e o CLIMA (mood) do Audius. Duas faixas "groove, techhouse,
 * summer" se atraem mesmo em gêneros vizinhos; é o que deixa o set alternar
 * sem parecer que mudou de festa.
 */
const tagsMemo = new WeakMap();      // a mesma faixa é comparada milhares de vezes por set
function tagsDe(t) {
  if (t && typeof t === 'object' && tagsMemo.has(t) && t.sinais === tagsMemo.get(t).sinais) return tagsMemo.get(t).tags;
  const cru = t?.tags?.length ? t.tags : String(t?.sinais?.tags || '').split(',');
  const tags = new Set(cru.map((x) => String(x).trim().toLowerCase().replace(/^#/, '')).filter((x) => x.length > 1));
  if (t && typeof t === 'object') tagsMemo.set(t, { tags, sinais: t.sinais });
  return tags;
}
export function afinidade(a, b) {
  const ta = tagsDe(a), tb = tagsDe(b);
  let comum = 0;
  for (const x of ta) if (tb.has(x)) comum++;
  const uniao = ta.size + tb.size - comum;
  const jac = uniao ? comum / uniao : 0;
  const ma = a?.mood || a?.sinais?.clima, mb = b?.mood || b?.sinais?.clima;
  return Math.min(1, jac * 1.6 + (ma && mb && ma === mb ? 0.35 : 0));
}

/**
 * VARIEDADE — o ajuste do DJ. Quanto pesa trocar de família, e se trocar de
 * gênero DENTRO dela (ou pra uma vizinha) ganha ou custa:
 *   coeso        fica no mesmo som; troca de família quase nunca
 *   equilibrado  fica na família, varia de gênero de vez em quando
 *   eclético     alterna de propósito — mas só pra vizinhos que combinam
 */
export const VARIEDADES = {
  coeso:       { familia: 1.6, trocaPerto: 1.5 },
  equilibrado: { familia: 1,   trocaPerto: 0.5 },
  ecletico:    { familia: 0.45, trocaPerto: -2 },
};

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
 * A faixa de BPM era 118–134, e era estreita demais: com três pilhas marcadas
 * sobravam ~89 candidatas, e a corrente morria em 4 passos por falta de quem
 * encaixasse. Agora o pote vai de 100 a 150 e quem estreita é a própria
 * corrente, que só aceita ±4% por passo — ela não vai pular de 100 pra 150, vai
 * caminhar. O pote largo só dá a ela pra onde caminhar.
 */
export async function juntarCandidatas({ pilhas = null, bpmMin = 100, bpmMax = 150,
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
                                        recentes = null, sorte = 0, variedade = 'equilibrado', evitar = null }) {
  const V = VARIEDADES[variedade] || VARIEDADES.equilibrado;
  const usadas = new Set([semente.id]);
  const raizes = new Set([raiz(semente)]);
  const fila = [semente];
  // 0.8 porque as transições se sobrepõem: ninguém toca a faixa inteira
  let dur = semente.duration * 0.8;
  let atual = semente;

  const pendentes = obrigatorias.filter((t) => t && t.id !== semente.id);
  const passo = energia === 'subir' ? 1.012 : energia === 'descer' ? 0.988 : 1;

  /**
   * ENCAIXE POR NÍVEIS, e é isto que impede o set de morrer no quarto passo.
   *
   * A regra era uma só: tom compatível E andamento dentro de ±4%. Com um pote
   * pequeno isso fecha rápido — a corrente não achava ninguém e parava, então
   * pedir 30 minutos devolvia 4 faixas. O usuário viu antes de mim.
   *
   * Um DJ de verdade não para quando não há a transição perfeita: ele faz uma
   * transição mais difícil e resolve com o EQ. Então a corrente tenta em ordem:
   *
   *   0. tom compatível, ±4% de andamento — a transição que se faz dormindo
   *   1. tom a até 2 passos na roda, ±4% — encosta, e o ouvido perdoa
   *   2. qualquer tom, ±4% — casa só pelo andamento; corta os médios e vai
   *   3. qualquer tom, ±7% — o pitch estica mais do que se gostaria
   *
   * Cada faixa guarda em `nivel` como foi escolhida, pra que a interface possa
   * avisar "esta entra pelo andamento, o tom não bate" em vez de fingir que
   * todas são iguais.
   */
  const NIVEIS = [
    { bpm: 0.04, roda: 0 },
    { bpm: 0.04, roda: 2 },
    { bpm: 0.04, roda: 99 },
    { bpm: 0.07, roda: 99 },
  ];

  const encaixaNivel = (de, t, n) => {
    if (usadas.has(t.id) || !t.bpm || raizes.has(raiz(t))) return false;
    // passagem que o Jev achou que não combina (ver julgarPassagens)
    if (evitar?.has(de.id + '>' + t.id)) return false;
    const lv = NIVEIS[n];
    if (Math.abs(t.bpm / de.bpm - 1) > lv.bpm) return false;
    if (lv.roda === 0) return keyCompatible({ camelot: de.camelot }, { camelot: t.camelot }).ok;
    if (lv.roda >= 99) return true;
    return distanciaCamelot(de.camelot, t.camelot) <= lv.roda;
  };

  const encaixa = (de, t) => encaixaNivel(de, t, 0);

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
    // quantas do mesmo gênero seguidas no fim da fila
    let mesmoGenero = 0;
    for (let k = fila.length - 1; k >= 0 && fila[k].pilha === atual.pilha; k--) mesmoGenero++;

    // 1. alguma obrigatória encaixa agora? ela tem prioridade absoluta
    const i = pendentes.findIndex((t) => encaixa(atual, t));
    if (i >= 0) esc = pendentes.splice(i, 1)[0];

    // 2. senão, a melhor candidata livre — e se ainda há obrigatória pendente,
    //    prefere a que APROXIMA o BPM da próxima obrigatória: é a faixa-ponte
    let nivelUsado = 0;
    if (!esc) {
      let cands = [];
      for (nivelUsado = 0; nivelUsado < NIVEIS.length; nivelUsado++) {
        cands = candidatas.filter((t) => encaixaNivel(atual, t, nivelUsado));
        if (cands.length) break;
      }
      if (!cands.length) break;   // acabou mesmo: nem afrouxando tem candidata
      const alvo = pendentes.length
        ? (atual.bpm + pendentes[0].bpm) / 2     // caminha na direção dela
        : atual.bpm * passo;
      const anterior = fila[fila.length - 2];
      const custo = (t) => {
        const h = keyCompatible({ camelot: atual.camelot }, { camelot: t.camelot });
        let c = (h.distance ?? 0) * 3
              + Math.abs(t.bpm - alvo) / atual.bpm * 60
              // COERÊNCIA: ficar na família de som é o normal; vizinha custa
              // pouco, família distante custa caro. Dentro da família, trocar
              // de gênero é leve — e 4+ do mesmo gênero em fila pede variar
              + custoFamilia(atual, t) * V.familia
              + (t.pilha === atual.pilha ? (mesmoGenero >= 4 ? 2 : 0)
                 : custoFamilia(atual, t) <= 5 ? V.trocaPerto : 1)
              // tags e clima parecidos se atraem: até 4 pontos
              - afinidade(atual, t) * 4
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
              // música boa ganha: até 8 pontos entre um rascunho e um hit
              + (1 - qualidade(t)) * 8
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
      // a melhor numa passada só: ordenar chamava custo() ~2·n·log n vezes
      // (e com a sorte dentro, um comparador instável) — medido 4,3 s por set
      let melhor = Infinity;
      for (const t of cands) { const v = custo(t); if (v < melhor) { melhor = v; esc = t; } }
    }

    const harm = keyCompatible({ camelot: atual.camelot }, { camelot: esc.camelot });
    fila.push({ ...esc, deOndeVem: atual.title,
      obrigatoria: obrigatorias.some((t) => t.id === esc.id),
      nivel: nivelUsado,
      harmonicamenteOk: harm.ok,
      motivo: harm.reason,
      pitch: esc.bpm / atual.bpm - 1 });
    usadas.add(esc.id);
    raizes.add(raiz(esc));
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
                                        obrigatorias = [], recentes = [], sorte = 3.5,
                                        variar = true, variedade = 'equilibrado', evitar = null } = {}) {
  const jaOuvidas = new Set(recentes || []);
  if (!candidatas?.length) return { fila: [], minutos: 0, generos: 0, naoCoube: obrigatorias };

  /**
   * As escolhidas à mão entram no pote, senão a corrente não tem como chegar
   * nelas. E elas ganham `pilha`: vieram da lista, não de `juntarCandidatas`,
   * então não tinham esse campo e apareciam como "[undefined]" no set — e, pior
   * que o rótulo feio, sem pilha elas escapavam do custo de variedade que
   * impede duas do mesmo gênero em sequência.
   */
  const baralhar = (a) => {
    const x = [...a];
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  };

  /**
   * SET NOVO A CADA PEDIDO. Com os mesmos gêneros marcados, o pote era o mesmo
   * toda vez e o montador ficava sempre com a MELHOR corrente — que é quase a
   * mesma. Pedir outro set devolvia as mesmas músicas. Agora cada pedido sorteia
   * 60% do pote (as escolhidas sempre entram) e, lá embaixo, escolhe ao acaso
   * entre as 4 melhores correntes. Continua bom; só não é mais sempre igual.
   * `variar: false` é pro set de favoritas, onde o pote é pequeno de propósito.
   */
  let pote = [...candidatas];
  if (variar && pote.length > 120) {
    pote = baralhar(pote).slice(0, Math.max(120, Math.round(pote.length * 0.6)));
  }
  for (const o of obrigatorias) {
    if (!o) continue;
    const jaTem = pote.find((t) => t.id === o.id);
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
  const sementes = semente ? [comPilha(semente)]
    : obrigatorias.length ? [comPilha(obrigatorias[0])]
    : baralhar(pote.filter((t) => t.bpm <= (energia === 'descer' ? 134 : 125)))
        // já ouvidas pro fim; entre as outras, as melhores primeiro (com
        // folga de sorteio, senão todo set abriria com o mesmo hit)
        .map((t) => ({ t, k: (jaOuvidas.has(t.id) ? 10 : 0) - qualidade(t) * 2 + Math.random() }))
        .sort((a, b) => a.k - b.k).map((x) => x.t)
        .slice(0, 40);
  if (!sementes.length) sementes.push(pote[0]);

  const resultados = [];
  for (const s of sementes) {
    const r = corrente(s, pote, { minutos, energia, obrigatorias, recentes: jaOuvidas, sorte, variedade, evitar });
    const generos = new Set(r.fila.map((x) => x.pilha)).size;
    // quantas faixas, quantos gêneros, quantas escolhidas entraram, e quão
    // perto da duração pedida. As suas escolhas pesam mais que tudo.
    const novas = r.fila.filter((x) => !jaOuvidas.has(x.id)).length;
    const q = r.fila.reduce((s, x) => s + qualidade(x), 0) / Math.max(1, r.fila.length);
    // saltos de família no set inteiro: um set que faz sentido quase não salta
    const saltos = r.fila.slice(1).reduce((s, x, k) => s + custoFamilia(r.fila[k], x), 0);
    const V = VARIEDADES[variedade] || VARIEDADES.equilibrado;
    const pontos = r.fila.length + Math.min(generos, 4) * (variedade === 'ecletico' ? 3 : 1.5)
                 - saltos * 0.8 * V.familia + novas * 2 + q * 12
                 + (obrigatorias.length - r.naoCoube.length) * 20
                 + (Math.abs(r.minutos - minutos) < 6 ? 8 : 0)
                 - Math.abs(r.minutos - minutos) / 3;
    resultados.push({ ...r, pontos, generos });
  }
  resultados.sort((a, b) => b.pontos - a.pontos);
  const melhor = resultados[Math.floor(Math.random() * Math.min(variar ? 4 : 2, resultados.length))];
  return { fila: melhor.fila, minutos: +melhor.minutos.toFixed(1),
           generos: melhor.generos, naoCoube: melhor.naoCoube };
}

/** Resumo em uma linha. */
export function resumoSet(s) {
  if (!s?.fila?.length) return 'sem set';
  const de = s.fila[0].bpm, ate = s.fila[s.fila.length - 1].bpm;
  const dificeis = s.fila.filter((t) => (t.nivel ?? 0) >= 2).length;
  return `${s.fila.length} faixas · ${s.generos} gêneros · ${de} → ${ate} BPM · ~${Math.round(s.minutos)} min`
       + (dificeis ? ` · ${dificeis} só pelo andamento` : '');
}
