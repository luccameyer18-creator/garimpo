/**
 * O Garimpeiro — o mascote do professor.
 *
 * Uma bolinha de capacete de mineiro e fone de DJ. Não é enfeite solto: ele
 * mostra o estado do professor sem precisar ler texto, que é o que falta pra
 * quem está com as mãos nos controles e os olhos na onda.
 *
 *   a LÂMPADA do capacete acende na cor do conselho mais urgente
 *     (rosa = conserta agora, verde = próximo passo, azul = pode esperar)
 *   ele BALANÇA no andamento da música que está tocando — no BPM de verdade
 *   CAVA com a picareta quando o garimpo está buscando faixas
 *   fica FELIZ (olhos em arco) quando não há nada pra corrigir
 *   PISCA de vez em quando, porque um rosto que não pisca parece congelado
 *
 * SVG puro + CSS: zero imagem pra baixar, escala em qualquer tela, e as cores
 * vêm das mesmas variáveis do resto da interface.
 */

const SVG = `
<svg viewBox="0 0 64 64" class="gp-svg" aria-hidden="true">
  <defs>
    <radialGradient id="gp-corpo" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#ffd27a"/>
      <stop offset="0.6" stop-color="#e8a33d"/>
      <stop offset="1" stop-color="#b8741c"/>
    </radialGradient>
    <radialGradient id="gp-luz" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="var(--gp-luz)" stop-opacity=".9"/>
      <stop offset="1" stop-color="var(--gp-luz)" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- picareta: só aparece cavando -->
  <g class="gp-picareta">
    <line x1="50" y1="46" x2="60" y2="30" stroke="#8a5a2b" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M53 26 Q60 24 64 30 Q59 28 55 30 Z" fill="#9aa4b2"/>
  </g>

  <!-- pezinhos -->
  <ellipse cx="24" cy="58" rx="6" ry="3" fill="#7a4a1a"/>
  <ellipse cx="40" cy="58" rx="6" ry="3" fill="#7a4a1a"/>

  <!-- corpo-bolinha -->
  <circle cx="32" cy="38" r="19" fill="url(#gp-corpo)"/>
  <ellipse cx="25" cy="30" rx="6" ry="3.5" fill="#fff" opacity=".25"/>

  <!-- olhos -->
  <g class="gp-olhos">
    <ellipse class="gp-olho" cx="25.5" cy="38" rx="3" ry="3.8" fill="#2a1a0a"/>
    <ellipse class="gp-olho" cx="38.5" cy="38" rx="3" ry="3.8" fill="#2a1a0a"/>
    <circle cx="26.5" cy="36.6" r="1" fill="#fff"/>
    <circle cx="39.5" cy="36.6" r="1" fill="#fff"/>
  </g>
  <!-- olhos felizes (^ ^) -->
  <g class="gp-feliz">
    <path d="M22.5 39 Q25.5 35 28.5 39" stroke="#2a1a0a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M35.5 39 Q38.5 35 41.5 39" stroke="#2a1a0a" stroke-width="2" fill="none" stroke-linecap="round"/>
  </g>
  <!-- boca -->
  <path class="gp-boca" d="M28 46 Q32 49 36 46" stroke="#5a300a" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  <!-- bochechas -->
  <circle cx="20" cy="44" r="2.4" fill="#ff7a8a" opacity=".45"/>
  <circle cx="44" cy="44" r="2.4" fill="#ff7a8a" opacity=".45"/>

  <!-- capacete de mineiro -->
  <path d="M13 26 Q32 4 51 26 Z" fill="#f2c230"/>
  <rect x="11" y="24" width="42" height="4" rx="2" fill="#d9a91a"/>
  <!-- lâmpada do capacete: a cor do conselho -->
  <circle class="gp-halo" cx="32" cy="15" r="11" fill="url(#gp-luz)"/>
  <circle cx="32" cy="15" r="4.2" fill="#fff8d6" stroke="#b8860b" stroke-width="1.2"/>
  <circle class="gp-lampada" cx="32" cy="15" r="2.6" fill="var(--gp-luz)"/>

  <!-- fone de DJ por cima do capacete -->
  <path d="M10 30 Q10 8 32 8 Q54 8 54 30" stroke="#1d1530" stroke-width="3" fill="none"/>
  <rect x="5" y="28" width="9" height="13" rx="4" fill="#2a1f44" stroke="#4cc9f0" stroke-width="1"/>
  <rect x="50" y="28" width="9" height="13" rx="4" fill="#2a1f44" stroke="#4cc9f0" stroke-width="1"/>
</svg>`;

