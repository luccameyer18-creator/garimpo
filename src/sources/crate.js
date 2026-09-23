/**
 * A crate local — o acervo que fica no seu aparelho e cresce a cada garimpo.
 *
 * O app nascia com ~1000 faixas alcançáveis: 33 pilhas × 40 por pilha, buscadas
 * de novo a cada carregamento. Isso é pouco pra um set de verdade e lento pra
 * navegar, porque toda troca de chip era uma ida à rede.
 *
 * O que a medição da API do Audius mostrou, e que abriu o caminho:
 *
 *   - `limit` vai até 100 (200 devolve 400).
 *   - `offset` FUNCIONA, até 200 no trending — 3 páginas de 100 por consulta —
 *     e as páginas não se repetem (medi 0/100 em comum entre a 1ª e a 2ª).
 *   - `time` aceita `week`, `month` e `allTime`. `year` devolve 400.
 *   - existe `/tracks/trending/underground`, que é outro acervo.
 *   - playlists são multiplicador: cada uma rende de 3 a 50 faixas, quase todas
 *     com BPM e tom.
 *
 * Multiplicando: 16 gêneros × 3 janelas × 3 páginas = 144 consultas de 100.
 * Com as buscas por texto e as playlists, passa de 10 mil antes de deduplicar.
 *
 * Guardar em IndexedDB e não em memória é o que faz isso valer a pena: o acervo
 * sobrevive ao recarregamento, então garimpar é um custo que se paga uma vez e
 * a navegação seguinte é instantânea e offline.
 *
 * Só entra aqui o que serve num deck: tocável, não travado por chave de API,
 * entre 60 e 600 s. Guardar o que não dá pra tocar é encher o acervo de
 * decepção.
 */

import { isDeckable, normalizeTrack } from './audius.js';

const BANCO = 'garimpo';
const LOJA = 'faixas';
const VERSAO = 1;

let db = null;

function abrir() {
  if (db) return Promise.resolve(db);
  return new Promise((ok, no) => {
    const req = indexedDB.open(BANCO, VERSAO);
    req.onupgradeneeded = () => {
      const b = req.result;
      if (!b.objectStoreNames.contains(LOJA)) {
        const loja = b.createObjectStore(LOJA, { keyPath: 'id' });
        // índices pelo que a interface filtra de verdade
        loja.createIndex('genre', 'genre', { unique: false });
        loja.createIndex('bpm', 'bpm', { unique: false });
        loja.createIndex('camelot', 'camelot', { unique: false });
        loja.createIndex('pilha', 'pilha', { unique: false });
      }
    };
    req.onsuccess = () => { db = req.result; ok(db); };
    req.onerror = () => no(req.error || new Error('IndexedDB recusou abrir'));
  });
}

/** IndexedDB não existe em janela privada de alguns navegadores. */
export async function disponivel() {
  try { await abrir(); return true; } catch { return false; }
}

/** Guarda um lote. Devolve quantas eram NOVAS. */
export async function guardar(faixas, pilha = null) {
  if (!faixas?.length) return 0;
  const b = await abrir();
  return new Promise((ok, no) => {
    const tx = b.transaction(LOJA, 'readwrite');
    const loja = tx.objectStore(LOJA);
    let novas = 0;
    let pendentes = 0;
    for (const f of faixas) {
      if (!f?.id) continue;
      pendentes++;
      const pedido = loja.get(f.id);
      pedido.onsuccess = () => {
        if (!pedido.result) novas++;
        // `pilha` guarda de onde veio; mantém a primeira, que é a mais específica
        loja.put({ ...(pedido.result || {}), ...f, pilha: pedido.result?.pilha || pilha || f.pilha || null });
      };
    }
    tx.oncomplete = () => ok(novas);
    tx.onerror = () => no(tx.error);
    if (!pendentes) ok(0);
  });
}

export async function contar() {
  const b = await abrir();
  return new Promise((ok, no) => {
    const p = b.transaction(LOJA, 'readonly').objectStore(LOJA).count();
    p.onsuccess = () => ok(p.result);
    p.onerror = () => no(p.error);
  });
}

/**
 * Busca no acervo local. Tudo opcional; sem filtro nenhum devolve o começo.
 *
 * Varre com cursor em vez de carregar tudo: com 10 mil faixas, `getAll()`
 * traria ~5 MB pra memória só pra jogar fora 9900 delas.
 */
