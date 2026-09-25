/**
 * Worker do Garimpo — o pedaço de servidor que um site estático não tem.
 *
 * Duas funções, e as duas precisam de servidor pelo mesmo motivo: segredo ou
 * estado compartilhado não podem morar numa página pública.
 *
 *   POST /jev       proxy pro Jev da TypeSafe. A chave fica AQUI, como segredo
 *                   do Worker (TYPESAFE_KEY). A TypeSafe recusa chamada de
 *                   navegador (CORS), e a chave numa página pública seria de
 *                   quem abrisse o código-fonte.
 *
 *   GET  /acervo    faixas do Audius que alguém garimpou e compartilhou.
 *   POST /acervo    compartilha faixas garimpadas. SÓ metadados do Audius (id,
 *                   título, BPM…): o áudio continua vindo do Audius, cuja
 *                   licença permite tocar. Arquivo do computador de alguém
 *                   NUNCA passa por aqui — seria redistribuir música sem
 *                   direito.
 *
 *   GET/POST /lixo  votos de "isto não é música" (👎 e reprovação do Jev)
 *   POST /feedback  sugestões e bugs do 💬 — só escrita, quem lê é o dono
 *
 * PROTEÇÕES, porque a chave é do dono e qualquer um com o link chama isto:
 *   - só aceita a origem do site (CORS fechado)
 *   - só aceita o modelo jev-latest e no máximo 60 perguntas por pedido — o
 *     proxy serve ao Garimpo, não é uma TypeSafe grátis pro mundo
 *   - teto DIÁRIO de chamadas ao Jev (LIMITE_DIA), contado no D1: se alguém
 *     abusar, o pior caso é o limite do dia, não uma conta aberta
 *   - teto por IP por minuto, em memória do isolate (melhor esforço)
 */

const ORIGENS = new Set([
  'https://luccameyer18-creator.github.io',
  'http://127.0.0.1:8080',
]);
const LIMITE_DIA = 1500;        // sets decididos por dia, somando todo mundo
const LIMITE_IP_MIN = 12;       // pedidos por IP por minuto
const MAX_PERGUNTAS = 60;       // um set de 30 transições cabe folgado
const MAX_CORPO = 96 * 1024;

const porIp = new Map();        // ip -> { janela, n } — por isolate, melhor esforço

/**
 * A Vercel: o endereço de produção e as prévias de cada mudança deste projeto
 * (garimpo-<hash>-laas-sistema.vercel.app). Não é "qualquer .vercel.app".
 */
const VERCEL = /^https:\/\/garimpo-(topaz|[a-z0-9]+-laas-sistema)\.vercel\.app$/;
const permitida = (origem) => ORIGENS.has(origem) || VERCEL.test(origem);

function cabecalhos(origem) {
  return {
    'Access-Control-Allow-Origin': permitida(origem) ? origem : 'https://luccameyer18-creator.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

function json(corpo, status, origem) {
  return new Response(JSON.stringify(corpo), {
    status, headers: { 'Content-Type': 'application/json', ...cabecalhos(origem) },
  });
}

function passouDoIp(ip) {
  const agora = Math.floor(Date.now() / 60000);
  const r = porIp.get(ip);
  if (!r || r.janela !== agora) { porIp.set(ip, { janela: agora, n: 1 }); return false; }
  r.n++;
  return r.n > LIMITE_IP_MIN;
}

async function jev(req, env, origem) {
  const bruto = await req.text();
  if (bruto.length > MAX_CORPO) return json({ erro: 'pedido grande demais' }, 413, origem);
  let corpo;
  try { corpo = JSON.parse(bruto); } catch { return json({ erro: 'json inválido' }, 400, origem); }
  if (corpo.model !== 'jev-latest') return json({ erro: 'só jev-latest' }, 400, origem);
  const n = Object.keys(corpo.questions || {}).length;
  if (!n || n > MAX_PERGUNTAS) return json({ erro: `de 1 a ${MAX_PERGUNTAS} perguntas` }, 400, origem);

  // teto diário, somando todo mundo: protege o bolso do dono da chave
  const dia = new Date().toISOString().slice(0, 10);
  const uso = await env.DB.prepare(
    'INSERT INTO uso (dia, n) VALUES (?1, 1) ON CONFLICT(dia) DO UPDATE SET n = n + 1 RETURNING n'
  ).bind(dia).first();
  if ((uso?.n || 0) > LIMITE_DIA) return json({ erro: 'limite do dia atingido' }, 429, origem);

  const r = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.TYPESAFE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state: corpo.state, questions: corpo.questions }),
  });
  return new Response(await r.text(), {
    status: r.status, headers: { 'Content-Type': 'application/json', ...cabecalhos(origem) },
  });
}

