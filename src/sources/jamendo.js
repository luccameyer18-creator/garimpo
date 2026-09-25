/**
 * JAMENDO — a 3ª fonte (depois do Audius e do hearthis): ~600 mil faixas de
 * artistas independentes, todas em Creative Commons.
 *
 * O que ele tem de diferente, medido em 2026-09-25:
 *   - o client_id é PESSOAL pelos termos deles: fica no Worker (secret), e o
 *     app só fala com /jamendo/* de lá. O Worker também dá a cada pedido um
 *     pedaço diferente do catálogo (um cursor por gênero), pra cada lote do
 *     dia trazer músicas que ninguém garimpou.
 *   - o áudio só libera CORS SEM Range (com Range o 206 vem sem permissão):
 *     o deck baixa a faixa inteira (3 a 7 MB em mp32), sem o truque do prefixo.
 *   - não vem BPM nem tom: a análise do deck mede quando alguém toca, e aí a
 *     faixa entra no acervo de todo mundo com os dois (ver app.aprenderJamendo).
 *   - licença CC: o crédito mostra o artista, o link pra faixa e a licença.
 */
import { WORKER } from './galera.js';

export const PREFIXO = 'jm:';
export const ehJamendo = (f) => String(f?.id || '').startsWith(PREFIXO);
const numero = (f) => String(f.id).slice(PREFIXO.length);

/** O stream (mp32, VBR alta), montado do id — nunca com o client_id junto. */
export const audioDe = (f) => `https://prod-1.storage.jamendo.com/?trackid=${numero(f)}&format=mp32`;
export const paginaDe = (f) => `https://www.jamendo.com/track/${numero(f)}`;

/**
 * Um pedaço do catálogo do gênero, NOVO a cada chamada (o cursor anda no
 * Worker). Devolve { faixas, fim } — fim = o gênero acabou (o cursor volta ao
 * começo pra próxima pessoa).
 */
export async function lote(genero, { n = 200, signal } = {}) {
  const r = await fetch(`${WORKER}/jamendo/lote?genero=${encodeURIComponent(genero)}&n=${n}`, { signal });
  if (!r.ok) throw new Error('jamendo ' + r.status);
  const j = await r.json();
  return { faixas: (j.faixas || []).map((f) => ({ ...f, source: 'jamendo' })), fim: !!j.fim };
}
