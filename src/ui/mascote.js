/**
 * O Garimpeiro — o DJ, o professor e a cara do Garimpo, numa pessoa só.
 *
 * Ele não é enfeite: é a CONSCIÊNCIA da cabine. Sente a música (lê a batida e
 * o espectro de verdade, de `estadoPista`), fala o que está fazendo e
 * ensinando (a boca mexe quando a barra do professor muda), e mostra o estado
 * das coisas sem precisar ler texto — que é o que falta pra quem está com as
 * mãos nos controles e os olhos na onda.
 *
 *   SENTE      pula no bumbo, com a altura vinda do GRAVE, e amassa como
 *              borracha; balança a cada meio compasso; bate o pé alternado
 *   CURTE      braços pra cima quando a energia sobe e no drop; na QUEBRA
 *              fecha os olhos e segura o fone; canta (boca aberta) no bumbo
 *              quando a música está cheia
 *   ACOMPANHA  olha pro deck que está tocando; pisca em intervalos
 *              irregulares, como gente
 *   AVISA      a lâmpada do capacete acende na cor do conselho mais urgente
 *              (rosa = conserta agora, verde = próximo passo, azul = pode
 *              esperar); treme quando é urgente; olhos felizes quando está
 *              tudo certo
 *   GARIMPA    cava com a picareta quando o garimpo está buscando faixas;
 *              no resto do tempo segura a bateia com as pepitas
 *   PITA       clica nele e ele acende o palheiro; clica de novo, apaga
 *
 * A cara é de garimpeiro de verdade: chapéu de palha com a lanterna presa na
 * fita, bigodão, barba por fazer, lenço vermelho, camisa xadrez, suspensório,
 * botina — e o fone de DJ no pescoço, porque ele também é o DJ.
 *
 * Desempenho: um SVG de ~50 px; por quadro, só o `transform` de 7 grupos, e
 * só quando o valor muda. Sem música e sem ninguém olhando, ele respira a 20
 * quadros por segundo.
 */

import { estadoPista as E } from './pista.js';

