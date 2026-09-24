/**
 * hearthis.at — a segunda fonte de áudio do Garimpo, e a mais parecida com o
 * SoundCloud que ainda deixa um app tocar: API aberta, sem chave, sem cadastro.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA E NÃO OUTRA (medido em 2026-09-24)
 * ════════════════════════════════════════════════════════════════════════════
 * Testei Jamendo, Internet Archive, ccMixter, Mixcloud, Nina, FMA e hearthis
 * com as exigências do deck. SoundCloud fechou a API; Mixcloud não entrega
 * áudio; ccMixter não manda CORS na API; Nina e FMA estão fora do ar pra app.
 *
 * Jamendo (645 mil faixas) e Internet Archive (80 mil lançamentos de
 * netlabel) tocam no navegador — mas não trazem BPM nem tom, e o acervo só
 * mostra faixa que tem os dois. O hearthis traz: 134 de 140 faixas medidas.
 *
 * ÁUDIO: 30/30 faixas buscáveis pelo navegador, pela cadeia
 *     hearthis.at/{artista}/{faixa}/listen/   301  (ACAO *)
 *     streamNN.hearthis.at/listen.mp3?…       200  (ACAO *)
 * O `stream_url` da API aponta pra hearthis.APP, cujo 301 NÃO manda
 * access-control-allow-origin: o navegador morreria no primeiro salto. Por
 * isso a URL é montada a partir do caminho da faixa, sempre em hearthis.AT.
 * (Depois do salto entre domínios o navegador manda Origin: null; o ACAO * do
 * streamNN aceita. Conferido emulando o salto.)
 *
 * RANGE: o preflight do hearthis.at responde 500 — mas o Chrome não faz
 * preflight pra `Range: bytes=a-b`, que é cabeçalho seguro (conferido no
 * navegador: 206; emular o preflight no Node me fez achar que não dava). O
 * deck baixa em pedaços paralelos, e cai num GET único se o navegador
 * recusar — ver comecar().
 *
 * SETS: o acervo deles é dominado por sets de DJ (mediana de 68 min no
 * "popular"). O parâmetro `duration=10`, que não está documentado, inverte
 * isso: 17 de 20 viram faixas de 1 a 10 min. Paginação vai até ~26 páginas
 * (≈500 faixas por consulta) e `count` máximo é 50.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ID: 'ht:{artista}/{faixa}', o caminho do link. É dele que saem o stream e a
 * capa, então a faixa guardada no acervo embarcado ou numa pasta toca sem
 * perguntar nada à API. O prefixo também separa do Audius: um id numérico do
 * hearthis passaria na regex de id do Audius e iria parar no Worker da galera
 * e nas consultas de sinais.
 *
 * Licença: são uploads dos próprios artistas, como no SoundCloud. A API existe
 * pra tocar em outros apps, com crédito ao artista e link pra faixa — ver
 * atribuicao().
 */

import { snapBpm, bpmWindow, parseKey, DECK_MIN_SEC, DECK_MAX_SEC } from './audius.js';

export const API = 'https://api-v2.hearthis.at';
export const SITE = 'https://hearthis.at';
export const PREFIXO = 'ht:';
/** A API devolve no máximo 50 por página. */
export const POR_PAGINA = 50;

/**
 * As categorias do hearthis que servem a um DJ, e em que gênero do app cada
 * uma cai. As que batem com um gênero do Audius entram nos chips que já
 * existem (House, Techno…) e as que batem com uma crate também (Amapiano,
 * Psy). As outras ganham chip próprio (`aba`): é o que o Audius não tem.
 *
 * Ficam de fora podcast, audiobook, rock, clássico e afins — e "funk" e
 * "urban", que conferi e são mistura (funky house alemão, prévia de
 * repertório, programa de rádio): no chip de funk brasileiro seriam ruído.
 */