const CSS = `
.gp { --gp-luz: #2ee6a8; --gp-dur: 0.48s; width:44px; height:44px; flex:none; position:relative; }
.gp-svg { width:100%; height:100%; overflow:visible; transform-origin:50% 90%; }
.gp .gp-feliz, .gp .gp-picareta { display:none; }
.gp.feliz .gp-feliz { display:inline; }
.gp.feliz .gp-olhos { display:none; }
.gp.cavando .gp-picareta { display:inline; transform-origin:50px 46px; animation: gp-cava .5s ease-in-out infinite; }

/* respira devagar quando nada toca */
.gp .gp-svg { animation: gp-respira 3.2s ease-in-out infinite; }
/* balança NO ANDAMENTO: a duração da animação é um tempo da música */
.gp.dancando .gp-svg { animation: gp-balanca calc(var(--gp-dur) * 2) ease-in-out infinite; }
/* urgente: tremidinha e olhos arregalados */
.gp.urgente .gp-svg { animation: gp-treme .35s ease-in-out infinite; }
.gp.urgente .gp-olho { ry: 4.6; }
.gp .gp-halo { animation: gp-pulsa 1.6s ease-in-out infinite; }
/* pisca */
.gp .gp-olho { transform-box: fill-box; transform-origin: center; animation: gp-pisca 4.8s infinite; }

@keyframes gp-respira { 0%,100% { transform: translateY(0) scale(1,1) } 50% { transform: translateY(-1.5px) scale(1.02,.98) } }
@keyframes gp-balanca { 0%,100% { transform: rotate(-7deg) translateY(0) } 25% { transform: rotate(0) translateY(-3px) }
                        50% { transform: rotate(7deg) translateY(0) } 75% { transform: rotate(0) translateY(-3px) } }
@keyframes gp-treme { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-1.5px) } 75% { transform: translateX(1.5px) } }
@keyframes gp-pulsa { 0%,100% { opacity:.55 } 50% { opacity:1 } }
@keyframes gp-pisca { 0%,93%,100% { transform: scaleY(1) } 95% { transform: scaleY(.1) } }
@keyframes gp-cava { 0%,100% { transform: rotate(0) } 50% { transform: rotate(-35deg) } }
@media (prefers-reduced-motion: reduce) {
  .gp .gp-svg, .gp .gp-halo, .gp .gp-olho, .gp.cavando .gp-picareta { animation: none !important; }
}
`;

const COR = { urgente: '#ff4ecd', agora: '#2ee6a8', depois: '#4cc9f0' };

/** Monta o mascote dentro de `el`. Devolve o controle dele. */
export function montarMascote(el) {
  if (!document.getElementById('gp-css')) {
    const st = document.createElement('style');
    st.id = 'gp-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  const box = document.createElement('div');
  box.className = 'gp';
  box.innerHTML = SVG;
  box.title = 'o Garimpeiro';
  el.prepend(box);

  let bpmAtual = 0;
  return {
    /** A cor do conselho mais urgente: 'urgente' | 'agora' | 'depois' | null (tudo certo). */
    humor(cor) {
      box.style.setProperty('--gp-luz', COR[cor] || COR.agora);
      box.classList.toggle('urgente', cor === 'urgente');
      box.classList.toggle('feliz', !cor);
    },
    /** Balança no andamento; 0 ou null = parado. */
    batida(bpm) {
      const b = bpm > 40 && bpm < 220 ? Math.round(bpm) : 0;
      if (b === bpmAtual) return;
      bpmAtual = b;
      box.classList.toggle('dancando', !!b);
      if (b) box.style.setProperty('--gp-dur', (60 / b).toFixed(3) + 's');
    },
    cavando(on) { box.classList.toggle('cavando', !!on); },
  };
}
