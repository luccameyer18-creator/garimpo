/**
 * Os efeitos da pista, na TELA INTEIRA, por cima da CDJ.
 *
 * Eram desenhados num quadrado embaixo do mixer. Agora são uma camada do
 * tamanho da tela, na frente de tudo, com mistura "screen": a luz dos efeitos
 * SOMA sobre os painéis e o escuro deixa os controles aparecerem normais —
 * dá pra ler e clicar (a camada não pega clique).
 *
 *   CANHÕES  moving heads no teto: cones de luz na fumaça, varrendo em pares
 *            espelhados a cada 8 tempos, abrindo no grave, trocando de cor na
 *            frase; no drop todos apontam pra galera; na quebra quase apagam
 *   LASER    um leque de raios finos do meio do teto (bombando; médio no drop)
 *   GALERA   silhuetas ESCURAS contra a luz, numa camada própria: corpo,
 *            cabeça (boné, cabelo), braços pra cima com a energia e no drop,
 *            gente filmando com o celular — e um fio de contraluz colorido
 *   NEBLINA  a fumaça iluminada no chão, respirando com o grave
 *   DROP     confete, "DROP!" e (bombando) um estrobo curto
 *
 * O ✨ é a intensidade: leve 2 canhões, médio 4 (+ laser no drop), bombando 6
 * com leque de laser e estrobo. SEM a 🎉 pista, nada disso desenha.
 *
 * O globo, os reflexos e a névoa moram em pista.js (#luzes), também na frente.
 * Com a VIAGEM ligada (viagem.js), os lasers saem — a viagem já ocupa a tela —
 * e ficam a galera e o confete.
 *
 * LEVE: desenha a metade da resolução da tela (a placa amplia), 30 quadros
 * por segundo, e só redesenha o que muda. O ✨ do painel desliga tudo.
 *
 * ACESSIBILIDADE: o estrobo é só no bombando, só um tempo depois do drop, e
 * nunca com `prefers-reduced-motion` (aí a cena fica parada).
 */

import { estadoPista as E } from './pista.js';
import { qualidade as Q, aoMudarQualidade, definirModo } from './qualidade.js';

/** Paleta por estilo do DJ: cor-base e quanto ela passeia. */
const VISUAL = {
  hipnotico:    { hue: 195, faixa: 70 },
  pista:        { hue: 300, faixa: 140 },
  disco:        { hue: 32,  faixa: 70 },
  turntablista: { hue: 350, faixa: 50 },
  baile:        { hue: 95,  faixa: 80 },
  festival:     { hue: 0,   faixa: 360 },
};
const CONFETE = ['#ff4ecd', '#4cc9f0', '#ffb347', '#2ee6a8', '#c77dff', '#fff2b3'];
// resolução da camada: metade da tela, vezes o degrau do medidor (qualidade.js)
const ESCALA = 0.5;
const NOME_MODO = { 1: 'leve', 2: 'médio', 3: 'bombando' };

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;

/**
 * @param {HTMLElement} el   a faixa da cabine (onde ficam o rótulo e os botões)
 * @param {object} [op]
 * @param {function} [op.rotulo]  (estado) => html do rótulo "ao vivo"
 * @param {object}   [op.viagem]  o controle da viagem (viagem.js)
 */
