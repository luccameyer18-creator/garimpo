/**
 * O garimpeiro — varre o Audius fundo e enche a crate local.
 *
 * Roda em segundo plano, é interrompível, e reporta progresso. Não bloqueia
 * nada: o usuário continua mixando enquanto ele cava.
 *
 * A ordem das frentes não é arbitrária — é da que mais rende por requisição
 * para a que menos rende, pra que parar no meio ainda deixe um acervo útil:
 *
 *   1. BUSCAS por texto — o único caminho pro que o Audius não tem como
 *      gênero: funk carioca, pagode, sertanejo, reggaeton. Vem PRIMEIRO porque
 *      é o material escasso; o eletrônico sobra de qualquer jeito.
 *   2. TRENDING por gênero × janela × página. 16 gêneros × 3 janelas × 3
 *      páginas de 100 = 144 consultas. É o grosso do volume.
 *   3. UNDERGROUND, que é outro acervo e traz o que não é hit.
 *   4. PLAYLISTS. Cada uma rende de 3 a 50 faixas e quase todas têm BPM e tom,
 *      porque quem monta playlist costuma cuidar dos metadados. Por último
 *      porque são as mais lentas: uma requisição pra achar, outra por faixa.
 *
 * Entre requisições há uma pausa curta. Não é superstição: o Audius é uma rede
 * de nós comunitários e martelar um deles derruba o serviço pra todo mundo,
 * inclusive pra você no meio de um set.
 */

import { APP_NAME, GENRES, CRATES, DJS, APOSTAS, ARTISTAS, isDeckable, normalizeTrack } from './audius.js';
import * as hearthis from './hearthis.js';
import { guardar as guardarLocal, contar, artistas, artistasVarridos, marcarVarrido, ausentes,
         frentesEsgotadas, marcarEsgotada } from './crate.js';
import { compartilhar } from './galera.js';

/** Guarda no crate daqui E manda pra galera: o que um garimpa, todos ouvem. */
function guardar(lote, pilha) {
  compartilhar((lote || []).map((f) => ({ ...f, pilha: pilha || f.pilha || null })));
  return guardarLocal(lote, pilha);
}

const H = 'https://api.audius.co/v1';
const PAUSA = 120;          // ms entre requisições

/**
 * Limites MEDIDOS da API, não chutados:
 *   limit máximo 100 (200 devolve 400)
 *   offset até 200 no trending (400 devolve 400)
 *   time aceita week/month/allTime; year devolve 400
 */
const LIMITE = 100;
const PAGINAS = [0, 100, 200];
const JANELAS = ['week', 'month', 'allTime'];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function pegar(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return j.data ?? [];      // /users/handle devolve objeto, o resto devolve lista
}