const SVG = `
<svg viewBox="-6 -4 92 92" class="gp-svg" aria-hidden="true">
  <defs>
    <radialGradient id="gp-pele" cx="40%" cy="35%" r="75%">
      <stop offset="0" stop-color="#f2c08a"/><stop offset=".6" stop-color="#d8955a"/><stop offset="1" stop-color="#a8622e"/>
    </radialGradient>
    <linearGradient id="gp-palha" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f3dc92"/><stop offset="1" stop-color="#c99a45"/>
    </linearGradient>
    <pattern id="gp-xadrez" width="6" height="6" patternUnits="userSpaceOnUse">
      <rect width="6" height="6" fill="#2f6d5a"/>
      <rect width="3" height="6" fill="#23574a"/>
      <rect width="6" height="2" y="2" fill="#c43b35" opacity=".55"/>
      <rect width="1" height="6" x="4" fill="#e9d38a" opacity=".45"/>
    </pattern>
    <radialGradient id="gp-luz" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="var(--gp-luz)" stop-opacity=".95"/><stop offset="1" stop-color="var(--gp-luz)" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="gp-ouro" cx="35%" cy="30%" r="70%">
      <stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#ffc629"/><stop offset="1" stop-color="#b87a08"/>
    </radialGradient>
    <radialGradient id="gp-brasa" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff2a8"/><stop offset=".45" stop-color="#ff8a1f"/><stop offset="1" stop-color="#ff3d00" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <ellipse class="gp-sombra" cx="40" cy="85" rx="20" ry="3.4" fill="#000" opacity=".35"/>

  <g class="gp-todo">
    <!-- botinas -->
    <g class="gp-pe gp-pe-e"><path d="M27 77 h9 v4 q0 2 -2 2 h-10 q-2 0 -1.5 -2 q.5 -2 4.5 -2 z" fill="#5a3314"/></g>
    <g class="gp-pe gp-pe-d"><path d="M44 77 h9 q4 0 4.5 2 q.5 2 -1.5 2 h-10 q-2 0 -2 -2 z" fill="#5a3314"/></g>
    <!-- calça jeans -->
    <rect x="28.5" y="68" width="9.5" height="10.5" rx="2" fill="#3c5d93"/>
    <rect x="42" y="68" width="9.5" height="10.5" rx="2" fill="#3c5d93"/>

    <!-- braço esquerdo, com a BATEIA e as pepitas -->
    <g class="gp-braco gp-braco-e">
      <path d="M27 53 Q19 58 16 66" stroke="url(#gp-xadrez)" stroke-width="6.5" fill="none" stroke-linecap="round"/>
      <circle cx="15.5" cy="67" r="3.4" fill="url(#gp-pele)"/>
      <g class="gp-bateia">
        <ellipse cx="12" cy="70" rx="9" ry="3.3" fill="#6b5a4a"/>
        <ellipse cx="12" cy="69" rx="7.4" ry="2.3" fill="#8d7a66"/>
        <circle cx="9.5" cy="68.6" r="1.4" fill="url(#gp-ouro)"/>
        <circle cx="13" cy="68.2" r="1.1" fill="url(#gp-ouro)"/>
        <circle cx="15.2" cy="69" r=".9" fill="url(#gp-ouro)"/>
        <path class="gp-brilho" d="M12.8 64.2 v2.6 M11.5 65.5 h2.6" stroke="#fff6c4" stroke-width=".8" stroke-linecap="round"/>
      </g>
    </g>
    <!-- braço direito, com a picareta quando garimpa -->
    <g class="gp-braco gp-braco-d">
      <path d="M53 53 Q61 58 64 66" stroke="url(#gp-xadrez)" stroke-width="6.5" fill="none" stroke-linecap="round"/>
      <circle cx="64.5" cy="67" r="3.4" fill="url(#gp-pele)"/>
      <g class="gp-picareta">
        <line x1="64.5" y1="67" x2="76" y2="48" stroke="#8a5a2b" stroke-width="2.6" stroke-linecap="round"/>
        <path d="M69 43 Q78 40 83 47 Q77 45 72.5 48 Z" fill="#aeb8c6"/>
      </g>
    </g>

    <!-- tronco: camisa xadrez, suspensório, cinto -->
    <rect x="25" y="49" width="30" height="21" rx="8" fill="url(#gp-xadrez)" stroke="#1d4538" stroke-width=".8"/>
    <path d="M31 50 L32 69 M49 50 L48 69" stroke="#4a2a12" stroke-width="2.2" stroke-linecap="round"/>
    <rect x="25.5" y="66.5" width="29" height="3.4" rx="1.2" fill="#4a2a12"/>
    <rect x="37.5" y="66.2" width="5" height="4" rx=".8" fill="url(#gp-ouro)"/>
    <!-- lenço no pescoço -->
    <path d="M33 49.5 L47 49.5 L40 57 Z" fill="#d8322d" stroke="#9e1f1b" stroke-width=".6"/>

    <!-- fone de DJ no pescoço -->
    <g class="gp-fone">
      <path d="M28 50 Q40 58.5 52 50" stroke="#211838" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <rect x="25.6" y="47.2" width="5" height="6.6" rx="2.2" fill="#2a1f44" stroke="var(--gp-neon)" stroke-width=".9"/>
      <rect x="49.4" y="47.2" width="5" height="6.6" rx="2.2" fill="#2a1f44" stroke="var(--gp-neon)" stroke-width=".9"/>
    </g>

    <!-- cabeça -->
    <ellipse cx="25.5" cy="37" rx="2.6" ry="3.4" fill="#c7824a"/>
    <ellipse cx="54.5" cy="37" rx="2.6" ry="3.4" fill="#c7824a"/>
    <ellipse cx="40" cy="36.5" rx="14.5" ry="14" fill="url(#gp-pele)"/>
    <!-- barba por fazer -->
    <path d="M28 41 Q30 50 40 51 Q50 50 52 41 Q48 47 40 47.5 Q32 47 28 41 Z" fill="#6b4226" opacity=".28"/>

    <g class="gp-rosto">
      <!-- sobrancelhas grossas -->
      <path d="M30.5 30.2 Q34 28.4 37.2 30" stroke="#3b2210" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path d="M42.8 30 Q46 28.4 49.5 30.2" stroke="#3b2210" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <g class="gp-olhos">
        <ellipse cx="34" cy="34.5" rx="3.3" ry="3.7" fill="#fff"/>
        <ellipse cx="46" cy="34.5" rx="3.3" ry="3.7" fill="#fff"/>
        <g class="gp-iris">
          <circle cx="34.3" cy="35" r="2.2" fill="#3a2414"/>
          <circle cx="46.3" cy="35" r="2.2" fill="#3a2414"/>
          <circle cx="35.2" cy="34" r=".8" fill="#fff"/><circle cx="47.2" cy="34" r=".8" fill="#fff"/>
        </g>
      </g>
      <g class="gp-fechados" display="none">
        <path d="M30.8 35 Q34 37.6 37.2 35" stroke="#3b2210" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        <path d="M42.8 35 Q46 37.6 49.2 35" stroke="#3b2210" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      </g>
      <g class="gp-felizes" display="none">
        <path d="M30.8 36 Q34 32.4 37.2 36" stroke="#3b2210" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        <path d="M42.8 36 Q46 32.4 49.2 36" stroke="#3b2210" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      </g>
      <!-- bochechas, nariz -->
      <ellipse cx="29.5" cy="40.5" rx="2.6" ry="1.6" fill="#ff7a6a" opacity=".35"/>
      <ellipse cx="50.5" cy="40.5" rx="2.6" ry="1.6" fill="#ff7a6a" opacity=".35"/>
      <ellipse cx="40" cy="39.6" rx="2.7" ry="2.3" fill="#c9784a"/>
      <!-- boca (embaixo do bigode) -->
      <path class="gp-sorriso" d="M36.5 46.2 Q40 48.4 43.5 46.2" stroke="#5a2410" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <g class="gp-canta" display="none">
        <ellipse cx="40" cy="46.8" rx="2.6" ry="2.4" fill="#4a1a0c"/>
        <ellipse cx="40" cy="48" rx="1.5" ry=".9" fill="#ff7a8a"/>
      </g>
      <!-- o BIGODÃO -->
      <path d="M40 42.4 Q36 41.2 32.5 43 Q30 44.2 28.6 43.2 Q29.4 46.4 33.4 46 Q37.2 45.6 40 44.2 Q42.8 45.6 46.6 46 Q50.6 46.4 51.4 43.2 Q50 44.2 47.5 43 Q44 41.2 40 42.4 Z"
            fill="#3b2210"/>
      <!-- o palheiro: aceso no clique -->
      <g class="gp-palheiro">
        <path d="M43.6 46.6 L52.4 48.6" stroke="#e8d48a" stroke-width="1.9" stroke-linecap="round"/>
        <path d="M45 46.9 L46 47.1 M48 47.6 L49 47.8" stroke="#b89a52" stroke-width="1.9"/>
        <circle class="gp-brasa-luz" cx="53" cy="48.8" r="3.2" fill="url(#gp-brasa)"/>
        <circle class="gp-brasa" cx="52.9" cy="48.7" r="1.1" fill="#ff7a1a"/>
        <g class="gp-fumaca">
          <circle cx="54" cy="45.5" r="1.6" fill="#d9d4e8"/>
          <circle cx="54" cy="45.5" r="1.9" fill="#d9d4e8"/>
          <circle cx="54" cy="45.5" r="1.4" fill="#d9d4e8"/>
        </g>
      </g>
    </g>

    <!-- chapéu de palha, com a lanterna presa na fita (a luz que avisa) -->
    <path d="M26 25 Q26 11 40 10 Q54 11 54 25 Z" fill="url(#gp-palha)" stroke="#a67c32" stroke-width=".8"/>
    <path d="M28.5 22 Q40 19 51.5 22" stroke="#b58a3c" stroke-width=".8" fill="none" opacity=".7"/>
    <path d="M30 15.5 Q40 13 50 15.5" stroke="#b58a3c" stroke-width=".7" fill="none" opacity=".6"/>
    <rect x="26" y="21.2" width="28" height="3.8" fill="#5a3314"/>
    <ellipse cx="40" cy="25.4" rx="26" ry="4.6" fill="url(#gp-palha)" stroke="#a67c32" stroke-width=".8"/>
    <ellipse cx="40" cy="24.8" rx="21" ry="2.6" fill="#c99a45" opacity=".55"/>
    <circle class="gp-halo" cx="40" cy="22.6" r="10" fill="url(#gp-luz)"/>
    <rect x="36.2" y="19.8" width="7.6" height="5.8" rx="1.8" fill="#3a2a18"/>
    <circle cx="40" cy="22.7" r="2.5" fill="#fff8d6"/>
    <circle class="gp-lampada" cx="40" cy="22.7" r="1.7" fill="var(--gp-luz)"/>
  </g>
</svg>`;