export async function buscar({ pilha = null, genero = null, texto = null,
                               bpmMin = null, bpmMax = null, camelot = null,
                               precisaBpmETom = true, limite = 200,
                               amostrar = false } = {}) {
  const b = await abrir();
  const q = texto ? String(texto).toLowerCase() : null;
  return new Promise((ok, no) => {
    const fora = [];
    let vistos = 0;
    const loja = b.transaction(LOJA, 'readonly').objectStore(LOJA);
    const cur = loja.openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c || (!amostrar && fora.length >= limite)) return ok(fora);
      const f = c.value;
      let serve = true;
      if (precisaBpmETom && (!f.bpm || !f.camelot)) serve = false;
      // `gen:X` também casa com genre === X: o garimpo por texto guarda sem
      // rótulo, e o chip House mostrava 28 faixas com 39 mil no acervo
      if (serve && pilha) {
        const porGenero = pilha.startsWith('gen:') && f.genre === pilha.slice(4);
        if (f.pilha !== pilha && !porGenero) serve = false;
      }
      if (serve && genero && f.genre !== genero) serve = false;
      if (serve && bpmMin != null && !(f.bpm >= bpmMin)) serve = false;
      if (serve && bpmMax != null && !(f.bpm <= bpmMax)) serve = false;
      if (serve && camelot && f.camelot !== camelot) serve = false;
      if (serve && q && !`${f.title} ${f.artist} ${f.genre || ''}`.toLowerCase().includes(q)) serve = false;
      if (serve) {
        // amostragem de reservatório: `limite` faixas espalhadas pelo acervo
        // inteiro numa passada, em vez das primeiras na ordem do id
        if (!amostrar || fora.length < limite) fora.push(f);
        else {
          const j = Math.floor(Math.random() * (vistos + 1));
          if (j < limite) fora[j] = f;
        }
        vistos++;
      }
      c.continue();
    };
    cur.onerror = () => no(cur.error);
  });
}

/** Quantas faixas por pilha e por gênero — é o que a tela mostra. */
export async function estatisticas() {
  const b = await abrir();
  return new Promise((ok, no) => {
    const porPilha = {}, porGenero = {};
    let total = 0, comDados = 0;
    const cur = b.transaction(LOJA, 'readonly').objectStore(LOJA).openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return ok({ total, comDados, porPilha, porGenero });
      const f = c.value;
      total++;
      if (f.bpm && f.camelot) {
        comDados++;
        if (f.pilha) porPilha[f.pilha] = (porPilha[f.pilha] || 0) + 1;
        if (f.genre) porGenero[f.genre] = (porGenero[f.genre] || 0) + 1;
      }
      c.continue();
    };
    cur.onerror = () => no(cur.error);
  });
}

/**
 * Os artistas que já apareceram no acervo, com quantas faixas cada um tem aqui.
 *
 * É a lista que a varredura por artista consome: cada faixa encontrada aponta
 * pra um artista, e o catálogo daquele artista costuma ser muito maior do que
 * o que veio pelo trending. Medi um com 279 faixas tendo chegado por uma só.
 */
export async function artistas({ max = 4000 } = {}) {
  const b = await abrir();
  return new Promise((ok, no) => {
    const conta = new Map();
    const cur = b.transaction(LOJA, 'readonly').objectStore(LOJA).openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) {
        return ok([...conta.entries()]
          .sort((x, y) => y[1] - x[1])
          .slice(0, max)
          .map(([handle, n]) => ({ handle, aqui: n })));
      }
      const h = c.value.handle;
      if (h) conta.set(h, (conta.get(h) || 0) + 1);
      c.continue();
    };
    cur.onerror = () => no(cur.error);
  });
}

/**
 * Frentes já esgotadas, pra que "garimpar mais" CONTINUE em vez de repetir.
 *
 * Sem isto, cada garimpo recomeçava pelas crates brasileiras — que se esgotam
 * rápido — e gastava minutos devolvendo `+0` antes de chegar em terreno novo.
 * Uma frente só é marcada como esgotada quando não trouxe NADA de novo; se
 * trouxe alguma coisa, pode trazer mais da próxima vez.
 */
const CHAVE_FRENTES = 'garimpo.frentesEsgotadas';
export function frentesEsgotadas() {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_FRENTES) || '[]')); }
  catch { return new Set(); }
}
export function marcarEsgotada(nome) {
  try {
    const s = frentesEsgotadas();
    s.add(nome);
    localStorage.setItem(CHAVE_FRENTES, JSON.stringify([...s].slice(-2000)));
  } catch {}
}
export function esquecerFrentes() {
  try { localStorage.removeItem(CHAVE_FRENTES); } catch {}
}

/** Handles de artista já varridos, pra não varrer duas vezes. */
const CHAVE_VARRIDOS = 'garimpo.artistasVarridos';
export function artistasVarridos() {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_VARRIDOS) || '[]')); }
  catch { return new Set(); }
}
export function marcarVarrido(handle) {
  try {
    const s = artistasVarridos();
    s.add(handle);
    // 8000 handles ≈ 120 KB: cabe folgado e evita revarrer a cada garimpo
    localStorage.setItem(CHAVE_VARRIDOS, JSON.stringify([...s].slice(-8000)));
  } catch { /* sem storage, revarre — é lento, não é errado */ }
}

export async function limpar() {
  const b = await abrir();
  try { localStorage.removeItem(CHAVE_VARRIDOS); localStorage.removeItem(CHAVE_FRENTES); } catch {}
  return new Promise((ok, no) => {
    const p = b.transaction(LOJA, 'readwrite').objectStore(LOJA).clear();
    p.onsuccess = () => ok(true);
    p.onerror = () => no(p.error);
  });
}

/** Filtra e normaliza um lote cru da API antes de guardar. */
export function prepararLote(cru) {
  const fora = [];
  for (const t of cru || []) {
    if (!isDeckable(t)) continue;
    const n = normalizeTrack(t);
    if (n.isLongMix) continue;
    fora.push(n);
  }
  return fora;
}
