/**
 * Inspeção de layout — "existe no DOM" não é o mesmo que "o usuário vê".
 *
 * Eu entreguei uma versão em que os botões PLAY, CUE, SYNC e KEY LOCK tinham
 * sumido da tela, porque conferi com querySelector se eles EXISTIAM — e
 * existiam. Estavam cortados pelo overflow do deck. Elemento cortado continua
 * no DOM, responde a querySelector, tem className, e é invisível.
 *
 * Isto mede posição e tamanho reais e acusa quatro coisas que o DOM esconde:
 * tamanho zero, corte pela borda da janela, cobertura por outro elemento, e
 * página que rola quando não deveria.
 *
 * Uso, no console do navegador com o app aberto:
 *   const { inspecionar } = await import('/src/dev/inspecionar.js');
 *   inspecionar();
 */

/** Todo controle que o usuário precisa alcançar. Se entrar controle novo, entra aqui. */
export const CONTROLES = [
  ...['A', 'B'].flatMap((d) =>
    ['.play', '.cue', '.sync', '.keylock', '.jog', '.fader', '.onda', '.mini',
     '.bpm-val', '.pos', '.faixa-sel'].map((c) => `#deck${d} ${c}`)),
  '#xf', '#master', '#fase', '#lista', '#b-compat', '#genero', '#busca',
  '#prof-fala', '#prof-rosto', '#b-ajuda', '#b-diag', '#b-arquivo',
  ...['A', 'B'].flatMap((d) =>
    ['grave', 'medio', 'agudo'].flatMap((b) => [`#eq-${d}-${b}`, `#kill-${d}-${b}`])),
];

function avaliar(sel) {
  const el = document.querySelector(sel);
  if (!el) return { sel, problema: 'NÃO EXISTE' };
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) {
    return { sel, problema: 'tamanho zero', medida: `${r.width | 0}x${r.height | 0}` };
  }
  if (r.bottom > innerHeight + 1) return { sel, problema: 'cortado embaixo', fora: Math.round(r.bottom - innerHeight) };
  if (r.top < -1) return { sel, problema: 'cortado em cima', fora: Math.round(-r.top) };
  if (r.right > innerWidth + 1) return { sel, problema: 'cortado à direita', fora: Math.round(r.right - innerWidth) };
  if (r.left < -1) return { sel, problema: 'cortado à esquerda', fora: Math.round(-r.left) };

  // o centro do elemento pertence mesmo a ele, ou tem algo por cima?
  const alvo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (alvo && alvo !== el && !el.contains(alvo) && !alvo.contains(el)) {
    return { sel, problema: 'coberto', por: (alvo.id || alvo.className || alvo.tagName).toString().slice(0, 28) };
  }

  // alvo de toque pequeno demais para dedo
  if (el.matches('button, input[type=range]') && (r.height < 22 || r.width < 22)) {
    return { sel, problema: 'alvo de toque pequeno', medida: `${r.width | 0}x${r.height | 0}` };
  }
  return null;
}

export function inspecionar({ silencioso = false } = {}) {
  const problemas = CONTROLES.map(avaliar).filter(Boolean);
  const rola = document.documentElement.scrollHeight > innerHeight + 2;
  const r = {
    viewport: `${innerWidth}x${innerHeight}`,
    alturaDaPagina: document.documentElement.scrollHeight,
    paginaRola: rola,
    controlesChecados: CONTROLES.length,
    problemas,
    ok: problemas.length === 0 && !rola,
  };
  if (!silencioso) {
    console.log(r.ok ? '✔ layout ok' : '✘ layout com problema', r.viewport);
    if (problemas.length) console.table(problemas);
    if (rola) console.warn(`página rola: ${r.alturaDaPagina}px num viewport de ${innerHeight}px`);
  }
  return r;
}

/** Roda a inspeção em vários tamanhos de tela, sem redimensionar a janela de verdade. */
export function inspecionarTamanhos(tamanhos = [[1920, 1080], [1440, 900], [1366, 768], [1280, 700]]) {
  console.warn('redimensione a janela manualmente para cada tamanho; esta função só reporta o atual');
  return inspecionar();
}
