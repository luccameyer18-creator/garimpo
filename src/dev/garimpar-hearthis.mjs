/**
 * Garimpa o hearthis e grava a semente dele: assets/acervo-hearthis.json.
 *
 *   node src/dev/garimpar-hearthis.mjs [--fases crates,categorias,termos,artistas]
 *        [--artistas 800] [--saida caminho.json] [--parcial caminho.json] [--retomar]
 *
 * Roda no computador de quem mantém o app, pelo mesmo motivo da semente do
 * Audius (ver semente.js): uma varredura aqui em vez de uma por pessoa que
 * abre o link. O app carrega o arquivo depois da semente do Audius.
 *
 * Frentes, do escasso pro abundante (a mesma lógica do garimpar.js):
 *   1. as buscas das crates brasileiras e latinas, com o filtro de cada uma
 *      ROTULANDO (não descartando)
 *   2. as categorias do hearthis que servem a DJ, página a página
 *   3. buscas por termo das famílias de house, techno, disco e hip-hop
 *   4. os artistas achados, do que mais apareceu pro que menos
 *
 * Toda consulta leva `duration=10` (ver hearthis.js): sem ele o acervo deles
 * é quase só set de uma hora.
 *
 * DEVAGAR DE PROPÓSITO. A primeira versão tinha dois trabalhadores e pausa de
 * 150 ms; em meia hora a API deles começou a devolver 504 e corpo vazio (43
 * de 60 pedidos), e um pedido sozinho passou de ~1 s pra 6,8 s. Agora é um
 * pedido por vez, com pausa, e recuo longo em 5xx. O checkpoint é gravado a
 * cada frente, e --retomar continua de onde parou — dá pra parar a qualquer
 * hora sem perder o que já veio.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { CRATES } from '../sources/audius.js';
import {
  CATEGORIAS, pegar, preparar, pilhaDe, POR_PAGINA, BRASILEIRA, NAO_E_MUSICA, normalizarGenero,
} from '../sources/hearthis.js';
import { CAMPOS } from '../sources/semente.js';

const arg = (nome, padrao) => {
  const i = process.argv.indexOf('--' + nome);
  return i > 0 ? process.argv[i + 1] : padrao;
};
const SAIDA = arg('saida', 'assets/acervo-hearthis.json');
const PARCIAL = arg('parcial', SAIDA.replace(/\.json$/, '') + '.parcial.json');
const RETOMAR = process.argv.includes('--retomar');
/** --so-gravar: não varre nada, só transforma o checkpoint na semente. */
const SO_GRAVAR = process.argv.includes('--so-gravar');
const FASES = new Set(arg('fases', 'crates,categorias,termos,artistas').split(','));
const MAX_ARTISTAS = Number(arg('artistas', 400));
const PAUSA = 400;             // ms entre páginas
const MAX_PAGINAS = 40;        // categorias param por volta da 11ª de 50
// a busca devolve 20 por página, por relevância: o fundo rende pouco e é onde
// a API deles demora e dá 504. Com 15 páginas a varredura levaria ~9 h
const MAX_PAGINAS_TERMO = 5;
const MAX_PAGINAS_ARTISTA = 1; // 50 faixas: a maioria dos artistas tem menos

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const relogio = () => { const s = Math.round((Date.now() - t0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** id → faixa normalizada. A pilha da primeira frente que rotulou fica. */
const faixas = new Map();
/** nomes das frentes já varridas (vão no checkpoint, pra --retomar pular) */
const feitas = new Set();
let pedidos = 0;
const rendeu = [];

if (RETOMAR && existsSync(PARCIAL)) {
  const j = JSON.parse(readFileSync(PARCIAL, 'utf8'));
  for (const linha of j.faixas || []) {
    const f = Object.fromEntries((j.campos || CAMPOS).map((c, i) => [c, linha[i] ?? null]));
    faixas.set(f.id, f);
  }
  for (const n of j.feitas || []) feitas.add(n);
  console.log(`[${relogio()}] retomando: ${faixas.size} faixas, ${feitas.size} frentes já feitas`);
}

function somar(lote, pilha) {
  let novas = 0;
  for (const f of lote) {
    const ja = faixas.get(f.id);
    if (!ja) { faixas.set(f.id, { ...f, pilha: pilha || null }); novas++; }
    else if (!ja.pilha && pilha) ja.pilha = pilha;
  }
  return novas;
}

/**
 * Uma página crua. Corpo vazio é soluço: recua e tenta de novo. 504 é outra
 * coisa — é a página FUNDA demais pra eles (a 6ª de 50 com filtro de duração
 * leva 30 s e morre), e insistir custava ~5 min por categoria. No segundo
 * 504 a série desiste e a varredura segue pra próxima frente.
 */
async function pagina(caminho, params) {
  for (let i = 0; i < 5; i++) {
    try { pedidos++; return await pegar(caminho, params, { tentativas: 1 }); }
    catch (e) {
      if (/HTTP 50[234]/.test(e.message) && i >= 1) {
        console.log(`  [${relogio()}] ${caminho} p${params.page}: ${e.message.replace(/^.*: /, '')} de novo — funda demais, sigo`);
        return null;
      }
      // corpo vazio volta logo (medido: a mesma página responde certo em
      // seguida); 5xx e 429 recuam de verdade
      const espera = /HTTP 429/.test(e.message) ? 60000
        : /HTTP 5/.test(e.message) ? 10000 * (i + 1) : 3000 * (i + 1);
      console.log(`  [${relogio()}] ${caminho} p${params.page}: ${e.message.replace(/^hearthis indisponível em [^:]*: /, '')} — espero ${espera / 1000}s`);
      await dormir(espera);
    }
  }
  return null;       // desiste desta página, não da varredura
}

/**
 * Uma frente = uma série de páginas. Para na primeira página que a API
 * devolve VAZIA (não na primeira sem novidade: página cheia de repetida ainda
 * indica que há mais adiante).
 */
async function correr(f) {
  let novas = 0;
  for (let p = 1; p <= f.paginas; p++) {
    const cru = await pagina(f.caminho, { ...f.params, page: String(p), count: String(POR_PAGINA) });
    if (!Array.isArray(cru) || !cru.length) break;
    const lote = preparar(cru, { slugOrigem: f.slug || null });
    if (f.filtro || f.brasileira) {
      // crate brasileira: além do filtro dela (medido no Audius), marca
      // brasileira de verdade — ver hearthis.BRASILEIRA
      const casam = lote.filter((t) => (!f.filtro || f.filtro.test(`${t.title} ${t.artist} ${t.genre || ''}`)) &&
        (!f.brasileira || BRASILEIRA.test(`${t.title} ${t.artist}`)));
      novas += somar(casam, f.pilha) + somar(lote.filter((t) => !casam.includes(t)), null);
    } else novas += somar(lote, f.pilha || null);
    await dormir(PAUSA);
  }
  rendeu.push({ frente: f.nome, novas });
  return novas;
}

async function emFila(frentes) {
  const fila = frentes.filter((f) => !feitas.has(f.nome));
  let n = 0;
  for (const f of fila) {
    const novas = await correr(f);
    feitas.add(f.nome);
    n++;
    if (novas || n % 10 === 0) {
      console.log(`[${relogio()}] ${n}/${fila.length} ${f.nome}: +${novas} · total ${faixas.size} · ${pedidos} pedidos`);
    }
    gravar(PARCIAL, true);
  }
}

/**
 * As regras que vieram depois valem também pro que já estava no checkpoint:
 * rótulo brasileiro só com marca brasileira, gênero cru normalizado ("funk"
 * gringo vira Disco), e programa falado fora.
 */
function revisar(f) {
  const texto = `${f.title} ${f.artist}`;
  if (f.pilha?.startsWith('br:') && !BRASILEIRA.test(texto)) f.pilha = null;
  f.genre = normalizarGenero(f.genre, texto);
  return !NAO_E_MUSICA.test(f.genre || '');
}

function gravar(caminho, comFeitas = false) {
  const linhas = [...faixas.values()]
    .filter((f) => f.id && f.bpm && f.camelot && revisar(f))
    .map((f) => CAMPOS.map((c) => (c === 'duration' ? Math.round(f[c] || 0) : (f[c] ?? null))));
  // data E hora: a semente carrega uma vez por versão (semente.js), então
  // regerar no mesmo dia com a versão só da data não chegaria a ninguém
  const corpo = { versao: `${new Date().toISOString().slice(0, 16)}-ht`, fonte: 'hearthis', campos: CAMPOS, faixas: linhas };
  if (comFeitas) corpo.feitas = [...feitas];
  writeFileSync(caminho, JSON.stringify(corpo));
  return linhas.length;
}

// ── 1. crates brasileiras, latinas, estilos e slowed ──
const PREFIXOS = { BR: 'br:', LAT: 'lat:', EST: 'est:', SLW: 'slw:' };
const frentesCrates = [];
for (const c of CRATES) {
  if (!PREFIXOS[c.reg]) continue;
  for (const b of c.buscas || [{ q: c.termo, filtro: c.filtro }]) {
    frentesCrates.push({
      nome: `${c.nome} · ${b.q}`, caminho: '/search/', params: { t: b.q, duration: '10' },
      pilha: PREFIXOS[c.reg] + c.nome, filtro: b.filtro !== undefined ? b.filtro : null, paginas: MAX_PAGINAS,
      brasileira: c.reg === 'BR',
    });
  }
}

// ── 2. categorias ──
const frentesCategorias = CATEGORIAS.map((c) => ({
  nome: `categoria ${c.slug}`, caminho: `/categories/${c.slug}/`, params: { duration: '10' },
  slug: c.slug, pilha: pilhaDe(c.slug), paginas: MAX_PAGINAS,
}));

// ── 3. termos das famílias que o app mais toca ──
const TERMOS = [
  'house', 'deep house', 'tech house', 'progressive house', 'afro house', 'melodic house',
  'soulful house', 'funky house', 'jackin house', 'organic house', 'chicago house', 'acid house',
  'disco house', 'french house', 'bass house', 'latin house', 'minimal', 'minimal house', 'lo-fi house',
  'techno', 'melodic techno', 'minimal techno', 'hard techno', 'peak time techno', 'industrial techno',
  'acid techno', 'detroit techno', 'dub techno', 'hypnotic techno', 'raw techno',
  'disco', 'nu disco', 'italo disco', 'cosmic disco', 'boogie', 'disco edit', 'edit', 're-edit',
  'bootleg', 'remix', 'extended mix', 'club mix', 'original mix',
  'hip hop', 'boom bap', 'instrumental hip hop', 'beats', 'trap', 'drill', 'phonk', 'afrobeats',
  'amapiano', 'reggaeton', 'moombahton', 'baile funk', 'brazil',
  'drum and bass', 'liquid', 'dubstep', 'breaks', 'electro', 'trance', 'psytrance',
  'downtempo', 'balearic', 'afro', 'indie dance', 'melodic', 'groove',
];
const frentesTermos = TERMOS.map((q) => ({
  nome: `termo ${q}`, caminho: '/search/', params: { t: q, duration: '10' }, pilha: null, paginas: MAX_PAGINAS_TERMO,
}));

if (SO_GRAVAR) FASES.clear();
console.log(`[${relogio()}] fases: ${[...FASES].join(', ') || '(nenhuma: só gravar)'}`);
if (FASES.has('crates')) await emFila(frentesCrates);
if (FASES.has('categorias')) await emFila(frentesCategorias);
if (FASES.has('termos')) await emFila(frentesTermos);

// ── 4. artistas: quem mais apareceu primeiro ──
if (FASES.has('artistas')) {
  const porArtista = new Map();
  for (const f of faixas.values()) if (f.handle) porArtista.set(f.handle, (porArtista.get(f.handle) || 0) + 1);
  const artistas = [...porArtista.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_ARTISTAS);
  console.log(`[${relogio()}] ${faixas.size} faixas antes dos artistas; varrendo ${artistas.length} de ${porArtista.size} artistas`);
  await emFila(artistas.map(([h]) => ({
    nome: `artista ${h}`, caminho: `/${encodeURIComponent(h.replace(/^ht:/, ''))}/`, params: { type: 'tracks' },
    pilha: null, paginas: MAX_PAGINAS_ARTISTA,
  })));
}

const n = gravar(SAIDA);
const conta = (campo) => {
  const m = {};
  for (const f of faixas.values()) {
    if (f.bpm && f.camelot && !NAO_E_MUSICA.test(f.genre || '')) m[f[campo] || '—'] = (m[f[campo] || '—'] || 0) + 1;
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k}:${v}`).join('  ');
};
console.log(`\n[${relogio()}] PRONTO: ${n} faixas em ${SAIDA} · ${pedidos} pedidos`);
console.log('por pilha:', conta('pilha'));
console.log('por gênero:', conta('genre'));
console.log('frentes que mais renderam:', rendeu.sort((a, b) => b.novas - a.novas).slice(0, 15).map((r) => `${r.frente}:${r.novas}`).join('  '));
