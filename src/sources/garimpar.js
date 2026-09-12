/**
 * O garimpeiro — varre o Audius fundo e enche a crate local.
 *
 * Roda em segundo plano, é interrompível, e reporta progresso. Não bloqueia
 * nada: o usuário continua mixando enquanto ele cava.
 *
 * A ordem das frentes não é arbitrária — é da que mais rende por requisição
 * para a que menos rende, pra que parar no meio ainda deixe um acervo útil:
 *
 *   1. BUSCAS por texto — o único caminho pro que o Audius não tem como
 *      gênero: funk carioca, pagode, sertanejo, reggaeton. Vem PRIMEIRO porque
 *      é o material escasso; o eletrônico sobra de qualquer jeito.
 *   2. TRENDING por gênero × janela × página. 16 gêneros × 3 janelas × 3
 *      páginas de 100 = 144 consultas. É o grosso do volume.
 *   3. UNDERGROUND, que é outro acervo e traz o que não é hit.
 *   4. PLAYLISTS. Cada uma rende de 3 a 50 faixas e quase todas têm BPM e tom,
 *      porque quem monta playlist costuma cuidar dos metadados. Por último
 *      porque são as mais lentas: uma requisição pra achar, outra por faixa.
 *
 * Entre requisições há uma pausa curta. Não é superstição: o Audius é uma rede
 * de nós comunitários e martelar um deles derruba o serviço pra todo mundo,
 * inclusive pra você no meio de um set.
 */

import { APP_NAME, GENRES, CRATES, isDeckable, normalizeTrack } from './audius.js';
import { guardar, contar, artistas, artistasVarridos, marcarVarrido } from './crate.js';

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
  return j.data ?? [];      // /users/handle devolve objeto, o resto devolve lista
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

  /**
   * ORDEM DAS FRENTES: o escasso primeiro.
   *
   * Antes o trending vinha antes das buscas por texto, e isso tinha uma
   * consequência que só apareceu medindo: quando o alvo era atingido ainda
   * dentro do trending, as crates brasileiras e latinas NUNCA eram cavadas. O
   * acervo acabou com 795 faixas de Electronic e 5 de funk carioca.
   *
   * O material eletrônico do Audius é abundante e o brasileiro é raro. Cavar o
   * abundante primeiro é gastar o orçamento no que sobraria de qualquer jeito.
   * Então: buscas por texto (Brasil e América Latina), depois trending, depois
   * underground, e as playlists por último porque são as mais lentas — uma
   * requisição pra achar a playlist e outra por faixa.
   */
  /**
   * 1. BUSCAS por texto — o único caminho pro Brasil e pra América Latina, e
   *    onde mora a maior folga que eu tinha deixado na mesa.
   *
   *    Dois achados de medição mudaram esta parte:
   *
   *    a) o `offset` da BUSCA vai muito mais fundo que o do trending: com 500
   *       ele ainda devolve 100 faixas cheias. Então aqui são 6 páginas, não 3.
   *
   *    b) um termo só não alcança o acervo. Medi termo a termo: "funk remix"
   *       rende 96, "mc" 96, "beat brasil" 74, "mtg" 48, "pagode 90" 41,
   *       "modão" 42, "piseiro" 32 — enquanto "forró eletrônico" e "sertanejo
   *       universitário" rendem ZERO. Então cada crate tem uma lista de termos
   *       escolhidos por rendimento, não por como a gente chamaria o gênero.
   *
   *    Termos inequívocos (mtg, piseiro, arrocha, perreo) dispensam filtro: se
   *    a faixa voltou numa busca por "piseiro", é piseiro. Termos ambíguos
   *    ("samba", "brega", "mc") mantêm o filtro, senão o acervo brasileiro se
   *    enche de homônimo em inglês.
   */
  /**
   * A busca por texto não tem fundo prático: medi `offset=3000` devolvendo 100
   * faixas cheias. Doze páginas por termo é onde eu paro — não porque a API
   * acaba, mas porque o Audius é uma rede de nós comunitários e varrer sem
   * limite seria cobrar deles a minha ambição. Quem quiser mais cava de novo:
   * o acervo acumula entre sessões.
   */
  const PAGINAS_BUSCA = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
  for (const c of CRATES) {
    const buscas = c.buscas || [{ q: c.termo, filtro: c.filtro }];
    for (const b of buscas) {
      for (const offset of PAGINAS_BUSCA) {
        frentes.push({
          nome: `${c.nome} · ${b.q}`,
          pilha: (c.reg === 'BR' ? 'br:' : 'lat:') + c.nome,
          url: `${H}/tracks/search?query=${encodeURIComponent(b.q)}&limit=${LIMITE}` +
               `&offset=${offset}&app_name=${APP_NAME}`,
          filtro: b.filtro !== undefined ? b.filtro : null,
        });
      }
    }
  }

  // 2. trending por gênero, janela e página
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

  // 3. underground: outro acervo, o que ainda não virou hit
  for (const offset of PAGINAS) {
    frentes.push({
      nome: 'underground',
      pilha: 'gen:Electronic',
      url: `${H}/tracks/trending/underground?limit=${LIMITE}&offset=${offset}&app_name=${APP_NAME}`,
    });
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

  /**
   * FASE DOS ARTISTAS — o maior multiplicador, e o último a rodar.
   *
   * Cada faixa encontrada aponta pra um artista, e o catálogo dele costuma ser
   * muito maior do que o que chegou pelo trending: medi um artista com 279
   * faixas tendo aparecido por uma só. Varrer os artistas que já estão no
   * acervo transforma N faixas em muito mais, sem depender de adivinhar termo
   * de busca.
   *
   * Roda por último de propósito: precisa que o acervo já tenha gente dentro
   * pra saber a quem perguntar. E os handles varridos ficam marcados, pra que
   * o segundo garimpo continue de onde o primeiro parou em vez de repetir.
   */
  const varrerArtistas = async () => {
    let lista = [];
    try { lista = await artistas({ max: 3000 }); } catch { return; }
    const jaVarridos = artistasVarridos();
    const pendentes = lista.filter((a) => !jaVarridos.has(a.handle));
    for (const a of pendentes) {
      if (signal?.aborted || total >= alvo) break;
      feito++;
      try {
        const u = await pegar(`${H}/users/handle/${encodeURIComponent(a.handle)}?app_name=${APP_NAME}`, signal);
        const id = Array.isArray(u) ? u[0]?.id : u?.id;
        if (!id) { marcarVarrido(a.handle); continue; }
        const cru = await pegar(`${H}/users/${id}/tracks?limit=100&app_name=${APP_NAME}`, signal);
        const novas = await guardar(preparar(cru), null);
        total += novas;
        marcarVarrido(a.handle);
        aoAndar({ total, novas, frente: `artista ${a.handle}`, feito, de: frentes.length + pendentes.length });
      } catch (e) {
        if (signal?.aborted) break;
        marcarVarrido(a.handle);   // não insiste num handle que deu erro
      }
      await dormir(PAUSA);
    }
  };

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

  if (!signal?.aborted && total < alvo) await varrerArtistas();

  return { total, frentes: feito, de: frentes.length, parou: !!signal?.aborted };
}