export const CATEGORIAS = [
  { slug: 'house', nome: 'House', genero: 'House' },
  { slug: 'deephouse', nome: 'Deep House', genero: 'Deep House' },
  { slug: 'techhouse', nome: 'Tech House', genero: 'Tech House' },
  { slug: 'progressivehouse', nome: 'Progressive House', genero: 'Progressive House' },
  { slug: 'techno', nome: 'Techno', genero: 'Techno' },
  { slug: 'trance', nome: 'Trance', genero: 'Trance' },
  { slug: 'drumandbass', nome: 'Drum & Bass', genero: 'Drum & Bass' },
  { slug: 'dubstep', nome: 'Dubstep', genero: 'Dubstep' },
  { slug: 'trap', nome: 'Trap', genero: 'Trap' },
  { slug: 'hiphop', nome: 'Hip-Hop', genero: 'Hip-Hop/Rap' },
  { slug: 'disco', nome: 'Disco', genero: 'Disco' },
  { slug: 'ambient', nome: 'Ambient', genero: 'Ambient' },
  { slug: 'edm', nome: 'EDM', genero: 'Electronic' },
  { slug: 'dance', nome: 'Dance', genero: 'Electronic' },
  { slug: 'electro', nome: 'Electro', genero: 'Electronic' },
  { slug: 'electonica', nome: 'Electronica', genero: 'Electronic' },   // assim mesmo, com o erro deles
  // caem em crates que já existem
  { slug: 'amapiano', nome: 'Amapiano', genero: 'Amapiano', pilha: 'lat:Amapiano' },
  { slug: 'psytrance', nome: 'Psytrance', genero: 'Psytrance', pilha: 'est:Psy' },
  // o que o Audius não tem como gênero: chip novo, na aba indicada
  { slug: 'organichouse', nome: 'Organic House', genero: 'Organic House', aba: 'eletronico' },
  { slug: 'dubtechno', nome: 'Dub Techno', genero: 'Dub Techno', aba: 'eletronico' },
  { slug: 'garage', nome: 'UK Garage', genero: 'Garage', aba: 'eletronico' },
  { slug: 'breakbeat', nome: 'Breakbeat', genero: 'Breakbeat', aba: 'eletronico' },
  { slug: 'jungle', nome: 'Jungle', genero: 'Jungle', aba: 'eletronico' },
  { slug: 'bass', nome: 'Bass', genero: 'Bass', aba: 'eletronico' },
  { slug: 'futurebass', nome: 'Future Bass', genero: 'Future Bass', aba: 'eletronico' },
  { slug: 'hardstyle', nome: 'Hardstyle', genero: 'Hardstyle', aba: 'eletronico' },
  { slug: 'hardcore', nome: 'Hardcore', genero: 'Hardcore', aba: 'eletronico' },
  { slug: 'idm', nome: 'IDM', genero: 'IDM', aba: 'eletronico' },
  { slug: 'downtempo', nome: 'Downtempo', genero: 'Downtempo', aba: 'estilos' },
  { slug: 'chillout', nome: 'Chillout', genero: 'Chillout', aba: 'estilos' },
  { slug: 'lofi', nome: 'Lo-Fi', genero: 'Lo-Fi', aba: 'estilos' },
  { slug: 'rnb', nome: 'R&B', genero: 'R&B', aba: 'estilos' },
  { slug: 'soul', nome: 'Soul', genero: 'Soul', aba: 'estilos' },
  { slug: 'dancehall', nome: 'Dancehall', genero: 'Dancehall', aba: 'estilos' },
  { slug: 'raggae', nome: 'Reggae', genero: 'Reggae', aba: 'estilos' },     // idem
  { slug: 'dub', nome: 'Dub', genero: 'Dub', aba: 'estilos' },
];
const POR_SLUG = new Map(CATEGORIAS.map((c) => [c.slug, c]));
/** Os gêneros que o app já conhece: esses passam direto pela normalização. */
const CONHECIDOS = new Set(CATEGORIAS.map((c) => c.genero));

/**
 * A pilha (chave de chip) em que as faixas de uma categoria entram:
 *   - a crate que já existe ('lat:Amapiano')
 *   - o chip novo desta fonte ('ht:dubtechno')
 *   - o chip de gênero do Audius ('gen:House') — o mesmo rótulo que o
 *     trending do Audius põe, pra o equilíbrio do set contar House como um
 *     gênero só, venha de onde vier
 */
