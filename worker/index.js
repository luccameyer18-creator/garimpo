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

function cabecalhos(origem) {
  return {
    'Access-Control-Allow-Origin': ORIGENS.has(origem) ? origem : 'https://luccameyer18-creator.github.io',
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
  if (!f || typeof f.id !== 'string' || !/^[A-Za-z0-9]{3,16}$/.test(f.id)) return null;
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
  // paginação por `criada`: quem já tem até T pede só o que veio depois
  const desde = Number(url.searchParams.get('desde') || 0);
  const { results } = await env.DB.prepare(
    `SELECT id, title, artist, handle, duration, genre, bpm, camelot, key, pilha, criada
     FROM faixas WHERE criada > ?1 ORDER BY criada LIMIT 2000`).bind(desde).all();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM faixas').first();
  return json({ faixas: results, total: total?.n || 0 }, 200, origem);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origem = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecalhos(origem) });
    if (origem && !ORIGENS.has(origem)) return json({ erro: 'origem não autorizada' }, 403, origem);

    const ip = req.headers.get('CF-Connecting-IP') || 'desconhecido';
    if (req.method === 'POST' && passouDoIp(ip)) return json({ erro: 'devagar — muitos pedidos' }, 429, origem);

    try {
      if (req.method === 'POST' && url.pathname === '/jev') return await jev(req, env, origem);
      if (req.method === 'POST' && url.pathname === '/acervo') return await acervoPost(req, env, origem);
      if (req.method === 'GET' && url.pathname === '/acervo') return await acervoGet(url, env, origem);
      if (url.pathname === '/') return json({ garimpo: 'ok' }, 200, origem);
      return json({ erro: 'não achei' }, 404, origem);
    } catch (e) {
      return json({ erro: 'falha interna' }, 500, origem);
    }
  },
};