/** Valida uma faixa compartilhada: só metadados do Audius, com tamanho preso. */
function faixaValida(f) {
  // Audius, ou Jamendo depois que alguém tocou e a análise mediu o BPM
  if (!f || typeof f.id !== 'string' || !/^(?:[A-Za-z0-9]{3,16}|jm:\d{1,10})$/.test(f.id)) return null;
  const txt = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const num = (v, lo, hi) => (typeof v === 'number' && v >= lo && v <= hi ? v : null);
  const bpm = num(f.bpm, 40, 250), dur = num(f.duration, 30, 900);
  if (!bpm || !dur) return null;
  return {
    id: f.id, title: txt(f.title, 200) || '(sem título)', artist: txt(f.artist, 120) || '',
    handle: txt(f.handle, 60), duration: Math.round(dur), genre: txt(f.genre, 40),
    bpm, camelot: txt(f.camelot, 4), key: txt(f.key, 12), pilha: txt(f.pilha, 40),
  };
}

async function acervoPost(req, env, origem) {
  const bruto = await req.text();
  if (bruto.length > 256 * 1024) return json({ erro: 'lote grande demais' }, 413, origem);
  let lista;
  try { lista = JSON.parse(bruto); } catch { return json({ erro: 'json inválido' }, 400, origem); }
  if (!Array.isArray(lista)) return json({ erro: 'esperava uma lista' }, 400, origem);
  const boas = lista.slice(0, 500).map(faixaValida).filter(Boolean);
  if (!boas.length) return json({ novas: 0 }, 200, origem);
  const agora = Date.now();
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO faixas (id, title, artist, handle, duration, genre, bpm, camelot, key, pilha, criada)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`);
  const res = await env.DB.batch(boas.map((f) =>
    stmt.bind(f.id, f.title, f.artist, f.handle, f.duration, f.genre, f.bpm, f.camelot, f.key, f.pilha, agora)));
  const novas = res.reduce((s, r) => s + (r.meta?.changes || 0), 0);
  return json({ novas, recebidas: boas.length }, 200, origem);
}

async function acervoGet(url, env, origem) {
  // paginação por `criada` (>=: faixas de um mesmo POST dividem o carimbo, e
  // quem cortou uma página no meio de um grupo precisa receber o grupo inteiro)
  const desde = Number(url.searchParams.get('desde') || 0);
  const { results } = await env.DB.prepare(
    `SELECT id, title, artist, handle, duration, genre, bpm, camelot, key, pilha, criada
     FROM faixas WHERE criada >= ?1 ORDER BY criada LIMIT 2000`).bind(desde).all();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM faixas').first();
  return json({ faixas: results, total: total?.n || 0 }, 200, origem);
}

/**
 * Trash compartilhado. POST soma um voto por faixa; GET devolve as que têm
 * 2+ votos. Só ids no formato do Audius; até 50 por pedido.
 */
/**
 * Id que vale voto: o do Audius ou o do hearthis ('ht:artista/faixa'). Antes
 * só o do Audius — o 👎 numa faixa do hearthis nunca chegava na galera.
 */
const ID_VOTO = /^(?:ht:[A-Za-z0-9._-]{1,60}\/[A-Za-z0-9._-]{1,100}|jm:\d{1,10}|[A-Za-z0-9]{3,16})$/;
const idsDoCorpo = (corpo) => (Array.isArray(corpo?.ids) ? corpo.ids : [])
  .filter((x) => typeof x === 'string' && ID_VOTO.test(x)).slice(0, 50);

async function lixoPost(req, env, origem) {
  let corpo;
  try { corpo = JSON.parse(await req.text()); } catch { return json({ erro: 'json inválido' }, 400, origem); }
  const ids = idsDoCorpo(corpo);
  if (!ids.length) return json({ votos: 0 }, 200, origem);
  const agora = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO lixo (id, votos, criada) VALUES (?1, 1, ?2)
     ON CONFLICT(id) DO UPDATE SET votos = votos + 1`);
  await env.DB.batch(ids.map((id) => stmt.bind(id, agora)));
  return json({ votos: ids.length }, 200, origem);
}
/**
 * JAMENDO — o client_id é pessoal (termos deles) e mora aqui como secret
 * (JAMENDO_ID); o app nunca vê. Cada pedido de lote anda o cursor do gênero,
 * então cada pessoa recebe um pedaço diferente do catálogo. Teto diário
 * global: o plano não comercial dá 35 mil pedidos por MÊS.
 */
