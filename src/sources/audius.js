/**
 * Audius — fonte de áudio do Garimpo.
 *
 * Sem chave de API, sem cadastro. Metadata e áudio com CORS liberado.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A DESCOBERTA QUE FAZ ISSO FUNCIONAR (medido em 2026-09-11, 18/18 faixas)
 * ════════════════════════════════════════════════════════════════════════════
 * NÃO use /tracks/{id}/stream e deixe o navegador seguir o redirect. A cadeia é
 *     302 → validator → 307 → armazenamento bruto (Cloudflare R2 / Backblaze)
 * e o último hop NÃO manda access-control-allow-origin. Resultado: ~31% das
 * faixas falham com "Failed to fetch" no navegador, de forma permanente
 * (o validator é fixo por faixa — testei 8/8 tentativas, sempre igual).
 * O curl engana porque segue redirect sem fazer checagem de CORS.
 *
 * USE /tracks/{id}/stream?no_redirect=true. Devolve JSON (ACAO: *) com a URL
 * assinada do validator, que na maioria das vezes serve os bytes ele mesmo,
 * com CORS completo e Range funcionando.
 *
 * CORRECAO (2026-09-12): eu havia escrito "100% do catalogo" com base em 18/18.
 * Exagerei. Em uso real ~2 em 5 resolves ainda devolvem uma URL que redireciona
 * pro R2 e quebra por CORS. MAS o validator e SORTEADO a cada resolve (4-5
 * acertos em 6 na mesma faixa), ao contrario do caminho do redirect, que era
 * fixo por faixa. Entao resolveStreamUrl agora VERIFICA com 2 bytes antes de
 * devolver e resolve de novo se falhar. Com 4 tentativas isso passa de 99%.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Licença: Open Music License §1.2 concede a "Music Players" direito
 * irrevogável e royalty-free de EXECUÇÃO PÚBLICA. NÃO concede obra derivada —
 * tocar é livre, gravar e publicar mix não é. Ver attribution() para §1.5.
 *
 * O campo `license` da faixa NÃO é o portão (35% dizem "All rights reserved" e
 * tocam normalmente). Os portões reais são is_streamable, is_stream_gated e
 * allowed_api_keys.
 */

export const APP_NAME = 'garimpo';

/** Hosts de discovery. Se um cair, tenta o próximo. */
const HOSTS = [
  'https://discoveryprovider.audius.co',
  'https://api.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
];

let hostIndex = 0;

/** Faixa usável num deck: 1 min a 10 min. Acima disso é set/mix de DJ. */
export const DECK_MIN_SEC = 60;
export const DECK_MAX_SEC = 600;

class AudiusError extends Error {
  constructor(msg, cause) {
    super(msg);
    this.name = 'AudiusError';
    this.cause = cause;
  }
}

