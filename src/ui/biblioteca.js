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

import { GENRES, CRATES, DJS, APOSTAS, trending, search, crateBr, revelacoes, apostasDaSemana, faixasDoArtista } from '../sources/audius.js';
import * as crate from '../sources/crate.js';
import { sinaisAudius } from '../coach/jev.js';

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
  { grupo: 'app.grupo.estilos',
    itens: CRATES.filter((c) => c.reg === 'EST').map((c) => ({ chave: 'est:' + c.nome, nome: c.nome,
      rede: () => crateBr(c.nome, { limite: 40 }) })) },
  // as apostas: o que está estourando. Revelações é FRESCA (quem está
  // chegando muda toda semana: volta à rede a cada 6 h mesmo com acervo); as
  // 🚀 da semana entram logo depois dela, ver carregarApostas()
  { grupo: 'app.grupo.apostas',
    itens: [{ chave: 'dj:Revelações', nome: '🔥 Revelações', fresca: true, rede: () => revelacoes({ limite: 60 }) },
      ...APOSTAS.map((c) => ({ chave: 'dj:' + c.nome, nome: c.nome, rede: () => crateBr(c.nome, { limite: 60 }) }))] },
  { grupo: 'app.grupo.djs',
    itens: DJS.map((c) => ({ chave: 'dj:' + c.nome, nome: c.nome, rede: () => crateBr(c.nome, { limite: 60 }) })) },
];
let TODAS = GRUPOS.flatMap((g) => g.itens);

/**
 * 🚀 APOSTAS DA SEMANA: os artistas do Audius que mais pegaram tração, com
 * NOME, um chip cada. Guardadas por 12 h (a conta pede 14 chamadas); ao
 * trocar, as que saíram deixam de estar marcadas. Devolve true se mudou.
 */
const GRUPO_APOSTAS = GRUPOS.find((g) => g.grupo === 'app.grupo.apostas');
function porApostas(lista) {
  GRUPO_APOSTAS.itens = GRUPO_APOSTAS.itens.filter((i) => !i.chave.startsWith('ap:'));
  // quem já tem chip com nome (Aurelios é aposta fixa E sai na da semana) não repete
  const ja = new Set(TODAS.filter((i) => i.chave.startsWith('dj:')).map((i) => i.nome.toLowerCase()));
  lista = lista.filter((a) => !ja.has(a.nome.toLowerCase()));
  GRUPO_APOSTAS.itens.splice(1, 0, ...lista.map((a) => ({
    chave: 'ap:' + a.id, nome: '🚀 ' + a.nome, fresca: true, rede: () => faixasDoArtista(a.id, { limite: 60 }),
  })));
  TODAS = GRUPOS.flatMap((g) => g.itens);
}
export async function carregarApostas() {
  const salvo = ler('garimpo.apostas', null);
  if (salvo?.lista?.length && Date.now() - salvo.quando < 12 * 3600e3) return false;
  let lista;
  try { lista = await apostasDaSemana({ n: 8 }); } catch { return false; }
  if (!lista.length) return false;
  gravar('garimpo.apostas', { quando: Date.now(), lista });
  porApostas(lista);
  const vivas = new Set(TODAS.map((i) => i.chave));
  for (const s of [...selecionadas]) if (s.startsWith('ap:') && !vivas.has(s)) selecionadas.delete(s);
  gravar('garimpo.bib.generos', [...selecionadas]);
  return true;
}

export const ORDENS = ['embaralhar', 'favoritas', 'bpm', 'tom', 'nome', 'combina'];

// ─────────────────────────── estado persistido ───────────────────────────

const ler = (k, padrao) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? padrao; } catch { return padrao; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/** Gêneros marcados. Vazio = tudo — e é o padrão: sem preferência até a pessoa escolher. */
let selecionadas = new Set(ler('garimpo.bib.generos', []));
let ordem = ler('garimpo.bib.ordem', 'embaralhar');
let decrescente = ler('garimpo.bib.desc', false);
let favoritas = ler('garimpo.favoritas', []);   // objetos completos: tocam sem rede
// as 🚀 apostas guardadas aparecem já no primeiro quadro (ler/gravar existem daqui pra baixo)
porApostas(ler('garimpo.apostas', { lista: [] }).lista || []);
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

  /**
   * GÊNERO COM POUCA MÚSICA NO ACERVO VAI À REDE — cada um, não o conjunto.
   *
   * Antes a conta era do conjunto: com House (1.500 no acervo) e Megafunk
   * (zero) marcados, "já tem música suficiente" e o Megafunk nunca era
   * buscado — o set saía só de House e parecia que a troca de gênero não
   * funcionava. Agora cada pilha marcada com menos de 30 faixas no acervo é
   * buscada na rede, e o que vem fica GUARDADO com a pilha certa: da próxima
   * vez já está no acervo.
   */
  if (selecionadas.size) {
    const porPilhaAchada = {};
    for (const t of fora) {
      for (const s of selecionadas) {
        if (s === t.pilha || (s.startsWith('gen:') && t.genre === s.slice(4))) porPilhaAchada[s] = (porPilhaAchada[s] || 0) + 1;
      }
    }
    const faltam = TODAS.filter((i) => selecionadas.has(i.chave) &&
      ((porPilhaAchada[i.chave] || 0) < 30 || (i.fresca && passada(i.chave))));
    await Promise.all(faltam.slice(0, 6).map(async (it) => {
      try {
        const novas = (await it.rede()).filter((t) => !t.isLongMix)
          .filter((t) => (bpmMin == null || t.bpm >= bpmMin) && (bpmMax == null || t.bpm <= bpmMax));
        for (const t of novas) t.pilha = t.pilha || it.chave;
        somar(novas);
        crate.guardar(novas, it.chave).catch(() => {});
        if (it.fresca) { try { localStorage.setItem('garimpo.fresca.' + it.chave, String(Date.now())); } catch {} }
      } catch {}
    }));
  }
  return fora;
}