export function pilhaDe(slug) {
  const c = POR_SLUG.get(slug);
  if (!c) return null;
  return c.pilha || (c.aba ? PREFIXO + c.slug : 'gen:' + c.genero);
}

// ─────────────────────────────── rede ───────────────────────────────

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET em JSON. A API devolve lista pura (não `{ data }` como o Audius), e
 * página além do fim vem como lista vazia, não erro.
 */
export async function pegar(caminho, params = {}, { signal, tentativas = 3 } = {}) {
  // toString(), não .size: URLSearchParams.size não existe no Safari 16
  const qs = new URLSearchParams(params).toString();
  const url = `${API}${caminho}${qs ? '?' + qs : ''}`;
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      ultimo = e;
      if (signal?.aborted) throw e;
      if (i < tentativas - 1) await dormir(400 * (i + 1));
    }
  }
  throw new Error(`hearthis indisponível em ${caminho}: ${ultimo?.message}`);
}

// ─────────────────────────────── faixas ───────────────────────────────

/** Caminho '{artista}/{faixa}' tirado do link da faixa. */
export function caminhoDe(t) {
  try {
    const p = new URL(t.permalink_url).pathname.replace(/^\/+|\/+$/g, '');
    if (/^[^/]+\/[^/]+$/.test(p)) return p;
  } catch {}
  return t?.user?.permalink && t?.permalink ? `${t.user.permalink}/${t.permalink}` : null;
}

/** O caminho de uma faixa já normalizada (tira o 'ht:'). */
export const caminhoDaFaixa = (faixa) => String(faixa?.id || '').slice(PREFIXO.length);

export const ehHearthis = (faixa) => faixa?.source === 'hearthis' ||
  String(faixa?.id || '').startsWith(PREFIXO);

/** Programa falado não é faixa, mesmo tendo BPM e tom (o detector deles chuta). */
export const NAO_E_MUSICA = /podcast|radio ?show|audiobook|spoken|comedy|talk ?show|news/i;

/** Toca? Pública, não exclusiva de fã, não é transmissão ao vivo nem programa. */
export function tocavel(t) {
  return !!t && !Number(t.private) && !Number(t.fan_exclusive_play) && !Number(t.is_live) &&
    !NAO_E_MUSICA.test(t.genre || '') && !!caminhoDe(t);
}

/**
 * Marca de música brasileira no título ou no nome de quem subiu.
 *
 * Os filtros das crates brasileiras foram medidos no Audius; no hearthis,
 * que é europeu, eles erram quase sempre — conferi a amostra: "Ice MC -
 * Russian Roulette" caía em funk (o "Mc"), remix indiano em Rap BR, "AXEL
 * Schwunck" em Axé. Então rótulo brasileiro no hearthis exige isto aqui.
 */
export const BRASILEIRA = new RegExp('\\b(baile|funk (carioca|brasil(eiro)?|rj|sp|bh|mandel[aã]o|consciente|150|' +
  'ostenta[çc][aã]o|proibid[aã]o)|mtg|montagem|mandel[aã]o|tamborz[aã]o|pancad[aã]o|favela|brega|piseiro|' +
  // "samba" sozinho não: "Mercury Samba" é eletrônico europeu
  'pagod[aã]o|pagode|samba (enredo|de roda)|sambinha|sertanej\\w*|arrocha|forr[oó]|rap nacional|trap (br|nacional)|automotivo|' +
  'putaria|bregadeira|carioca|brasil|brazil(ian)?)\\b', 'i');