/** GET em JSON com failover entre hosts de discovery e backoff. */
async function api(path, params = {}, { tries = HOSTS.length * 2, signal } = {}) {
  const qs = new URLSearchParams({ ...params, app_name: APP_NAME });
  let last;
  for (let i = 0; i < tries; i++) {
    const host = HOSTS[(hostIndex + i) % HOSTS.length];
    try {
      const res = await fetch(`${host}/v1${path}?${qs}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      hostIndex = (hostIndex + i) % HOSTS.length; // fixa no host que respondeu
      return json.data;
    } catch (e) {
      last = e;
      if (signal?.aborted) throw e;
      if (i < tries - 1) await sleep(180 * (i + 1));
    }
  }
  throw new AudiusError(`Audius indisponível em ${path}`, last);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────── BPM ───────────────────────────────

/**
 * Arredonda BPM pra valor musical e dobra oitavas pra faixa de trabalho.
 *
 * Dois problemas reais, medidos: o BPM do Audius é detectado por máquina
 * (is_custom_bpm = 0 em 100/100 da amostra) e erra meio-tempo — vi techno
 * marcado como 64.9 BPM. E um erro de 0.03 BPM acumula um tempo inteiro em
 * ~4 minutos, o que faz mix longo descolar mesmo com SYNC perfeito.
 *
 * CRÍTICO pro planejador de set: sem dobrar a oitava ANTES de montar as
 * arestas do grafo, ele julga 130 e 65 incompatíveis sendo o mesmo andamento.
 */
/**
 * Janelas de BPM por gênero. Desambiguam a dobra de oitava: sem isso, um DnB
 * detectado como 87 fica em 87 em vez de 174, e um techno lido como 64.9 pode
 * parar em 70 em vez de 130. O gênero vem de graça no metadata do Audius.
 *
 * Ainda assim a ambiguidade é INERENTE — só pelo número não se sabe se 70 é
 * 70 ou 140. Por isso a UI precisa dos botões ×2 e ÷2.
 */
export const GENRE_BPM = {
  'Drum & Bass': [160, 185],
  'Dubstep': [130, 155],
  'Techno': [118, 150],
  'House': [112, 135],
  'Deep House': [112, 130],
  'Tech House': [118, 132],
  'Progressive House': [120, 136],
  'Trance': [128, 145],
  'Disco': [108, 130],
  'Trap': [125, 160],
  'Hip-Hop/Rap': [78, 108],
  'Ambient': [60, 115],
  'Electronic': [105, 150],
};

export function bpmWindow(genre) {
  const w = GENRE_BPM[genre];
  return w ? { min: w[0], max: w[1] } : { min: 70, max: 180 };
}

export function snapBpm(raw, { min = 70, max = 180 } = {}) {
  const bpm = Number(raw);
  if (!Number.isFinite(bpm) || bpm <= 0) return null;

  // Enumera as oitavas plausíveis. NÃO usar dois laços while (um sobe até min,
  // outro desce até max): com janela mais estreita que uma oitava eles se
  // desfazem mutuamente e devolvem valor FORA da janela sem avisar.
  const cands = [];
  for (let b = bpm; b >= 20; b /= 2) cands.push(b);
  for (let b = bpm * 2; b <= 400; b *= 2) cands.push(b);

  // distância logarítmica até o intervalo [min,max] (0 se estiver dentro)
  const distToWindow = (b) =>
    b < min ? Math.log2(min / b) : b > max ? Math.log2(b / max) : 0;

  const inside = cands.filter((b) => distToWindow(b) === 0);
  let pick;
  if (inside.length) {
    // dentro da janela: prefere a que exige MENOS dobras, pra não reinterpretar
    // mais do que o necessário (350 → 175, não 87.5)
    inside.sort((a, b) => Math.abs(Math.log2(a / bpm)) - Math.abs(Math.log2(b / bpm)));
    pick = inside[0];
  } else {
    // nenhuma oitava cabe: pega a que menos extrapola a janela
    cands.sort((a, b) => distToWindow(a) - distToWindow(b));
    pick = cands[0];
  }

  const i = Math.round(pick);
  if (Math.abs(pick - i) <= 0.08) return i; // 120, não 119.97
  const h = Math.round(pick * 2) / 2;
  if (Math.abs(pick - h) <= 0.03) return h; // permite 128.5
  return Math.round(pick * 100) / 100;
}

// ─────────────────────────────── tom / Camelot ───────────────────────────────

const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
// indexado por pitch class (C=0 .. B=11)
const MINOR_CAMELOT = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
const MAJOR_CAMELOT = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Converte o `musical_key` do Audius pra Camelot.
 * O Audius escreve em texto: "G minor", "A flat minor", "F major", "G flat minor".
 * Retorna { pc, mode, camelot, label } ou null.
 */
export function parseKey(text) {
  if (!text || typeof text !== 'string') return null;
  const s = text.trim().toLowerCase();
  const m = s.match(/^([a-g])\s*(sharp|#|flat|b|♭|♯)?\s*(major|minor|maj|min|m)?/);
  if (!m) return null;

  let pc = PC[m[1]];
  if (pc === undefined) return null;
  const acc = m[2];
  if (acc === 'sharp' || acc === '#' || acc === '♯') pc += 1;
  else if (acc === 'flat' || acc === 'b' || acc === '♭') pc -= 1;
  pc = ((pc % 12) + 12) % 12;

  // `m` sozinho também é menor: o hearthis escreve "Am", "Gbm". Com /min/ só,
  // "Am" virava Lá MAIOR — e 'maj' não pode casar, por isso a âncora.
  const isMinor = /^m(in(or)?)?$/.test(m[3] || '') || /\bminor\b/.test(s);
  const mode = isMinor ? 'minor' : 'major';
  const camelot = (isMinor ? MINOR_CAMELOT : MAJOR_CAMELOT)[pc] + (isMinor ? 'A' : 'B');
  return { pc, mode, camelot, label: `${SHARP[pc]} ${isMinor ? 'min' : 'maj'}` };
}

/**
 * Compatibilidade harmônica pela roda de Camelot: mesmo tom, vizinho (±1 na
 * mesma letra), ou relativa maior/minor (mesmo número, letra trocada).
 */
export function keyCompatible(a, b) {
  if (!a || !b) return { ok: true, reason: 'tom desconhecido', distance: null };
  const pa = typeof a === 'string' ? parseKey(a) : a;
  const pb = typeof b === 'string' ? parseKey(b) : b;
  if (!pa || !pb) return { ok: true, reason: 'tom desconhecido', distance: null };

  const na = parseInt(pa.camelot, 10), la = pa.camelot.slice(-1);
  const nb = parseInt(pb.camelot, 10), lb = pb.camelot.slice(-1);
  const ring = Math.min(Math.abs(na - nb), 12 - Math.abs(na - nb));

  if (na === nb && la === lb) return { ok: true, reason: 'mesmo tom', distance: 0 };
  if (na === nb) return { ok: true, reason: 'relativa maior/menor', distance: 1 };
  if (ring === 1 && la === lb) return { ok: true, reason: 'vizinho na roda', distance: 1 };
  if (ring === 1) return { ok: false, reason: 'vizinho mas modo trocado', distance: 2 };
  return { ok: false, reason: `${ring} passos na roda`, distance: ring };
}

// ─────────────────────────────── faixas ───────────────────────────────

/** Portões reais de playback. O campo `license` NÃO é um deles. */
export function isPlayable(t) {
  return !!t && t.is_streamable === true && !t.is_stream_gated &&
         !(t.allowed_api_keys && t.allowed_api_keys.length);
}

/** Dá pra carregar num deck, ou é um set de 60 min? */
export function isDeckable(t) {
  return isPlayable(t) && t.duration >= DECK_MIN_SEC && t.duration <= DECK_MAX_SEC;
}

/** Forma interna. bpmRaw fica guardado pra UI poder mostrar o valor original. */
export function normalizeTrack(t) {
  const key = parseKey(t.musical_key);
  const win = bpmWindow(t.genre);
  return {
    source: 'audius',
    id: t.id,
    title: t.title,
    artist: t.user?.name || t.user?.handle || '(desconhecido)',
    handle: t.user?.handle || null,
    duration: t.duration,
    genre: t.genre || null,
    mood: t.mood || null,
    tags: t.tags ? String(t.tags).split(',').filter(Boolean) : [],
    isrc: t.isrc || null,
    bpm: snapBpm(t.bpm, win),
    bpmWindow: win,
    bpmRaw: t.bpm ?? null,
    bpmFromArtist: !!t.is_custom_bpm,
    key: key?.label || null,
    camelot: key?.camelot || null,
    keyFromArtist: !!t.is_custom_musical_key,
    artwork: t.artwork?.['480x480'] || t.artwork?.['150x150'] || null,
    license: t.license || null,
    permalink: t.permalink ? `https://audius.co${t.permalink}` : null,
    releaseDate: t.release_date || null,
    isLongMix: t.duration > DECK_MAX_SEC,
    playable: isPlayable(t),
  };
}

export async function trending({ genre, limit = 50, time = 'week', signal } = {}) {
  const p = { limit: String(limit), time };
  if (genre) p.genre = genre;
  const data = await api('/tracks/trending', p, { signal });
  return (data || []).filter(isPlayable).map(normalizeTrack);
}

export async function search(query, { limit = 50, signal } = {}) {
  const data = await api('/tracks/search', { query, limit: String(limit) }, { signal });
  return (data || []).filter(isPlayable).map(normalizeTrack);
}

export async function getTrack(id, { signal } = {}) {
  const data = await api(`/tracks/${id}`, {}, { signal });
  return data ? normalizeTrack(data) : null;
}

/**
 * Resolve a URL de áudio REALMENTE buscável pelo navegador.
 * Este é o coração do módulo — ver o comentário no topo do arquivo.
 * O validator é sorteado por chamada, então um retry pega outro nó.
 */
export async function resolveStreamUrl(id, { tries = 4, verificar = true, signal } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const url = await api(`/tracks/${id}/stream`, { no_redirect: 'true' }, { tries: 2, signal });
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        throw new Error('no_redirect não devolveu URL');
      }
      if (!verificar) return url;

      // MEDIDO: nem todo validator serve direto. Alguns (v.monophonic.digital,
      // cn0.mainnet.audiusindex.org) ainda respondem 307 para armazenamento
      // bruto sem CORS, e aí o navegador falha com "Failed to fetch".
      // Mas o host é SORTEADO a cada resolve (4-5 acertos em 6), então basta
      // resolver de novo. Confere com 2 bytes antes de entregar.
      const r = await fetch(url, { headers: { Range: 'bytes=0-1' }, signal });
      if (r.status === 206 || r.ok) return url;
      throw new Error(`validator respondeu ${r.status}`);
    } catch (e) {
      last = e;
      if (signal?.aborted) throw e;
      await sleep(120 * (i + 1));
    }
  }
  throw new AudiusError(
    `nenhum validator do Audius serviu esta faixa (${tries} tentativas)`, last);
}

