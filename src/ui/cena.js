/**
 * A janela da pista — o que o DJ vê da cabine. Três modos:
 *
 *   PISTA    a galera, o globo, os lasers e a névoa
 *   VIAGEM   o MilkDrop — o visualizador do Winamp, via Butterchurn (MIT,
 *            WebGL, carregado sob demanda do jsDelivr). São 100 presets; ele
 *            troca a cada 32 tempos (64 no estilo hipnótico) com fusão de 2,7 s,
 *            e na hora do drop marcado. ↻ troca na mão. Sem WebGL ou sem rede,
 *            cai no túnel próprio (o quadro anterior redesenhado ampliado e
 *            girado, com um anel de espectro em caleidoscópio)
 *            Por cima, na viagem: formas psicodélicas (anéis, estrelas, olhos,
 *            espirais, flores, mandalas) que nascem no fundo do túnel e voam
 *            na direção de quem olha, crescendo em perspectiva até sair da
 *            tela — nascem no bumbo, correm com o grave, revoada no drop
 *   MISTURA  a viagem no fundo, a galera e os lasers por cima (o padrão)
 *
 * NADA aqui é loop de animação fingindo acompanhar a música. Tudo lê
 * `estadoPista` (pista.js), que vem da grade de batidas do deck no ar e do
 * espectro real do master:
 *
 *   - a galera pula no bumbo, com ACENTO no 1 do compasso; a altura do pulo
 *     vem do GRAVE; os contornos de luz, do AGUDO; os braços, da energia
 *   - cada pessoa tem um jeito de dançar (pula, balança, cabeceia, acena) e um
 *     atraso próprio de alguns milissegundos — é o que tira o ar de robô
 *   - os lasers varrem a cada 8 tempos e trocam de cor a cada frase de 16
 *   - o ESTILO do DJ muda a paleta, a velocidade e o rastro do visualizador:
 *     hipnótico é frio e lento, disco é dourado, festival é arco-íris
 *   - na QUEBRA a luz baixa e a galera só balança; no DROP abre tudo
 *
 * ACESSIBILIDADE: nenhum clarão de tela cheia, nenhum liga-desliga. Com
 * `prefers-reduced-motion` a cena fica parada e só redesenha devagar.
 */

import { estadoPista as E } from './pista.js';

/**
 * Como cada estilo PINTA. `hue` é a cor-base, `faixa` quanto a cor pode
 * variar a partir dela, `giro` a rotação do túnel por segundo, `zoom` o quanto
 * ele puxa pra fora por quadro, `rastro` quanto do quadro anterior sobrevive.
 */
const VISUAL = {
  hipnotico:    { hue: 195, faixa: 70,  giro: 0.10, zoom: 1.010, rastro: 0.95 },
  pista:        { hue: 300, faixa: 140, giro: 0.22, zoom: 1.018, rastro: 0.91 },
  disco:        { hue: 32,  faixa: 70,  giro: 0.26, zoom: 1.016, rastro: 0.91 },
  turntablista: { hue: 350, faixa: 50,  giro: 0.45, zoom: 1.026, rastro: 0.84 },
  baile:        { hue: 95,  faixa: 80,  giro: 0.32, zoom: 1.022, rastro: 0.88 },
  festival:     { hue: 0,   faixa: 360, giro: 0.36, zoom: 1.030, rastro: 0.90 },
};
const MODOS = ['mistura', 'viagem', 'pista'];
const CONFETE = ['#ff4ecd', '#4cc9f0', '#ffb347', '#2ee6a8', '#c77dff', '#fff2b3'];

/** Pseudo-aleatório estável por inteiro (pras facetas e a galera não tremerem). */
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;

/**
 * @param {HTMLElement} el   a caixa da janela; o canvas é criado dentro
 * @param {object} [op]
 * @param {function} [op.rotulo]   (estado) => html do rótulo
 * @param {function} [op.nomeModo] (modo) => texto do botão de modo
 */
