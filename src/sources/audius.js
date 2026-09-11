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
 * assinada do validator. Buscar essa URL DIRETO mantém você no validator, que
 * serve os bytes com CORS completo e Range funcionando.
 * Medido: GET 200 em 18/18, Range 206 em 18/18, preflight 204 com
 * `access-control-allow-headers: range` em 18/18. Um hop a menos, e 100% do
 * catálogo em vez de 69%.
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

  const isMinor = /min/.test(m[3] || '') || /\bminor\b/.test(s);
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
export async function resolveStreamUrl(id, { tries = 3, signal } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const url = await api(`/tracks/${id}/stream`, { no_redirect: 'true' }, { tries: 2, signal });
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        throw new Error('no_redirect não devolveu URL');
      }
      return url;
    } catch (e) {
      last = e;
      if (signal?.aborted) throw e;
      await sleep(200 * (i + 1));
    }
  }
  throw new AudiusError(`não consegui resolver o stream de ${id}`, last);
}

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

export const GENRES = [
  'Electronic', 'House', 'Techno', 'Deep House', 'Tech House', 'Progressive House',
  'Drum & Bass', 'Dubstep', 'Trap', 'Hip-Hop/Rap', 'Disco', 'Trance', 'Ambient',
];