const JAMENDO_TAGS = {
  Tudo: null, House: 'house', Techno: 'techno', 'Tech House': 'techhouse', 'Deep House': 'deephouse',
  // Funk BR: o Jamendo não tem (a tag "funk" volta vazia, e seria funk gringo)
  Disco: 'disco', 'Afro House': 'afro', 'Funk BR': false, 'Hip-Hop/Rap': 'hiphop',
  'Drum & Bass': 'drumnbass', Trance: 'trance', Dubstep: 'dubstep', Latin: 'latin',
  Electronic: 'electronic', Ambient: 'ambient',
};
const JAMENDO_POR_DIA = 1000;
async function jamendoLote(url, env, origem) {
  if (!env.JAMENDO_ID) return json({ erro: 'jamendo não configurado' }, 503, origem);
  const genero = url.searchParams.get('genero') || 'Tudo';
  if (!(genero in JAMENDO_TAGS)) return json({ erro: 'gênero desconhecido' }, 400, origem);
  if (JAMENDO_TAGS[genero] === false) return json({ faixas: [], fim: true }, 200, origem);
  const n = Math.min(200, Math.max(10, Number(url.searchParams.get('n')) || 200));
  const dia = 'jm:' + new Date().toISOString().slice(0, 10);
  const uso = await env.DB.prepare(
    'INSERT INTO uso (dia, n) VALUES (?1, 1) ON CONFLICT(dia) DO UPDATE SET n = n + 1 RETURNING n').bind(dia).first();
  if ((uso?.n || 0) > JAMENDO_POR_DIA) return json({ erro: 'limite do dia do jamendo' }, 429, origem);
  /**
   * PÁGINA VAZIA NÃO É FIM: a API do Jamendo tem buracos (medido: House no
   * offset 30 volta 0, no 40 volta 10). Pula até 4 páginas vazias antes de
   * concluir que o gênero acabou.
   */
  let j = null;
  for (let pulo = 0; pulo < 4; pulo++) {
    const cur = await env.DB.prepare(
      `INSERT INTO jamendo_cursor (genero, pos) VALUES (?1, ?2)
       ON CONFLICT(genero) DO UPDATE SET pos = pos + ?2 RETURNING pos`).bind(genero, n).first();
    const offset = Math.max(0, (cur?.pos ?? n) - n);
    const q = new URLSearchParams({ client_id: env.JAMENDO_ID, format: 'json', limit: String(n), offset: String(offset),
      audioformat: 'mp32', include: 'musicinfo licenses', order: 'popularity_total' });
    if (JAMENDO_TAGS[genero]) q.set('tags', JAMENDO_TAGS[genero]);
    const r = await fetch('https://api.jamendo.com/v3.0/tracks/?' + q);
    if (!r.ok) return json({ erro: 'jamendo respondeu ' + r.status }, 502, origem);
    j = await r.json();
    if (j?.headers?.status !== 'success' || (j.results || []).length) break;
  }
  /**
   * O Jamendo responde FALHA com HTTP 200 (status 'failed' no corpo). Tratar
   * isso como "acabou o catálogo" voltava o cursor pro começo (visto no 1º
   * teste): agora falha é falha — o cursor desanda o passo e o app segue sem.
   */
  if (j?.headers?.status !== 'success') {
    await env.DB.prepare('UPDATE jamendo_cursor SET pos = MAX(0, pos - ?2) WHERE genero = ?1').bind(genero, n).run();
    return json({ erro: 'jamendo falhou', codigo: j?.headers?.code ?? null }, 502, origem);
  }
  const res = Array.isArray(j.results) ? j.results : [];
  // 4 páginas vazias seguidas: acabou o gênero, o cursor volta pro começo
  if (!res.length) await env.DB.prepare('UPDATE jamendo_cursor SET pos = 0 WHERE genero = ?1').bind(genero).run();
  const txt = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const faixas = res
    .filter((t) => t && /^\d{1,10}$/.test(String(t.id)) && t.duration >= 60 && t.duration <= 600)
    .map((t) => ({
      id: 'jm:' + t.id, title: txt(t.name, 200) || '(sem título)', artist: txt(t.artist_name, 120) || '',
      handle: 'jm:' + String(t.artist_id || '').slice(0, 12), duration: Math.round(t.duration),
      genre: JAMENDO_TAGS[genero] ? genero : txt(t.musicinfo?.tags?.genres?.[0], 40),
      image: txt(t.album_image || t.image, 300), licenca: txt(t.license_ccurl, 200),
    }));
  return json({ faixas, fim: !res.length }, 200, origem);
}

