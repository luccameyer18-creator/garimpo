/**
 * O GUIA DA PRIMEIRA VEZ: o Garimpeiro acende uma parte da cabine por vez e
 * diz pra que serve — o botão do DJ, as músicas, os decks, o mixer. Aparece
 * sozinho só na primeira entrada; depois, só se a pessoa pedir (no "?").
 *
 * Um holofote (um buraco numa cortina escura) em cima do controle de verdade,
 * e um cartão do lado. Passo cujo controle não está na tela (celular, painel
 * minimizado) é pulado, em vez de apontar pro nada.
 *
 * Desempenho: o holofote anda só por transform; largura e altura mudam sem
 * transição. Nada de blur (ver a regra das animações).
 */
import { t } from './i18n.js';

const CHAVE = 'garimpo.guia.visto';

/** Os passos: o que acender (o primeiro que estiver visível) e a chave do texto. */
const PASSOS = [
  { alvo: null, k: 'oi' },
  { alvo: ['#b-piloto'], k: 'dj' },
  { alvo: ['#dj-modos'], k: 'modos' },
  { alvo: ['.dj-painel .piloto-op', '#b-prefs'], k: 'opcoes' },
  { alvo: ['#aba-A', '#deckA .browse'], k: 'musicas' },
  { alvo: ['#deckA'], k: 'deck' },
  { alvo: ['.mixer'], k: 'mixer' },
  { alvo: ['#pads'], k: 'sons' },
  { alvo: ['#prof'], k: 'prof' },
  { alvo: ['.cena-pista', '.cena-viagem'], k: 'efeitos' },
  { alvo: ['#b-ajuda'], k: 'fim' },
];

export const guiaVisto = () => { try { return localStorage.getItem(CHAVE) === '1'; } catch { return true; } };
const marcarVisto = () => { try { localStorage.setItem(CHAVE, '1'); } catch {} };

function visivel(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
}
const achar = (sels) => (sels || []).map((s) => document.querySelector(s)).find(visivel) || null;

/**
 * Abre o guia. `antes()` roda ao começar (fecha a gaveta, por exemplo);
 * `depois(terminou)` roda ao sair — terminou = foi até o fim, não pulou.
 */
export function abrirGuia({ antes = () => {}, depois = () => {} } = {}) {
  if (document.getElementById('guia')) return;
  antes();
  const passos = PASSOS.filter((p) => !p.alvo || achar(p.alvo));
  let i = 0;

  const raiz = document.createElement('div');
  raiz.id = 'guia';
  raiz.setAttribute('role', 'dialog');
  raiz.setAttribute('aria-modal', 'true');
  raiz.innerHTML = `
    <div class="guia-luz"></div>
    <div class="guia-cartao" aria-live="polite">
      <div class="guia-quem"><span class="guia-ic" aria-hidden="true">⛏</span><b>Garimpeiro</b><span class="guia-n"></span></div>
      <h3 class="guia-tit"></h3>
      <p class="guia-txt"></p>
      <div class="guia-pontos" aria-hidden="true"></div>
      <div class="guia-bts">
        <button class="guia-pular"></button>
        <span></span>
        <button class="guia-voltar"></button>
        <button class="guia-ir"></button>
      </div>
    </div>`;
  document.body.appendChild(raiz);
  const $ = (s) => raiz.querySelector(s);
  $('.guia-pontos').innerHTML = passos.map(() => '<i></i>').join('');

  function posicionar() {
    const p = passos[i];
    const el = p.alvo ? achar(p.alvo) : null;
    const luz = $('.guia-luz'), cartao = $('.guia-cartao');
    raiz.classList.toggle('sem-alvo', !el);
    if (el) {
      const r = el.getBoundingClientRect(), m = 6;
      luz.style.width = r.width + m * 2 + 'px';
      luz.style.height = r.height + m * 2 + 'px';
      luz.style.transform = `translate(${r.left - m}px, ${r.top - m}px)`;
      // o cartão: embaixo se couber, senão em cima, senão ao lado; sempre dentro da tela
      const cw = cartao.offsetWidth, ch = cartao.offsetHeight, g = 14;
      let x = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), innerWidth - cw - 12);
      let y;
      if (r.bottom + g + ch < innerHeight - 8) y = r.bottom + g;
      else if (r.top - g - ch > 8) y = r.top - g - ch;
      else {
        y = Math.min(Math.max(8, r.top + r.height / 2 - ch / 2), innerHeight - ch - 8);
        x = r.right + g + cw < innerWidth - 8 ? r.right + g : Math.max(12, r.left - g - cw);
      }
      cartao.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    } else {
      luz.style.transform = `translate(${innerWidth / 2}px, ${innerHeight / 2}px)`;
      luz.style.width = luz.style.height = '0px';
      cartao.style.transform = `translate(${Math.round((innerWidth - cartao.offsetWidth) / 2)}px, ${Math.round((innerHeight - cartao.offsetHeight) / 2)}px)`;
    }
  }

  function mostrar() {
    const p = passos[i];
    const ultimo = i === passos.length - 1;
    $('.guia-tit').textContent = t(`guia.${p.k}.tit`);
    $('.guia-txt').innerHTML = t(`guia.${p.k}.txt`);
    $('.guia-n').textContent = `${i + 1}/${passos.length}`;
    $('.guia-pular').textContent = t('guia.pular');
    $('.guia-pular').hidden = ultimo;
    $('.guia-voltar').textContent = t('guia.voltar');
    $('.guia-voltar').hidden = i === 0;
    $('.guia-ir').textContent = t(i === 0 ? 'guia.bora' : ultimo ? 'guia.fim' : 'guia.proximo');
    raiz.querySelectorAll('.guia-pontos i').forEach((b, k) => b.classList.toggle('lig', k === i));
    // o texto muda o tamanho do cartão: posiciona depois de medir
    const c = $('.guia-cartao');
    c.classList.remove('entra'); void c.offsetWidth; c.classList.add('entra');
    posicionar();
    $('.guia-ir').focus({ preventScroll: true });
  }

  function sair(terminou) {
    marcarVisto();
    removeEventListener('resize', posicionar);
    document.removeEventListener('keydown', tecla, true);
    raiz.remove();
    depois(terminou);
  }
  const ir = (d) => {
    if (i + d >= passos.length) return sair(true);
    i = Math.max(0, i + d);
    mostrar();
  };
  function tecla(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sair(false); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ir(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); ir(-1); }
    // as teclas do app (pads 1–8, espaço…) não disparam por baixo do guia
    else e.stopPropagation();
  }

  $('.guia-ir').onclick = () => ir(1);
  $('.guia-voltar').onclick = () => ir(-1);
  $('.guia-pular').onclick = () => sair(false);
  // clicar na cortina não faz nada: fechar sem querer no primeiro minuto é pior
  raiz.addEventListener('pointerdown', (e) => e.stopPropagation());
  addEventListener('resize', posicionar);
  document.addEventListener('keydown', tecla, true);
  mostrar();
}
