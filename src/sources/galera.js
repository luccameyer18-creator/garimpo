/**
 * Garimpo da galera — o que cada um garimpa vira acervo de todo mundo.
 *
 * Quem garimpa manda as faixas novas pro Worker; quem abre o app puxa o que os
 * outros acharam desde a última visita. Só vão e voltam METADADOS do Audius
 * (id, título, BPM, tom…): o áudio continua vindo do Audius, e arquivo local
 * seu nunca sai do aparelho.
 *
 * Tudo aqui é melhor-esforço: sem rede ou com o Worker fora, o app segue igual,
 * só sem as faixas da galera.
 */

import { guardar } from './crate.js';

export const WORKER = 'https://garimpo.garimpo-dj.workers.dev';

/**
 * Trash compartilhado: cada 👎 (ou reprovação do Jev) é um voto. Com 2 votos
 * a faixa some do garimpo de todo mundo — o Jev de uma pessoa economiza o
 * token de todas as outras.
 */
export async function votarLixo(ids, origem = 'gente') {
  if (!ids?.length) return;
  try {
    await fetch(`${WORKER}/lixo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids.slice(0, 50), origem }),
    });
  } catch {}
}
export async function puxarLixo() {
  try {
    const r = await fetch(`${WORKER}/lixo`);
    if (!r.ok) return null;
    return (await r.json()).ids || [];
  } catch { return null; }
}

const CHAVE_DESDE = 'garimpo.galera.desde';
const CAMPOS = ['id', 'title', 'artist', 'handle', 'duration', 'genre', 'bpm', 'camelot', 'key', 'pilha'];
const LOTE = 500;          // o Worker aceita até 500 por POST
const PAGINA = 2000;       // e devolve até 2000 por GET

let fila = [];
let timer = null;

/**
 * Enfileira faixas garimpadas pra compartilhar.
 *
 * Espera 4 s de calma antes de mandar: um garimpo chama isto dezenas de vezes
 * seguidas, e um POST por chamada estouraria o limite por IP do Worker.
 */
export function compartilhar(faixas) {
  for (const f of faixas || []) {
    if (!f?.id || !f.bpm || !f.duration) continue;
    fila.push(Object.fromEntries(CAMPOS.map((k) => [k, f[k] ?? null])));
  }
  clearTimeout(timer);
  if (fila.length) timer = setTimeout(enviar, 4000);
}

async function enviar() {
  while (fila.length) {
    const lote = fila.splice(0, LOTE);
    try {
      const r = await fetch(`${WORKER}/acervo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lote),
      });
      // 429 = rápido demais: devolve o lote pra fila e tenta de novo daqui a pouco
      if (r.status === 429) { fila = lote.concat(fila); timer = setTimeout(enviar, 15000); return; }
    } catch { return; }
  }
}

/**
 * Puxa o que a galera garimpou desde a última visita.
 *
 * O cursor é o `criada` da última faixa recebida. Faixas de um mesmo POST
 * dividem o mesmo `criada`, então o Worker devolve `>= desde`: se a página veio
 * cheia, o último grupo pode ter vindo pela metade e é pedido de novo inteiro
 * (repetida não conta, o crate ignora). Página incompleta = está tudo aqui, e o
 * cursor anda um milissegundo pra não baixar o último grupo toda visita.
 *
 * @returns {Promise<{novas:number}>}
 */
export async function puxar() {
  let desde = 0;
  try { desde = Number(localStorage.getItem(CHAVE_DESDE) || 0); } catch {}
  let novas = 0;
  try {
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`${WORKER}/acervo?desde=${desde}`);
      if (!r.ok) break;
      const { faixas = [] } = await r.json();
      if (!faixas.length) break;
      novas += await guardar(faixas.map(({ criada, ...f }) => f), null);
      const ultima = faixas[faixas.length - 1].criada;
      const cheia = faixas.length >= PAGINA;
      desde = cheia ? ultima : ultima + 1;
      try { localStorage.setItem(CHAVE_DESDE, String(desde)); } catch {}
      if (!cheia) break;
    }
  } catch {}
  return { novas };
}
