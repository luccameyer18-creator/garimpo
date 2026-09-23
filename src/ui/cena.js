/**
 * Os efeitos da pista, na TELA INTEIRA, por cima da CDJ.
 *
 * Eram desenhados num quadrado embaixo do mixer. Agora são uma camada do
 * tamanho da tela, na frente de tudo, com mistura "screen": a luz dos efeitos
 * SOMA sobre os painéis e o escuro deixa os controles aparecerem normais —
 * dá pra ler e clicar (a camada não pega clique).
 *
 *   LASERS   dos dois cantos de cima, cruzando a CDJ; varrem a cada 8 tempos,
 *            trocam de cor a cada frase de 16, abrem com a energia e o grave
 *   GALERA   silhuetas de NEON dançando na borda de baixo: cada pessoa com um
 *            jeito (pula, balança, cabeceia, acena) e um atraso próprio; pulo
 *            pelo grave com acento no 1 do compasso, contorno aceso pelo agudo
 *   DROP     confete e o "DROP!" no meio da tela — só em drop MARCADO na faixa
 *   QUEBRA   a luz baixa e a galera só balança, esperando a volta
 *
 * O globo, os reflexos e a névoa moram em pista.js (#luzes), também na frente.
 * Com a VIAGEM ligada (viagem.js), os lasers saem — a viagem já ocupa a tela —
 * e ficam a galera e o confete.
 *
 * LEVE: desenha a metade da resolução da tela (a placa amplia), 30 quadros
 * por segundo, e só redesenha o que muda. O ✨ do painel desliga tudo.
 *
 * ACESSIBILIDADE: sem clarão, sem liga-desliga de tela inteira. Com
 * `prefers-reduced-motion` a cena fica parada.
 */

