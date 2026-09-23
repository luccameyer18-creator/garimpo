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
 *   GARIMPA    cava com a picareta quando o garimpo está buscando faixas
 *
 * Desempenho: um SVG de ~50 px; por quadro, só o `transform` de 7 grupos, e
 * só quando o valor muda. Sem música e sem ninguém olhando, ele respira a 20
 * quadros por segundo.
 */

import { estadoPista as E } from './pista.js';

const SVG = `
<svg viewBox="-6 -4 92 92" class="gp-svg" aria-hidden="true">
  <defs>
    <radialGradient id="gp-c" cx="36%" cy="30%" r="78%">
      <stop offset="0" stop-color="#ffe7a8"/><stop offset=".5" stop-color="#f6b64c"/><stop offset="1" stop-color="#c26f1c"/>
    </radialGradient>
    <linearGradient id="gp-cap" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe56e"/><stop offset="1" stop-color="#dea216"/>
    </linearGradient>
    <radialGradient id="gp-luz" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="var(--gp-luz)" stop-opacity=".95"/><stop offset="1" stop-color="var(--gp-luz)" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="gp-iris" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#5a3aa8"/><stop offset="1" stop-color="#1c0f33"/>
    </radialGradient>
  </defs>

  <ellipse class="gp-sombra" cx="40" cy="85" rx="19" ry="3.4" fill="#000" opacity=".35"/>

  <g class="gp-todo">
    <g class="gp-pe gp-pe-e"><ellipse cx="30" cy="80" rx="7.5" ry="4" fill="#8a4a14"/></g>
    <g class="gp-pe gp-pe-d"><ellipse cx="50" cy="80" rx="7.5" ry="4" fill="#8a4a14"/></g>

    <g class="gp-braco gp-braco-e">
      <path d="M19 55 Q11 61 11 69" stroke="#d98a2a" stroke-width="6.5" fill="none" stroke-linecap="round"/>
      <circle cx="11" cy="69" r="4.4" fill="#f6b64c" stroke="#c26f1c" stroke-width=".8"/>
    </g>
    <g class="gp-braco gp-braco-d">
      <path d="M61 55 Q69 61 69 69" stroke="#d98a2a" stroke-width="6.5" fill="none" stroke-linecap="round"/>
      <circle cx="69" cy="69" r="4.4" fill="#f6b64c" stroke="#c26f1c" stroke-width=".8"/>
      <g class="gp-picareta">
        <line x1="69" y1="69" x2="80" y2="50" stroke="#8a5a2b" stroke-width="2.6" stroke-linecap="round"/>
        <path d="M73 45 Q81 42 86 49 Q80 47 76 50 Z" fill="#aeb8c6"/>
      </g>
    </g>

    <!-- o corpo-bolinha -->
    <ellipse cx="40" cy="56" rx="24.5" ry="25.5" fill="url(#gp-c)" stroke="#b5661a" stroke-width="1"/>
    <ellipse cx="30" cy="44" rx="8" ry="4.2" fill="#fff" opacity=".3" transform="rotate(-22 30 44)"/>

    <!-- rosto -->
    <g class="gp-rosto">
      <g class="gp-olhos">
        <ellipse cx="31" cy="55" rx="5.6" ry="6.6" fill="#fff"/>
        <ellipse cx="49" cy="55" rx="5.6" ry="6.6" fill="#fff"/>
        <g class="gp-iris">
          <circle cx="31.5" cy="56" r="3.9" fill="url(#gp-iris)"/>
          <circle cx="49.5" cy="56" r="3.9" fill="url(#gp-iris)"/>
          <circle cx="33" cy="54.2" r="1.4" fill="#fff"/><circle cx="51" cy="54.2" r="1.4" fill="#fff"/>
          <circle cx="30.4" cy="57.6" r=".6" fill="#fff"/><circle cx="48.4" cy="57.6" r=".6" fill="#fff"/>
        </g>
      </g>
      <!-- olhos fechados curtindo / felizes -->
      <g class="gp-fechados" display="none">
        <path d="M26 56 Q31 60 36 56" stroke="#3a1f0a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M44 56 Q49 60 54 56" stroke="#3a1f0a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      </g>
      <g class="gp-felizes" display="none">
        <path d="M26 57 Q31 51 36 57" stroke="#3a1f0a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M44 57 Q49 51 54 57" stroke="#3a1f0a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      </g>
      <path class="gp-sorriso" d="M35 66 Q40 70.5 45 66" stroke="#6a300c" stroke-width="2" fill="none" stroke-linecap="round"/>
      <g class="gp-canta" display="none">
        <ellipse cx="40" cy="67.5" rx="3.6" ry="3.9" fill="#5a1f0e"/>
        <ellipse cx="40" cy="69.2" rx="2.1" ry="1.5" fill="#ff7a8a"/>
      </g>
      <ellipse cx="23.5" cy="63.5" rx="3.2" ry="2.1" fill="#ff7a8a" opacity=".5"/>
      <ellipse cx="56.5" cy="63.5" rx="3.2" ry="2.1" fill="#ff7a8a" opacity=".5"/>
    </g>

    <!-- capacete de garimpeiro -->
    <path d="M16 42 Q17 18 40 16 Q63 18 64 42 Z" fill="url(#gp-cap)" stroke="#c28f12" stroke-width="1"/>
    <path d="M40 16 L40 42" stroke="#e6b21e" stroke-width="3" opacity=".6"/>
    <path d="M11 41 Q40 34 69 41 Q70 45.5 66 45 Q40 39.5 14 45 Q10 45.5 11 41 Z" fill="#d49c14"/>
    <circle class="gp-halo" cx="40" cy="24" r="12" fill="url(#gp-luz)"/>
    <rect x="34.5" y="19" width="11" height="10" rx="3" fill="#5b4a2a"/>
    <circle cx="40" cy="24" r="4.1" fill="#fff8d6"/>
    <circle class="gp-lampada" cx="40" cy="24" r="2.8" fill="var(--gp-luz)"/>

    <!-- fone de DJ -->
    <path d="M13 44 Q10 10 40 8 Q70 10 67 44" stroke="#211838" stroke-width="3.6" fill="none" stroke-linecap="round"/>
    <g class="gp-fone">
      <rect x="6.5" y="40" width="10" height="15" rx="4.5" fill="#2a1f44"/>
      <rect x="6.5" y="40" width="10" height="15" rx="4.5" fill="none" stroke="var(--gp-neon)" stroke-width="1.4"/>
      <rect x="63.5" y="40" width="10" height="15" rx="4.5" fill="#2a1f44"/>
      <rect x="63.5" y="40" width="10" height="15" rx="4.5" fill="none" stroke="var(--gp-neon)" stroke-width="1.4"/>
    </g>
  </g>
</svg>`;

const CSS = `
.gp { --gp-luz:#2ee6a8; --gp-neon:#4cc9f0; width:52px; height:52px; flex:none; position:relative; }
.gp-svg { width:100%; height:100%; overflow:visible; }
.gp-svg g { transform-box: view-box; }
.gp .gp-todo { transform-origin: 40px 84px; }
.gp .gp-braco-e { transform-origin: 19px 55px; }
.gp .gp-braco-d { transform-origin: 61px 55px; }
.gp .gp-pe-e { transform-origin: 30px 80px; }
.gp .gp-pe-d { transform-origin: 50px 80px; }
.gp .gp-olhos { transform-origin: 40px 55px; }
.gp .gp-picareta { display:none; }
.gp.cavando .gp-picareta { display:inline; }
.gp .gp-halo { opacity:.75; }
.gp.urgente .gp-halo { opacity:1; }
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