/**
 * Aquece a faixa ANTES do clique: resolve a URL e abre a conexão com o
 * validator gastando 2 bytes.
 *
 * MEDIDO: o tamanho do prefixo quase não muda o tempo até tocável (256 KB a
 * 2 MB ficam todos entre 900 e 1300 ms com conexão quente), porque o custo é
 * LATÊNCIA, não banda — RTT de 550 ms. O que pesa é que cada faixa resolve
 * para um host de validator diferente, então é DNS + TLS do zero a cada vez:
 * com conexão fria o mesmo download leva 2527 ms em vez de 730 ms.
 *
 * Chamar no hover (ou ao renderizar a lista) tira ~2 s do caminho do clique.
 * O resultado fica em cache: resolveStreamUrl() reaproveita.
 */
const cacheUrl = new Map();

export async function prefetch(id, { signal } = {}) {
  if (cacheUrl.has(id)) return cacheUrl.get(id);
  const p = (async () => {
    const url = await resolveStreamUrl(id, { signal });
    // preconnect explícito ajuda o navegador a guardar o socket
    try {
      const l = document.createElement('link');
      l.rel = 'preconnect';
      l.href = new URL(url).origin;
      l.crossOrigin = 'anonymous';
      document.head.appendChild(l);
    } catch {}
    // resolveStreamUrl ja gastou 2 bytes verificando, entao a conexao ja esta
    // quente aqui: nao precisa sondar de novo
    return url;
  })();
  cacheUrl.set(id, p);
  p.catch(() => cacheUrl.delete(id)); // não cacheia falha
  return p;
}

/** URL já aquecida, se houver. */
export function urlAquecida(id) { return cacheUrl.get(id) || null; }

/**
 * Confere que a URL é de fato buscável com Range, gastando 2 bytes.
 * Use antes de marcar uma faixa como tocável na biblioteca, e guarde o
 * veredito em IndexedDB — assim a UI nunca promete o que não entrega.
 */
export async function probeStream(url, { signal } = {}) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1' }, signal });
    return {
      ok: r.status === 206 || r.ok,
      status: r.status,
      ranges: r.status === 206,
      bytes: Number((r.headers.get('content-range') || '').split('/')[1]) || null,
      type: r.headers.get('content-type'),
    };
  } catch (e) {
    return { ok: false, status: 0, ranges: false, bytes: null, error: e.message };
  }
}

/** Atribuição exigida pela Open Music License §1.5. Renderizar junto da faixa. */
export function attribution(track) {
  return {
    artist: track.artist,
    copyright: `© ${track.releaseDate ? new Date(track.releaseDate).getFullYear() : ''} ${track.artist}`.trim(),
    licenseNotice: 'Licenciado sob a Audius Open Music License',
    licenseUrl: 'https://openaudiofoundation.org/open-music-license.pdf',
    trackUrl: track.permalink,
  };
}

