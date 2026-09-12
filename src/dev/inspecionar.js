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
     '.bpm-val', '.pos', '.faixa-sel', '.auto'].map((c) => `#deck${d} ${c}`)),
  '#xf', '#master', '#fase', '#lista', '#b-compat', '#busca',
  '#prof-plano', '#b-ajuda', '#b-diag', '#b-arquivo',
  '#b-encaixar', '#crates', '#saida-fone', '#b-piloto', '#pref-min', '#pref-energia', '#b-prefs', '#idioma',
  ...['A', 'B'].flatMap((d) => [`#fone-${d}`, `#vol-${d}`, `#fino-menos-${d}`, `#fino-mais-${d}`]),
  ...['A', 'B'].flatMap((d) =>
    ['grave', 'medio', 'agudo'].flatMap((b) => [`#eq-${d}-${b}`, `#kill-${d}-${b}`])),
];

/** Algum ancestral rola e consegue trazer este elemento pra vista? */
function emContainerRolavel(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p);
    const rola = /(auto|scroll)/.test(o.overflowY) || /(auto|scroll)/.test(o.overflow);
    if (rola && p.scrollHeight > p.clientHeight + 1) return true;
  }
  return false;
}

function avaliar(sel, rolagemProposital) {
  const el = document.querySelector(sel);
  if (!el) return { sel, problema: 'NÃO EXISTE' };
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) {
    return { sel, problema: 'tamanho zero', medida: `${r.width | 0}x${r.height | 0}` };
  }
  /**
   * "Abaixo da dobra" so e defeito quando a pagina NAO deveria rolar.
   *
   * No layout largo, tudo cabe numa tela e sair dela e bug. Em telas estreitas
   * a pagina rola de proposito, e ai medir contra a altura da JANELA acusava 40
   * controles de uma vez, afogando os dois achados de verdade. Contra a altura
   * do DOCUMENTO, "cortado" volta a significar cortado.
   */
  const limite = rolagemProposital ? document.documentElement.scrollHeight : innerHeight;
  const topo = rolagemProposital ? r.top + scrollY : r.top;
  const base = rolagemProposital ? r.bottom + scrollY : r.bottom;
  // fora da janela mas DENTRO de um painel que rola = alcançável, não cortado.
  // Sem isto, dar overflow-y:auto numa coluna fazia o inspetor acusar tudo que
  // estivesse abaixo da dobra dela — inclusive o que o usuário alcança rolando.
  if (!emContainerRolavel(el) && base > limite + 1) {
    return { sel, problema: 'cortado embaixo', fora: Math.round(base - limite) };
  }
  if (!emContainerRolavel(el) && topo < -1) {
    return { sel, problema: 'cortado em cima', fora: Math.round(-topo) };
  }
  if (r.right > innerWidth + 1) return { sel, problema: 'cortado à direita', fora: Math.round(r.right - innerWidth) };
  if (r.left < -1) return { sel, problema: 'cortado à esquerda', fora: Math.round(-r.left) };

  // o centro do elemento pertence mesmo a ele, ou tem algo por cima?
  // cobertura so da pra testar no que esta na janela agora
  const naJanela = r.top >= 0 && r.bottom <= innerHeight;
  const alvo = naJanela ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  if (alvo && alvo !== el && !el.contains(alvo) && !alvo.contains(el)) {
    return { sel, problema: 'coberto', por: (alvo.id || alvo.className || alvo.tagName).toString().slice(0, 28) };
  }

  // alvo de toque pequeno demais para dedo
  // Alvo pequeno so e problema em DEDO. Num mouse, um slider de 16px de altura
  // e o controle nativo e acerta de primeira — acusar isso enchia o relatorio
  // de 13 falsos positivos e escondia os achados de verdade.
  // Os botoes auxiliares (ms, FONE, AUTO, kill) sao pequenos de proposito: o
  // alvo grande deles e o anel do jog e a tira do mixer.
  const dedo = matchMedia('(pointer: coarse)').matches;
  const auxiliar = el.matches('.fino, .fone, .auto, .mini-b, .kill');
  if (dedo && !auxiliar && el.matches('button, input[type=range]') && (r.height < 22 || r.width < 22)) {
    return { sel, problema: 'alvo de toque pequeno', medida: `${r.width | 0}x${r.height | 0}` };
  }
  return null;
}

export function inspecionar({ silencioso = false } = {}) {
  // abaixo de 1040px o layout empilha e a pagina rola de proposito
  const rolagemProposital = innerWidth <= 1040;
  const problemas = CONTROLES.map((c) => avaliar(c, rolagemProposital)).filter(Boolean);
  const rola = !rolagemProposital && document.documentElement.scrollHeight > innerHeight + 2;
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
