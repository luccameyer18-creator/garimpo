/**
 * A janela da pista — o que o DJ vê da cabine.
 *
 * Globo espelhado girando, lasers varrendo por cima da galera, e a galera
 * pulando no bumbo. Tudo lê `estadoPista` (pista.js), que vem da GRADE de
 * batidas do deck no ar — o mesmo relógio do ENCAIXAR. Por isso:
 *
 *   - a galera pula exatamente no bumbo, e cada um com a sua altura
 *   - os lasers fazem uma varrida a cada 8 tempos, e trocam de cor a cada
 *     frase de 16 — como um operador de luz que conta a música
 *   - mais som, mais gente na pista e mais braço pra cima
 *   - na QUEBRA a luz baixa e só o globo fica; no DROP abre tudo, a galera
 *     pula junto e cai confete
 *
 * Canvas 2D e não DOM: são ~60 pessoas, ~30 feixes e ~100 facetas por quadro,
 * e isso em elementos HTML seria layout demais. Num canvas é só pintar.
 *
 * ACESSIBILIDADE: nenhum clarão de tela cheia, nenhum liga-desliga. Os feixes
 * variam de intensidade entre ~40% e ~75%, nunca de apagado a aceso. Com
 * `prefers-reduced-motion` a cena fica parada e só redesenha devagar.
 */

import { estadoPista as E } from './pista.js';

/** Pares de cor por frase: esquerda, direita. */
const PALETAS = [
  ['#ff4ecd', '#4cc9f0'], ['#ffb347', '#c77dff'], ['#2ee6a8', '#ff4ecd'],
  ['#4cc9f0', '#ffb347'], ['#c77dff', '#2ee6a8'],
];
/** No tema all black: as mesmas famílias de cor, bem mais fundas. */
const PALETAS_BLACK = [
  ['#8e2a70', '#1f6f8c'], ['#8c6124', '#5b3d85'], ['#1b7a5c', '#8e2a70'],
  ['#1f6f8c', '#8c6124'], ['#5b3d85', '#1b7a5c'],
];
const CONFETE = ['#ff4ecd', '#4cc9f0', '#ffb347', '#2ee6a8', '#c77dff', '#fff2b3'];

/** Pseudo-aleatório estável por inteiro (pras facetas do globo não tremerem). */
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/**
 * @param {HTMLElement} el   a caixa da janela; o canvas é criado dentro
 * @param {object} [op]
 * @param {function} [op.rotulo]  (estado) => texto do rótulo, ou null
 */