/**
 * Faixas que dá pra mixar COM esta: BPM dentro do alcance do pitch e tom
 * compatível na roda de Camelot.
 *
 * É o núcleo do planejador de set, antecipado — porque procurar por nome num
 * catálogo independente não funciona (buscar "french house" devolve Rock e
 * Comedy mal etiquetados), mas procurar por 122 BPM em 8A funciona sempre.
 *
 * A dobra de oitava do snapBpm tem que vir ANTES da comparação, senão uma
 * faixa de 124 e outra lida como 62 parecem incompatíveis sendo o mesmo andamento.
 */
export async function compativeis(faixa, {
  toleranciaBpm = 0.08,     // o que o pitch fader alcança
  limite = 60,
  generos = null,
  permitirMeioTempo = true, // aceitar faixa no dobro/metade do andamento
  signal,
} = {}) {
  if (!faixa?.bpm) throw new AudiusError('a faixa carregada não tem BPM');

  const alvo = faixa.bpm;
  const busca = generos || [faixa.genre, 'House', 'Disco', 'Deep House', 'Tech House',
    'Latin', 'Funk', 'Hip-Hop/Rap', 'World']
    .filter((g, i, a) => g && a.indexOf(g) === i);

  const vistas = new Map();
  for (const g of busca) {
    try {
      for (const t of await trending({ genre: g, limit: 50, signal })) {
        if (!t.bpm || t.isLongMix || t.id === faixa.id) continue;
        if (!vistas.has(t.id)) vistas.set(t.id, t);
      }
    } catch { /* um gênero fora do ar não derruba o resto */ }
  }

  const fora = [];
  for (const t of vistas.values()) {
    // TRES relacoes de tempo, nao uma. Um brega funk de 150 e um trap de 75 tem
    // a MESMA batida, em metade e no dobro do andamento — tocar um em cima do
    // outro e justamente como se mistura ritmo diferente. Recusar o 2:1 seria
    // recusar metade da musica brasileira.
    let razao = t.bpm / alvo, relacao = 1;
    if (permitirMeioTempo) {
      for (const [r, rel] of [[t.bpm / alvo, 1], [t.bpm / (alvo * 2), 0.5], [t.bpm / (alvo / 2), 2]]) {
        if (Math.abs(r - 1) < Math.abs(razao - 1)) { razao = r; relacao = rel; }
      }
    }
    const desvio = Math.abs(razao - 1);
    if (desvio > toleranciaBpm) continue;               // fora do pitch fader

    const harmonia = keyCompatible(
      faixa.camelot ? { camelot: faixa.camelot } : null,
      t.camelot ? { camelot: t.camelot } : null
    );

    fora.push({
      ...t,
      pitchNecessario: (razao - 1),                      // fração; -0.02 = -2%
      tempoRelacao: relacao,                             // 1 | 0.5 (meio tempo) | 2 (dobro)
      harmonia: harmonia.reason,
      harmonicamenteOk: harmonia.ok,
      // ordena por harmonia primeiro, depois por quão pouco precisa de pitch.
      // meio tempo entra, mas atrás do casamento direto: exige mais da mão.
      _score: (harmonia.ok ? 0 : 10) + (harmonia.distance ?? 2) + desvio * 20
              + (relacao === 1 ? 0 : 1.5),
    });
  }

  fora.sort((a, b) => a._score - b._score);
  return fora.slice(0, limite);
}

export const GENRES = [
  'Electronic', 'House', 'Techno', 'Deep House', 'Tech House', 'Progressive House',
  'Drum & Bass', 'Dubstep', 'Trap', 'Hip-Hop/Rap', 'Disco', 'Trance', 'Ambient',
  // estes tres sao onde mora o que veio do Brasil no Audius, conferido por busca
  'Latin', 'Funk', 'World',
];

/**
 * Crates brasileiras — busca por texto, não por gênero.
 *
 * O Audius não tem gênero "funk carioca", "pagode" nem "sertanejo": o que existe
 * está espalhado em Latin, World, Funk e Hip-Hop/Rap. Então o caminho é busca
 * textual, e foi medida uma por uma contra o filtro de deck (tocável, 60–600 s):
 *
 *   pagode 30/30 · sertanejo 30/30 · baile funk 25/30 · brega funk 22/24
 *   samba 27/30 · rap nacional 15/16 · trap brasileiro 14/14 · funk carioca 8/8
 *
 * `termo` é o que vai pro Audius; `filtro` é o que separa acerto de homônimo —
 * buscar "forró" devolve "forlorn" e buscar "axé" devolve "Maze of the Axe".
 */
/** "acid"/"303" no nome E um gênero da família — senão é rap ou dubstep com a palavra. */
const ACID_HOUSE = /^(?=.*(acid|303))(?=.*(house|jack|chicago))/i;
const ACID_TECHNO = /^(?=.*(acid|303))(?=.*(techno|electro|rave|break|industrial))/i;
const ACID_TRANCE = /^(?=.*acid)(?=.*(trance|psy|goa))/i;

