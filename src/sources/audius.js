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
];

/** Compatibilidade: a primeira versão só tinha crates do Brasil. */
export const CRATES_BR = CRATES.filter((c) => c.reg === 'BR');

/** Busca uma crate e descarta o homônimo. */
export async function crateBr(nome, { limite = 40, signal } = {}) {
  const c = CRATES.find((x) => x.nome === nome);
  if (!c) throw new AudiusError(`crate desconhecida: ${nome}`);
  const res = await search(c.termo, { limit: 50, signal });
  const casa = (t) => c.filtro.test(`${t.title} ${t.artist} ${t.genre || ''}`);
  const bons = res.filter(casa), resto = res.filter((t) => !casa(t));
  // se o filtro foi severo demais, completa com o resto em vez de devolver vazio
  return [...bons, ...resto].slice(0, limite);
}