/** Página do hearthis: lista pura; "sem resultado" vem como objeto, e vira []. */
async function pegarHearthis(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

/** Filtra o lote cru pro que serve num deck e normaliza. */
function preparar(cru) {
  const fora = [];
  for (const t of cru) {
    if (!isDeckable(t)) continue;
    const n = normalizeTrack(t);
    if (n.isLongMix) continue;
    fora.push(n);
  }
  return fora;
}

/**
 * Cava até `alvo` faixas no acervo, ou até acabarem as frentes.
 *
 * @param {object} opts
 * @param {number} opts.alvo        para quando o acervo chegar aqui
 * @param {AbortSignal} opts.signal
 * @param {function} opts.aoAndar   ({ total, novas, frente, feito, de })
 */
export async function garimpar({ alvo = 10000, signal, aoAndar = () => {} } = {}) {
  const frentes = [];

  /**
   * ORDEM DAS FRENTES: o escasso primeiro.
   *
   * Antes o trending vinha antes das buscas por texto, e isso tinha uma
   * consequência que só apareceu medindo: quando o alvo era atingido ainda
   * dentro do trending, as crates brasileiras e latinas NUNCA eram cavadas. O
   * acervo acabou com 795 faixas de Electronic e 5 de funk carioca.
   *
   * O material eletrônico do Audius é abundante e o brasileiro é raro. Cavar o
   * abundante primeiro é gastar o orçamento no que sobraria de qualquer jeito.
   * Então: buscas por texto (Brasil e América Latina), depois trending, depois
   * underground, e as playlists por último porque são as mais lentas — uma
   * requisição pra achar a playlist e outra por faixa.
   */
  /**
   * 1. BUSCAS por texto — o único caminho pro Brasil e pra América Latina, e
   *    onde mora a maior folga que eu tinha deixado na mesa.
   *
   *    Dois achados de medição mudaram esta parte:
   *
   *    a) o `offset` da BUSCA vai muito mais fundo que o do trending: com 500
   *       ele ainda devolve 100 faixas cheias. Então aqui são 6 páginas, não 3.
   *
   *    b) um termo só não alcança o acervo. Medi termo a termo: "funk remix"
   *       rende 96, "mc" 96, "beat brasil" 74, "mtg" 48, "pagode 90" 41,
   *       "modão" 42, "piseiro" 32 — enquanto "forró eletrônico" e "sertanejo
   *       universitário" rendem ZERO. Então cada crate tem uma lista de termos
   *       escolhidos por rendimento, não por como a gente chamaria o gênero.
   *
   *    Termos inequívocos (mtg, piseiro, arrocha, perreo) dispensam filtro: se
   *    a faixa voltou numa busca por "piseiro", é piseiro. Termos ambíguos
   *    ("samba", "brega", "mc") mantêm o filtro, senão o acervo brasileiro se
   *    enche de homônimo em inglês.
   */
  /**
   * A busca por texto não tem fundo prático: medi `offset=3000` devolvendo 100
   * faixas cheias. Doze páginas por termo é onde eu paro — não porque a API
   * acaba, mas porque o Audius é uma rede de nós comunitários e varrer sem
   * limite seria cobrar deles a minha ambição. Quem quiser mais cava de novo:
   * o acervo acumula entre sessões.
   */
  const PAGINAS_BUSCA = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
  for (const c of [...CRATES, ...DJS, ...APOSTAS]) {
    const buscas = c.buscas || [{ q: c.termo, filtro: c.filtro }];
    for (const b of buscas) {
      /**
       * Uma SÉRIE por termo, não 12 frentes soltas.
       *
       * Paginar sempre até o fim gasta requisição em página vazia: medi termos
       * devolvendo `+0` seis vezes seguidas antes de a varredura desistir. Uma
       * série para na primeira página que volta VAZIA DA API — não na primeira
       * que não traz novidade, porque uma página inteira de faixas já
       * conhecidas ainda indica que há mais adiante.
       */
      frentes.push({
        nome: `${c.nome} · ${b.q}`,
        pilha: ({ BR: 'br:', LAT: 'lat:', EST: 'est:', DJ: 'dj:', SLW: 'slw:' }[c.reg] || 'lat:') + c.nome,
        filtro: b.filtro !== undefined ? b.filtro : null,
        serie: PAGINAS_BUSCA.map((offset) =>
          `${H}/tracks/search?query=${encodeURIComponent(b.q)}&limit=${LIMITE}` +
          `&offset=${offset}&app_name=${APP_NAME}`),
      });
    }
  }

  // 1a. os artistas com conta (funk e rap): as faixas deles, página a página
  for (const a of ARTISTAS) {
    frentes.push({
      nome: `artista · ${a.nome}`, pilha: 'dj:' + a.nome, filtro: null,
      serie: [0, 100, 200].map((offset) => `${H}/users/${a.id}/tracks?limit=${LIMITE}&offset=${offset}&app_name=${APP_NAME}`),
    });
  }

  /**
   * 1c. HEARTHIS, categoria por categoria. A semente dele já traz o grosso
   * (ver src/dev/garimpar-hearthis.mjs); aqui é pra pegar o que subiu depois.
   * `duration=10` em toda página, senão vem set de uma hora. A API para por
   * volta da 11ª página de 50.
   */
  for (const c of hearthis.CATEGORIAS) {
    frentes.push({
      nome: `hearthis · ${c.nome}`, pilha: hearthis.pilhaDe(c.slug), filtro: null,
      fonte: 'hearthis', slug: c.slug,
      serie: Array.from({ length: 11 }, (_, i) =>
        `${hearthis.API}/categories/${c.slug}/?page=${i + 1}&count=${hearthis.POR_PAGINA}&duration=10`),
    });
  }

  /**
   * 1b. BUSCAS ELETRÔNICAS, também em série profunda.
   *
   * O trending por gênero para em `offset=200` — 300 faixas por gênero por
   * janela, e acabou. A busca por texto não tem esse teto: medi `offset=3000`
   * ainda devolvendo 100 cheias. Então, pro eletrônico, buscar por texto rende
   * várias vezes mais que confiar só no trending.
   *
   * Os termos incluem o que o Audius NÃO tem como gênero e que é justamente o
   * que um DJ procura: edit, bootleg, mashup, remix. Sem filtro — aqui não há
   * homônimo em outra língua pra separar.
   */
  /**
   * HOUSE, TECHNO e DISCO vêm primeiro e com muito mais variações que o resto.
   *
   * É o pedido de quem usa, e faz sentido de catálogo: são as três famílias com
   * mais material no Audius e as que melhor se misturam entre si — todas moram
   * entre 118 e 132 BPM, que é exatamente a faixa em que a corrente de set
   * consegue caminhar sem esticar pitch.
   *
   * As variações não são sinônimos decorativos: no Audius elas são etiquetas
   * DIFERENTES, e buscar "jackin house" alcança faixas que uma busca por
   * "house" não traz nas primeiras mil.
   */
  const FOCO = [
    // house e suas famílias
    'house', 'deep house', 'tech house', 'progressive house', 'afro house',
    'bass house', 'future house', 'melodic house', 'soulful house',
    'funky house', 'jackin house', 'tribal house', 'latin house',
    'organic house', 'g house', 'uk house', 'chicago house', 'acid house',
    'disco house', 'french house', 'garage house', 'slap house',
    'brazilian bass', 'house music', 'house edit', 'house remix',
    // techno e suas famílias
    'techno', 'melodic techno', 'minimal techno', 'hard techno',
    'peak time techno', 'industrial techno', 'acid techno', 'detroit techno',
    'dub techno', 'hypnotic techno', 'raw techno', 'techno remix',
    // disco e suas famílias
    'disco', 'nu disco', 'italo disco', 'disco funk', 'cosmic disco',
    'space disco', 'boogie', 'disco edit', 'disco remix', 'disco house edit',
    'funk disco', 'modern disco', 'indie dance',
    // hip-hop: mora em 85-100 BPM, que casa com house em MEIO TEMPO — 90 contra
    // 180, ou 95 contra 127 puxando a fase. É por isso que ele entra no foco e
    // não numa pilha à parte: o set alterna quando há material dos dois lados.
    'hip hop', 'hip-hop', 'boom bap', 'trap', 'rap', 'old school hip hop',
    'lo-fi hip hop', 'jazz rap', 'g funk', 'west coast', 'east coast',
    'underground hip hop', 'instrumental hip hop', 'hip hop remix',
    'rap remix', 'trap remix', 'drill', 'phonk',
  ];
  const TERMOS_ELETRONICOS = [
    ...FOCO,
    'trance', 'psytrance', 'electro', 'drum and bass', 'dnb', 'jungle',
    'dubstep', 'bass music', 'garage', 'breakbeat', 'hardstyle',
    'edit', 'bootleg', 'mashup', 'remix', 'club mix', 'extended mix',
  ];
  for (const q of TERMOS_ELETRONICOS) {
    frentes.push({
      nome: `eletrônico · ${q}`,
      pilha: null,
      filtro: null,
      serie: PAGINAS_BUSCA.map((offset) =>
        `${H}/tracks/search?query=${encodeURIComponent(q)}&limit=${LIMITE}` +
        `&offset=${offset}&app_name=${APP_NAME}`),
    });
  }

  // 2. trending por gênero, janela e página
  for (const g of GENRES) {
    for (const time of JANELAS) {
      for (const offset of PAGINAS) {
        frentes.push({
          nome: `${g} · ${time}`,
          pilha: 'gen:' + g,
          url: `${H}/tracks/trending?genre=${encodeURIComponent(g)}&limit=${LIMITE}` +
               `&offset=${offset}&time=${time}&app_name=${APP_NAME}`,
        });
      }
    }
  }

  // 3. underground: outro acervo, o que ainda não virou hit
  for (const offset of PAGINAS) {
    frentes.push({
      nome: 'underground',
      pilha: 'gen:Electronic',
      url: `${H}/tracks/trending/underground?limit=${LIMITE}&offset=${offset}&app_name=${APP_NAME}`,
    });
  }

  // 4. playlists: multiplicador. Busca a playlist, depois as faixas dela.
  const termosPl = [...GENRES.slice(0, 10).map((g) => g.toLowerCase()),
                    'funk', 'baile funk', 'reggaeton', 'pagode', 'sertanejo',
                    'disco', 'dj set', 'party', 'brasil', 'latino'];
  for (const q of termosPl) {
    frentes.push({ nome: `playlists “${q}”`, playlists: q });
  }

  let total = await contar().catch(() => 0);
  let feito = 0;

  /**
   * FASE DOS ARTISTAS — o maior multiplicador, e o último a rodar.
   *
   * Cada faixa encontrada aponta pra um artista, e o catálogo dele costuma ser
   * muito maior do que o que chegou pelo trending: medi um artista com 279
   * faixas tendo aparecido por uma só. Varrer os artistas que já estão no
   * acervo transforma N faixas em muito mais, sem depender de adivinhar termo
   * de busca.
   *
   * Roda por último de propósito: precisa que o acervo já tenha gente dentro
   * pra saber a quem perguntar. E os handles varridos ficam marcados, pra que
   * o segundo garimpo continue de onde o primeiro parou em vez de repetir.
   */
  const varrerArtistas = async () => {
    let lista = [];
    try { lista = await artistas({ max: 3000 }); } catch { return; }
    const jaVarridos = artistasVarridos();
    const pendentes = lista.filter((a) => !jaVarridos.has(a.handle));
    for (const a of pendentes) {
      if (signal?.aborted || total >= alvo) break;
      feito++;
      try {
        // artista do hearthis ('ht:fulano'): perguntar ao Audius seria um 404
        if (a.handle.startsWith(hearthis.PREFIXO)) {
          const novas = await guardar(await hearthis.faixasDoArtista(a.handle, { signal }), null);
          total += novas;
          marcarVarrido(a.handle);
          aoAndar({ total, novas, frente: `artista ${a.handle}`, feito, de: aFazer.length + pendentes.length });
          await dormir(PAUSA);
          continue;
        }
        const u = await pegar(`${H}/users/handle/${encodeURIComponent(a.handle)}?app_name=${APP_NAME}`, signal);
        const id = Array.isArray(u) ? u[0]?.id : u?.id;
        if (!id) { marcarVarrido(a.handle); continue; }
        const cru = await pegar(`${H}/users/${id}/tracks?limit=100&app_name=${APP_NAME}`, signal);
        const novas = await guardar(preparar(cru), null);
        total += novas;
        marcarVarrido(a.handle);
        aoAndar({ total, novas, frente: `artista ${a.handle}`, feito, de: aFazer.length + pendentes.length });
      } catch (e) {
        if (signal?.aborted) break;
        marcarVarrido(a.handle);   // não insiste num handle que deu erro
      }
      await dormir(PAUSA);
    }
  };

  // pula o que ja se esgotou em garimpos anteriores: sem isto, cada execucao
  // recomecava pelas crates brasileiras devolvendo +0 por minutos a fio
  const esgotadas = frentesEsgotadas();
  const aFazer = frentes.filter((f) => !esgotadas.has(f.nome));

  for (const f of aFazer) {
    if (signal?.aborted || total >= alvo) break;
    feito++;
    try {
      let lote = [];
      if (f.playlists) {
        const pls = await pegar(
          `${H}/playlists/search?query=${encodeURIComponent(f.playlists)}&limit=10&app_name=${APP_NAME}`,
          signal);
        for (const p of pls) {
          if (signal?.aborted) break;
          await dormir(PAUSA);
          try {
            const faixas = await pegar(`${H}/playlists/${p.id}/tracks?app_name=${APP_NAME}`, signal);
            lote.push(...preparar(faixas));
          } catch { /* uma playlist fora do ar não derruba a varredura */ }
        }
      } else if (f.serie) {
        const doHearthis = f.fonte === 'hearthis';
        for (const url of f.serie) {
          if (signal?.aborted) break;
          const cru = doHearthis ? await pegarHearthis(url, signal) : await pegar(url, signal);
          if (!cru.length) break;        // a API acabou este termo: não insiste
          lote.push(...(doHearthis ? hearthis.preparar(cru, { slugOrigem: f.slug }) : preparar(cru)));
          await dormir(PAUSA);
        }
      } else {
        const cru = await pegar(f.url, signal);
        lote = preparar(cru);
      }

      /**
       * O FILTRO ROTULA, não descarta — e essa distinção rendeu o dobro de
       * acervo.
       *
       * O filtro existe porque a busca por texto pega homônimo: "forró" traz
       * "forlorn", "axé" traz "Maze of the Axe". Mas eu estava usando ele pra
       * JOGAR FORA, e medi o preço: numa busca por "brega", das 75 faixas
       * utilizáveis o filtro descartava 50.
       *
       * Só que ele responde a uma pergunta de VITRINE — "isto pertence ao chip
       * Brega funk?" — e não a uma pergunta de ACERVO. Pro montador de set,
       * música compatível é música compatível, tenha vindo de onde tiver vindo.
       *
       * Então: tudo que serve num deck entra no acervo; o rótulo da pilha só é
       * posto em quem passa no filtro. O chip continua limpo e o acervo cresce.
       */
      let novas = 0;
      if (f.filtro && lote.length) {
        const casam = [], resto = [];
        for (const t of lote) {
          (f.filtro.test(`${t.title} ${t.artist} ${t.genre || ''}`) ? casam : resto).push(t);
        }
        novas += await guardar(casam, f.pilha || null);
        novas += await guardar(resto, null);
      } else {
        novas = await guardar(lote, f.pilha || null);
      }
      total += novas;
      // frente que nao trouxe nada esta esgotada: nao volta no proximo garimpo
      if (!novas) marcarEsgotada(f.nome);
      aoAndar({ total, novas, frente: f.nome, feito, de: aFazer.length });
    } catch (e) {
      if (signal?.aborted) break;
      aoAndar({ total, novas: 0, frente: f.nome, feito, de: aFazer.length, erro: e.message });
    }
    await dormir(PAUSA);
  }

  if (!signal?.aborted && total < alvo) await varrerArtistas();

  return { total, frentes: feito, de: aFazer.length, parou: !!signal?.aborted };
}


// ─────────────────────────── o LOTE DO DIA ───────────────────────────

/**
 * O LOTE DO DIA (ideia do Lucca): em vez de um garimpo sem fim na primeira
 * visita, cada pessoa garimpa UM lote por dia — até 1.000 músicas NOVAS do
 * gênero que escolher. "Novas" = que o acervo ainda não tem; e como tudo que
 * alguém garimpa vai pro acervo de todo mundo (galera.js), o lote de cada um
 * empurra o acervo de todos pra frente: quanto mais gente garimpa, mais música
 * nova chega pra todo mundo, e o próximo a garimpar House cava mais fundo.
 *
 * As frentes, da mais certeira pra mais funda:
 *   1. trending do gênero (3 janelas x 3 páginas)
 *   2. busca por texto do gênero e das variações dele, até 1.200 de fundo
 *   3. categoria do hearthis que casa com o gênero
 */
export const LOTE_GENEROS = [
  // 🌎 DE TUDO: um pouco de cada gênero (o garimpo pelo garimpo — o que é
  // ruim a galera tira com 👎)
  { id: 'Tudo', audius: null, tudo: true, termos: [] },
  { id: 'House', audius: 'House', termos: ['house', 'deep house', 'afro house', 'melodic house', 'jackin house', 'funky house', 'bass house', 'organic house', 'soulful house'] },
  { id: 'Techno', audius: 'Techno', termos: ['techno', 'melodic techno', 'minimal techno', 'hard techno', 'peak time techno', 'hypnotic techno', 'acid techno', 'dub techno'] },
  { id: 'Tech House', audius: 'Tech House', termos: ['tech house', 'minimal tech house', 'jackin tech house'] },
  { id: 'Deep House', audius: 'Deep House', termos: ['deep house', 'organic house', 'lounge house'] },
  { id: 'Disco', audius: 'Disco', termos: ['disco', 'nu disco', 'italo disco', 'disco edit', 'boogie', 'indie dance', 'disco house'] },
  { id: 'Afro House', audius: null, termos: ['afro house', 'afro tech', 'amapiano', 'afrobeats remix'] },
  { id: 'Funk BR', audius: 'Funk', termos: ['funk carioca', 'baile funk', 'funk mandelao', 'brega funk', 'funk bh', 'funk paulista', 'funk remix'] },
  { id: 'Hip-Hop/Rap', audius: 'Hip-Hop/Rap', termos: ['hip hop', 'boom bap', 'rap', 'trap', 'drill', 'phonk', 'lo-fi hip hop'] },
  { id: 'Drum & Bass', audius: 'Drum & Bass', termos: ['drum and bass', 'dnb', 'jungle', 'liquid dnb', 'neurofunk'] },
  { id: 'Trance', audius: 'Trance', termos: ['trance', 'psytrance', 'progressive trance', 'uplifting trance'] },
  { id: 'Dubstep', audius: 'Dubstep', termos: ['dubstep', 'riddim', 'bass music', 'future bass'] },
  { id: 'Latin', audius: 'Latin', termos: ['reggaeton', 'latin house', 'cumbia', 'dembow', 'moombahton'] },
  { id: 'Electronic', audius: 'Electronic', termos: ['electronic', 'electro', 'breakbeat', 'edit', 'bootleg', 'club mix'] },
  { id: 'Ambient', audius: 'Ambient', termos: ['ambient', 'downtempo', 'chillout', 'lo-fi'] },
];

export async function garimparLote({ genero, alvo = 1000, signal, aoAndar = () => {} } = {}) {
  const G = LOTE_GENEROS.find((g) => g.id === genero) || LOTE_GENEROS[0];
  const pilha = G.audius ? 'gen:' + G.audius : null;
  const series = [];
  if (G.tudo) {
    // de tudo: a semana em alta de cada gênero e a busca rasa de cada termo
    // principal, embaralhados — e depois os artistas, como nos outros
    for (const g of LOTE_GENEROS.filter((x) => !x.tudo)) {
      if (g.audius) series.push({ nome: `${g.id} · em alta`, urls: PAGINAS.map((o) =>
        `${H}/tracks/trending?genre=${encodeURIComponent(g.audius)}&limit=${LIMITE}&offset=${o}&time=week&app_name=${APP_NAME}`) });
      series.push({ nome: `busca “${g.termos[0]}”`, urls: [0, 100, 200, 300].map((o) =>
        `${H}/tracks/search?query=${encodeURIComponent(g.termos[0])}&limit=${LIMITE}&offset=${o}&app_name=${APP_NAME}`) });
    }
    series.push({ nome: 'underground', urls: PAGINAS.map((o) =>
      `${H}/tracks/trending/underground?limit=${LIMITE}&offset=${o}&app_name=${APP_NAME}`) });
    series.sort(() => Math.random() - 0.5);
  }
  if (G.audius) {
    for (const time of JANELAS) {
      series.push({ nome: `${G.id} · em alta (${time})`, urls: PAGINAS.map((o) =>
        `${H}/tracks/trending?genre=${encodeURIComponent(G.audius)}&limit=${LIMITE}&offset=${o}&time=${time}&app_name=${APP_NAME}`) });
    }
  }
  const FUNDO = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
  for (const q of G.termos) {
    series.push({ nome: `busca “${q}”`, urls: FUNDO.map((o) =>
      `${H}/tracks/search?query=${encodeURIComponent(q)}&limit=${LIMITE}&offset=${o}&app_name=${APP_NAME}`) });
  }
  for (const c of hearthis.CATEGORIAS.filter((c) => c.genero === G.audius || c.genero === G.id)) {
    series.push({ nome: `hearthis · ${c.nome}`, hearthis: c.slug, urls: Array.from({ length: 20 }, (_, i) =>
      `${hearthis.API}/categories/${c.slug}/?page=${i + 1}&count=${hearthis.POR_PAGINA}&duration=10`) });
  }

  const ids = [];
  let feito = 0;
  for (const s of series) {
    if (signal?.aborted || ids.length >= alvo) break;
    feito++;
    for (const url of s.urls) {
      if (signal?.aborted || ids.length >= alvo) break;
      try {
        const cru = s.hearthis ? await pegarHearthis(url, signal) : await pegar(url, signal);
        if (!cru.length) break;                       // a fonte acabou este termo
        const prontas = s.hearthis ? hearthis.preparar(cru, { slugOrigem: s.hearthis }) : preparar(cru);
        const novas = (await ausentes(prontas)).filter((f) => !ids.includes(f.id)).slice(0, alvo - ids.length);
        if (novas.length) {
          // o rótulo do gênero só em quem é do gênero (a busca por texto pega vizinho)
          const doGenero = novas.filter((f) => !G.audius || f.genre === G.audius || s.hearthis);
          const outras = novas.filter((f) => !doGenero.includes(f));
          await guardar(doGenero, pilha);
          await guardar(outras, null);
          ids.push(...novas.map((f) => f.id));
        }
        aoAndar({ n: ids.length, alvo, frente: s.nome, feito, de: series.length });
      } catch (e) {
        if (signal?.aborted) break;
        break;                                        // página com erro: próxima frente
      }
      await dormir(PAUSA);
    }
  }
  /**
   * 4. O CATÁLOGO DOS ARTISTAS do próprio lote — o reservatório mais fundo.
   * As buscas batem no que o acervo já tem (a semente trouxe 63 mil); o artista
   * que apareceu no lote costuma ter dezenas de faixas que ninguém garimpou, e
   * do mesmo som. Medido: House parava em 511 sem esta frente.
   */
  if (ids.length < alvo && !signal?.aborted) {
    const jaVarridos = artistasVarridos();
    const doLote = await Promise.resolve().then(async () => {
      const { pegarIds } = await import('./crate.js');
      return pegarIds(ids.slice(0, 400));
    }).catch(() => []);
    const handles = [...new Set(doLote.map((f) => f.handle).filter(Boolean))].filter((h) => !jaVarridos.has(h));
    let k = 0;
    for (const h of handles) {
      if (signal?.aborted || ids.length >= alvo) break;
      k++;
      try {
        let prontas;
        if (h.startsWith(hearthis.PREFIXO)) prontas = await hearthis.faixasDoArtista(h, { signal });
        else {
          const u = await pegar(`${H}/users/handle/${encodeURIComponent(h)}?app_name=${APP_NAME}`, signal);
          const uid = Array.isArray(u) ? u[0]?.id : u?.id;
          prontas = uid ? preparar(await pegar(`${H}/users/${uid}/tracks?limit=100&app_name=${APP_NAME}`, signal)) : [];
        }
        const novas = (await ausentes(prontas || [])).filter((f) => !ids.includes(f.id)).slice(0, alvo - ids.length);
        if (novas.length) { await guardar(novas, null); ids.push(...novas.map((f) => f.id)); }
        marcarVarrido(h);
        aoAndar({ n: ids.length, alvo, frente: `artista ${h.replace(hearthis.PREFIXO, '')}`, feito: series.length + k, de: series.length + handles.length });
      } catch (e) {
        if (signal?.aborted) break;
        marcarVarrido(h);
      }
      await dormir(PAUSA);
    }
  }
  return { ids, genero: G.id, parou: !!signal?.aborted };
}