export function montarCena(el, { rotulo = null } = {}) {
  const cv = document.createElement('canvas');
  el.prepend(cv);
  const c = cv.getContext('2d');
  const rot = el.querySelector('.cena-rot');
  const selo = el.querySelector('.cena-drop');

  let W = 0, H = 0, dpr = 1, u = 1;
  let gente = [];
  const confete = [];
  const reflexos = Array.from({ length: 40 }, (_, i) => ({
    a: hash(i) * Math.PI * 2, y: 0.05 + hash(i + 99) * 0.7, r: 0.6 + hash(i + 7) * 0.9, c: i % 2,
  }));

  /** Distribui a galera em três fileiras; a de trás é menor e mais apagada. */
  function montarGente() {
    gente = [];
    const filas = [{ y: 0.74, esc: 0.55, cor: '#1c1433' }, { y: 0.86, esc: 0.78, cor: '#130d25' },
                   { y: 1.0, esc: 1.05, cor: '#08050f' }];
    let k = 0;
    filas.forEach((f, fi) => {
      const passo = 30 * u * f.esc;
      const n = Math.max(3, Math.ceil(W / passo) + 1);
      for (let i = 0; i < n; i++) {
        k++;
        gente.push({
          fila: fi, esc: f.esc, cor: f.cor, yb: f.y,
          x: (i + 0.5 + (hash(k) - 0.5) * 0.7) * (W / n),
          salto: 0.7 + hash(k + 3) * 0.8,
          // 1 em 5 pula no contratempo — sem isso parece um exército marchando
          off: hash(k + 5) < 0.2 ? 0.5 : (hash(k + 6) - 0.5) * 0.08,
          braco: hash(k + 8),                  // limiar de energia pra levantar os braços
          fase: hash(k + 11) * 6.28,
          ordem: hash(k + 13),                 // quem chega primeiro na pista
          alfa: 0,
          c: k % 2,
        });
      }
    });
    // fileira de trás primeiro: quem está na frente cobre quem está atrás
    gente.sort((a, b) => a.fila - b.fila);
  }

  function ajustar() {
    // 1,5x basta pra uma cena que se mexe o tempo todo; 2x é o dobro de pixel
    dpr = Math.min(1.5, devicePixelRatio || 1);
    const w = Math.round(el.clientWidth * dpr), h = Math.round(el.clientHeight * dpr);
    if (w === W && h === H) return;
    W = cv.width = w; H = cv.height = h;
    u = Math.max(0.6, Math.min(W, H * 1.2) / 300);
    montarGente();
  }
  new ResizeObserver(ajustar).observe(el);

  // não pinta o que ninguém vê (celular com a janela fora da tela)
  let visivel = true;
  new IntersectionObserver((es) => { visivel = es[0]?.isIntersecting ?? true; }).observe(el);

  let ultimoDrop = E.drop, tAntes = performance.now(), giro = 0, textoAntes = '', tRotulo = 0;

  function quadro(agora) {
    requestAnimationFrame(quadro);
    if (!visivel || document.hidden) return;
    const dt = Math.min(0.1, (agora - tAntes) / 1000);
    if (E.reduzido && agora - tAntes < 500) return;
    // sem música a cena é só ambiente: 20 quadros por segundo bastam
    if (!E.tocando && !confete.length && agora - tAntes < 50) return;
    tAntes = agora;
    if (!W || !H) { ajustar(); if (!W || !H) return; }

    const toca = E.tocando;
    const black = document.documentElement.dataset.tema === 'black';
    const tabela = black ? PALETAS_BLACK : PALETAS;
    const pal = tabela[Math.floor(Math.max(0, E.batida) / 16) % tabela.length];
    const quebraV = E.quebra ? 1 : 0;
    const luz = (toca ? 1 : 0.35) * (black ? 0.7 : 1);
    if (!E.reduzido) giro += dt * (toca ? 0.5 : 0.12);

    // ── fundo e fumaça
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, black ? '#000' : '#07040f'); g.addColorStop(1, black ? '#08080a' : '#150b2a');
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const x = W * (0.2 + 0.3 * i + 0.06 * Math.sin(giro * 0.3 + i * 2));
      const y = H * (0.45 + 0.08 * Math.cos(giro * 0.25 + i));
      const r = Math.max(W, H) * 0.45;
      const f = c.createRadialGradient(x, y, 0, x, y, r);
      f.addColorStop(0, pal[i % 2] + '30'); f.addColorStop(1, pal[i % 2] + '00');
      c.globalAlpha = (0.35 + E.energia * 0.5) * luz;
      c.fillStyle = f; c.fillRect(0, 0, W, H);
    }

    // ── reflexos do globo andando pelas paredes
    const bx = W / 2, by = H * 0.14, br = Math.min(W * 0.085, H * 0.09);
    for (const s of reflexos) {
      const a = s.a + giro;
      const frente = Math.cos(a);
      if (frente < -0.1) continue;
      const x = bx + Math.sin(a) * W * 0.62;
      const y = H * s.y;
      c.globalAlpha = (0.10 + E.pulso * 0.16 + E.dropV * 0.2) * (0.4 + 0.6 * frente) * luz;
      c.fillStyle = s.c ? '#fff6e0' : pal[0];
      c.beginPath(); c.arc(x, y, (1.5 + s.r * 2.2) * u * (0.5 + 0.5 * frente), 0, 6.283); c.fill();
    }

    // ── lasers: dois canhões nos cantos, um no meio quando a música abre
    const varre = Math.sin((E.batida * Math.PI) / 8);           // uma ida por 8 tempos
    const aberto = E.energia + E.dropV * 0.8;
    const nFeixe = toca ? 2 + Math.round(Math.min(1, aberto) * 5) : 1;
    const abre = 0.05 + Math.min(1, aberto) * 0.07 + E.dropV * 0.06;
    const alfaL = (0.40 + E.pulso * 0.35) * (1 - quebraV * 0.85) * (toca ? 1 : 0.3);
    const fontes = [
      { x: W * 0.01, y: H * 0.02, base: 0.95 + varre * 0.38, cor: pal[0] },
      { x: W * 0.99, y: H * 0.02, base: Math.PI - 0.95 - varre * 0.38, cor: pal[1] },
    ];
    if (aberto > 0.6 && !E.quebra) {
      fontes.push({ x: bx, y: by + br, base: Math.PI / 2 + Math.sin((E.batida * Math.PI) / 4) * 0.5, cor: pal[(Math.floor(E.batida / 4) & 1)] });
    }
    const L = W + H;
    for (const f of fontes) {
      c.strokeStyle = f.cor;
      for (let k = 0; k < nFeixe; k++) {
        const th = f.base + (k - (nFeixe - 1) / 2) * abre;
        const x2 = f.x + Math.cos(th) * L, y2 = f.y + Math.sin(th) * L;
        c.globalAlpha = alfaL * 0.18; c.lineWidth = 6 * dpr;
        c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(x2, y2); c.stroke();
        c.globalAlpha = alfaL * 0.8; c.lineWidth = 1.1 * dpr;
        c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(x2, y2); c.stroke();
      }
      // o ponto de onde a luz sai
      c.globalAlpha = alfaL;
      c.fillStyle = f.cor;
      c.beginPath(); c.arc(f.x, f.y, 3 * dpr, 0, 6.283); c.fill();
    }

    // ── o globo
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 0.35;
    c.strokeStyle = '#8f86aa'; c.lineWidth = dpr;
    c.beginPath(); c.moveTo(bx, 0); c.lineTo(bx, by - br); c.stroke();
    c.globalAlpha = 1;
    c.save();
    c.beginPath(); c.arc(bx, by, br, 0, 6.283); c.clip();
    c.fillStyle = '#2a2342'; c.fillRect(bx - br, by - br, br * 2, br * 2);
    const lin = 8, fac = (br * 2) / lin;
    const desl = (giro * 3) % 1;
    for (let j = 0; j < lin; j++) {
      const yy = by - br + j * fac;
      for (let i = -1; i <= lin; i++) {
        const xx = bx - br + (i + desl) * fac;
        const col = i - Math.floor(giro * 3);
        const dx = (xx + fac / 2 - bx) / br, dy = (yy + fac / 2 - by) / br;
        const borda = Math.max(0, 1 - (dx * dx + dy * dy));
        let v = 0.25 + hash(col * 31 + j) * 0.45;
        if (hash(col * 17 + j * 3) > 0.88) v += E.pulso * 0.5;       // faceta que pega a luz
        v *= 0.35 + 0.65 * Math.sqrt(borda);
        const cc = Math.round(60 + v * 195);
        c.fillStyle = `rgb(${cc},${cc - 8},${Math.min(255, cc + 18)})`;
        c.fillRect(xx + 0.6 * dpr, yy + 0.6 * dpr, fac - 1.2 * dpr, fac - 1.2 * dpr);
      }
    }
    c.restore();
    c.globalCompositeOperation = 'lighter';
    const gl = c.createRadialGradient(bx, by, br * 0.6, bx, by, br * 3);
    gl.addColorStop(0, pal[0] + '55'); gl.addColorStop(1, pal[0] + '00');
    c.globalAlpha = (0.35 + E.pulso * 0.35 + E.dropV * 0.3) * luz;
    c.fillStyle = gl; c.fillRect(bx - br * 3, by - br * 3, br * 6, br * 6);

    // ── luz no chão, embaixo da galera
    const ch = c.createRadialGradient(W / 2, H * 1.05, 0, W / 2, H * 1.05, W * 0.75);
    ch.addColorStop(0, pal[1] + '66'); ch.addColorStop(1, pal[1] + '00');
    c.globalAlpha = (0.18 + E.pulso * 0.3 * E.energia + E.dropV * 0.25) * luz;
    c.fillStyle = ch; c.fillRect(0, H * 0.5, W, H * 0.55);

    // ── a galera
    c.globalCompositeOperation = 'source-over';
    const quantos = toca ? 0.2 + Math.min(1, E.energia * 1.1 + E.dropV * 0.3) * 0.8 : 0.12;
    const pulam = toca && !E.quebra;
    for (const p of gente) {
      p.alfa += ((p.ordem < quantos ? 1 : 0) - p.alfa) * Math.min(1, dt * 2.5);
      if (p.alfa < 0.02) continue;
      const hr = 8.5 * u * p.esc;
      const f = ((((E.batida + p.off) % 1) + 1) % 1);
      const pulsoP = E.reduzido ? 0 : Math.exp(-f * 5);
      const salto = pulam ? pulsoP * p.salto * hr * (0.9 + E.dropV * 1.2) : 0;
      // na quebra ninguém pula: o corpo balança devagar, esperando a volta
      const balanco = !E.reduzido && toca ? Math.sin(E.batida * Math.PI / 2 + p.fase) * hr * (E.quebra ? 0.35 : 0.12) : 0;
      const x = p.x + balanco;
      const y = H * p.yb - hr * 3.2 - salto;
      c.globalAlpha = p.alfa;
      c.fillStyle = p.cor;
      c.strokeStyle = p.cor;

      // braços pra cima: mais energia, mais braço; no drop, quase todo mundo
      const bracos = toca && (p.braco < E.energia * 0.8 - 0.15 || p.braco < E.dropV * 0.9 || (E.quebra && p.braco < 0.3));
      if (bracos) {
        const acena = E.reduzido ? 0 : Math.sin(E.batida * Math.PI + p.fase) * 0.35;
        c.lineWidth = hr * 0.55; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x - hr * 1.05, y + hr * 1.6);
        c.lineTo(x - hr * (1.5 + acena), y - hr * 1.9);
        c.moveTo(x + hr * 1.05, y + hr * 1.6);
        c.lineTo(x + hr * (1.5 - acena), y - hr * 1.9);
        c.stroke();
      }
      // tronco e cabeça
      c.beginPath();
      if (c.roundRect) c.roundRect(x - hr * 1.4, y + hr * 1.05, hr * 2.8, hr * 5, hr * 1.1);
      else c.rect(x - hr * 1.4, y + hr * 1.05, hr * 2.8, hr * 5);
      c.fill();
      c.beginPath(); c.arc(x, y, hr, 0, 6.283); c.fill();
      // contorno de luz no topo da cabeça, na cor do laser do lado dela
      c.globalAlpha = p.alfa * (0.25 + E.pulso * 0.45 + E.dropV * 0.3) * luz * (1 - p.fila * 0.25);
      c.strokeStyle = pal[p.c];
      c.lineWidth = 1.3 * dpr;
      c.beginPath(); c.arc(x, y, hr, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    }

    // ── confete no drop
    if (E.drop !== ultimoDrop) {
      ultimoDrop = E.drop;
      if (!E.reduzido) {
        for (let i = 0; i < 90; i++) {
          confete.push({
            x: Math.random() * W, y: -Math.random() * H * 0.4,
            vx: (Math.random() - 0.5) * 30 * u, vy: (25 + Math.random() * 45) * u,
            r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10,
            cor: CONFETE[i % CONFETE.length], vida: 3.5 + Math.random() * 1.5,
          });
        }
        if (selo) { selo.classList.remove('vai'); void selo.offsetWidth; selo.classList.add('vai'); }
      }
    }
    for (let i = confete.length - 1; i >= 0; i--) {
      const q = confete[i];
      q.vida -= dt;
      if (q.vida <= 0 || q.y > H + 10) { confete.splice(i, 1); continue; }
      q.x += (q.vx + Math.sin(q.r * 2) * 12 * u) * dt;
      q.y += q.vy * dt;
      q.r += q.vr * dt;
      c.globalAlpha = Math.min(1, q.vida);
      c.fillStyle = q.cor;
      c.setTransform(Math.cos(q.r), Math.sin(q.r), -Math.sin(q.r), Math.cos(q.r), q.x, q.y);
      c.fillRect(-2.5 * u, -4 * u * Math.abs(Math.cos(q.r * 1.7)), 5 * u, 8 * u * Math.abs(Math.cos(q.r * 1.7)) + 0.5);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);

    // ── vinheta
    c.globalAlpha = 1;
    const vi = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vi.addColorStop(0, 'rgba(0,0,0,0)'); vi.addColorStop(1, 'rgba(0,0,0,.55)');
    c.fillStyle = vi; c.fillRect(0, 0, W, H);

    if (rot && rotulo && agora - tRotulo > 250) {
      tRotulo = agora;
      let pessoas = 0;
      for (const p of gente) if (p.alfa > 0.5) pessoas++;
      const tx = rotulo({ ...E, pessoas });
      if (tx !== textoAntes) { textoAntes = tx; rot.innerHTML = tx; }
    }
  }
  requestAnimationFrame(quadro);
}