/** Pilha fresca buscada há mais de 6 h (ou nunca): vai à rede de novo. */
function passada(chave) {
  try { return Date.now() - Number(localStorage.getItem('garimpo.fresca.' + chave) || 0) > 6 * 3600e3; }
  catch { return true; }
}

async function daRede() {
  const fora = [];
  // sem gênero marcado: três pilhas SORTEADAS (antes era sempre House)
  const alvo = selecionadas.size ? TODAS.filter((i) => selecionadas.has(i.chave)) : embaralhar(TODAS).slice(0, 3);
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
  // 70–180 BPM: com 100–150, boombap (~90) nunca entrava num set
  let lista = await doAcervo({ bpmMin: 70, bpmMax: 180, porPilha: 900, tudo: 5000 });
  if (lista.length < 40) lista = lista.concat(await daRede());
  lista = lista.filter((f) => f.bpm && f.camelot && f.duration >= 90 && f.duration <= 420 && !ehLixo(f.id));
  // sem repetidas: o que veio do acervo e o que veio da rede se sobrepõem, e a
  // mesma música às vezes foi enviada duas vezes (mesmo título e artista)
  const vistas = new Set();
  lista = lista.filter((f) => {
    const k1 = 'id:' + f.id, k2 = 'tt:' + `${f.title}|${f.artist}`.toLowerCase().replace(/\s+/g, ' ').trim();
    if (vistas.has(k1) || vistas.has(k2)) return false;
    vistas.add(k1); vistas.add(k2);
    return true;
  });
  /**
   * EQUILÍBRIO: nenhum gênero domina por ter mais faixas guardadas.
   *   - com gêneros marcados: no máximo 150 de cada um, sorteadas. Sem isto,
   *     House (900 no acervo) + Megafunk (25) dava um set só de House
   *   - com TUDO: no máximo 80 de cada gênero, sorteadas — o set sai aleatório
   *     de verdade, sem preferência nenhuma, até a pessoa escolher
   */
  const grupos = {};
  const marcadas = [...selecionadas];
  for (const t of lista) {
    const k = marcadas.length
      ? marcadas.find((s) => s === t.pilha || (s.startsWith('gen:') && t.genre === s.slice(4))) || 'outro'
      : t.pilha || ('gen:' + (t.genre || '?'));
    (grupos[k] ||= []).push(t);
  }
  // com gêneros marcados, o maior fica em no máximo o DOBRO do menor (piso 40):
  // Megafunk com 24 faixas não some no meio de 900 de House
  const tamanhos = marcadas.map((s) => grupos[s]?.length || 0).filter((n) => n > 0);
  const teto = marcadas.length ? Math.min(150, Math.max(40, 2 * Math.min(...tamanhos, 75))) : 80;
  lista = Object.entries(grupos).flatMap(([k, g]) => embaralhar(g).slice(0, k === 'outro' ? 60 : teto));
  // no máximo 600 (sorteadas, o equilíbrio já foi feito): é o que dá pra
  // perguntar ao Audius quem é bom em ~2 s
  if (lista.length > 600) lista = embaralhar(lista).slice(0, 600);
  await comSinais(lista);
  return lista;
}

/**
 * O QUE O AUDIUS SABE DE CADA UMA — plays, curtidas, reposts — pra o
 * montador preferir música que alguém ouviu e gostou (ver `qualidade` em
 * setlist.js). O acervo não guarda isso (o Worker só leva o essencial), então
 * se pergunta na hora, 25 por pedido, 6 pedidos de cada vez, e se lembra
 * durante a sessão. Sem rede: tudo segue, só sem essa nota.
 */
const sinaisVistos = new Map();
async function comSinais(lista) {
  const faltam = lista.filter((t) => t.source !== 'local' && !sinaisVistos.has(t.id) && /^[A-Za-z0-9]{3,16}$/.test(t.id));
  const lotes = [];
  for (let i = 0; i < faltam.length; i += 25) lotes.push(faltam.slice(i, i + 25));
  for (let i = 0; i < lotes.length; i += 6) {
    const r = await Promise.all(lotes.slice(i, i + 6).map((l) => sinaisAudius(l).catch(() => ({}))));
    for (const mapa of r) for (const [id, s] of Object.entries(mapa)) sinaisVistos.set(id, s);
  }
  for (const t of lista) t.sinais = sinaisVistos.get(t.id) || t.sinais || null;
}
