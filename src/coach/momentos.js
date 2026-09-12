/**
 * Momentos de virada — onde a música "abre" pra você entrar ou sair.
 *
 * Isto existia, mas só na minha mão: nas transições de teste eu encaixava a
 * entrada num múltiplo de 8 tempos a partir da âncora, e por isso soava no
 * lugar. Quem estava ouvindo perguntou como eu achava o momento — e a resposta
 * "eu calculo, você não vê" é uma resposta ruim. Então virou tela.
 *
 * Duas ideias, e as duas são de música, não de código:
 *
 * 1. FRASE. Música de pista é construída em blocos de 4 compassos (16 tempos),
 *    e blocos maiores de 8 compassos (32 tempos). Entrar ou sair no meio de um
 *    bloco soa como interromper alguém no meio da frase. Os limites de frase
 *    saem direto da grade: âncora + k×16 tempos. Não precisa detectar nada.
 *
 * 2. ENERGIA. Nem todo limite de frase vale o mesmo. O que importa é o que
 *    ACONTECE ali: se a energia sobe, é um drop — o melhor lugar do mundo pra
 *    trazer a próxima faixa. Se cai, é uma quebra — o melhor lugar pra tirar a
 *    que está saindo. Isso sai de comparar a energia de ataque dos 16 tempos
 *    anteriores com a dos 16 seguintes.
 *
 * A classificação é por MEDIANA, não por média: uma faixa inteira em pé de
 * igualdade teria todos os limites marcados como drop se o critério fosse
 * absoluto. O que interessa é quais limites se destacam DENTRO DESTA faixa.
 */

/** Quantos tempos tem uma frase e um bloco. Convenção da música de pista. */
export const TEMPOS_FRASE = 16;
export const TEMPOS_BLOCO = 32;

/**
 * @param {object} deck  precisa de `grid` {bpm, ancora}, `onset` {v, taxa} e `duration`
 * @returns {Array<{t:number, tipo:'drop'|'quebra'|'frase', bloco:boolean, salto:number}>}
 */
export function momentos(deck) {
  const g = deck?.grid;
  const env = deck?.onset;
  if (!g?.bpm || !env?.v?.length || !deck.duration) return [];

  const periodo = 60 / g.bpm;
  const passo = periodo * TEMPOS_FRASE;
  const taxa = env.taxa;

  // energia de ataque de uma frase, em quadros do envelope
  const energia = (t0, t1) => {
    const i0 = Math.max(0, Math.round(t0 * taxa));
    const i1 = Math.min(env.v.length, Math.round(t1 * taxa));
    if (i1 <= i0) return 0;
    let s = 0;
    for (let i = i0; i < i1; i++) s += env.v[i];
    return s / (i1 - i0);
  };

  const brutos = [];
  let k = 0;
  for (let t = g.ancora; t < deck.duration - passo * 0.5; t += passo, k++) {
    if (t < passo * 0.5) continue;            // não marca antes da 1ª frase inteira
    const antes = energia(t - passo, t);
    const depois = energia(t, t + passo);
    // salto relativo: fração de mudança, imune ao volume absoluto da faixa
    const salto = (depois - antes) / Math.max(antes, depois, 1e-9);
    brutos.push({ t, salto, bloco: k % (TEMPOS_BLOCO / TEMPOS_FRASE) === 0 });
  }
  if (!brutos.length) return [];

  // limiar pela distribuição DESTA faixa: o que se destaca aqui dentro
  const saltos = brutos.map((b) => Math.abs(b.salto)).sort((a, b) => a - b);
  const corte = Math.max(0.18, saltos[Math.floor(saltos.length * 0.72)] || 0.18);

  return brutos.map((b) => ({
    t: b.t,
    bloco: b.bloco,
    salto: Math.round(b.salto * 100) / 100,
    tipo: b.salto >= corte ? 'drop' : b.salto <= -corte ? 'quebra' : 'frase',
  }));
}

/**
 * O próximo momento útil a partir de `pos`.
 *
 * `pra` diz o que você quer fazer: 'entrar' procura drop (a música abrindo),
 * 'sair' procura quebra (a música fechando). Sem nenhum dos dois por perto,
 * devolve o próximo limite de bloco, que já é infinitamente melhor que um
 * ponto qualquer.
 *
 * `antecedencia` existe porque avisar no instante exato é inútil: você precisa
 * do aviso alguns segundos antes pra ter tempo de agir.
 */
export function proximoMomento(lista, pos, { pra = 'entrar', antecedencia = 0 } = {}) {
  if (!lista?.length) return null;
  const querido = pra === 'sair' ? 'quebra' : 'drop';
  const adiante = lista.filter((m) => m.t > pos + antecedencia);
  if (!adiante.length) return null;
  return adiante.find((m) => m.tipo === querido)
      || adiante.find((m) => m.bloco)
      || adiante[0];
}

/** Segundos até o momento, e em quantos tempos — falar em tempos ensina frase. */
export function faltaPara(momento, deck) {
  if (!momento || !deck?.grid?.bpm) return null;
  const seg = (momento.t - deck.displayPosition) / (deck.nominalRate || 1);
  return { seg, tempos: Math.round(seg * (deck.grid.bpm * (deck.nominalRate || 1)) / 60) };
}