export function montarCena(el, { rotulo = null, nomeModo = (m) => m, audio = () => null } = {}) {
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  el.prepend(cv);
  // o MilkDrop desenha num canvas WebGL por trás; o 2D (galera, lasers) por cima
  const gl = document.createElement('canvas');
  gl.setAttribute('aria-hidden', 'true');
  gl.style.display = 'none';
  el.prepend(gl);
  const c = cv.getContext('2d');
  // o buffer do túnel: guarda o quadro anterior pra ser redesenhado ampliado
  const buf = document.createElement('canvas');
  const bc = buf.getContext('2d');
  const rot = el.querySelector('.cena-rot');
  const selo = el.querySelector('.cena-drop');
  const painel = el.querySelector('.dj-painel');

  let W = 0, H = 0, dpr = 1, u = 1, chao = 0;

  let modo = 'mistura';
  try { if (MODOS.includes(localStorage.getItem('garimpo.cena.modo'))) modo = localStorage.getItem('garimpo.cena.modo'); } catch {}
  const bModo = document.createElement('button');
  bModo.className = 'cena-modo';
  bModo.type = 'button';
  const pintarModo = () => { bModo.textContent = '◎ ' + nomeModo(modo); };
  bModo.onclick = () => {
    modo = MODOS[(MODOS.indexOf(modo) + 1) % MODOS.length];
    try { localStorage.setItem('garimpo.cena.modo', modo); } catch {}
    bc.clearRect(0, 0, W, H);
    pintarModo();
  };
  pintarModo();
  el.appendChild(bModo);

  /**
   * TELA CHEIA, como o visualizador do Windows Media Player: a janela cobre a
   * tela, o painel do DJ flutua embaixo, Esc volta. Aqui o canvas desenha em
   * resolução reduzida (0,6x) e o navegador amplia — num visualizador borrado
   * é bonito, e o túnel em tela Full HD a 1,5x seria pesado demais.
   */
  const bCheia = document.createElement('button');
  bCheia.className = 'cena-cheia';
  bCheia.type = 'button';
  bCheia.textContent = '⛶';
  const cheia = (on) => {
    el.classList.toggle('tela-cheia', on);
    document.body.classList.toggle('viajando', on);
    bc.clearRect(0, 0, W, H);
  };
  bCheia.onclick = () => cheia(!el.classList.contains('tela-cheia'));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.classList.contains('tela-cheia')) cheia(false); });
  el.appendChild(bCheia);

  // ─────────────── MilkDrop (Butterchurn) ───────────────
  let milk = null, milkEstado = 'nada', presets = null, nomes = [], presetAtual = -1, trocaEm = 0;
  const bTroca = document.createElement('button');
  bTroca.className = 'cena-troca';
  bTroca.type = 'button';
  bTroca.textContent = '↻';
  bTroca.hidden = true;
  const trocar = (fusao = 2.7) => {
    if (!milk || !nomes.length) return;
    let i = Math.floor(Math.random() * nomes.length);
    if (i === presetAtual) i = (i + 1) % nomes.length;
    presetAtual = i;
    try { milk.loadPreset(presets[nomes[i]], fusao); } catch {}
  };
  bTroca.onclick = () => trocar(1.2);
  el.appendChild(bTroca);

  /** Carrega o Butterchurn na primeira vez que precisar. Falhou? Fica no túnel próprio. */
  async function iniciarMilk() {
    const a = audio();
    if (!a?.ctx || !a?.no) return;                 // o áudio ainda não ligou
    milkEstado = 'carregando';
    try {
      if (!document.createElement('canvas').getContext('webgl2')) throw new Error('sem webgl2');
      const [m1, m2] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/butterchurn@2.6.7/+esm'),
        import('https://cdn.jsdelivr.net/npm/butterchurn-presets@2.4.7/lib/butterchurnPresets.min.js/+esm'),
      ]);
      const bc = m1.default?.default || m1.default || m1;
      const pr = m2.default?.getPresets ? m2.default : m2.default?.default || m2;
      presets = pr.getPresets();
      nomes = Object.keys(presets);
      milk = bc.createVisualizer(a.ctx, gl, { width: Math.max(1, W), height: Math.max(1, H), pixelRatio: 1, textureRatio: 1 });
      milk.connectAudio(a.no);
      trocar(0);
      milkEstado = 'ok';
      bTroca.hidden = false;
    } catch (e) {
      milkEstado = 'falhou';
      console.warn('MilkDrop indisponível, usando o túnel próprio:', e.message);
    }
  }
  window.addEventListener('idioma', pintarModo);

  let gente = [];
  const confete = [];
  const voadores = [];
  const FORMAS = ['anel', 'estrela', 'olho', 'espiral', 'flor', 'mandala'];
  let batidaVoo = -1;
  const reflexos = Array.from({ length: 36 }, (_, i) => ({
    a: hash(i) * Math.PI * 2, y: 0.05 + hash(i + 99) * 0.6, r: 0.6 + hash(i + 7) * 0.9, c: i % 2,
  }));

  /** A galera em três fileiras, apoiada logo acima do painel do DJ. */
  function montarGente() {
    gente = [];
    const filas = [{ y: -0.16, esc: 0.55, cor: '#1c1433' }, { y: -0.07, esc: 0.78, cor: '#130d25' },
                   { y: 0.02, esc: 1.0, cor: '#08050f' }];
    const JEITOS = ['pula', 'pula', 'balanca', 'cabeca', 'acena'];
    let k = 0;
    filas.forEach((f, fi) => {
      const passo = 26 * u * f.esc;
      const n = Math.max(3, Math.ceil(W / passo) + 1);
      for (let i = 0; i < n; i++) {
        k++;
        gente.push({
          fila: fi, esc: f.esc, cor: f.cor, dy: f.y,
          x: (i + 0.5 + (hash(k) - 0.5) * 0.7) * (W / n),
          jeito: JEITOS[Math.floor(hash(k + 21) * JEITOS.length)],
          salto: 0.7 + hash(k + 3) * 0.8,
          // atraso próprio (até ~8% do tempo): ninguém na pista pula junto de verdade
          atraso: hash(k + 5) * 0.08 + (hash(k + 6) < 0.15 ? 0.5 : 0),
          braco: hash(k + 8),
          fase: hash(k + 11) * 6.28,
          ordem: hash(k + 13),
          deriva: (hash(k + 17) - 0.5) * 0.6,   // anda um pouco pela pista
          alfa: 0, c: k % 2,
        });
      }
    });
    gente.sort((a, b) => a.fila - b.fila);
  }

  function ajustar() {
    dpr = el.classList.contains('tela-cheia') ? 0.6 : Math.min(1.5, devicePixelRatio || 1);
    const w = Math.round(el.clientWidth * dpr), h = Math.round(el.clientHeight * dpr);
    const livre = h - Math.round((painel?.offsetHeight || 0) * dpr) - 8 * dpr;
    const novoChao = Math.max(h * 0.45, livre);
    if (w === W && h === H && novoChao === chao) return;
    W = cv.width = buf.width = gl.width = w; H = cv.height = buf.height = gl.height = h;
    try { milk?.setRendererSize(w, h); } catch {}
    chao = novoChao;
    u = Math.max(0.6, Math.min(W, chao * 1.3) / 300);
    montarGente();
  }
  const ro = new ResizeObserver(ajustar);
  ro.observe(el);
  if (painel) ro.observe(painel);

  let visivel = true;
  new IntersectionObserver((es) => { visivel = es[0]?.isIntersecting ?? true; }).observe(el);

  let ultimoDrop = E.drop, tAntes = performance.now(), giro = 0, tunel = 0, textoAntes = '', tRotulo = 0;

  // ─────────────── a viagem (visualizador) ───────────────
  function viagem(v, dt, black) {
    const cx = W / 2, cy = chao * 0.5;
    const m = Math.min(W, chao);
    // 1. o túnel: o quadro anterior, ampliado e girado, um pouco mais apagado
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = black ? '#000' : '#05030b';
    c.fillRect(0, 0, W, H);
    const z = v.zoom + E.grave * 0.02 + E.dropV * 0.03;
    tunel += dt * v.giro * (E.tocando ? 1 : 0.3) * (1 + E.medio * 0.8);
    c.globalAlpha = Math.min(0.88, v.rastro) - E.agudo * 0.05;
    c.translate(cx, cy);
    c.rotate(Math.sin(tunel) * 0.012 + v.giro * 0.01);
    c.scale(z, z);
    c.drawImage(buf, -cx, -cy);
    c.setTransform(1, 0, 0, 1, 0, 0);

    // 2. o anel de espectro, espelhado (caleidoscópio de 6 pétalas)
    const esp = E.espectro;
    const hueBase = v.hue + (v.faixa >= 360 ? E.batida * 12 : Math.sin(E.batida / 16) * v.faixa / 2);
    const luz = black ? 40 : 55;
    c.globalCompositeOperation = 'source-over';
    const r0 = m * (0.10 + E.pulso * 0.05 + E.grave * 0.06);
    const N = 24;
    c.lineCap = 'round';
    c.globalAlpha = 0.4;
    for (let i = 0; i < N; i++) {
      // escala quase logarítmica: o grave perto do eixo, o agudo na ponta
      const b = esp ? esp[Math.min(esp.length - 1, 1 + Math.floor(Math.pow(i / N, 1.8) * 180))] / 255 : 0;
      const len = (0.02 + b * 0.32) * m * (E.tocando ? 1 : 0.2);
      c.strokeStyle = hsl(hueBase + (i / N) * v.faixa * 0.5, 90, luz);
      c.lineWidth = (1.2 + b * 2.4) * dpr;
      c.beginPath();
      for (let s = 0; s < 6; s++) {
        const base = (s / 6) * Math.PI * 2 + tunel * 2;
        for (const lado of [1, -1]) {
          const a = base + lado * (i / N) * (Math.PI / 6);
          const ca = Math.cos(a), sa = Math.sin(a);
          c.moveTo(cx + ca * r0, cy + sa * r0);
          c.lineTo(cx + ca * (r0 + len), cy + sa * (r0 + len));
        }
      }
      c.stroke();
    }
    // 3. no 1 do compasso, um anel fino que o túnel leva pra fora
    if (E.tocando && E.compasso === 0 && E.pulso > 0.8) {
      c.globalAlpha = 0.5;
      c.strokeStyle = hsl(hueBase + 180, 80, luz + 10);
      c.lineWidth = 1.5 * dpr;
      c.beginPath(); c.arc(cx, cy, r0 * 0.8, 0, 6.283); c.stroke();
    }
    // 4. o miolo: uma flor que abre com o médio
    c.globalAlpha = 0.2 + E.medio * 0.3;
    c.fillStyle = hsl(hueBase + 40, 85, luz);
    c.beginPath();
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const r = r0 * (0.45 + 0.25 * Math.abs(Math.sin(a * 4 + tunel * 3)) * (0.4 + E.medio));
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (k) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.fill();

    // 5. guarda o quadro pro túnel do próximo
    bc.globalCompositeOperation = 'copy';
    bc.globalAlpha = 1;
    bc.drawImage(cv, 0, 0);
  }

  // ─────────────── formas voando em 3D (viagem) ───────────────
  /**
   * Perspectiva de verdade: cada forma tem uma profundidade z (1 = lá no fundo,
   * 0 = no seu rosto). A posição na tela é o centro + direção / z, e o
   * tamanho é base / z — então ela acelera e cresce ao chegar perto, como
   * coisa vindo na sua direção. Sai de cena quando passa da tela.
   */
  function soltar(n, cx, cy) {
    for (let i = 0; i < n && voadores.length < 46; i++) {
      voadores.push({
        forma: FORMAS[Math.floor(Math.random() * FORMAS.length)],
        a: Math.random() * Math.PI * 2, // direção
        d: 0.15 + Math.random() * 0.85, // quão longe do eixo
        z: 1, giro: (Math.random() - 0.5) * 3, rot: Math.random() * 6.28,
        h: Math.random() * 360, cx, cy,
      });
    }
  }
  function forma(q, x, y, r, cor, t) {
    c.save();
    c.translate(x, y); c.rotate(q.rot);
    c.strokeStyle = cor; c.fillStyle = cor;
    c.lineWidth = Math.max(1, r * 0.12);
    c.beginPath();
    if (q.forma === 'anel') { c.arc(0, 0, r, 0, 6.283); c.stroke(); c.beginPath(); c.arc(0, 0, r * 0.6, 0, 6.283); c.stroke(); }
    else if (q.forma === 'estrela') {
      for (let k = 0; k <= 10; k++) { const rr = k % 2 ? r * 0.45 : r; const a = (k / 10) * Math.PI * 2; k ? c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : c.moveTo(rr, 0); }
      c.stroke();
    } else if (q.forma === 'olho') {
      c.moveTo(-r, 0); c.quadraticCurveTo(0, -r * 0.8, r, 0); c.quadraticCurveTo(0, r * 0.8, -r, 0); c.stroke();
      c.beginPath(); c.arc(0, 0, r * 0.32, 0, 6.283); c.fill();
    } else if (q.forma === 'espiral') {
      for (let k = 0; k <= 40; k++) { const a = k * 0.45 + t; const rr = (k / 40) * r; k ? c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : c.moveTo(0, 0); }
      c.stroke();
    } else if (q.forma === 'flor') {
      for (let k = 0; k < 6; k++) { c.moveTo(0, 0); c.ellipse(Math.cos(k * 1.047) * r * 0.5, Math.sin(k * 1.047) * r * 0.5, r * 0.5, r * 0.2, k * 1.047, 0, 6.283); }
      c.stroke();
    } else {
      for (let k = 0; k < 8; k++) { c.moveTo(0, 0); c.lineTo(Math.cos(k * 0.785) * r, Math.sin(k * 0.785) * r); }
      c.stroke(); c.beginPath(); c.arc(0, 0, r * 0.7, 0, 6.283); c.stroke();
    }
    c.restore();
  }
  function voar(dt, black) {
    const cx = W / 2, cy = chao * 0.5;
    // nasce no bumbo: 1 por tempo, 2 no 1 do compasso, mais com energia
    const bi = Math.floor(E.batida);
    if (E.tocando && bi !== batidaVoo) {
      batidaVoo = bi;
      soltar((E.compasso === 0 ? 2 : 1) + Math.round(E.energia * 1.5), cx, cy);
    }
    if (!E.tocando && Math.random() < dt * 0.6) soltar(1, cx, cy);
    const m = Math.min(W, chao);
    const vel = (0.22 + E.grave * 0.55 + E.dropV * 0.9) * (E.bpm ? E.bpm / 120 : 0.6);
    c.globalCompositeOperation = 'lighter';
    for (let i = voadores.length - 1; i >= 0; i--) {
      const q = voadores[i];
      q.z -= dt * vel * (0.35 + (1 - q.z));          // acelera ao chegar perto
      q.rot += q.giro * dt;
      if (q.z <= 0.06) { voadores.splice(i, 1); continue; }
      const esc = 1 / q.z;
      const x = cx + Math.cos(q.a) * q.d * m * 0.12 * esc;
      const y = cy + Math.sin(q.a) * q.d * m * 0.12 * esc;
      const r = m * 0.018 * esc;
      if (x < -r * 2 || x > W + r * 2 || y < -r * 2 || y > H + r * 2) { voadores.splice(i, 1); continue; }
      // aparece do fundo, some ao encostar na câmera
      c.globalAlpha = Math.min(1, (1 - q.z) * 3) * Math.min(1, (q.z - 0.06) * 4) * 0.75;
      const cor = hsl(q.h + E.batida * 8, 95, black ? 45 : 60);
      forma(q, x, y, r, cor, E.batida);
    }
    // drop marcado: revoada
    if (E.dropV > 0.95) soltar(10, cx, cy);
  }

  // ─────────────── a pista ───────────────
  function pista(v, dt, black, sobre) {
    const toca = E.tocando;
    const hueBase = v.hue + Math.floor(Math.max(0, E.batida) / 16) * (v.faixa >= 360 ? 67 : v.faixa / 3);
    const L0 = black ? 42 : 62;
    const pal = [[hueBase, L0], [hueBase + v.faixa / 2 + 30, L0]];
    const cor = (i, a = 1) => hsl(pal[i][0], 90, pal[i][1], a);
    const quebraV = E.quebra ? 1 : 0;
    const luz = (toca ? 1 : 0.35) * (black ? 0.7 : 1) * (sobre ? 0.8 : 1);

    if (!sobre) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, black ? '#000' : '#07040f'); g.addColorStop(1, black ? '#08080a' : '#150b2a');
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }

    // reflexos do globo nas paredes: brilham com o AGUDO
    const bx = W / 2, by = chao * 0.13, br = Math.min(W * 0.08, chao * 0.09);
    c.globalCompositeOperation = 'lighter';
    for (const s of reflexos) {
      const a = s.a + giro;
      const frente = Math.cos(a);
      if (frente < -0.1) continue;
      c.globalAlpha = (0.08 + E.agudo * 0.3 + E.dropV * 0.2) * (0.4 + 0.6 * frente) * luz;
      c.fillStyle = s.c ? '#fff6e0' : cor(0);
      c.beginPath();
      c.arc(bx + Math.sin(a) * W * 0.62, chao * s.y, (1.4 + s.r * 2) * u * (0.5 + 0.5 * frente), 0, 6.283);
      c.fill();
    }

    // lasers: abrem com a energia e o grave, varrem a cada 8 tempos
    const varre = Math.sin((E.batida * Math.PI) / 8);
    const aberto = Math.min(1, E.energia * 0.6 + E.grave * 0.5 + E.dropV * 0.8);
    const nFeixe = toca ? 2 + Math.round(aberto * 5) : 1;
    const abre = 0.05 + aberto * 0.07;
    const alfaL = (0.35 + E.pulso * (E.compasso === 0 ? 0.4 : 0.25)) * (1 - quebraV * 0.85)
                * (toca ? 1 : 0.3) * (sobre ? 0.7 : 1);
    const fontes = [
      { x: W * 0.01, y: 0, base: 0.95 + varre * 0.38, cor: cor(0) },
      { x: W * 0.99, y: 0, base: Math.PI - 0.95 - varre * 0.38, cor: cor(1) },
    ];
    if (aberto > 0.6 && !E.quebra) {
      fontes.push({ x: bx, y: by + br, base: Math.PI / 2 + Math.sin((E.batida * Math.PI) / 4) * 0.5,
                    cor: cor(Math.floor(E.batida / 4) & 1) });
    }
    const L = W + H;
    for (const f of fontes) {
      c.strokeStyle = f.cor;
      for (let k = 0; k < nFeixe; k++) {
        const th = f.base + (k - (nFeixe - 1) / 2) * abre;
        const x2 = f.x + Math.cos(th) * L, y2 = f.y + Math.sin(th) * L;
        c.globalAlpha = alfaL * 0.16; c.lineWidth = 6 * dpr;
        c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(x2, y2); c.stroke();
        c.globalAlpha = alfaL * 0.75; c.lineWidth = 1.1 * dpr;
        c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(x2, y2); c.stroke();
      }
    }

    // névoa: manchas macias perto do chão, acesas pelos lasers; engrossa na quebra
    for (let i = 0; i < 3; i++) {
      const x = W * (0.2 + 0.3 * i + 0.08 * Math.sin(giro * 0.4 + i * 2.1));
      const y = chao * (0.72 + 0.05 * Math.cos(giro * 0.3 + i));
      const r = Math.max(W, chao) * 0.42;
      const f = c.createRadialGradient(x, y, 0, x, y, r);
      f.addColorStop(0, cor(i % 2, 0.22)); f.addColorStop(1, cor(i % 2, 0));
      c.globalAlpha = (0.35 + E.grave * 0.4 + quebraV * 0.35) * luz;
      c.fillStyle = f; c.fillRect(0, 0, W, chao);
    }

    // o globo
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 0.35; c.strokeStyle = '#8f86aa'; c.lineWidth = dpr;
    c.beginPath(); c.moveTo(bx, 0); c.lineTo(bx, by - br); c.stroke();
    c.globalAlpha = 1;
    c.save();
    c.beginPath(); c.arc(bx, by, br, 0, 6.283); c.clip();
    c.fillStyle = '#2a2342'; c.fillRect(bx - br, by - br, br * 2, br * 2);
    const lin = 8, fac = (br * 2) / lin, desl = (giro * 3) % 1;
    for (let j = 0; j < lin; j++) {
      const yy = by - br + j * fac;
      for (let i = -1; i <= lin; i++) {
        const xx = bx - br + (i + desl) * fac;
        const col = i - Math.floor(giro * 3);
        const dx = (xx + fac / 2 - bx) / br, dy = (yy + fac / 2 - by) / br;
        const borda = Math.max(0, 1 - (dx * dx + dy * dy));
        let q = 0.25 + hash(col * 31 + j) * 0.45;
        if (hash(col * 17 + j * 3) > 0.88) q += E.agudo * 0.6;
        q *= 0.35 + 0.65 * Math.sqrt(borda);
        const cc = Math.round(60 + q * 195);
        c.fillStyle = `rgb(${cc},${cc - 8},${Math.min(255, cc + 18)})`;
        c.fillRect(xx + 0.6 * dpr, yy + 0.6 * dpr, fac - 1.2 * dpr, fac - 1.2 * dpr);
      }
    }
    c.restore();

    // a galera
    const quantos = toca ? 0.2 + Math.min(1, E.energia * 1.1 + E.dropV * 0.3) * 0.8 : 0.12;
    const pulam = toca && !E.quebra;
    for (const p of gente) {
      p.alfa += ((p.ordem < quantos ? 1 : 0) - p.alfa) * Math.min(1, dt * 2.5);
      if (p.alfa < 0.02) continue;
      const hr = 8 * u * p.esc;
      const bt = E.batida - p.atraso;
      const f = ((bt % 1) + 1) % 1;
      const noUm = (((Math.floor(bt) % 4) + 4) % 4) === 0;
      const pp = E.reduzido ? 0 : Math.exp(-f * 5);
      const forca = (0.5 + E.grave * 0.9) * (noUm ? 1.35 : 1) * (1 + E.dropV * 1.1);
      let salto = 0, lado = 0, cabeca = 0;
      if (pulam && !E.reduzido) {
        if (p.jeito === 'pula') salto = pp * p.salto * hr * forca;
        else if (p.jeito === 'balanca') { lado = Math.sin(bt * Math.PI / 2 + p.fase) * hr * 0.5; salto = pp * hr * 0.3 * forca; }
        else if (p.jeito === 'cabeca') { cabeca = pp * hr * 0.45 * forca; salto = pp * hr * 0.15; }
        else { salto = pp * hr * 0.5 * forca; lado = Math.sin(bt * Math.PI + p.fase) * hr * 0.2; }
      } else if (toca && !E.reduzido) {
        // na quebra: todo mundo balança devagar, esperando a volta
        lado = Math.sin(E.batida * Math.PI / 4 + p.fase) * hr * 0.4;
      }
      const x = p.x + lado + Math.sin(giro * 0.2 + p.fase) * p.deriva * hr * 4;
      const y = chao + p.dy * chao - hr * 3.2 - salto;
      c.globalAlpha = p.alfa;
      c.fillStyle = p.cor; c.strokeStyle = p.cor;
      const bracos = toca && (p.braco < E.energia * 0.8 - 0.15 || p.braco < E.dropV * 0.95
                              || (p.jeito === 'acena' && p.braco < 0.7) || (E.quebra && p.braco < 0.3));
      if (bracos) {
        const acena = E.reduzido ? 0 : Math.sin(bt * Math.PI + p.fase) * 0.4;
        c.lineWidth = hr * 0.55; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x - hr * 1.05, y + hr * 1.6); c.lineTo(x - hr * (1.5 + acena), y - hr * 1.9);
        c.moveTo(x + hr * 1.05, y + hr * 1.6); c.lineTo(x + hr * (1.5 - acena), y - hr * 1.9);
        c.stroke();
      }
      c.beginPath();
      if (c.roundRect) c.roundRect(x - hr * 1.4, y + hr * 1.05, hr * 2.8, hr * 6, hr * 1.1);
      else c.rect(x - hr * 1.4, y + hr * 1.05, hr * 2.8, hr * 6);
      c.fill();
      c.beginPath(); c.arc(x, y + cabeca, hr, 0, 6.283); c.fill();
      // contorno de luz: o AGUDO acende
      c.globalAlpha = p.alfa * (0.2 + E.agudo * 0.6 + E.dropV * 0.3) * luz * (1 - p.fila * 0.25);
      c.strokeStyle = cor(p.c);
      c.lineWidth = 1.3 * dpr;
      c.beginPath(); c.arc(x, y + cabeca, hr, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    }
  }

  function quadro(agora) {
    requestAnimationFrame(quadro);
    if (!visivel || document.hidden) return;
    const dt = Math.min(0.1, (agora - tAntes) / 1000);
    if (E.reduzido && agora - tAntes < 500) return;
    // sem música: 20 quadros por segundo bastam pro ambiente
    if (!E.tocando && !confete.length && agora - tAntes < 50) return;
    tAntes = agora;
    if (!W || !H) { ajustar(); if (!W || !H) return; }

    const black = document.documentElement.dataset.tema === 'black';
    const v = VISUAL[E.estilo] || VISUAL.pista;
    if (!E.reduzido) giro += dt * (E.tocando ? 0.5 : 0.12);

    const querMilk = modo !== 'pista';
    if (querMilk && milkEstado === 'nada') iniciarMilk();
    const usaMilk = querMilk && milkEstado === 'ok';
    gl.style.display = usaMilk ? 'block' : 'none';
    bTroca.hidden = !usaMilk;
    if (usaMilk) {
      // troca de preset na virada de frase (32 tempos; 64 no hipnótico)
      const frase = E.estilo === 'hipnotico' ? 64 : 32;
      const bloco = Math.floor(Math.max(0, E.batida) / frase);
      if (E.tocando && bloco !== trocaEm) { if (trocaEm) trocar(2.7); trocaEm = bloco; }
      try { milk.render(); } catch {}
      c.clearRect(0, 0, W, H);
    } else if (querMilk) viagem(v, dt, black);
    if (modo === 'viagem' && !E.reduzido) voar(dt, black);
    if (modo !== 'viagem') pista(v, dt, black, modo === 'mistura');

    // confete: só no drop de verdade (marcador da faixa)
    if (E.drop !== ultimoDrop) {
      ultimoDrop = E.drop;
      if (!E.reduzido && E.dropReal) {
        for (let i = 0; i < 80; i++) {
          confete.push({
            x: Math.random() * W, y: -Math.random() * chao * 0.4,
            vx: (Math.random() - 0.5) * 30 * u, vy: (25 + Math.random() * 45) * u,
            r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10,
            cor: CONFETE[i % CONFETE.length], vida: 3 + Math.random() * 1.5,
          });
        }
        if (selo) { selo.classList.remove('vai'); void selo.offsetWidth; selo.classList.add('vai'); }
        if (milkEstado === 'ok') trocar(0.8);
      }
    }
    c.globalCompositeOperation = 'source-over';
    for (let i = confete.length - 1; i >= 0; i--) {
      const q = confete[i];
      q.vida -= dt;
      if (q.vida <= 0 || q.y > chao) { confete.splice(i, 1); continue; }
      q.x += (q.vx + Math.sin(q.r * 2) * 12 * u) * dt;
      q.y += q.vy * dt;
      q.r += q.vr * dt;
      c.globalAlpha = Math.min(1, q.vida);
      c.fillStyle = q.cor;
      c.setTransform(Math.cos(q.r), Math.sin(q.r), -Math.sin(q.r), Math.cos(q.r), q.x, q.y);
      const hh = 8 * u * Math.abs(Math.cos(q.r * 1.7)) + 0.5;
      c.fillRect(-2.5 * u, -hh / 2, 5 * u, hh);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);

    // vinheta
    c.globalAlpha = 1;
    const vi = c.createRadialGradient(W / 2, chao / 2, Math.min(W, chao) * 0.35, W / 2, chao / 2, Math.max(W, H) * 0.75);
    vi.addColorStop(0, 'rgba(0,0,0,0)'); vi.addColorStop(1, 'rgba(0,0,0,.5)');
    c.fillStyle = vi; c.fillRect(0, 0, W, H);

    // rótulo estável: muda quando o estado muda, não a cada contagem
    if (rot && rotulo && agora - tRotulo > 400) {
      tRotulo = agora;
      const tx = rotulo(E);
      if (tx !== textoAntes) { textoAntes = tx; rot.innerHTML = tx; }
    }
  }
  requestAnimationFrame(quadro);
}