/** Rótulos soltos do hearthis → gênero do app (a ordem importa: o específico antes). */
const GENERO_CRU = [
  [/hip.?hop|\brap\b/i, 'Hip-Hop/Rap'],
  [/^(dance ?(&|and) ?edm|edm|dance)$/i, 'Electronic'],
  [/psy|goa/i, 'Psytrance'],
  [/dub ?techno/i, 'Dub Techno'],
  [/tekno|techno/i, 'Techno'],
  [/deep ?house/i, 'Deep House'],
  [/tech ?house/i, 'Tech House'],
  [/progressive ?house/i, 'Progressive House'],
  [/\bhouse\b/i, 'House'],
  [/drum ?(&|and|n'?) ?bass|\bdnb\b/i, 'Drum & Bass'],
  [/trance/i, 'Trance'],
  [/disco/i, 'Disco'],
  [/amapiano/i, 'Amapiano'],
];

/**
 * Normaliza um rótulo de gênero do hearthis. `texto` (título + artista)
 * decide o caso do funk: lá "funk" é funk/soul/boogie gringo, e no app o
 * gênero Funk é onde mora o funk BRASILEIRO (é o chip e a família funkbr).
 * Sem marca brasileira, vai pra Disco, que é onde ele se mistura.
 */
export function normalizarGenero(rotulo, texto = '') {
  if (!rotulo) return null;
  const r = String(rotulo).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).trim();
  if (/^funk\b/i.test(r)) return BRASILEIRA.test(texto) ? 'Funk' : 'Disco';
  if (CONHECIDOS.has(r)) return r;
  for (const [re, g] of GENERO_CRU) if (re.test(r)) return g;
  return r.slice(0, 40);
}

/** Cabe num deck: 1 a 10 min, e com BPM e tom (sem os dois o acervo não mostra). */
export function deckavel(t) {
  const d = Number(t?.duration);
  return tocavel(t) && d >= DECK_MIN_SEC && d <= DECK_MAX_SEC && Number(t.bpm) > 0 && !!parseKey(t.key);
}

/** Gênero do app pra uma faixa: pela categoria dela, senão pela que a trouxe. */
function generoDe(t, slugOrigem) {
  const c = POR_SLUG.get(t?.genre_slush) || POR_SLUG.get(slugOrigem);
  if (c) return c.genero;
  return normalizarGenero(t?.genre, `${t?.title || ''} ${t?.user?.username || ''}`);
}

/** Forma interna, a mesma das faixas do Audius (ver audius.normalizeTrack). */
export function normalizar(t, { slugOrigem = null } = {}) {
  const caminho = caminhoDe(t);
  const genero = generoDe(t, slugOrigem);
  const win = bpmWindow(genero);
  const tom = parseKey(t.key);
  const tags = Array.isArray(t.tags_arr) ? t.tags_arr
    : String(t.tags || '').split(',').map((x) => x.trim()).filter(Boolean);
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    source: 'hearthis',
    id: PREFIXO + caminho,
    title: String(t.title || '').trim() || '(sem título)',
    artist: t.user?.username || t.user?.permalink || '(desconhecido)',
    handle: t.user?.permalink ? PREFIXO + t.user.permalink : null,
    duration: Math.round(Number(t.duration) || 0),
    genre: genero,
    mood: null,
    tags,
    bpm: snapBpm(t.bpm, win),
    bpmWindow: win,
    bpmRaw: n(t.bpm),
    key: tom?.label || null,
    camelot: tom?.camelot || null,
    artwork: t.artwork_url || t.thumb || null,
    license: t.license || null,
    permalink: `${SITE}/${caminho}/`,
    releaseDate: t.release_date || null,
    isLongMix: Number(t.duration) > DECK_MAX_SEC,
    playable: tocavel(t),
    // o que o montador de set usa pra preferir música que alguém ouviu (ver
    // setlist.qualidade): no Audius isso é pedido à parte; aqui vem junto
    sinais: {
      plays: n(t.playback_count), curtidas: n(t.favoritings_count), reposts: n(t.reshares_count),
      tags: tags.join(',') || null, clima: null,
      descricao: String(t.description || '').slice(0, 140) || null,
    },
  };
}

/** Filtra o lote cru pro que serve num deck e normaliza. */
export function preparar(cru, { slugOrigem = null } = {}) {
  return (Array.isArray(cru) ? cru : []).filter(deckavel).map((t) => normalizar(t, { slugOrigem }));
}

// ─────────────────────────────── consultas ───────────────────────────────