import { estadoPista as E } from './pista.js';
import { qualidade as Q, aoMudarQualidade } from './qualidade.js';

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
// resolução da camada em relação à tela, por nível de qualidade (qualidade.js)
const ESCALA = { 3: 0.5, 2: 0.35, 1: 0.3, 0: 0.3 };

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

  // ✨ efeitos ligados/desligados (lembra)
  let ativos = true;
  try { ativos = localStorage.getItem('garimpo.efeitos') !== '0'; } catch {}
  const bEfeitos = document.createElement('button');
  bEfeitos.className = 'cena-modo';
  bEfeitos.type = 'button';
  const pintarEfeitos = () => {
    bEfeitos.textContent = ativos ? `✨ ${Q.nivel}/3` : '✨ off';
    bEfeitos.title = `efeitos: nível ${Q.nivel} de 3, ajustado sozinho pra não travar (${Q.fps || '—'} fps)`;
    bEfeitos.classList.toggle('lig', ativos);
    cv.style.display = ativos ? 'block' : 'none';
    document.body.classList.toggle('sem-efeitos', !ativos);
  };
  bEfeitos.onclick = () => {
    ativos = !ativos;
    try { localStorage.setItem('garimpo.efeitos', ativos ? '1' : '0'); } catch {}
    pintarEfeitos();
  };
  el.appendChild(bEfeitos);

  // 🌀 a viagem da página inteira; ↻ troca o visual dela
  const bViagem = document.createElement('button');
  bViagem.className = 'cena-viagem';
  bViagem.type = 'button';
  bViagem.textContent = '🌀 viagem';
  const bTroca = document.createElement('button');
  bTroca.className = 'cena-troca';
  bTroca.type = 'button';
  bTroca.textContent = '↻';
  bTroca.hidden = true;
  bViagem.onclick = () => {
    const on = viagem?.alternar();
    bViagem.classList.toggle('lig', !!on);
    bTroca.hidden = !on;
  };
  bTroca.onclick = () => viagem?.trocar?.(1.2);
  if (viagem) { el.appendChild(bViagem); el.appendChild(bTroca); }
  pintarEfeitos();

  let W = 0, H = 0, u = 1, gente = [];
  const confete = [];

  /** A galera numa fileira só, na borda de baixo da tela. */
  function montarGente() {
    gente = [];
    const JEITOS = ['pula', 'pula', 'balanca', 'cabeca', 'acena'];
    const passo = 34 * u;
    const n = Math.max(6, Math.ceil(W / passo));
    for (let i = 0; i < n; i++) {
      const k = i + 1;
      gente.push({
        x: (i + 0.5 + (hash(k) - 0.5) * 0.6) * (W / n),
        esc: 0.8 + hash(k + 2) * 0.4,
        jeito: JEITOS[Math.floor(hash(k + 21) * JEITOS.length)],
        salto: 0.7 + hash(k + 3) * 0.8,
        // atraso próprio: ninguém na pista pula junto de verdade
        atraso: hash(k + 5) * 0.08 + (hash(k + 6) < 0.15 ? 0.5 : 0),
        braco: hash(k + 8), fase: hash(k + 11) * 6.28, ordem: hash(k + 13),
        alfa: 0, c: k % 2,
      });
    }
  }

  function ajustar() {
    const esc = ESCALA[Q.nivel] ?? 0.5;
    const w = Math.round(innerWidth * esc), h = Math.round(innerHeight * esc);
    if (w === W && h === H) return;
    W = cv.width = w; H = cv.height = h;
    u = Math.max(0.5, Math.min(W, H * 1.6) / 600);
    montarGente();
  }
  addEventListener('resize', ajustar);
  aoMudarQualidade(() => { ajustar(); pintarEfeitos(); });
  ajustar();

  let ultimoDrop = E.drop, tAntes = 0, giro = 0, textoAntes = '', tRotulo = 0;

  function lasers(pal, luz) {
    const varre = Math.sin((E.batida * Math.PI) / 8);          // uma ida por 8 tempos
    const aberto = Math.min(1, E.energia * 0.6 + E.grave * 0.5 + E.dropV * 0.8);
    const n = E.tocando ? 2 + Math.round(aberto * 5) : 1;
    const abre = 0.04 + aberto * 0.06;
    const alfa = (0.3 + E.pulso * (E.compasso === 0 ? 0.35 : 0.2)) * (E.quebra ? 0.15 : 1) * (E.tocando ? 1 : 0.25) * luz;
    const fontes = [
      { x: 0, y: 0, base: 0.8 + varre * 0.35, cor: pal[0] },
      { x: W, y: 0, base: Math.PI - 0.8 - varre * 0.35, cor: pal[1] },
    ];
    if (aberto > 0.6 && !E.quebra) {
      fontes.push({ x: W / 2, y: 0, base: Math.PI / 2 + Math.sin((E.batida * Math.PI) / 4) * 0.55, cor: pal[Math.floor(E.batida / 4) & 1] });
    }
    const L = W + H;
    for (const f of fontes) {
      c.strokeStyle = f.cor;
      for (let k = 0; k < n; k++) {
        const th = f.base + (k - (n - 1) / 2) * abre;
        const x2 = f.x + Math.cos(th) * L, y2 = f.y + Math.sin(th) * L;
        c.globalAlpha = alfa * 0.14; c.lineWidth = 5 * u;
        c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(x2, y2); c.stroke();
        c.globalAlpha = alfa * 0.7; c.lineWidth = Math.max(1, 1.1 * u);
        c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(x2, y2); c.stroke();
      }
    }
  }

  function galera(pal, dt, luz) {
    const toca = E.tocando;
    const quantos = toca ? 0.25 + Math.min(1, E.energia * 1.1 + E.dropV * 0.3) * 0.75 : 0.15;
    const pulam = toca && !E.quebra;
    c.lineCap = 'round';
    for (const p of gente) {
      p.alfa += ((p.ordem < quantos ? 1 : 0) - p.alfa) * Math.min(1, dt * 2.5);
      if (p.alfa < 0.02) continue;
      const hr = 9 * u * p.esc;
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
        lado = Math.sin(E.batida * Math.PI / 4 + p.fase) * hr * 0.4;
      }
      const x = p.x + lado;
      const y = H - hr * 2.4 - salto;              // metade do corpo aparece na borda
      // silhueta de NEON: só o contorno, aceso pelo agudo — por cima da CDJ
      // um corpo cheio taparia os controles; o contorno não
      c.globalAlpha = p.alfa * (0.35 + E.agudo * 0.45 + E.dropV * 0.2) * luz;
      c.strokeStyle = pal[p.c];
      c.lineWidth = Math.max(1, 1.4 * u);
      c.beginPath(); c.arc(x, y + cabeca, hr, 0, 6.283); c.stroke();
      c.beginPath();
      c.moveTo(x - hr * 1.4, H + 2); c.lineTo(x - hr * 1.4, y + hr * 2.1);
      c.quadraticCurveTo(x - hr * 1.4, y + hr * 1.2, x, y + hr * 1.2);
      c.quadraticCurveTo(x + hr * 1.4, y + hr * 1.2, x + hr * 1.4, y + hr * 2.1);
      c.lineTo(x + hr * 1.4, H + 2);
      c.stroke();
      const bracos = toca && (p.braco < E.energia * 0.8 - 0.15 || p.braco < E.dropV * 0.95
                              || (p.jeito === 'acena' && p.braco < 0.7) || (E.quebra && p.braco < 0.3));
      if (bracos) {
        const acena = E.reduzido ? 0 : Math.sin(bt * Math.PI + p.fase) * 0.4;
        c.beginPath();
        c.moveTo(x - hr * 1.2, y + hr * 1.7); c.lineTo(x - hr * (1.5 + acena), y - hr * 1.9);
        c.moveTo(x + hr * 1.2, y + hr * 1.7); c.lineTo(x + hr * (1.5 - acena), y - hr * 1.9);
        c.stroke();
      }
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
    if (!ativos || Q.nivel === 0) { if (tAntes) { c.clearRect(0, 0, W, H); tAntes = 0; } return; }
    if (agora - tAntes < (E.tocando || confete.length ? 33 : 66)) return;   // 30 fps; 15 sem música
    if (E.reduzido && agora - tAntes < 500) return;
    const dt = Math.min(0.1, (agora - tAntes) / 1000);
    tAntes = agora;

    const black = document.documentElement.dataset.tema === 'black';
    const v = VISUAL[E.estilo] || VISUAL.pista;
    const hueBase = v.hue + Math.floor(Math.max(0, E.batida) / 16) * (v.faixa >= 360 ? 67 : v.faixa / 3);
    const L0 = black ? 45 : 62;
    const pal = [hsl(hueBase, 90, L0), hsl(hueBase + v.faixa / 2 + 30, 90, L0)];
    const luz = black ? 0.6 : 1;
    if (!E.reduzido) giro += dt * (E.tocando ? 0.5 : 0.12);

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    // nível 1: só confete e DROP; do 2 pra cima, lasers e galera
    if (Q.nivel >= 2) {
      if (!viagem?.ligada) lasers(pal, luz);
      galera(pal, dt, luz);
    }

    // confete: só no drop de verdade (marcador da faixa)
    if (E.drop !== ultimoDrop) {
      ultimoDrop = E.drop;
      if (!E.reduzido && E.dropReal) {
        for (let i = 0; i < 90; i++) {
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
