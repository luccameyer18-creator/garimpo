/**
 * Fila do set — a sequência que o professor sugere pra você tocar.
 *
 * É o planejador de set da Fase 8, antecipado. Dada uma faixa semente, monta
 * uma corrente onde CADA passo encaixa no anterior: BPM dentro do alcance do
 * pitch e tom compatível na roda de Camelot.
 *
 * Busca gulosa com olhar de um passo, não exaustiva: o catálogo do Audius é
 * pequeno o bastante pra que uma busca profunda não compense, e uma fila que
 * aparece na hora vale mais que uma ótima que demora.
 *
 * A curva de energia usa o BPM como proxy — subir de andamento ao longo do set
 * é o jeito mais simples e mais confiável de subir energia sem precisar de
 * análise espectral.
 */

import { compativeis, keyCompatible } from '../sources/audius.js';

/**
 * @param {object} semente  faixa já normalizada, com bpm e camelot
 * @param {object} opts
 * @param {number} opts.tamanho     quantas faixas na fila
 * @param {string} opts.energia     'subir' | 'estavel' | 'descer'
 */
export async function montarFila(semente, { tamanho = 5, energia = 'subir', signal } = {}) {
  if (!semente?.bpm) throw new Error('a faixa semente precisa de BPM');

  const fila = [];
  const usados = new Set([semente.id]);
  let atual = semente;

  for (let i = 0; i < tamanho; i++) {
    let cands;
    try {
      cands = await compativeis(atual, { limite: 40, signal });
    } catch { break; }

    const livres = cands.filter((t) => !usados.has(t.id));
    if (!livres.length) break;

    const alvoBpm = energia === 'subir' ? atual.bpm * 1.012
                  : energia === 'descer' ? atual.bpm * 0.988
                  : atual.bpm;

    // custo: harmonia primeiro, depois quanto foge da curva de energia, depois
    // quanto pitch exige. Harmonia pesa mais porque é o que se ouve errado.
    const pontuar = (t) => {
      const h = keyCompatible(
        atual.camelot ? { camelot: atual.camelot } : null,
        t.camelot ? { camelot: t.camelot } : null);
      const custoH = h.ok ? (h.distance ?? 0) : 8;
      const custoE = Math.abs(t.bpm - alvoBpm) / Math.max(1, atual.bpm) * 40;
      const custoP = Math.abs(t.pitchNecessario ?? 0) * 25;
      return custoH + custoE + custoP;
    };

    livres.sort((a, b) => pontuar(a) - pontuar(b));
    const escolhida = livres[0];

    const h = keyCompatible(
      atual.camelot ? { camelot: atual.camelot } : null,
      escolhida.camelot ? { camelot: escolhida.camelot } : null);

    fila.push({
      ...escolhida,
      deOndeVem: atual.title,
      motivo: h.reason,
      pitch: escolhida.bpm / atual.bpm - 1,
    });
    usados.add(escolhida.id);
    atual = escolhida;
  }

  return fila;
}

/** Resumo da fila em uma linha, pra caber na interface. */
export function resumo(fila, semente) {
  if (!fila?.length) return 'fila vazia';
  const bpms = [semente?.bpm, ...fila.map((t) => t.bpm)].filter(Boolean);
  const de = bpms[0], ate = bpms[bpms.length - 1];
  const min = Math.round(fila.reduce((s, t) => s + t.duration, 0) / 60);
  return `${fila.length} faixas · ${de} → ${ate} BPM · ~${min} min`;
}