/** Uma página de uma categoria, só faixas de até 10 min. */
export async function categoria(slug, { pagina = 1, count = POR_PAGINA, signal } = {}) {
  const cru = await pegar(`/categories/${encodeURIComponent(slug)}/`,
    { page: String(pagina), count: String(count), duration: '10' }, { signal });
  return preparar(cru, { slugOrigem: slug });
}

/** Busca por texto, só faixas de até 10 min. */
export async function buscar(q, { pagina = 1, count = POR_PAGINA, signal } = {}) {
  const cru = await pegar('/search/', { t: q, page: String(pagina), count: String(count), duration: '10' }, { signal });
  return preparar(cru);
}

/** As faixas de um artista (handle 'ht:fulano' ou só 'fulano'). */
export async function faixasDoArtista(handle, { pagina = 1, count = POR_PAGINA, signal } = {}) {
  const quem = String(handle).replace(PREFIXO, '');
  const cru = await pegar(`/${encodeURIComponent(quem)}/`,
    { type: 'tracks', page: String(pagina), count: String(count) }, { signal });
  return preparar(cru);
}

/**
 * O QUE ESTÁ ROLANDO DE BOM no underground eletrônico daqui, agora.
 *
 * "Underground" o hearthis já é: medi mediana de 13 plays na primeira página
 * de techno. E ele não diz quantos seguidores cada artista tem (o objeto
 * `user` não traz), então a régua das revelações do Audius — tração dividida
 * por fama — não se aplica. O que separa o bom é o que PEGOU entre o que subiu
 * há pouco:
 *   - o "popular" deles (recente e ouvido), só o que é de pista
 *   - a 1ª página de cada categoria da cena (≈ as últimas 4 semanas)
 *
 * A régua é CARINHO, não play. A primeira versão somava plays e o topo saiu
 * "[TRAILER] … Full Set" e reupload de conta de rádio: 11 mil plays e zero
 * curtida — é divulgação, não cena. O que a cena abraça tem outro desenho:
 * 217 plays, 15 curtidas, 12 reposts. Então exige curtida ou repost, e play
 * só desempata (com teto). Amortecida pela idade; no máximo duas por artista,
 * pra ser a cena e não um perfil.
 */
const CENA = ['techno', 'deephouse', 'house', 'techhouse', 'dubtechno', 'organichouse', 'breakbeat', 'electro', 'disco'];
const DE_PISTA = new Set(['House', 'Deep House', 'Tech House', 'Progressive House', 'Organic House',
  'Techno', 'Dub Techno', 'Electronic', 'Disco', 'Garage', 'Breakbeat', 'Drum & Bass', 'Jungle', 'Bass',
  'Trance', 'Psytrance', 'Amapiano']);
/** Set, programa, coletânea e prévia não são faixa, mesmo com menos de 10 min. */
const NAO_E_FAIXA = new RegExp('\\b(podcast|radio ?show|episode|session|preview|snippet|teaser|trailer|jingle|' +
  'promo mix|full set|dj ?set|dj ?mix|mixtape|in the mix|megamix|classics \\d|vol(ume)?\\.? ?\\d)\\b', 'i');
/** Conta de rádio sobe clássico dos outros: não é a cena de agora. */
const CONTA_DE_RADIO = /\bradio\b/i;

/**
 * As faixas de pista que subiram há pouco (até 120 dias), já com carinho,
 * plays e idade. Uma consulta só, guardada por 10 min: o 🕳️ Underground e os
 * 🚀 estourados leem daqui, e a API deles não precisa responder duas vezes.
 *
 * Teto de 10 s POR pedido: com a API lenta, a primeira versão levou 24 s pra
 * abrir o chip esperando o mais demorado. O que não chegar fica de fora.
 */
