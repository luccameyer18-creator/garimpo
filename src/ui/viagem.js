/**
 * MODO VIAGEM — a página inteira entra na viagem, não só uma janelinha.
 *
 * Abre no HIPERESPAÇO (hiperespaco.js): as imagens que quem fumou DMT
 * descreve — crisântemo, túnel, mandala, joias, fractal — geradas na placa
 * de vídeo e dançando com a música. O ↻ passa pelas cinco cenas e depois
 * pelo MilkDrop (com as formas voando); mais um ↻ volta pro hiperespaço.
 *
 *   POR CIMA o MilkDrop (Butterchurn) cobre a tela inteira, na frente da CDJ,
 *           com mistura "screen": a luz soma, o escuro deixa ver os controles
 *   NA FRENTE formas psicodélicas (anéis, estrelas, olhos, espirais, flores,
 *           mandalas) nascem no centro e voam em 3D na direção de quem olha,
 *           passando por cima dos botões (sem pegar clique)
 *
 * LEVE DE PROPÓSITO — a primeira versão travava:
 *   - os dois canvas desenham em resolução BAIXA (o fundo a ~1/3 da tela, a
 *     frente a ~1/2) e a placa de vídeo amplia; num visualizador isso é
 *     bonito, e são 9x menos pixels pra pintar
 *   - 30 quadros por segundo, não 60
 *   - um MilkDrop só na página (a janela da cabine não roda o dela junto)
 *   - as luzes normais da pista (#pista, #luzes) desligam enquanto dura
 *   - para tudo com a aba escondida
 *
 * Tudo segue a música por `estadoPista`: formas nascem no bumbo, correm com
 * o grave, revoada no drop; o preset do MilkDrop troca a cada frase.
 */

import { estadoPista as E } from './pista.js';
import { qualidade as Q, aoMudarQualidade } from './qualidade.js';
import { montarHiperespaco } from './hiperespaco.js';
import { desenharAparicao, sortearTipo } from './aparicoes.js';

// o MilkDrop desenha 1/3 da tela (menos, se o medidor baixar a resolução);
// quantas formas voam depende do modo escolhido (leve, médio, bombando)
const MAX_FORMAS = { 3: 44, 2: 22, 1: 8, 0: 0 };