export const CRATES = [
  // ── Brasil ──
  { nome: 'Funk',      reg: 'BR',  termo: 'baile funk',
    buscas: [{ q: 'baile funk' }, { q: 'funk remix' }, { q: 'mtg' },
             { q: 'funk mandelao' }, { q: 'montagem funk' }, { q: 'automotivo' },
             { q: 'mc', filtro: /funk|baile|mc\s|brasil|favela|mtg/i }],
    filtro: /funk|baile|favela|mc|brasil|mtg/i },
  { nome: 'Brega funk',reg: 'BR',  termo: 'brega funk',
    buscas: [{ q: 'brega funk' }, { q: 'bregadeira' }, { q: 'tecnobrega' },
             { q: 'brega', filtro: /brega/i }],
    filtro: /brega|funk|mc/i },
  { nome: 'Funk RJ',   reg: 'BR',  termo: 'funk carioca',
    buscas: [{ q: 'funk carioca' }, { q: 'favela funk' }, { q: 'rasta funk' },
             { q: 'beat brasil' }],
    filtro: /funk|carioca|brasil|mc|favela|beat/i },
  { nome: 'Pagode',    reg: 'BR',  termo: 'pagode',
    buscas: [{ q: 'pagode' }, { q: 'pagode 90' }, { q: 'samba pagode' }],
    filtro: /pagode|samba|turma|grupo/i },
  { nome: 'Samba',     reg: 'BR',  termo: 'samba',
    buscas: [{ q: 'samba' }, { q: 'bossa nova' }, { q: 'samba rock' }],
    filtro: /samba|brasil|bossa/i },
  { nome: 'Sertanejo', reg: 'BR',  termo: 'sertanejo',
    buscas: [{ q: 'sertanejo' }, { q: 'modao' }, { q: 'piseiro' }, { q: 'arrocha' }],
    filtro: /sertanejo|mod[ãa]o|moda de viola|piseiro|arrocha|forr[óo]/i },
  { nome: 'Trap BR',   reg: 'BR',  termo: 'trap brasileiro',
    buscas: [{ q: 'trap brasileiro' }, { q: 'trap br' }, { q: 'trap funk' }],
    filtro: /.*/ },
  { nome: 'Rap BR',    reg: 'BR',  termo: 'rap nacional',
    buscas: [{ q: 'rap nacional' }, { q: 'rap brasileiro' }, { q: 'hip hop brasil' }],
    filtro: /.*/ },
  /*
   * Os "mega" e os baianos são RAROS no Audius (catálogo de artista
   * independente): medido em 2026-09-23, "megafunk" achou 1 faixa e "pagodão
   * baiano" nenhuma. Por isso várias buscas vizinhas por pilha — "montagem"
   * (48 faixas) é onde o megafunk mora lá — e o filtro segura o que é homônimo.
   */
  { nome: 'Megafunk',  reg: 'BR',  termo: 'mega funk',
    buscas: [{ q: 'megafunk' }, { q: 'mega funk', filtro: /mega|funk|mtg|montagem|baile/i },
             { q: 'montagem', filtro: /montagem|mtg|funk|baile/i }, { q: 'mega funk rs', filtro: /mega|funk/i },
             { q: 'mega remix funk', filtro: /mega|funk/i }],
    filtro: /mega|funk|montagem|mtg/i },
  { nome: 'Mega House', reg: 'BR', termo: 'mega house',
    buscas: [{ q: 'mega house', filtro: /mega|house/i }, { q: 'megahouse' },
             { q: 'house funk brasil', filtro: /house|funk/i }],
    filtro: /mega|house/i },
  { nome: 'Mega Disco', reg: 'BR', termo: 'mega disco',
    buscas: [{ q: 'mega disco', filtro: /mega|disco/i }, { q: 'megadisco' },
             { q: 'disco remix brasil', filtro: /disco/i }],
    filtro: /mega|disco/i },
  { nome: 'Axé',       reg: 'BR',  termo: 'axé',
    buscas: [{ q: 'axé' }, { q: 'axe music', filtro: /ax[eé]|bahia|carnaval/i },
             { q: 'axe bahia', filtro: /ax[eé]|bahia/i }, { q: 'carnaval bahia', filtro: /carnaval|bahia|ax[eé]/i }],
    filtro: /ax[eé]|bahia|carnaval|salvador/i },
  { nome: 'Pagodão',   reg: 'BR',  termo: 'pagodão',
    buscas: [{ q: 'pagodão' }, { q: 'pagodao' }, { q: 'swingueira' }, { q: 'pagode baiano' },
             { q: 'arrocha pagodao', filtro: /pagod|swing|arrocha/i }],
    filtro: /pagod|swing|bahia|baian/i },
  // ── América Latina ──
  { nome: 'Reggaeton', reg: 'LAT', termo: 'reggaeton',
    buscas: [{ q: 'reggaeton' }, { q: 'reggaeton remix' }, { q: 'latin urban' }],
    filtro: /reggaeton|reggaetón|perreo|latin/i },
  { nome: 'Perreo',    reg: 'LAT', termo: 'perreo',
    buscas: [{ q: 'perreo' }, { q: 'perreo intenso' }], filtro: /.*/ },
  { nome: 'Cumbia',    reg: 'LAT', termo: 'cumbia',
    buscas: [{ q: 'cumbia' }, { q: 'cumbia remix' }, { q: 'cumbia villera' }],
    filtro: /cumbia/i },
  { nome: 'Dembow',    reg: 'LAT', termo: 'dembow',
    buscas: [{ q: 'dembow' }, { q: 'dembow dominicano' }], filtro: /dembow|dancehall/i },
  { nome: 'Guaracha',  reg: 'LAT', termo: 'guaracha',
    buscas: [{ q: 'guaracha' }, { q: 'aleteo' }, { q: 'zapateo' }],
    filtro: /guaracha|aleteo|zapateo/i },
  { nome: 'Salsa',     reg: 'LAT', termo: 'salsa',
    buscas: [{ q: 'salsa' }, { q: 'timba' }, { q: 'salsa choke' }],
    filtro: /salsa|son|timba/i },
  { nome: 'Bachata',   reg: 'LAT', termo: 'bachata',
    buscas: [{ q: 'bachata' }, { q: 'bachata remix' }], filtro: /bachata/i },
  { nome: 'Moombahton',reg: 'LAT', termo: 'moombahton',
    buscas: [{ q: 'moombahton' }, { q: 'moombah' }], filtro: /moombah/i },
  { nome: 'Amapiano',  reg: 'LAT', termo: 'amapiano',
    buscas: [{ q: 'amapiano' }, { q: 'amapiano remix' }], filtro: /amapiano|piano/i },
  // ── mais estilos: subgêneros que o Audius não tem como gênero próprio ──
  { nome: 'Minimal',   reg: 'EST', termo: 'minimal techno',
    buscas: [{ q: 'minimal techno' }, { q: 'minimal house' }, { q: 'minimal deep' }, { q: 'microhouse' }],
    filtro: /minimal|micro/i },
  { nome: 'Psy',       reg: 'EST', termo: 'psytrance',
    buscas: [{ q: 'psytrance' }, { q: 'psy trance' }, { q: 'goa trance' }, { q: 'full on psy' },
             { q: 'progressive psy' }],
    filtro: /psy|goa|trance/i },
  { nome: 'Boombap',   reg: 'EST', termo: 'boom bap',
    buscas: [{ q: 'boom bap' }, { q: 'boombap' }, { q: 'boom bap beat' },
             { q: '90s hip hop beat', filtro: /boom|90s|bap/i }],
    filtro: /boom\s?bap|90s|hip ?hop/i },
  // ── acid: a linha do TB-303 e o que nasceu dela ──
  // Medido (1ª página, faixas de deck): "acid house" 14 com acid no nome,
  // "acid techno" 22, "acid trance" 18, "hard acid" 16, "acid rave" 20,
  // "chicago house" 25, "303" 42. A busca solta ("acid", "303") traz rap,
  // dubstep e synthwave com a palavra no nome — essas exigem gênero eletrônico
  // junto (ACID_ELETRONICO); o resto da busca entra no acervo sem o rótulo.
  { nome: 'Acid House', reg: 'EST', termo: 'acid house',
    buscas: [{ q: 'acid house', filtro: /acid|303/i }, { q: 'chicago house', filtro: /chicago|jack|acid|warehouse/i },
             { q: 'jackin house', filtro: /jack/i }, { q: 'acid house 303', filtro: /acid|303/i },
             { q: '303', filtro: ACID_HOUSE }],
    filtro: /acid|303|chicago|jack/i },
  { nome: 'Acid Techno', reg: 'EST', termo: 'acid techno',
    buscas: [{ q: 'acid techno', filtro: /acid|303/i }, { q: 'hard acid', filtro: /acid/i },
             { q: 'acid rave', filtro: /acid/i }, { q: 'acid electro', filtro: /acid/i },
             { q: 'acid breaks', filtro: /acid/i }, { q: 'acid', filtro: ACID_TECHNO }],
    filtro: /acid|303/i },
  // ── slowed & sped up: a versão lenta/acelerada que a internet ama ──
  // Medido (4 páginas, título com a palavra): slowed 287, slowed+reverb 309,
  // sped up 126, speed up 128, nightcore 152. O BPM delas é o da versão.
  { nome: 'Slowed', reg: 'SLW', termo: 'slowed',
    buscas: [{ q: 'slowed', filtro: /slowed/i }, { q: 'slowed reverb', filtro: /slowed|reverb/i },
             { q: 'ultra slowed', filtro: /slowed/i }, { q: 'slowed funk', filtro: /slowed/i }],
    filtro: /slowed|reverb/i },
  { nome: 'Sped up', reg: 'SLW', termo: 'sped up',
    buscas: [{ q: 'sped up', filtro: /sped ?up|speed ?up/i }, { q: 'speed up', filtro: /sped ?up|speed ?up/i },
             { q: 'sped up funk', filtro: /sped ?up|speed ?up/i }],
    filtro: /sped ?up|speed ?up/i },
  { nome: 'Nightcore', reg: 'SLW', termo: 'nightcore',
    buscas: [{ q: 'nightcore', filtro: /nightcore/i }], filtro: /nightcore/i },
  { nome: 'Acid Trance', reg: 'EST', termo: 'acid trance',
    buscas: [{ q: 'acid trance', filtro: /acid/i }, { q: 'acid psy', filtro: /acid/i },
             { q: 'acid', filtro: ACID_TRANCE }],
    filtro: /acid/i },
];