export function montarCena(el, { rotulo = null, viagem = null } = {}) {
  const cv = document.createElement('canvas');
  cv.id = 'cena-tela';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  const c = cv.getContext('2d');
  const rot = el.querySelector('.cena-rot');
  const selo = el.querySelector('.cena-drop');
  if (selo) document.body.appendChild(selo);      // o "DROP!" aparece no meio da TELA

  // ✨ o modo de efeitos, escolhido pela pessoa: leve → médio → bombando → off
  const bEfeitos = document.createElement('button');
  bEfeitos.className = 'cena-modo';
  bEfeitos.type = 'button';
  const pintarEfeitos = () => {
    bEfeitos.textContent = '✨ ' + NOME_MODO[Q.nivel];
    bEfeitos.title = 'intensidade da pista e da viagem: leve, médio ou bombando (toque pra trocar)';
    bEfeitos.classList.toggle('lig', modoPista || !!viagem?.ligada);
  };
  bEfeitos.onclick = () => definirModo(Q.nivel >= 3 ? 1 : Q.nivel + 1);
  el.appendChild(bEfeitos);

  // 🌀 a viagem da página inteira; ↻ troca o visual dela
  const bViagem = document.createElement('button');
  bViagem.className = 'cena-viagem';
  bViagem.type = 'button';
  bViagem.textContent = '🌀 viagem';
  const bPista = document.createElement('button');
  bPista.className = 'cena-pista';
  bPista.type = 'button';
  bPista.textContent = '🎉 pista';
  let modoPista = false;
  const ligarPista = (on) => {
    modoPista = on;
    bPista.classList.toggle('lig', on);
    pintarEfeitos();
    document.body.classList.toggle('pista-cheia', on);
    document.dispatchEvent(new CustomEvent('show'));
    montarGente();
  };
  const bTroca = document.createElement('button');
  bTroca.className = 'cena-troca';
  bTroca.type = 'button';
  bTroca.textContent = '↻';
  bTroca.hidden = true;
  bViagem.onclick = () => {
    const on = viagem?.alternar();
    bViagem.classList.toggle('lig', !!on);
    bTroca.hidden = !on;
    if (on && modoPista) ligarPista(false);          // uma de cada vez
    pintarEfeitos();
  };
  bPista.onclick = () => {
    ligarPista(!modoPista);
    if (modoPista && viagem?.ligada) { viagem.alternar(false); bViagem.classList.remove('lig'); bTroca.hidden = true; }
  };
  el.appendChild(bPista);
  // 👁 só o show: esconde a CDJ (app.js cuida; aqui só pede)
  const bSo = document.createElement('button');
  bSo.className = 'cena-so';
  bSo.type = 'button';
  bSo.textContent = '👁';
  bSo.title = 'só o show: esconde a CDJ (Esc volta)';
  bSo.onclick = () => document.dispatchEvent(new CustomEvent('so-show'));
  el.appendChild(bSo);
  bTroca.onclick = () => viagem?.trocar?.(1.2);
  if (viagem) { el.appendChild(bViagem); el.appendChild(bTroca); }
  pintarEfeitos();
  aoMudarQualidade(() => { montarGente(); pintarEfeitos(); });

  let W = 0, H = 0, u = 1, gente = [];
  const confete = [];

  /**
   * A GALERA DE VERDADE: silhuetas ESCURAS contra a luz, como numa foto de
   * club — não mais bonequinhos de contorno neon. Mora numa camada própria
   * (#cena-galera), com mistura normal: a camada das luzes só SOMA luz e não
   * consegue desenhar escuro. Com a CDJ à vista a galera é baixa e meio
   * transparente (os botões de baixo continuam legíveis); no 👁 só a pista
   * ela sobe e fica sólida.
   */
  const cg = document.createElement('canvas');
  cg.id = 'cena-galera';
  cg.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cg);
  const g = cg.getContext('2d');

  function montarGente() {
    gente = [];
    const JEITOS = ['pula', 'pula', 'balanca', 'cabeca', 'balanca', 'acena'];
    // leve: uma fileira; médio e bombando: duas (a de trás menor e mais alta)
    const filas = Q.nivel >= 2 ? [{ esc: 0.9, dy: 0.05, fundo: true }, { esc: 1.25, dy: 0 }] : [{ esc: 1.05, dy: 0 }];
    let k = 0;
    for (const fl of filas) {
      const passo = 30 * u * fl.esc;
      const n = Math.max(8, Math.ceil(W / passo));
      for (let i = 0; i < n; i++) {
        k++;
        gente.push({
          dy: fl.dy, fundo: !!fl.fundo,
          x: (i + 0.5 + (hash(k) - 0.5) * 0.7) * (W / n),
          esc: (0.82 + hash(k + 2) * 0.36) * fl.esc,
          larg: 0.9 + hash(k + 9) * 0.35,
          jeito: JEITOS[Math.floor(hash(k + 21) * JEITOS.length)],
          salto: 0.6 + hash(k + 3) * 0.8,
          // atraso próprio: ninguém na pista pula junto de verdade
          atraso: hash(k + 5) * 0.09 + (hash(k + 6) < 0.12 ? 0.5 : 0),
          braco: hash(k + 8), fase: hash(k + 11) * 6.28,
          celular: hash(k + 17) < 0.1,                 // tem sempre alguém filmando
          bone: hash(k + 19) < 0.22, cabelo: hash(k + 23) < 0.3,
        });
      }
    }
    // a fileira da frente desenha por último (fica na frente)
    gente.sort((a, b) => (b.fundo ? 1 : 0) - (a.fundo ? 1 : 0));
  }

  function ajustar() {
    const esc = ESCALA * Q.escala;
    const w = Math.round(innerWidth * esc), h = Math.round(innerHeight * esc);
    if (w === W && h === H) return;
    W = cv.width = cg.width = w; H = cv.height = cg.height = h;
    u = Math.max(0.5, Math.min(W, H * 1.6) / 600);
    montarGente();
  }
  addEventListener('resize', ajustar);
  aoMudarQualidade(() => { ajustar(); pintarEfeitos(); });
  ajustar();

  let ultimoDrop = E.drop, tAntes = 0, textoAntes = '', tRotulo = 0, dropEm = -1e9;

  /**
   * CANHÕES DE LUZ (moving heads): presos no teto, cada um joga um CONE de
   * luz que aparece na fumaça — mais forte perto do canhão, sumindo no chão.
   * Varrem em pares espelhados a cada 8 tempos, abrem no grave, trocam de cor
   * na frase; no drop apontam todos pra galera; na quebra quase apagam.
   */
  function canhoes(pal, luz) {
    const n = [0, 2, 4, 6][Q.nivel];
    const aberto = Math.min(1, E.energia * 0.6 + E.grave * 0.5 + E.dropV * 0.8);
    // por cima da CDJ os cones são mais fracos (não lavam os painéis); no
    // 👁 só a pista eles têm a força toda
    const soShow = document.body.classList.contains('so-viagem');
    const base = (0.28 + E.pulso * 0.35 + aberto * 0.4) * (E.quebra ? 0.25 : 1) * (E.tocando ? 1 : 0.3) * luz
               * (soShow ? 1 : 0.6);
    const L = H * 1.35;
    for (let i = 0; i < n; i++) {
      const x0 = W * (i + 0.5) / n;
      const lado = i < n / 2 ? 1 : -1;
      // espelhados: os da esquerda varrem pra direita quando os da direita vão pra esquerda
      let th = Math.PI / 2 + lado * (0.25 + Math.sin((E.batida * Math.PI) / 8 + i * 0.7) * 0.42);
      th = th * (1 - E.dropV) + (Math.PI / 2 + (i - (n - 1) / 2) * 0.05) * E.dropV;   // drop: todos pro centro
      const meia = 0.045 + aberto * 0.05;
      const cor = pal[i % 2];
      const x1 = x0 + Math.cos(th - meia) * L, y1 = Math.sin(th - meia) * L;
      const x2 = x0 + Math.cos(th + meia) * L, y2 = Math.sin(th + meia) * L;
      const gr = c.createLinearGradient(x0, 0, x0 + Math.cos(th) * L, Math.sin(th) * L);
      gr.addColorStop(0, cor); gr.addColorStop(0.55, cor); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr;
      c.globalAlpha = base * 0.32;
      c.beginPath(); c.moveTo(x0, -2); c.lineTo(x1, y1); c.lineTo(x2, y2); c.closePath(); c.fill();
      // o miolo do feixe, mais fino e mais forte
      c.globalAlpha = base * 0.5;
      c.beginPath(); c.moveTo(x0, -2);
      c.lineTo(x0 + Math.cos(th - meia * 0.25) * L, Math.sin(th - meia * 0.25) * L);
      c.lineTo(x0 + Math.cos(th + meia * 0.25) * L, Math.sin(th + meia * 0.25) * L);
      c.closePath(); c.fill();
      // o próprio canhão aceso no teto
      c.globalAlpha = Math.min(1, base * 1.4);
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(x0, 0, 2.2 * u, 0, 6.283); c.fill();
    }
  }

  /**
   * LEQUE DE LASER: do meio do teto, um leque de raios finos que gira e
   * pisca no tempo — no bombando o tempo todo, no médio só depois do drop.
   */
  function leque(pal, luz) {
    if (E.quebra || !E.tocando) return;
    const ativo = Q.nivel >= 3 ? 1 : E.dropV;
    if (ativo < 0.05) return;
    const n = 14;
    const giro = Math.sin((E.batida * Math.PI) / 16) * 0.6;
    const abre = 0.9 + E.grave * 0.4;
    const piscada = (Math.floor(E.batida * 2) % 2 === 0) ? 1 : 0.55;
    c.strokeStyle = Math.floor(E.batida / 16) % 2 ? '#39ff8a' : pal[1];
    c.lineWidth = Math.max(1, 0.9 * u);
    c.globalAlpha = 0.5 * ativo * piscada * luz;
    const L = W + H;
    c.beginPath();
    for (let k = 0; k < n; k++) {
      const th = Math.PI / 2 + giro + (k - (n - 1) / 2) * (abre / n);
      c.moveTo(W / 2, 0); c.lineTo(W / 2 + Math.cos(th) * L, Math.sin(th) * L);
    }
    c.stroke();
  }

  /** A fumaça iluminada no chão: um brilho largo que respira com o grave. */
  function neblina(pal, luz) {
    const a = (0.16 + E.grave * 0.3 + E.dropV * 0.25) * (E.quebra ? 0.6 : 1) * luz * [0, 0.6, 0.85, 1][Q.nivel];
    const gr = c.createRadialGradient(W / 2, H * 1.05, 0, W / 2, H * 1.05, W * 0.75);
    gr.addColorStop(0, pal[0]); gr.addColorStop(0.5, pal[1]); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = a;
    c.fillStyle = gr;
    c.fillRect(0, H * 0.45, W, H * 0.55);
  }

  /** ESTROBO no drop (só no bombando, só um tempo, e nunca com menos movimento). */
  function estrobo() {
    if (Q.nivel < 3 || E.reduzido) return;
    const desde = (performance.now() - dropEm) / 1000 * ((E.bpm || 124) / 60);   // em tempos
    if (desde < 0 || desde > 1) return;
    if ((desde * 4) % 1 < 0.35) { c.globalAlpha = 0.2; c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); }
  }

  /** A galera: corpo, cabeça (boné, cabelo), braços, celular — contra a luz. */
  function galera(pal, dt, luz, soShow) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const toca = E.tocando;
    const pulam = toca && !E.quebra;
    // quanto da tela a galera ocupa: com a CDJ à vista ela é baixa e bem
    // transparente (os botões de baixo têm que continuar legíveis)
    const alturaMax = soShow ? 0.34 : 0.14;
    cg.style.opacity = soShow ? '0.96' : '0.42';
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const p of gente) {
      const hr = H * alturaMax * 0.14 * p.esc;       // raio da cabeça
      const bt = E.batida - p.atraso;
      const f = ((bt % 1) + 1) % 1;
      const noUm = (((Math.floor(bt) % 4) + 4) % 4) === 0;
      const pp = E.reduzido ? 0 : Math.exp(-f * 5);
      const forca = (0.45 + E.grave * 0.9) * (noUm ? 1.3 : 1) * (1 + E.dropV * 1.2);
      let salto = 0, lado = 0, cabeca = 0;
      if (pulam && !E.reduzido) {
        if (p.jeito === 'pula') salto = pp * p.salto * hr * 0.9 * forca;
        else if (p.jeito === 'balanca') { lado = Math.sin(bt * Math.PI / 2 + p.fase) * hr * 0.45; salto = pp * hr * 0.25 * forca; }
        else if (p.jeito === 'cabeca') { cabeca = pp * hr * 0.5 * forca; salto = pp * hr * 0.12; }
        else { salto = pp * hr * 0.4 * forca; lado = Math.sin(bt * Math.PI + p.fase) * hr * 0.2; }
      } else if (toca && !E.reduzido) {
        lado = Math.sin(E.batida * Math.PI / 4 + p.fase) * hr * 0.35;
      }
      const x = p.x + lado;
      const yc = H - hr * 3.1 - salto - p.dy * H;     // centro da cabeça
      const ombro = hr * 1.75 * p.larg;
      const escuro = p.fundo ? '#120a1e' : '#06030b';
      g.fillStyle = escuro; g.strokeStyle = escuro;
      // corpo: ombros arredondados descendo até sair da tela
      g.beginPath();
      g.moveTo(x - ombro, H + 4);
      g.lineTo(x - ombro, yc + hr * 2.3);
      g.quadraticCurveTo(x - ombro, yc + hr * 1.35, x - hr * 0.55, yc + hr * 1.25);
      g.lineTo(x + hr * 0.55, yc + hr * 1.25);
      g.quadraticCurveTo(x + ombro, yc + hr * 1.35, x + ombro, yc + hr * 2.3);
      g.lineTo(x + ombro, H + 4);
      g.closePath(); g.fill();
      // cabeça (+ boné ou cabelo)
      const yh = yc + cabeca;
      g.beginPath(); g.arc(x, yh, hr, 0, 6.283); g.fill();
      if (p.bone) { g.beginPath(); g.ellipse(x + hr * 0.5, yh - hr * 0.45, hr * 1.05, hr * 0.35, 0, 0, 6.283); g.fill(); }
      else if (p.cabelo) { g.beginPath(); g.ellipse(x, yh - hr * 0.2, hr * 1.25, hr * 1.1, 0, 0, 6.283); g.fill(); }
      // braços pra cima: com a energia, no drop, ou quem acena
      const bracos = toca && (p.braco < E.energia * 0.75 - 0.15 || p.braco < E.dropV * 0.95
                              || (p.jeito === 'acena' && p.braco < 0.7) || (E.quebra && p.braco < 0.22));
      let maoX = null, maoY = null;
      if (bracos) {
        const acena = E.reduzido ? 0 : Math.sin(bt * Math.PI + p.fase) * 0.35;
        g.lineWidth = hr * 0.62;
        g.beginPath();
        g.moveTo(x - ombro * 0.8, yc + hr * 1.7);
        g.quadraticCurveTo(x - ombro * 1.15, yc - hr * 0.2, x - hr * (1.6 + acena), yc - hr * 2.3);
        g.moveTo(x + ombro * 0.8, yc + hr * 1.7);
        maoX = x + hr * (1.6 - acena); maoY = yc - hr * 2.3;
        g.quadraticCurveTo(x + ombro * 1.15, yc - hr * 0.2, maoX, maoY);
        g.stroke();
      }
      // contraluz: um fio de cor no topo da cabeça e dos ombros, da luz de trás
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = pal[(p.x > W / 2) ? 1 : 0];
      g.globalAlpha = (0.35 + E.agudo * 0.35 + E.dropV * 0.3) * luz * (p.fundo ? 0.5 : 0.85);
      g.lineWidth = Math.max(1, hr * 0.16);
      g.beginPath(); g.arc(x, yh, hr, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.beginPath(); g.moveTo(x - ombro, yc + hr * 2.3);
      g.quadraticCurveTo(x - ombro, yc + hr * 1.35, x - hr * 0.55, yc + hr * 1.25); g.stroke();
      // o celular filmando: a tela acesa na mão levantada
      if (p.celular && toca) {
        const cx = maoX ?? x + hr * 0.9, cy = maoY ?? yc - hr * 0.6;
        g.globalAlpha = 0.85; g.fillStyle = '#dfe8ff';
        g.fillRect(cx - hr * 0.22, cy - hr * 0.4, hr * 0.44, hr * 0.75);
        g.globalAlpha = 0.1; g.beginPath(); g.arc(cx, cy, hr * 0.8, 0, 6.283); g.fill();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }

  function quadro(agora) {
    requestAnimationFrame(quadro);
    if (document.hidden) return;
    // rótulo "ao vivo" da cabine: estável, muda quando o estado muda
    if (rot && rotulo && agora - tRotulo > 400) {
      tRotulo = agora;
      const tx = rotulo(E);
      if (tx !== textoAntes) { textoAntes = tx; rot.innerHTML = tx; }
    }
    // sem a 🎉 pista, estas camadas não desenham nada (o padrão é sem efeito)
    if (!modoPista) {
      if (tAntes) { c.clearRect(0, 0, W, H); g.clearRect(0, 0, W, H); tAntes = 0; }
      return;
    }
    if (agora - tAntes < (E.tocando || confete.length ? 33 : 66)) return;   // 30 fps; 15 sem música
    if (E.reduzido && agora - tAntes < 500) return;
    const dt = Math.min(0.1, (agora - tAntes) / 1000);
    tAntes = agora;

    const black = document.documentElement.dataset.tema === 'black';
    const v = VISUAL[E.estilo] || VISUAL.pista;
    const hueBase = v.hue + Math.floor(Math.max(0, E.batida) / 16) * (v.faixa >= 360 ? 67 : v.faixa / 3);
    const L0 = black ? 48 : 60;
    const pal = [hsl(hueBase, 95, L0), hsl(hueBase + v.faixa / 2 + 30, 95, L0)];
    const luz = black ? 0.65 : 1;
    const soShow = document.body.classList.contains('so-viagem');

    if (E.drop !== ultimoDrop && E.dropReal) dropEm = performance.now();

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    // leve: 2 canhões e a neblina; médio: 4 canhões (+ laser no drop);
    // bombando: 6 canhões, leque de laser sempre e estrobo no drop
    neblina(pal, luz);
    if (!viagem?.ligada) { canhoes(pal, luz); leque(pal, luz); }
    estrobo();
    c.globalAlpha = 1;
    galera(pal, dt, Q.nivel === 1 ? luz * 0.6 : luz, soShow);

    // confete: só no drop de verdade (marcador da faixa)
    if (E.drop !== ultimoDrop) {
      ultimoDrop = E.drop;
      if (!E.reduzido && E.dropReal) {
        for (let i = 0; i < [0, 30, 60, 120][Q.nivel]; i++) {
          confete.push({
            x: Math.random() * W, y: -Math.random() * H * 0.3,
            vx: (Math.random() - 0.5) * 40 * u, vy: (50 + Math.random() * 80) * u,
            r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10,
            cor: CONFETE[i % CONFETE.length], vida: 3 + Math.random() * 1.5,
          });
        }
        if (selo) { selo.classList.remove('vai'); void selo.offsetWidth; selo.classList.add('vai'); }
      }
    }
    c.globalCompositeOperation = 'source-over';
    for (let i = confete.length - 1; i >= 0; i--) {
      const q = confete[i];
      q.vida -= dt;
      if (q.vida <= 0 || q.y > H) { confete.splice(i, 1); continue; }
      q.x += (q.vx + Math.sin(q.r * 2) * 14 * u) * dt;
      q.y += q.vy * dt;
      q.r += q.vr * dt;
      c.globalAlpha = Math.min(1, q.vida) * 0.9;
      c.fillStyle = q.cor;
      c.setTransform(Math.cos(q.r), Math.sin(q.r), -Math.sin(q.r), Math.cos(q.r), q.x, q.y);
      const hh = 8 * u * Math.abs(Math.cos(q.r * 1.7)) + 0.5;
      c.fillRect(-2.5 * u, -hh / 2, 5 * u, hh);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
  requestAnimationFrame(quadro);
}