let recentesGuardadas = null;      // { quando, promessa }
function recentes() {
  if (recentesGuardadas && Date.now() - recentesGuardadas.quando < 10 * 60e3) return recentesGuardadas.promessa;
  const pagina = (caminho, params, slug) => pegar(caminho,
    { ...params, count: String(POR_PAGINA), duration: '10' },
    { signal: AbortSignal.timeout?.(10000), tentativas: 1 })
    .then((l) => (Array.isArray(l) ? l : []).map((t) => ({ t, slug })));
  const promessa = (async () => {
    const lotes = await Promise.allSettled([
      ...[1, 2].map((p) => pagina('/feed/', { type: 'popular', page: String(p) }, null)),
      ...CENA.map((slug) => pagina(`/categories/${slug}/`, { page: '1' }, slug)),
    ]);
    const agora = Date.now();
    const porId = new Map();
    for (const { t, slug } of lotes.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))) {
      if (!deckavel(t) || NAO_E_FAIXA.test(t.title || '') || CONTA_DE_RADIO.test(t.user?.username || '')) continue;
      if (!DE_PISTA.has(generoDe(t, slug))) continue;
      const quando = Date.parse(String(t.release_date || t.created_at || '').replace(' ', 'T') + 'Z');
      const dias = Number.isFinite(quando) ? Math.max(0, (agora - quando) / 86400e3) : Infinity;
      if (dias > 120) continue;
      const f = normalizar(t, { slugOrigem: slug });
      if (porId.has(f.id)) continue;
      porId.set(f.id, {
        f, dias,
        carinho: (Number(t.favoritings_count) || 0) + 2 * (Number(t.reshares_count) || 0),
        plays: Math.min(500, Number(t.playback_count) || 0),
      });
    }
    if (!porId.size) throw new Error('hearthis não respondeu');
    return [...porId.values()];
  })();
  recentesGuardadas = { quando: Date.now(), promessa };
  promessa.catch(() => { recentesGuardadas = null; });   // falha não fica guardada
  return promessa;
}

export async function emAlta({ limite = 40 } = {}) {
  const lista = (await recentes()).filter((x) => x.carinho >= 2)
    .map((x) => ({ f: x.f, nota: (10 * x.carinho + 0.2 * x.plays) / Math.sqrt(1 + x.dias / 7) }));
  const porArtista = {};
  const fora = [];
  for (const { f } of lista.sort((a, b) => b.nota - a.nota)) {
    if ((porArtista[f.handle] = (porArtista[f.handle] || 0) + 1) > 2) continue;
    fora.push(f);
    if (fora.length >= limite) break;
  }
  return fora;
}

/**
 * 🚀 OS ESTOURADOS DO MOMENTO: os artistas por trás do que está rolando.
 *
 * O "popular" do hearthis NÃO serve pra isso, medido: o topo é rádio e DJ que
 * só sobe set de uma hora — dos 25 primeiros, 22 tinham ZERO faixa que caiba
 * num deck. Então estourado aqui é quem tem faixa de pista recente que a cena
 * está abraçando: soma o carinho das faixas do artista e premia quem tem mais
 * de uma (uma é sorte; várias é alguém chegando). Exige carinho ≥ 4.
 *
 * @returns {Promise<{id, nome, fonte, faixas}[]>}  id = handle 'ht:fulano'
 */
export async function estourados({ n = 8 } = {}) {
  const por = new Map();
  for (const x of await recentes()) {
    const h = x.f.handle;
    if (!h) continue;
    const a = por.get(h) || { id: h, nome: x.f.artist, fonte: 'hearthis', carinho: 0, plays: 0, faixas: 0 };
    a.carinho += x.carinho; a.plays += x.plays; a.faixas++;
    por.set(h, a);
  }
  return [...por.values()].filter((a) => a.carinho >= 4)
    .map((a) => ({ ...a, nota: 10 * a.carinho + 0.2 * a.plays + 15 * (a.faixas - 1) }))
    .sort((a, b) => b.nota - a.nota).slice(0, n)
    .map(({ id, nome, fonte, faixas }) => ({ id, nome: String(nome).replace(/\s*[|•].*$/, '').trim(), fonte, faixas }));
}

// ─────────────────────────────── áudio e capa ───────────────────────────────

