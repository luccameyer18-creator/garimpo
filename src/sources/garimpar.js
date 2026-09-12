/**
 * O garimpeiro — varre o Audius fundo e enche a crate local.
 *
 * Roda em segundo plano, é interrompível, e reporta progresso. Não bloqueia
 * nada: o usuário continua mixando enquanto ele cava.
 *
 * A ordem das frentes não é arbitrária — é da que mais rende por requisição
 * para a que menos rende, pra que parar no meio ainda deixe um acervo útil:
 *
 *   1. TRENDING por gênero × janela × página. 16 gêneros × 3 janelas × 3
 *      páginas de 100 = 144 consultas. É o grosso.
 *   2. UNDERGROUND, que é outro acervo e traz o que não é hit.
 *   3. BUSCAS por texto — é o único caminho pro que o Audius não tem como
 *      gênero: funk carioca, pagode, sertanejo, reggaeton.
 *   4. PLAYLISTS. Cada uma rende de 3 a 50 faixas e quase todas têm BPM e tom,
 *      porque quem monta playlist costuma cuidar dos metadados.
 *
 * Entre requisições há uma pausa curta. Não é superstição: o Audius é uma rede
 * de nós comunitários e martelar um deles derruba o serviço pra todo mundo,
 * inclusive pra você no meio de um set.
 */

import { APP_NAME, GENRES, CRATES, isDeckable, normalizeTrack } from './audius.js';
import { guardar, contar } from './crate.js';

const H = 'https://api.audius.co/v1';
const PAUSA = 120;          // ms entre requisições

/**
 * Limites MEDIDOS da API, não chutados:
 *   limit máximo 100 (200 devolve 400)
 *   offset até 200 no trending (400 devolve 400)
 *   time aceita week/month/allTime; year devolve 400
 */
const LIMITE = 100;
const PAGINAS = [0, 100, 200];
const JANELAS = ['week', 'month', 'allTime'];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function pegar(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return j.data || [];
}

/** Filtra o lote cru pro que serve num deck e normaliza. */
function preparar(cru) {
  const fora = [];
  for (const t of cru) {
    if (!isDeckable(t)) continue;
    const n = normalizeTrack(t);
    if (n.isLongMix) continue;
    fora.push(n);
  }
  return fora;
}

/**
 * Cava até `alvo` faixas no acervo, ou até acabarem as frentes.
 *
 * @param {object} opts
 * @param {number} opts.alvo        para quando o acervo chegar aqui
 * @param {AbortSignal} opts.signal
 * @param {function} opts.aoAndar   ({ total, novas, frente, feito, de })
 */
export async function garimpar({ alvo = 10000, signal, aoAndar = () => {} } = {}) {
  const frentes = [];

  // 1. trending por gênero, janela e página
  for (const g of GENRES) {
    for (const time of JANELAS) {
      for (const offset of PAGINAS) {
        frentes.push({
          nome: `${g} · ${time}`,
          pilha: 'gen:' + g,
          url: `${H}/tracks/trending?genre=${encodeURIComponent(g)}&limit=${LIMITE}` +
               `&offset=${offset}&time=${time}&app_name=${APP_NAME}`,
        });
      }
    }
  }

  // 2. underground: outro acervo, o que ainda não virou hit
  for (const offset of PAGINAS) {
    frentes.push({
      nome: 'underground',
      pilha: 'gen:Electronic',
      url: `${H}/tracks/trending/underground?limit=${LIMITE}&offset=${offset}&app_name=${APP_NAME}`,
    });
  }

  // 3. buscas por texto — o único caminho pro Brasil e pra América Latina
  for (const c of CRATES) {
    for (const offset of PAGINAS) {
      frentes.push({
        nome: c.nome,
        pilha: (c.reg === 'BR' ? 'br:' : 'lat:') + c.nome,
        url: `${H}/tracks/search?query=${encodeURIComponent(c.termo)}&limit=${LIMITE}` +
             `&offset=${offset}&app_name=${APP_NAME}`,
        filtro: c.filtro,
      });
    }
  }

  // 4. playlists: multiplicador. Busca a playlist, depois as faixas dela.
  const termosPl = [...GENRES.slice(0, 10).map((g) => g.toLowerCase()),
                    'funk', 'baile funk', 'reggaeton', 'pagode', 'sertanejo',
                    'disco', 'dj set', 'party', 'brasil', 'latino'];
  for (const q of termosPl) {
    frentes.push({ nome: `playlists “${q}”`, playlists: q });
  }

  let total = await contar().catch(() => 0);
  let feito = 0;

  for (const f of frentes) {
    if (signal?.aborted || total >= alvo) break;
    feito++;
    try {
      let lote = [];
      if (f.playlists) {
        const pls = await pegar(
          `${H}/playlists/search?query=${encodeURIComponent(f.playlists)}&limit=10&app_name=${APP_NAME}`,
          signal);
        for (const p of pls) {
          if (signal?.aborted) break;
          await dormir(PAUSA);
          try {
            const faixas = await pegar(`${H}/playlists/${p.id}/tracks?app_name=${APP_NAME}`, signal);
            lote.push(...preparar(faixas));
          } catch { /* uma playlist fora do ar não derruba a varredura */ }
        }
      } else {
        const cru = await pegar(f.url, signal);
        lote = preparar(cru);
        // a busca por texto pega homônimo: "forró" traz "forlorn". O filtro da
        // crate separa, e sem ele o acervo brasileiro viraria qualquer coisa.
        if (f.filtro) lote = lote.filter((t) => f.filtro.test(`${t.title} ${t.artist} ${t.genre || ''}`));
      }

      const novas = await guardar(lote, f.pilha || null);
      total += novas;
      aoAndar({ total, novas, frente: f.nome, feito, de: frentes.length });
    } catch (e) {
      if (signal?.aborted) break;
      aoAndar({ total, novas: 0, frente: f.nome, feito, de: frentes.length, erro: e.message });
    }
    await dormir(PAUSA);
  }

  return { total, frentes: feito, de: frentes.length, parou: !!signal?.aborted };
}
