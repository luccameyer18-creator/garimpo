/**
 * PASTAS — as suas coleções de música, do seu jeito.
 *
 * Uma pasta é uma lista com nome: "minhas músicas", "aquecimento", "pro
 * churrasco". Entra nela qualquer faixa da lista (📁 no item) e todo arquivo
 * que você sobe — esses caem sozinhos em "minhas músicas".
 *
 * ONDE MORA, e por quê:
 *   - a lista de pastas e as faixas do Audius (só os dados: título, BPM, tom…)
 *     ficam no localStorage — o áudio delas continua vindo do Audius;
 *   - o ARQUIVO de uma música sua fica no IndexedDB DESTE navegador e não sai
 *     daqui: não vai pro acervo da galera, nem pro Worker, nem pra lugar
 *     nenhum. Tocar e mixar o que é seu é seu.
 *
 * Música sua chega sem BPM e sem tom (o Audius manda isso pronto; um arquivo
 * não). Na primeira vez que ela toca num deck, a análise do deck descobre os
 * dois e a pasta aprende (`atualizarLocal`) — daí em diante o DJ consegue
 * encaixá-la num set.
 */

const CHAVE = 'garimpo.pastas';
export const MINHAS = 'minhas';
const MAX_POR_PASTA = 2000;

const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE)) || []; } catch { return []; } };
let pastas = ler();
const gravar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(pastas)); } catch {} avisar(); };

const ouvintes = new Set();
/** Chama `fn` quando as pastas mudam (criar, apagar, pôr ou tirar faixa). */
export function aoMudar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
function avisar() { for (const f of ouvintes) { try { f(); } catch {} } }

/** Só o que precisa pra listar e tocar — nada do objeto inteiro do Audius. */
function enxuta(f) {
  const o = {};
  for (const k of ['id', 'title', 'artist', 'handle', 'duration', 'genre', 'bpm', 'camelot', 'key',
                   'artwork', 'permalink', 'source', 'localId', 'bpmWindow']) if (f[k] != null) o[k] = f[k];
  return o;
}

export function listar() { return pastas.map((p) => ({ id: p.id, nome: p.nome, n: p.faixas.length })); }

export function criar(nome) {
  nome = String(nome || '').trim().slice(0, 40);
  if (!nome) return null;
  const id = nome.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 20)
           + '-' + Date.now().toString(36).slice(-4);
  pastas.push({ id, nome, faixas: [] });
  gravar();
  return id;
}

/** "minhas músicas" existe desde o primeiro arquivo que você sobe. */
export function garantirMinhas(nome = 'minhas músicas') {
  if (!pastas.some((p) => p.id === MINHAS)) { pastas.unshift({ id: MINHAS, nome, faixas: [] }); gravar(); }
  return MINHAS;
}

export function renomear(id, nome) {
  const p = pastas.find((x) => x.id === id);
  nome = String(nome || '').trim().slice(0, 40);
  if (!p || !nome) return false;
  p.nome = nome; gravar(); return true;
}

export async function apagar(id) {
  const p = pastas.find((x) => x.id === id);
  if (!p) return false;
  pastas = pastas.filter((x) => x.id !== id);
  gravar();
  // arquivo seu que não está em mais nenhuma pasta sai do navegador também
  for (const f of p.faixas) if (f.localId && !pastas.some((x) => x.faixas.some((g) => g.localId === f.localId))) {
    try { await apagarArquivo(f.localId); } catch {}
  }
  return true;
}

export function contem(id, faixaId) { return !!pastas.find((x) => x.id === id)?.faixas.some((f) => f.id === faixaId); }
export function pastasDa(faixaId) { return pastas.filter((p) => p.faixas.some((f) => f.id === faixaId)).map((p) => p.id); }

export function adicionar(id, faixa) {
  const p = pastas.find((x) => x.id === id);
  if (!p || !faixa?.id || p.faixas.some((f) => f.id === faixa.id)) return false;
  p.faixas.unshift(enxuta(faixa));
  p.faixas = p.faixas.slice(0, MAX_POR_PASTA);
  gravar();
  return true;
}

export function remover(id, faixaId) {
  const p = pastas.find((x) => x.id === id);
  if (!p) return false;
  const antes = p.faixas.length;
  p.faixas = p.faixas.filter((f) => f.id !== faixaId);
  if (p.faixas.length !== antes) gravar();
  return p.faixas.length !== antes;
}

/** As faixas de uma pasta, com `pilha` pra o resto do app saber de onde vieram. */
export function faixasDe(id) {
  const p = pastas.find((x) => x.id === id);
  return p ? p.faixas.map((f) => ({ ...f, pilha: 'pasta:' + id })) : [];
}

/** A análise do deck descobriu BPM/tom de uma música sua: todas as pastas aprendem. */
export function atualizarLocal(localId, dados) {
  let mudou = false;
  for (const p of pastas) for (const f of p.faixas) {
    if (f.localId !== localId) continue;
    for (const [k, v] of Object.entries(dados)) if (v != null && f[k] !== v) { f[k] = v; mudou = true; }
  }
  if (mudou) gravar();
}

// ─────────────────────────── os seus arquivos (IndexedDB) ───────────────────────────

const BANCO = 'garimpo-meus';
function abrir() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('arquivos');
    r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
  });
}
async function op(modo, fn) {
  const db = await abrir();
  return new Promise((ok, erro) => {
    const tx = db.transaction('arquivos', modo);
    const r = fn(tx.objectStore('arquivos'));
    tx.oncomplete = () => ok(r?.result); tx.onerror = () => erro(tx.error);
  });
}

/**
 * Guarda um arquivo seu e devolve a faixa (sem BPM/tom ainda). O id começa
 * com "local:" pra nunca se confundir com um id do Audius.
 */
export async function guardarArquivo(file) {
  const localId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await op('readwrite', (loja) => loja.put({ nome: file.name, tipo: file.type, blob: file }, localId));
  return {
    id: 'local:' + localId, localId, source: 'local',
    title: file.name.replace(/\.[^.]+$/, ''), artist: 'você',
  };
}

/** O arquivo de volta, como File (o deck lê o nome e os bytes). */
export async function arquivo(localId) {
  const r = await op('readonly', (loja) => loja.get(localId));
  if (!r?.blob) return null;
  return new File([r.blob], r.nome || 'faixa', { type: r.tipo || r.blob.type });
}

async function apagarArquivo(localId) { await op('readwrite', (loja) => loja.delete(localId)); }
