/**
 * A biblioteca — UM menu pra escolher música, que serve à lista E ao DJ.
 *
 * Havia dois menus de gênero: os chips da lista (33, um por vez) e as pilhas do
 * painel do DJ (10, outras chaves). Pra quem usa, era confuso — escolhia House
 * na lista e o DJ tocava outra coisa. No código era pior: o painel guardava
 * `'Disco'` e o acervo guarda `'gen:Disco'`, então com gênero marcado o DJ
 * nunca achava nada no acervo local e ia buscar ~100 faixas na rede, ignorando
 * as 39 mil garimpadas.
 *
 * Agora é uma seleção só:
 *   - chips de gênero com SELEÇÃO MÚLTIPLA (House + Disco mostra as duas)
 *   - a MESMA seleção é o pote do DJ quando ele monta um set
 *   - ORDEM escolhível: embaralhada (de verdade, a cada vez), favoritas, BPM,
 *     tom, nome, ou "combina" com o que está tocando
 *   - FAVORITAS: a estrela guarda a faixa, e o modo favoritas mostra só elas —
 *     e aí o DJ toca só elas
 */

import { GENRES, CRATES, trending, search, crateBr } from '../sources/audius.js';
import * as crate from '../sources/crate.js';

/** Todas as pilhas, cada uma com chave única e rótulo. */
export const GRUPOS = [
  { grupo: 'app.grupo.eletronico',
    itens: GENRES.map((g) => ({ chave: 'gen:' + g, nome: g, rede: () => trending({ genre: g, limit: 40 }) })) },
  { grupo: 'app.grupo.brasil',
    itens: CRATES.filter((c) => c.reg === 'BR').map((c) => ({ chave: 'br:' + c.nome, nome: c.nome,
      rede: () => crateBr(c.nome, { limite: 40 }) })) },
  { grupo: 'app.grupo.latino',
    itens: CRATES.filter((c) => c.reg === 'LAT').map((c) => ({ chave: 'lat:' + c.nome, nome: c.nome,
      rede: () => crateBr(c.nome, { limite: 40 }) })) },
];
const TODAS = GRUPOS.flatMap((g) => g.itens);

export const ORDENS = ['embaralhar', 'favoritas', 'bpm', 'tom', 'nome', 'combina'];

// ─────────────────────────── estado persistido ───────────────────────────