/** A URL que o navegador consegue buscar — ver o topo do arquivo. */
export function urlDoStream(faixa) {
  const c = caminhoDaFaixa(faixa);
  if (!/^[^/]+\/[^/]+$/.test(c)) throw new Error('faixa do hearthis sem caminho');
  return `${SITE}/${c}/listen/`;
}

/**
 * BAIXAR EM PEDAÇOS — porque o servidor de stream deles limita cada conexão.
 *
 * MEDIDO no navegador, intercalando com o Audius: o stream76 entregou
 * 236 KB/s cravados em 4 de 4 faixas (limite por conexão), enquanto o Audius
 * dava 900 a 5800 KB/s. Com um GET só, os 2 MB do prefixo levavam ~10 s.
 * Em pedaços: 1 conexão 1048 KB/s, 4 conexões 2344 KB/s (stream75).
 *
 * `Range: bytes=a-b` é cabeçalho seguro no Chrome — NÃO dispara preflight
 * (conferido: 206 no hearthis.at, cujo preflight responderia 500). Cada
 * pedaço vai ao hearthis.at/…/listen/ e segue o próprio 301: a URL final do
 * GET (listen.mp3?…) tem CORS, mas a que o HEAD devolve (/<hash>.mp3) NÃO.
 *
 *   prefixo  4 × 512 KB em paralelo = 2 MB, 52 a 87 s de áudio
 *   tamanho  HEAD em paralelo (content-length é cabeçalho exposto)
 *   resto    pedaços de 1 MB, 4 conexões — só quando a faixa entra no deck
 *
 * O prefixo era 1 MB e foi pouco: medi o arquivo inteiro chegando 25 s
 * depois do clique numa faixa de 320 kbps cujo prefixo tinha 26 s de áudio.
 * Apertado demais — numa rede pior o som pararia antes do resto chegar.
 * Com 2 MB custa ~1 s a mais até tocar (3,8 s aquecida, ~6 s fria, medido
 * com 1 MB) e a folga dobra.
 *
 * Navegador que exigir preflight pra Range (a checar no Safari): cai no GET
 * único lido aos pedaços, que funciona em qualquer um, só que mais lento.
 */
const KB = 1024;
const PEDACO_PREFIXO = 512 * KB;
const PEDACO = 1024 * KB;
const CONEXOES = 4;

class SemRange extends Error {}

function juntar(partes) {
  const n = partes.reduce((s, p) => s + p.byteLength, 0);
  const u = new Uint8Array(n);
  let o = 0;
  for (const p of partes) { u.set(new Uint8Array(p), o); o += p.byteLength; }
  return u.buffer;
}