/**
 * DJs: famoso quase não sobe faixa no Audius — o que existe são REMIXES,
 * EDITS e BOOTLEGS deles feitos por produtor independente. Medido (5 páginas
 * de "<nome>" e "<nome> remix", faixas de deck, nome no título/artista E
 * gênero de pista): Alok 120, Deadmau5 220, Skrillex 202, Daft Punk 103,
 * David Guetta 70, Avicii 53, Calvin Harris 50, Armin 52, Fred again 47,
 * Martin Garrix 47, Tiësto 43, John Summit 42, Chris Lake 34, Swedish House
 * Mafia 30, Illusionize 29, Carl Cox 19, Charlotte de Witte 18, Hugel 17,
 * Meduza 17, Richie Hawtin 17, Dom Dolla 13, Anyma 12, KVSH 12, Eric Prydz 11,
 * Vintage Culture 10. Ficaram de fora por falta de faixa: Mochakk (1),
 * Beltran (nenhuma — os "Beltran" do Audius são outros), Peggy Gou (2),
 * Keinemusik (1), Solardo (2), Amelie Lens (3).
 *
 * `estrito`: se a rede não achar, não completa com o resto da busca — pedir
 * set do Alok e receber qualquer coisa seria mentir.
 */
const PISTA = 'house|techno|electr|trance|dance|disco|edm|dubstep|drum|bass|break|progressive|melodic|minimal|garage|afro|_140|future|hardstyle|club|remix|edit|bootleg';
const dj = (nome, nomeRe, termo = nome.toLowerCase()) => {
  const filtro = new RegExp(`^(?=.*(${nomeRe}))(?=.*(${PISTA}))`, 'i');
  return { nome, reg: 'DJ', termo, estrito: true, filtro,
           buscas: [{ q: termo, filtro }, { q: termo + ' remix', filtro }] };
};
export const DJS = [
  // Brasil primeiro
  dj('Alok', '\\balok\\b'), dj('Vintage Culture', 'vintage culture'), dj('Illusionize', 'illusionize'), dj('KVSH', '\\bkvsh\\b'),
  // house / tech house
  dj('Fisher', '\\bfisher\\b(?! price)'), dj('Chris Lake', 'chris lake'), dj('John Summit', 'john summit'),
  dj('Dom Dolla', 'dom dolla'), dj('Hugel', '\\bhugel\\b'), dj('Meduza', '\\bmeduza\\b'),
  dj('Swedish House Mafia', 'swedish house mafia|\\bshm\\b'), dj('Fred again', 'fred again'),
  // techno / melódico
  dj('Charlotte de Witte', 'charlotte de witte'), dj('Carl Cox', 'carl cox'), dj('Richie Hawtin', 'richie hawtin'),
  dj('Anyma', '\\banyma\\b'), dj('Eric Prydz', 'eric prydz'),
  // os gigantes
  dj('Daft Punk', 'daft punk'), dj('Deadmau5', 'deadmau5'), dj('Skrillex', 'skrillex'), dj('David Guetta', 'david guetta'),
  dj('Calvin Harris', 'calvin harris'), dj('Avicii', 'avicii'), dj('Martin Garrix', 'martin garrix'),
  dj('Tiësto', 'ti[eë]sto', 'tiesto'), dj('Armin van Buuren', 'armin van buuren'), dj('Diplo', '\\bdiplo\\b'),
];