const CSS = `
.gp { --gp-luz:#2ee6a8; --gp-neon:#4cc9f0; width:52px; height:52px; flex:none; position:relative; cursor:pointer; }
.gp-svg { width:100%; height:100%; overflow:visible; }
.gp-svg g { transform-box: view-box; }
.gp .gp-todo { transform-origin: 40px 84px; }
.gp .gp-braco-e { transform-origin: 27px 53px; }
.gp .gp-braco-d { transform-origin: 53px 53px; }
.gp .gp-pe-e { transform-origin: 31px 80px; }
.gp .gp-pe-d { transform-origin: 49px 80px; }
.gp .gp-olhos { transform-origin: 40px 34.5px; }
.gp .gp-picareta { display:none; }
.gp.cavando .gp-picareta { display:inline; }
.gp.cavando .gp-bateia { display:none; }
.gp .gp-halo { opacity:.75; }
.gp.urgente .gp-halo { opacity:1; }
.gp .gp-brilho { transform-origin: 12.8px 65.5px; animation: gp-brilho 2.6s ease-in-out infinite; }
@keyframes gp-brilho { 0%, 70%, 100% { opacity:0; transform:scale(.4); } 82% { opacity:1; transform:scale(1.2); } }
/* o palheiro: apagado some; aceso, a brasa respira e a fumaça sobe */
.gp .gp-palheiro { display:none; }
.gp.fumando .gp-palheiro { display:inline; }
.gp .gp-brasa-luz { transform-origin: 53px 48.8px; animation: gp-brasa 2.2s ease-in-out infinite; }
@keyframes gp-brasa { 0%, 100% { opacity:.55; transform:scale(.8); } 45% { opacity:1; transform:scale(1.25); } }
.gp .gp-fumaca circle { transform-origin: 54px 45.5px; opacity:0; animation: gp-fumaca 3.3s linear infinite; }
.gp .gp-fumaca circle:nth-child(2) { animation-delay: 1.1s; }
.gp .gp-fumaca circle:nth-child(3) { animation-delay: 2.2s; }
@keyframes gp-fumaca {
  0% { opacity:0; transform: translate(0,0) scale(.6); }
  15% { opacity:.75; }
  100% { opacity:0; transform: translate(6px,-22px) scale(2.6); }
}
@media (prefers-reduced-motion: reduce) {
  .gp .gp-fumaca circle, .gp .gp-brasa-luz, .gp .gp-brilho { animation:none; }
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
  box.title = 'o Garimpeiro — clica pra acender o palheiro';
  el.prepend(box);
  /**
   * O PALHEIRO: clicou, ele acende o cigarro de palha (a brasa respira, a
   * fumaça sobe); clicou de novo, apaga. Fica lembrado neste navegador. É só
   * dele — não mexe em nada da cabine, e o clique não passa pra frente.
   */
  const fumar = (on) => {
    box.classList.toggle('fumando', on);
    try { localStorage.setItem('garimpo.palheiro', on ? '1' : '0'); } catch {}
  };
  try { box.classList.toggle('fumando', localStorage.getItem('garimpo.palheiro') === '1'); } catch {}
  box.addEventListener('click', (e) => { e.stopPropagation(); fumar(!box.classList.contains('fumando')); });

  const q = (s) => box.querySelector(s);
  const partes = {
    todo: q('.gp-todo'), bracoE: q('.gp-braco-e'), bracoD: q('.gp-braco-d'),
    peE: q('.gp-pe-e'), peD: q('.gp-pe-d'), olhos: q('.gp-olhos'), iris: q('.gp-iris'),
  };
  const rostos = { olhos: q('.gp-olhos'), fechados: q('.gp-fechados'), felizes: q('.gp-felizes') };
  const bocas = { sorriso: q('.gp-sorriso'), canta: q('.gp-canta') };
  const antes = {};
  const por = (nome, tr) => { if (antes[nome] !== tr) { antes[nome] = tr; partes[nome].style.transform = tr; } };
  let rostoAntes = '', bocaAntes = '';
  const rosto = (r) => {
    if (r === rostoAntes) return;
    rostoAntes = r;
    for (const k in rostos) rostos[k].setAttribute('display', k === r ? 'inline' : 'none');
  };
  const boca = (b) => {
    if (b === bocaAntes) return;
    bocaAntes = b;
    for (const k in bocas) bocas[k].setAttribute('display', k === b ? 'inline' : 'none');
  };

  let bpmManual = 0, cor = 'agora', urgente = false, feliz = false, cavando = false;
  let falaAte = 0, festaAte = 0, piscaEm = performance.now() + 2500, olhar = 0;
  let visivel = true;
  new IntersectionObserver((es) => { visivel = es[0]?.isIntersecting ?? true; }).observe(box);
  const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tAntes = 0;

  function quadro(agora) {
    requestAnimationFrame(quadro);
    if (!visivel || document.hidden || !box.isConnected) return;
    const tocando = E.tocando;
    if (!tocando && !cavando && agora - tAntes < 50) return;    // parado: 20 fps
    if (reduzido && agora - tAntes < 400) return;
    tAntes = agora;

    // o relógio: a batida real quando a música toca; um andamento de mentira
    // na porta (bpmManual); senão, só a respiração
    const bat = tocando ? E.batida : bpmManual ? (agora / 1000) * (bpmManual / 60) : (agora / 1000) * 0.4;
    const f = ((bat % 1) + 1) % 1;
    const vivo = tocando || !!bpmManual;
    const pulso = vivo && !reduzido ? Math.exp(-f * 5) : 0;
    const grave = tocando ? E.grave : bpmManual ? 0.5 : 0;
    const energia = tocando ? E.energia : bpmManual ? 0.45 : 0;
    const quebra = tocando && E.quebra;
    const festa = agora < festaAte;
    const drop = festa ? 1 : tocando ? E.dropV : 0;
    const noUm = (((Math.floor(bat) % 4) + 4) % 4) === 0;

    // corpo: pula no bumbo e amassa; balança a cada meio compasso; respira parado
    let dy, rot, sx, sy;
    if (reduzido) { dy = 0; rot = 0; sx = sy = 1; }
    else if (vivo && !quebra) {
      const pulo = pulso * (2 + grave * 5) * (noUm ? 1.3 : 1) * (1 + drop);
      dy = -pulo;
      rot = Math.sin(bat * Math.PI / 2) * (3 + energia * 6);
      sx = 1 + pulso * 0.05; sy = 1 - pulso * 0.07;
    } else if (quebra) {
      dy = Math.sin(bat * Math.PI / 4) * 1.2; rot = Math.sin(bat * Math.PI / 4) * 5; sx = sy = 1;
    } else {
      const r = Math.sin(agora / 1000 * 1.9);
      dy = r * 0.8; rot = 0; sx = 1 + r * 0.01; sy = 1 - r * 0.01;
    }
    if (urgente && !reduzido) rot += Math.sin(agora / 40) * 2.5;
    por('todo', `translateY(${dy.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${sx.toFixed(3)},${sy.toFixed(3)})`);

    // braços: cavando > quebra (mãos no fone) > pra cima (energia/drop) > balançando
    let be, bd;
    if (cavando) { be = 20; bd = -60 + Math.sin(agora / 90) * 45; }
    else if (quebra) { be = 150; bd = -150; }
    else if (vivo && (energia > 0.62 || drop > 0.3)) {
      const acena = Math.sin(bat * Math.PI) * 18;
      be = 125 + acena; bd = -125 + acena;
    } else if (vivo) {
      const s = Math.sin(bat * Math.PI) * 14;
      be = 10 + s + pulso * 10; bd = -10 + s - pulso * 10;
    } else { be = 4; bd = -4; }
    if (reduzido) { be = 4; bd = -4; }
    por('bracoE', `rotate(${be.toFixed(0)}deg)`);
    por('bracoD', `rotate(${bd.toFixed(0)}deg)`);

    // pés: batem alternados, um em cada tempo
    const par = (Math.floor(bat) & 1) === 0;
    por('peE', `translateY(${(vivo && !quebra && par ? -pulso * 2.5 : 0).toFixed(1)}px)`);
    por('peD', `translateY(${(vivo && !quebra && !par ? -pulso * 2.5 : 0).toFixed(1)}px)`);

    // olhos: olham pro deck no ar; piscam em intervalo irregular
    const alvo = E.tocando ? (document.querySelector('.deck.no-ar')?.dataset.d === 'B' ? 1.3 : -1.3) : Math.sin(agora / 2600) * 1.2;
    olhar += (alvo - olhar) * 0.08;
    por('iris', `translate(${olhar.toFixed(1)}px, ${urgente ? -0.6 : 0}px)`);
    let pisca = 1;
    if (agora > piscaEm) {
      pisca = 0.1;
      if (agora > piscaEm + 120) piscaEm = agora + 2200 + Math.random() * 3800;
    }
    por('olhos', `scaleY(${urgente ? 1.12 : pisca})`);

    // cara: curtindo de olho fechado na quebra e no estilo hipnótico no bumbo;
    // feliz quando está tudo certo e nada toca; senão, olho aberto
    if (quebra || (tocando && E.estilo === 'hipnotico' && pulso > 0.6)) rosto('fechados');
    else if (festa || (feliz && !tocando)) rosto('felizes');
    else rosto('olhos');

    // boca: fala quando o professor fala; canta no bumbo com a música cheia
    const falando = agora < falaAte && Math.sin(agora / 70) > 0;
    boca(falando || (vivo && energia > 0.55 && pulso > 0.55) || drop > 0.4 ? 'canta' : 'sorriso');
  }
  requestAnimationFrame(quadro);

  return {
    /** A cor do conselho mais urgente: 'urgente' | 'agora' | 'depois' | null (tudo certo). */
    humor(c) {
      if (c === cor && feliz === !c) return;
      cor = c;
      box.style.setProperty('--gp-luz', COR[c] || COR.agora);
      urgente = c === 'urgente';
      feliz = !c;
      box.classList.toggle('urgente', urgente);
    },
    /** Andamento pra dançar sem música tocando (ex.: na porta). 0 = só respira. */
    batida(bpm) {
      // com música de verdade ele lê a grade; isto é só pra quando não há
      if (E.tocando) return;
      bpmManual = bpm > 40 && bpm < 220 ? bpm : 0;
    },
    cavando(on) { cavando = !!on; box.classList.toggle('cavando', cavando); },
    /** Ele falou (a barra do professor mudou): a boca mexe por um instante. */
    fala(ms = 1400) { falaAte = performance.now() + ms; },
    /** Você acertou um gesto: ele pula de braço pra cima por um instante. */
    comemora(ms = 1600) { festaAte = performance.now() + ms; falaAte = festaAte; },
    /** A cor do fone: a do deck no ar. */
    neon(corNeon) { box.style.setProperty('--gp-neon', corNeon); },
  };
}