/** ♥ da galera: um voto por id (o app só manda uma vez por pessoa). */
async function bomPost(req, env, origem) {
  let corpo;
  try { corpo = JSON.parse(await req.text()); } catch { return json({ erro: 'json inválido' }, 400, origem); }
  const ids = idsDoCorpo(corpo);
  if (!ids.length) return json({ votos: 0 }, 200, origem);
  const agora = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO bom (id, votos, criada) VALUES (?1, 1, ?2)
     ON CONFLICT(id) DO UPDATE SET votos = votos + 1`);
  await env.DB.batch(ids.map((id) => stmt.bind(id, agora)));
  return json({ votos: ids.length }, 200, origem);
}
/** As mais curtidas, com a contagem: [[id, votos], ...]. */
async function bomGet(env, origem) {
  const { results } = await env.DB.prepare('SELECT id, votos FROM bom ORDER BY votos DESC LIMIT 5000').all();
  return json({ ids: results.map((r) => [r.id, r.votos]) }, 200, origem);
}

async function lixoGet(env, origem) {
  const { results } = await env.DB.prepare('SELECT id FROM lixo WHERE votos >= 2 LIMIT 20000').all();
  return json({ ids: results.map((r) => r.id) }, 200, origem);
}

/**
 * Sugestões e bugs do 💬 do app. Só ESCRITA: não existe GET — quem lê é o
 * dono, pelo painel do D1 ou pelo wrangler. Texto até 2000 caracteres, nome
 * opcional até 80; o limite por IP dos POSTs vale aqui também.
 */
async function feedbackPost(req, env, origem) {
  let corpo;
  try { corpo = JSON.parse(await req.text()); } catch { return json({ erro: 'json inválido' }, 400, origem); }
  const texto = typeof corpo?.texto === 'string' ? corpo.texto.trim().slice(0, 2000) : '';
  if (texto.length < 2) return json({ erro: 'vazio' }, 400, origem);
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim().slice(0, 80) : null;
  const idioma = typeof corpo?.idioma === 'string' ? corpo.idioma.slice(0, 8) : null;
  await env.DB.prepare('INSERT INTO feedback (texto, nome, idioma, criada) VALUES (?1, ?2, ?3, ?4)')
    .bind(texto, nome || null, idioma, Date.now()).run();
  return json({ ok: true }, 200, origem);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origem = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecalhos(origem) });
    if (origem && !permitida(origem)) return json({ erro: 'origem não autorizada' }, 403, origem);

    const ip = req.headers.get('CF-Connecting-IP') || 'desconhecido';
    if (req.method === 'POST' && passouDoIp(ip)) return json({ erro: 'devagar — muitos pedidos' }, 429, origem);

    try {
      if (req.method === 'POST' && url.pathname === '/jev') return await jev(req, env, origem);
      if (req.method === 'POST' && url.pathname === '/acervo') return await acervoPost(req, env, origem);
      if (req.method === 'GET' && url.pathname === '/acervo') return await acervoGet(url, env, origem);
      if (req.method === 'POST' && url.pathname === '/lixo') return await lixoPost(req, env, origem);
      if (req.method === 'POST' && url.pathname === '/feedback') return await feedbackPost(req, env, origem);
      if (req.method === 'GET' && url.pathname === '/lixo') return await lixoGet(env, origem);
      if (req.method === 'POST' && url.pathname === '/bom') return await bomPost(req, env, origem);
      if (req.method === 'GET' && url.pathname === '/jamendo/lote') {
        if (passouDoIp(ip)) return json({ erro: 'devagar — muitos pedidos' }, 429, origem);
        return await jamendoLote(url, env, origem);
      }
      if (req.method === 'GET' && url.pathname === '/bom') return await bomGet(env, origem);
      if (url.pathname === '/') return json({ garimpo: 'ok' }, 200, origem);
      return json({ erro: 'não achei' }, 404, origem);
    } catch (e) {
      return json({ erro: 'falha interna' }, 500, origem);
    }
  },
};