/**
 * APOSTAS: nomes que estão subindo e que o Audius TEM (medido, 3 páginas de
 * "<nome>" e "<nome> remix", nome + gênero de pista): Aurelios 30, Sammy
 * Virji 15, Maddix 11, Chapeleiro 9, Shapeless 9, Prospa 8, Interplanetary
 * Criminal 8, Cat Dealers 8, Dubdogz 7. Muita aposta forte simplesmente não
 * está lá — Chris Stussy, Luke Dean, Indira Paganotto, I Hate Models: zero.
 * As apostas que o Audius tem DE SOBRA são as dele mesmo: apostasDaSemana().
 */
export const APOSTAS = [
  dj('Aurelios', '\\baurelios\\b'), dj('Sammy Virji', 'sammy virji'), dj('Maddix', '\\bmaddix\\b'),
  dj('Chapeleiro', 'chapeleiro'), dj('Shapeless', 'shapeless'), dj('Prospa', '\\bprospa\\b'),
  dj('Interplanetary Criminal', 'interplanetary criminal'), dj('Cat Dealers', 'cat dealers'), dj('Dubdogz', 'dubdogz'),
];

/**
 * REVELAÇÕES: quem está pegando tração sem ainda ser grande.
 *
 * O Audius já tem o "trending underground" (artistas com poucos seguidores),
 * mas cru ele vem cheio de faixa com 2 plays. Então: underground da semana +
 * trending do mês nos gêneros de pista, só artista entre 60 e 30 mil
 * seguidores, e a nota é TRAÇÃO (favoritos + 2×reposts — repost é alguém
 * mostrando pros outros) sobre o tamanho do artista. No máximo 3 faixas por
 * artista, pra ser "quem está chegando", não "a faixa que viralizou".
 */
const GEN_REVELACAO = ['House', 'Tech House', 'Techno', 'Deep House', 'Progressive House', 'Electronic', 'Disco'];
async function pontuarRevelacoes(signal) {
  const pedidos = [];
  for (const genre of GEN_REVELACAO) {
    pedidos.push(api('/tracks/trending/underground', { genre, limit: '100' }, { signal, tries: 3 }));
    pedidos.push(api('/tracks/trending', { genre, time: 'month', limit: '100' }, { signal, tries: 3 }));
  }
  const brutos = (await Promise.allSettled(pedidos)).flatMap((r) => (r.status === 'fulfilled' && r.value) || []);
  const porId = new Map();
  for (const t of brutos) {
    const seg = t.user?.follower_count ?? 0;
    if (!isDeckable(t) || porId.has(t.id) || seg < 60 || seg > 30000) continue;
    const tracao = (t.favorite_count || 0) + 2 * (t.repost_count || 0);
    if ((t.play_count || 0) < 40 || tracao < 4) continue;
    porId.set(t.id, { t, nota: tracao / Math.log10(seg + 10), artista: t.user?.id });
  }
  return [...porId.values()].sort((a, b) => b.nota - a.nota);
}
export async function revelacoes({ limite = 60, signal } = {}) {
  const notas = await pontuarRevelacoes(signal);
  const porArtista = {};
  const fora = [];
  for (const x of notas) {
    if ((porArtista[x.artista] = (porArtista[x.artista] || 0) + 1) > 3) continue;
    fora.push(normalizeTrack(x.t));
    if (fora.length >= limite) break;
  }
  return fora;
}

/**
 * APOSTAS DA SEMANA: os ARTISTAS por trás das revelações — quem soma mais
 * tração em mais de uma faixa. Uma faixa só pode ser sorte; duas é alguém
 * chegando. Nome limpo ("Fulano | DJ & Producer" → "Fulano").
 */
