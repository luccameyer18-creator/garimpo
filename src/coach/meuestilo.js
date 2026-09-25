/**
 * O DJ APRENDENDO COM VOCÊ.
 *
 * Toda transição sua que a leitura (leitura.js) achou boa — nota 70 ou mais —
 * fica guardada NESTE aparelho: que técnica você usou, quantos tempos durou e
 * quais duas músicas você juntou. Nada disso sai do navegador.
 *
 * Com 3 ou mais, nasce o estilo "o seu" na lista de estilos do DJ:
 *   pesos    as técnicas na proporção em que VOCÊ usa (com um piso, pra ele
 *            não virar um disco arranhado de uma técnica só)
 *   escala   a duração típica das suas transições, em relação à de cada técnica
 * e as duplas que você juntou bem passam a atrair o montador do set
 * (paresBons → setlist.js), porque se você juntou, é porque combina.
 */
import { ESTILOS, TECNICAS } from './tecnicas.js';

const CHAVE = 'garimpo.meuEstilo';
const MINIMO = 3;
const ESCALAS = [0.5, 0.75, 1, 1.5, 2];

function ler() {
  try { const v = JSON.parse(localStorage.getItem(CHAVE) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Guarda uma transição lida. Só as boas ensinam. Devolve se guardou. */
export function aprender(r) {
  if (!r || r.nota < 70 || !TECNICAS[r.tecnica]) return false;
  const lista = ler();
  lista.push({ tec: r.tecnica, tempos: r.tempos, nota: r.nota, par: [r.sai?.id, r.entra?.id], t: Date.now() });
  try { localStorage.setItem(CHAVE, JSON.stringify(lista.slice(-80))); } catch {}
  return true;
}

export function quantasBoas() { return ler().length; }

/** O estilo aprendido, ou null se ainda não há o bastante. */
export function estiloAprendido() {
  const lista = ler();
  if (lista.length < MINIMO) return null;
  const cont = {};
  for (const x of lista) cont[x.tec] = (cont[x.tec] || 0) + 1;
  const max = Math.max(...Object.values(cont));
  const pesos = {};
  for (const k of Object.keys(ESTILOS.pista.pesos)) pesos[k] = 0.3 + 4.7 * (cont[k] || 0) / max;
  // a escala: mediana de (tempos que você usou / tempos da técnica), na escala mais perto
  const razoes = lista.map((x) => x.tempos / (TECNICAS[x.tec]?.tempos || 32)).filter((v) => v > 0).sort((a, b) => a - b);
  const med = razoes[Math.floor(razoes.length / 2)] || 1;
  const escala = ESCALAS.reduce((m, e) => (Math.abs(e - med) < Math.abs(m - med) ? e : m), 1);
  const top = Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => TECNICAS[k]?.nome || k);
  return {
    nome: 'o seu',
    escola: `aprendido com você (${lista.length} transições)`,
    como: `o que você mais faz: ${top.join(' e ')}`,
    pesos, escala,
    uso: ESTILOS.pista.uso, vida: { ...ESTILOS.pista.vida }, chanceVida: ESTILOS.pista.chanceVida,
  };
}

/** Põe (ou atualiza) o "o seu" nos ESTILOS do DJ. Devolve se ele existe. */
export function registrarEstilo() {
  const e = estiloAprendido();
  if (e) ESTILOS.seu = e;
  return !!e;
}

/** As duplas que você juntou bem: "idA>idB". */
export function paresBons() {
  return new Set(ler().filter((x) => x.par?.[0] && x.par?.[1]).map((x) => x.par[0] + '>' + x.par[1]));
}

export function esquecerMeuEstilo() {
  try { localStorage.removeItem(CHAVE); } catch {}
  delete ESTILOS.seu;
}