const ler = (k, padrao) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? padrao; } catch { return padrao; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/** Gêneros marcados. Vazio = tudo. */
let selecionadas = new Set(ler('garimpo.bib.generos', ['gen:House']));
let ordem = ler('garimpo.bib.ordem', 'embaralhar');
let decrescente = ler('garimpo.bib.desc', false);
let favoritas = ler('garimpo.favoritas', []);   // objetos completos: tocam sem rede
/**
 * TRASH: o que não é música (piada, teste, grito, ruído). `lixo` é o que VOCÊ
 * tirou (👎) ou o Jev reprovou neste aparelho; `lixoGalera` é o que a galera
 * tirou (2+ votos no Worker). Não aparece na lista nem entra em set.
 * Favorita nunca é trash: se você deu ♥, vale o ♥.
 */
let lixo = new Set(ler('garimpo.lixo', []));
let lixoGalera = new Set(ler('garimpo.lixoGalera', []));
export function ehLixo(id) { return (lixo.has(id) || lixoGalera.has(id)) && !favoritas.some((f) => f.id === id); }
export function marcarLixo(ids) {
  for (const id of ids) lixo.add(id);
  gravar('garimpo.lixo', [...lixo].slice(-5000));
}
export function definirLixoGalera(ids) {
  lixoGalera = new Set(ids);
  gravar('garimpo.lixoGalera', [...lixoGalera]);
}

export const estado = {
  get selecionadas() { return [...selecionadas]; },
  get ordem() { return ordem; },
  get decrescente() { return decrescente; },
  get favoritas() { return favoritas; },
};

export function alternarGenero(chave) {
  if (chave === '*') selecionadas.clear();
  else selecionadas.has(chave) ? selecionadas.delete(chave) : selecionadas.add(chave);
  gravar('garimpo.bib.generos', [...selecionadas]);
}

/** Escolher a mesma ordem de novo inverte (BPM ↑ → ↓) ou re-embaralha. */
export function escolherOrdem(o) {
  if (!ORDENS.includes(o)) return;
  if (o === ordem && ['bpm', 'tom', 'nome'].includes(o)) decrescente = !decrescente;
  else if (o !== ordem) decrescente = false;
  ordem = o;
  gravar('garimpo.bib.ordem', ordem);
  gravar('garimpo.bib.desc', decrescente);
}

export function ehFavorita(id) { return favoritas.some((f) => f.id === id); }
export function alternarFavorita(faixa) {
  if (!faixa?.id) return false;
  const i = favoritas.findIndex((f) => f.id === faixa.id);
  if (i >= 0) favoritas.splice(i, 1);
  else favoritas.unshift(faixa);
  favoritas = favoritas.slice(0, 1000);
  gravar('garimpo.favoritas', favoritas);
  return i < 0;
}

// ─────────────────────────── buscar e ordenar ───────────────────────────

/** Fisher–Yates com Math.random: embaralha DE VERDADE, e de novo a cada chamada. */
function embaralhar(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

function chaveNome(t) {
  return String(t || '').replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase() || '\uffff';
}

/** Posição na roda de Camelot: 1A,1B,2A,… — ordem que um DJ lê. */
function ordemTom(c) {
  const m = /^(\d{1,2})([AB])$/.exec(String(c || ''));
  return m ? Number(m[1]) * 2 + (m[2] === 'B' ? 1 : 0) : 999;
}

function ordenar(lista, { pontuarCombina } = {}) {
  const s = decrescente ? -1 : 1;
  switch (ordem) {
    case 'bpm':  return [...lista].sort((a, b) => s * ((a.bpm || 0) - (b.bpm || 0)));
    case 'tom':  return [...lista].sort((a, b) => s * (ordemTom(a.camelot) - ordemTom(b.camelot)));
    // ignora o lixo do começo do título ("  Space", "#Uchalala", "【東方") —
    // senão a ordem A–Z começa por espaço, aspas e colchete
    case 'nome': return [...lista].sort((a, b) => s * chaveNome(a.title).localeCompare(chaveNome(b.title), 'pt'));
    case 'combina':
      return pontuarCombina
        ? [...lista].sort((a, b) => pontuarCombina(b) - pontuarCombina(a))
        : embaralhar(lista);
    default: return embaralhar(lista);   // embaralhar e favoritas
  }
}

/**
 * Busca as faixas da seleção atual no acervo local; cai pra rede se o acervo
 * não tiver material (primeira visita antes da semente, ou IndexedDB bloqueado).
 */
async function doAcervo({ bpmMin = null, bpmMax = null, porPilha = 250, tudo = 1500 } = {}) {
  const f = { bpmMin, bpmMax, amostrar: true };
  const fora = [];
  const vistos = new Set();
  const somar = (lista) => { for (const t of lista) if (!vistos.has(t.id)) { vistos.add(t.id); fora.push(t); } };
  try {
    if (!selecionadas.size) somar(await crate.buscar({ ...f, limite: tudo }));
    else somar(await crate.buscarPilhas([...selecionadas], { bpmMin, bpmMax, porPilha }));
  } catch { /* sem IndexedDB: segue pela rede abaixo */ }
  return fora;
}

async function daRede() {
  const fora = [];
  const alvo = selecionadas.size ? TODAS.filter((i) => selecionadas.has(i.chave)) : [TODAS.find((i) => i.chave === 'gen:House')];
  for (const it of alvo.slice(0, 6)) {
    try { fora.push(...await it.rede()); } catch {}
  }
  return fora;
}

/**
 * O que a LISTA mostra agora: seleção + busca + modo + ordem.
 * @param {object} op
 * @param {string} op.texto  busca por nome/artista
 * @param {function} op.pontuarCombina  nota de compatibilidade com o que toca
 */
export async function faixasDaLista({ texto = '', pontuarCombina = null } = {}) {
  const q = texto.trim().toLowerCase();
  let lista;
  if (ordem === 'favoritas') {
    lista = [...favoritas];
    if (q) lista = lista.filter((t) => `${t.title} ${t.artist} ${t.genre || ''}`.toLowerCase().includes(q));
  } else if (q) {
    /**
     * Com TEXTO, varre o acervo INTEIRO, não a amostra.
     *
     * A lista normal mostra uma amostra de 250 por gênero; filtrar o nome
     * dentro dela quase nunca acharia a música que a pessoa procura. Buscar é
     * "ache esta em qualquer lugar", então ignora o gênero marcado.
     */
    try { lista = await crate.buscar({ texto: q, limite: 300 }); } catch { lista = []; }
    // não achou no acervo: vai à rede — acha o que ninguém garimpou ainda
    if (lista.length < 5) {
      try { lista = lista.concat(await search(q, { limit: 40 })); } catch {}
    }
  } else {
    lista = await doAcervo();
    if (lista.length < 12) lista = lista.concat(await daRede());
  }
  return ordenar(lista.filter((t) => !t.isLongMix && !ehLixo(t.id)), { pontuarCombina }).slice(0, 300);
}

/**
 * O pote do DJ: a MESMA seleção da lista. Se a pessoa está no modo favoritas,
 * o DJ toca das favoritas — escolher as músicas do set é escolher na lista.
 */
/** O set só das favoritas: o DJ toca o que você marcou com ♥/★. */
export function favoritasParaSet() {
  return favoritas.filter((f) => f.bpm && f.camelot);
}

export async function candidatasDoSet() {
  if (ordem === 'favoritas') return favoritasParaSet();
  let lista = await doAcervo({ bpmMin: 100, bpmMax: 150, porPilha: 900, tudo: 5000 });
  if (lista.length < 40) lista = lista.concat(await daRede());
  return lista.filter((f) => f.bpm && f.camelot && f.duration >= 90 && f.duration <= 420 && !ehLixo(f.id));
}