export async function apostasDaSemana({ n = 8, signal } = {}) {
  const notas = await pontuarRevelacoes(signal);
  const por = new Map();
  for (const x of notas) {
    const u = x.t.user; if (!u?.id) continue;
    const a = por.get(u.id) || { id: u.id, nome: u.name, seguidores: u.follower_count, nota: 0, faixas: 0 };
    a.nota += x.nota; a.faixas++;
    por.set(u.id, a);
  }
  const limpo = (s) => String(s || '').split(/[|•·]/)[0].replace(/[^\p{L}\p{N} &.'$-]/gu, '').trim().slice(0, 24);
  return [...por.values()]
    .filter((a) => a.faixas >= 2 && limpo(a.nome).length >= 2)
    .sort((a, b) => b.nota - a.nota).slice(0, n)
    .map((a) => ({ id: a.id, nome: limpo(a.nome), seguidores: a.seguidores }));
}

/** As faixas de um artista, as mais tocadas primeiro, só as que cabem num deck. */
export async function faixasDoArtista(id, { limite = 60, signal } = {}) {
  const data = await api(`/users/${id}/tracks`, { limit: '100', sort: 'plays' }, { signal });
  return (data || []).filter(isDeckable).slice(0, limite).map(normalizeTrack);
}

/**
 * ARTISTAS COM CONTA NO AUDIUS — aqui o chip toca as faixas DELES (as mais
 * ouvidas primeiro), não uma busca pelo nome.
 *
 * FUNK: os DJs de funk famosos não estão no Audius (DJ Petroski, Arana, GBR,
 * Rennan da Penha, Marlboro…: nenhum tem conta, e o nome aparece em 0–2
 * faixas). Quem FAZ funk brasileiro lá, medido pelas faixas das buscas de
 * funk/montagem: KARAN! (baile a 130), DJ BDF, JAUM (mashups de MC), rezzo
 * (funk e tecnobrega), Samuel Farias Barbosa (montagens). Ficou de fora quem
 * só sobe versão slowed/sped up — essas moram na aba delas.
 *
 * RAP: artistas verificados do Hip-Hop/Rap do Audius com faixas de sobra
 * (medido: trending de mês/ano/sempre, conta verificada ou 3 mil+
 * seguidores, 12+ faixas que cabem num deck).
 */
export const ARTISTAS = [
  { nome: 'KARAN!', id: 'naYNA', reg: 'FUNK' }, { nome: 'DJ BDF', id: 'nVMlQ', reg: 'FUNK' },
  { nome: 'JAUM', id: 'ezGNP', reg: 'FUNK' }, { nome: 'rezzo', id: 'DE9M4', reg: 'FUNK' },
  { nome: 'Samuel Farias Barbosa', id: 'aNAYq1', reg: 'FUNK' },
  { nome: 'POUYA', id: 'ebq0y', reg: 'RAP' }, { nome: 'MadeinTYO', id: 'P5l1X', reg: 'RAP' },
  { nome: 'KILLY', id: '91Xm0', reg: 'RAP' }, { nome: 'trillsammy', id: 'NzMW8', reg: 'RAP' },
  { nome: 'Fat Nick', id: 'oGKZd', reg: 'RAP' }, { nome: 'Connor Price', id: 'KEWjl', reg: 'RAP' },
  { nome: 'AKTHESAVIOR', id: 'PdzOp', reg: 'RAP' }, { nome: 'Darnell William$', id: '6EEYG', reg: 'RAP' },
  { nome: 'ollie', id: '5QmM6', reg: 'RAP' }, { nome: 'Cam Archer', id: 'n0X3V', reg: 'RAP' },
  { nome: 'Lido', id: 'eJ5Qz', reg: 'RAP' }, { nome: 'Nocturnal', id: 'rmk5g', reg: 'RAP' },
  { nome: 'capshun', id: 'nogRn', reg: 'RAP' }, { nome: 'GOON DES GARCONS', id: 'nlOdQ', reg: 'RAP' },
  { nome: 'grouptherapy.', id: 'JdQpp', reg: 'RAP' }, { nome: 'Darci', id: 'PWBYp', reg: 'RAP' },
  { nome: 'DECAP', id: 'ePPq0', reg: 'RAP' }, { nome: 'MATTRICK', id: 'lzwQ6', reg: 'RAP' },
  { nome: 'MR.CARMACK', id: 'D7Mgn', reg: 'RAP' },
];

/** Compatibilidade: a primeira versão só tinha crates do Brasil. */
export const CRATES_BR = CRATES.filter((c) => c.reg === 'BR');

/** Busca uma crate e descarta o homônimo. */
export async function crateBr(nome, { limite = 40, signal } = {}) {
  const c = [...CRATES, ...DJS, ...APOSTAS].find((x) => x.nome === nome);
  if (!c) throw new AudiusError(`crate desconhecida: ${nome}`);
  // as duas primeiras buscas da pilha, não só o termo principal: pilha de DJ
  // vive de "<nome> remix", que o termo sozinho não traz
  const buscas = (c.buscas || [{ q: c.termo }]).slice(0, 2);
  const res = (await Promise.all(buscas.map((b) => search(b.q, { limit: 50, signal }).catch(() => [])))).flat();
  const vistos = new Set();
  const unicos = res.filter((t) => !vistos.has(t.id) && vistos.add(t.id));
  const casa = (t) => c.filtro.test(`${t.title} ${t.artist} ${t.genre || ''}`);
  const bons = unicos.filter(casa), resto = unicos.filter((t) => !casa(t));
  // se o filtro foi severo demais, completa com o resto em vez de devolver
  // vazio — menos em pilha estrita (DJ): aí vazio é a resposta honesta
  return (c.estrito ? bons : [...bons, ...resto]).slice(0, limite);
}