const FORMAS = ['anel', 'estrela', 'olho', 'espiral', 'flor', 'mandala'];
const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360},${s}%,${l}%)`;

/**
 * @param {object} op
 * @param {function} op.audio   () => { ctx, no } | null — de onde o MilkDrop escuta
 */
export function montarViagem({ audio }) {
  const fundo = document.createElement('canvas');
  fundo.id = 'viagem-fundo';
  fundo.setAttribute('aria-hidden', 'true');
  const frente = document.createElement('canvas');
  frente.id = 'viagem-frente';
  frente.setAttribute('aria-hidden', 'true');
  const hiperCv = document.createElement('canvas');
  hiperCv.id = 'viagem-hiper';
  hiperCv.setAttribute('aria-hidden', 'true');
  document.body.prepend(fundo);
  document.body.prepend(hiperCv);
  document.body.appendChild(frente);
  const c = frente.getContext('2d');
  // o hiperespaço é o padrão; sem WebGL, a viagem fica no MilkDrop
  const hiper = montarHiperespaco(hiperCv);
  let modo = hiper ? 'hiper' : 'milk';
  const pintarModo = () => document.body.classList.toggle('viagem-milk', modo === 'milk');

  /**
   * AS APARIÇÕES (aparicoes.js): os seres e as figuras que os relatos de DMT
   * descrevem, surgindo por cima do hiperespaço — uma por vez. Nascem numa
   * virada de frase (16 tempos), com mais chance quanto mais forte o ✨; no
   * drop vem sempre um SER (de luz, elfos máquina, louva-a-deus) ou o olho.
   * Surgem em 4 tempos, vivem ~24, se dissolvem em 6. Relógio próprio em
   * tempos, pra continuar vivo mesmo sem música.
   */
  let apar = null, relogioAp = 0, fraseAp = -1, dropAp = 0, tipoAntes = null;
  const VIDA = 24;
  function nascer(tipo) {
    tipoAntes = tipo;
    apar = { tipo, nasce: relogioAp, semente: Math.random() * 1000, hue: Math.random() * 360 };
  }
  function aparicoes(dt) {
    relogioAp += dt * ((E.tocando && E.bpm ? E.bpm : 100) / 60);
    if (apar && relogioAp - apar.nasce > VIDA + 6) apar = null;
    if (!apar && !E.reduzido) {
      const f16 = Math.floor(Math.max(0, E.batida) / 16);
      if (E.dropReal && E.drop !== dropAp && E.dropV > 0.9) {
        dropAp = E.drop;
        nascer(['entidade', 'mantis', 'elfos', 'olho'][Math.floor(Math.random() * 4)]);
      } else if (E.tocando && f16 !== fraseAp) {
        fraseAp = f16;
        if (Math.random() < [0, 0.35, 0.6, 0.9][Q.nivel || 2]) nascer(sortearTipo(tipoAntes));
      } else if (!E.tocando && Math.random() < dt * 0.05) nascer(sortearTipo(tipoAntes));
    }
    if (!apar) return;
    const idade = relogioAp - apar.nasce;
    const alfa = Math.min(1, idade / 4) * Math.min(1, Math.max(0, (VIDA + 6 - idade) / 6));
    const m = Math.min(W, H);
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = alfa * 0.95;
    c.shadowBlur = 0;
    desenharAparicao(c, apar.tipo, W / 2, H * 0.52, m * (apar.tipo === 'serpente' ? 0.28 : 0.33), E,
                     apar.hue + relogioAp * 2, apar.semente);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  let ligada = false, milk = null, estado = 'nada', presets = null, nomes = [], atual = -1, frase = -1;
  let W = 0, H = 0, FW = 0, FH = 0, tAntes = 0, batidaVoo = -1;
  const voadores = [];

  function medir() {
    // fundo a ~1/3, frente a ~1/2 da resolução da tela (em pixels CSS)
    const dv = 3 / Q.escala;
    FW = Math.max(200, Math.round(innerWidth / dv)); FH = Math.max(120, Math.round(innerHeight / dv));
    W = Math.max(320, Math.round(innerWidth / 2)); H = Math.max(180, Math.round(innerHeight / 2));
    fundo.width = FW; fundo.height = FH;
    frente.width = W; frente.height = H;
    hiper?.tamanho(FW, FH);
    try { milk?.setRendererSize(FW, FH); } catch {}
  }
  addEventListener('resize', () => { if (ligada) medir(); });
  aoMudarQualidade(() => { if (ligada) medir(); });

  function trocar(fusao = 2.7) {
    if (!milk || !nomes.length) return;
    let i = Math.floor(Math.random() * nomes.length);
    if (i === atual) i = (i + 1) % nomes.length;
    atual = i;
    try { milk.loadPreset(presets[nomes[i]], fusao); } catch {}
  }

  async function iniciarMilk() {
    const a = audio();
    if (!a?.ctx || !a?.no) return;
    estado = 'carregando';
    try {
      const [m1, m2] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/butterchurn@2.6.7/+esm'),
        import('https://cdn.jsdelivr.net/npm/butterchurn-presets@2.4.7/lib/butterchurnPresets.min.js/+esm'),
      ]);
      const bc = m1.default?.default || m1.default || m1;
      const pr = m2.default?.getPresets ? m2.default : m2.default?.default || m2;
      presets = pr.getPresets();
      nomes = Object.keys(presets);
      milk = bc.createVisualizer(a.ctx, fundo, { width: FW, height: FH, pixelRatio: 1, textureRatio: 1 });
      milk.connectAudio(a.no);
      trocar(0);
      estado = 'ok';
    } catch (e) {
      estado = 'falhou';
      console.warn('MilkDrop indisponível:', e.message);
    }
  }

  function soltar(n) {
    for (let i = 0; i < n && voadores.length < (MAX_FORMAS[Q.nivel] ?? 40); i++) {
      voadores.push({
        forma: FORMAS[Math.floor(Math.random() * FORMAS.length)],
        a: Math.random() * Math.PI * 2, d: 0.15 + Math.random() * 0.85,
        z: 1, giro: (Math.random() - 0.5) * 3, rot: Math.random() * 6.28, h: Math.random() * 360,
      });
    }
  }

  function forma(q, x, y, r, t) {
    c.setTransform(Math.cos(q.rot), Math.sin(q.rot), -Math.sin(q.rot), Math.cos(q.rot), x, y);
    c.lineWidth = Math.max(1, r * 0.12);
    c.beginPath();
    if (q.forma === 'anel') { c.arc(0, 0, r, 0, 6.283); c.moveTo(r * 0.6, 0); c.arc(0, 0, r * 0.6, 0, 6.283); c.stroke(); }
    else if (q.forma === 'estrela') {
      for (let k = 0; k <= 10; k++) { const rr = k % 2 ? r * 0.45 : r; const a = (k / 10) * Math.PI * 2; if (k) c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else c.moveTo(rr, 0); }
      c.stroke();
    } else if (q.forma === 'olho') {
      c.moveTo(-r, 0); c.quadraticCurveTo(0, -r * 0.8, r, 0); c.quadraticCurveTo(0, r * 0.8, -r, 0); c.stroke();
      c.beginPath(); c.arc(0, 0, r * 0.32, 0, 6.283); c.fill();
    } else if (q.forma === 'espiral') {
      for (let k = 0; k <= 32; k++) { const a = k * 0.5 + t; const rr = (k / 32) * r; if (k) c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else c.moveTo(0, 0); }
      c.stroke();
    } else if (q.forma === 'flor') {
      // seis pétalas redondas em volta do miolo
      for (let k = 0; k < 6; k++) {
        const px = Math.cos(k * 1.047) * r * 0.55, py = Math.sin(k * 1.047) * r * 0.55;
        c.moveTo(px + r * 0.35, py); c.arc(px, py, r * 0.35, 0, 6.283);
      }
      c.stroke();
    } else {
      for (let k = 0; k < 8; k++) { c.moveTo(0, 0); c.lineTo(Math.cos(k * 0.785) * r, Math.sin(k * 0.785) * r); }
      c.moveTo(r * 0.7, 0); c.arc(0, 0, r * 0.7, 0, 6.283); c.stroke();
    }
  }

  function quadro(agora) {
    requestAnimationFrame(quadro);
    if (!ligada || document.hidden) return;
    if (agora - tAntes < 33) return;                 // 30 quadros por segundo
    const dt = Math.min(0.1, (agora - tAntes) / 1000);
    tAntes = agora;

    // uma CENA nova a cada frase de 32 tempos (no hiperespaço ou no MilkDrop)
    const f = Math.floor(Math.max(0, E.batida) / 32);
    const virouFrase = E.tocando && f !== frase;
    if (virouFrase) frase = f;

    // ── hiperespaço: o shader, e só ele (é denso o bastante sozinho) ──
    if (modo === 'hiper') {
      if (virouFrase && frase > 0) hiper.trocar(Math.floor(Math.random() * (hiper.CENAS - 1) + hiper.cena + 1) % hiper.CENAS);
      hiper.desenhar(E, dt, Q.nivel || 2);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, W, H);
      aparicoes(dt);
      return;
    }

    // ── MilkDrop, preset novo a cada frase (32 tempos) ──
    if (estado === 'nada') iniciarMilk();
    if (estado === 'ok') {
      if (virouFrase && frase > 0) trocar(2.7);
      try { milk.render(); } catch {}
    }

    // ── frente: formas voando em 3D ──
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    if (E.reduzido) return;
    const bi = Math.floor(E.batida);
    if (E.tocando && bi !== batidaVoo) { batidaVoo = bi; soltar((E.compasso === 0 ? 2 : 1) + Math.round(E.energia)); }
    if (!E.tocando && Math.random() < dt * 0.5) soltar(1);
    if (E.dropV > 0.95) soltar(8);
    const cx = W / 2, cy = H / 2, m = Math.min(W, H);
    const vel = (0.22 + E.grave * 0.55 + E.dropV * 0.9) * (E.bpm ? E.bpm / 120 : 0.6);
    c.globalCompositeOperation = 'lighter';
    for (let i = voadores.length - 1; i >= 0; i--) {
      const q = voadores[i];
      q.z -= dt * vel * (0.35 + (1 - q.z));
      q.rot += q.giro * dt;
      if (q.z <= 0.06) { voadores.splice(i, 1); continue; }
      const esc = 1 / q.z;
      const x = cx + Math.cos(q.a) * q.d * m * 0.14 * esc;
      const y = cy + Math.sin(q.a) * q.d * m * 0.14 * esc;
      const r = m * 0.02 * esc;
      if (x < -r * 2 || x > W + r * 2 || y < -r * 2 || y > H + r * 2) { voadores.splice(i, 1); continue; }
      c.globalAlpha = Math.min(1, (1 - q.z) * 3) * Math.min(1, (q.z - 0.06) * 4) * 0.55;
      c.strokeStyle = c.fillStyle = hsl(q.h + E.batida * 8, 95, 62);
      forma(q, x, y, r, E.batida);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
  requestAnimationFrame(quadro);

  /**
   * O ↻: próxima cena do hiperespaço; depois da última, o MilkDrop; do
   * MilkDrop, volta pro hiperespaço.
   */
  function proxima() {
    if (modo === 'hiper') {
      if (hiper.cena >= hiper.CENAS - 1) { modo = 'milk'; pintarModo(); if (estado === 'ok') trocar(0.5); }
      else hiper.trocar();
    } else if (hiper) { modo = 'hiper'; pintarModo(); hiper.trocar(0); }
    else trocar(1.2);
  }

  return {
    get ligada() { return ligada; },
    trocar: proxima,
    alternar(on = !ligada) {
      ligada = on;
      document.body.classList.toggle('viagem', on);
      pintarModo();
      if (on) { medir(); tAntes = 0; } else { c.clearRect(0, 0, W, H); voadores.length = 0; }
      return on;
    },
  };
}