async function pedaco(url, ini, fim, signal, tentativas = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${ini}-${fim}` }, signal });
      if (r.status === 416) return new ArrayBuffer(0);        // começa depois do fim
      if (r.status !== 206) { r.body?.cancel().catch(() => {}); throw new SemRange(`respondeu ${r.status} a um Range`); }
      return await r.arrayBuffer();
    } catch (e) {
      if (signal?.aborted || e instanceof SemRange || i >= tentativas - 1) throw e;
      await dormir(300 * (i + 1));
    }
  }
}

/** Um GET só, lido aos pedaços: o caminho de quem não aceita Range sem preflight. */
async function corrido(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`stream respondeu ${r.status}`);
  const leitor = r.body.getReader();
  const partes = [];
  let lidos = 0;
  while (lidos < 4 * PEDACO_PREFIXO) {
    const { done, value } = await leitor.read();
    if (done) return { prefixo: juntar(partes), inteiro: true, modo: 'corrido' };
    partes.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    lidos += value.byteLength;
  }
  const prefixo = juntar(partes);
  return {
    prefixo, inteiro: false, modo: 'corrido',
    // o resto continua a MESMA leitura; o sinal é o de quem abriu o GET
    resto: async () => {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) return juntar(partes);
        partes.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      }
    },
  };
}

/**
 * Começa a baixar uma faixa: devolve o prefixo tocável e uma função que baixa
 * o resto. { prefixo, inteiro, modo, resto(signal) → ArrayBuffer inteiro }
 */
export async function comecar(faixa, { signal } = {}) {
  const url = urlDoStream(faixa);
  const tamanho = fetch(url, { method: 'HEAD', signal })
    .then((r) => Number(r.headers.get('content-length')) || null).catch(() => null);
  let pref;
  try {
    pref = await Promise.all([0, 1, 2, 3].map((i) =>
      pedaco(url, i * PEDACO_PREFIXO, (i + 1) * PEDACO_PREFIXO - 1, signal, 1)));
  } catch (e) {
    if (signal?.aborted) throw e;
    return corrido(url, signal);
  }
  const prefixo = juntar(pref);
  if (prefixo.byteLength < 4 * PEDACO_PREFIXO) return { prefixo, inteiro: true, modo: 'pedaços' };

  const resto = async (sinal) => {
    const total = await tamanho;
    if (!total) {
      // sem o tamanho: o resto numa tacada só, a partir de onde o prefixo parou
      const r = await fetch(url, { headers: { Range: `bytes=${prefixo.byteLength}-` }, signal: sinal });
      if (r.status !== 206) throw new Error(`resto respondeu ${r.status}`);
      return juntar([prefixo, await r.arrayBuffer()]);
    }
    const trechos = [];
    for (let ini = prefixo.byteLength; ini < total; ini += PEDACO) trechos.push([ini, Math.min(total, ini + PEDACO) - 1]);
    const partes = new Array(trechos.length);
    let prox = 0;
    await Promise.all(Array.from({ length: CONEXOES }, async () => {
      while (prox < trechos.length) {
        const k = prox++;
        partes[k] = await pedaco(url, trechos[k][0], trechos[k][1], sinal);
      }
    }));
    return juntar([prefixo, ...partes]);
  };
  return { prefixo, inteiro: false, modo: 'pedaços', resto };
}

/**
 * AQUECER: baixa o PREFIXO antes do clique (o resto só quando a faixa entra
 * no deck). A primeira resposta do hearthis leva 1 a 3,5 s — o 301 e o
 * servidor de stream acordando —, contra 0,2 a 0,5 s do Audius.
 *
 * Aqui aquecer já é baixar 1 MB, então quem chama espera o ponteiro PARAR no
 * item, e são no máximo DUAS de cada vez (a mais velha cede), por 20 s:
 * passar o mouse pela lista não pode virar dez downloads.
 */
const aquecidas = new Map();     // id → { promessa, ac, timer }
const MAX_AQUECIDAS = 2;

export function aquecer(faixa) {
  if (!faixa?.id || aquecidas.has(faixa.id)) return;
  while (aquecidas.size >= MAX_AQUECIDAS) {
    const [id, velha] = aquecidas.entries().next().value;
    clearTimeout(velha.timer); velha.ac.abort(); aquecidas.delete(id);
  }
  const ac = new AbortController();
  const promessa = comecar(faixa, { signal: ac.signal });
  promessa.catch(() => {});
  const timer = setTimeout(() => { ac.abort(); aquecidas.delete(faixa.id); }, 20000);
  aquecidas.set(faixa.id, { promessa, ac, timer });
}

/** Entrega (uma vez só) o começo já baixado desta faixa, se houver. */
export function tomarAquecida(faixa) {
  const a = aquecidas.get(faixa?.id);
  if (!a) return null;
  aquecidas.delete(faixa.id);
  clearTimeout(a.timer);
  return a;
}

/** Detalhe da faixa pelo caminho — pra capa sob demanda (o acervo não guarda). */
export async function detalhe(faixa, { signal } = {}) {
  const c = caminhoDaFaixa(faixa);
  return pegar(`/${c.split('/').map(encodeURIComponent).join('/')}/`, {}, { signal, tentativas: 1 });
}

/** Crédito que acompanha a faixa na tela: artista e link pra ela no hearthis. */
export function atribuicao(faixa) {
  return {
    artist: faixa.artist,
    trackUrl: faixa.permalink || `${SITE}/${caminhoDaFaixa(faixa)}/`,
    license: faixa.license && faixa.license !== 'all' ? faixa.license : null,
  };
}
