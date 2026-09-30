/**
 * MODO VIAGEM — a página inteira entra na viagem, não só uma janelinha.
 *
 * Abre no HIPERESPAÇO: as imagens que quem fumou DMT descreve — crisântemo,
 * túnel, mandala, joias, fractal — geradas na placa de vídeo e dançando com
 * a música. O ↻ passa pelas cinco cenas e depois pelo MilkDrop (com as
 * formas voando); mais um ↻ volta pro hiperespaço.
 *
 * DOIS HIPERESPAÇOS, o mesmo desenho:
 *   HD (hiper-hd.js)   na resolução de verdade da tela (dpr até 1,5), com
 *                      detalhe assado, rastro e bloom. Só é montado na 1ª
 *                      vez que a viagem liga (quase ninguém abre a viagem):
 *                      compila e assa aos poucos, sem travar, e entra por
 *                      cima com uma fusão quando fica pronto.
 *   antigo (hiperespaco.js)  1 shader em ~1/3 da tela. Aparece enquanto o HD
 *                      prepara (a tela nunca fica preta) e é a reserva se
 *                      o HD falhar ou a placa cair.
 * O medidor (qualidade.js) manda no preset do HD: engasgou, desce; liso, sobe.
 *
 *   POR CIMA o MilkDrop (Butterchurn) cobre a tela inteira, na frente da CDJ,
 *           com mistura "screen": a luz soma, o escuro deixa ver os controles
 *   NA FRENTE formas psicodélicas (anéis, estrelas, olhos, espirais, flores,
 *           mandalas) nascem no centro e voam em 3D na direção de quem olha,
 *           passando por cima dos botões (sem pegar clique)
 *
 * LEVE DE PROPÓSITO — a primeira versão travava:
 *   - o MilkDrop e as formas desenham em resolução BAIXA (o fundo a ~1/3 da
 *     tela, a frente a ~1/2) e a placa de vídeo amplia; num visualizador
 *     isso é bonito, e são 9x menos pixels pra pintar (o HD faz o mesmo por
 *     dentro: só a conta cara é pequena)
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
import { montarHiperespacoHD, presetParaEscala, presetPelaPlaca } from './hiper-hd.js';
import { desenharAparicao, sortearTipo } from './aparicoes.js';

// celular/tablet começa mais leve no HD: preset menor e texturas assadas de
// 1024² (8 MB em vez de 32, sem contar os mipmaps) — memória de placa de
// celular é pouca e dividida com o sistema
const CELULAR = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } })();
// quanto dura a fusão do hiperespaço antigo pro HD, quando ele fica pronto
const FUSAO_MS = 1200;

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
  let velho = montarHiperespaco(hiperCv);
  let modo = velho ? 'hiper' : 'milk';
  const pintarModo = () => document.body.classList.toggle('viagem-milk', modo === 'milk');

  // a placa caiu e voltou: o shader antigo não sabe se refazer sozinho,
  // então monta de novo no mesmo canvas (o contexto é o mesmo, restaurado)
  hiperCv.addEventListener('webglcontextlost', (e) => e.preventDefault());
  hiperCv.addEventListener('webglcontextrestored', () => {
    velho = montarHiperespaco(hiperCv);
    velho?.tamanho(FW, FH);
  });

  /**
   * O HIPERESPAÇO HD (hiper-hd.js). Montado na primeira vez que a viagem
   * liga; até ficar `pronto`, quem aparece é o antigo. Qualquer erro dele
   * (shader que não compila, exceção num quadro) = desiste do HD pra sempre
   * nesta página e fica o antigo: nunca tela preta, nunca erro a cada quadro.
   */
  let hd = null, hdCv = null, hdDesistiu = false, usandoHD = false, fundindo = null;
  let inicialHD = CELULAR ? 'medio' : 'alto';
  const hiper = () => (usandoHD ? hd : velho);

  function montarHD() {
    hdCv = document.createElement('canvas');
    hdCv.setAttribute('aria-hidden', 'true');
    try {
      hd = montarHiperespacoHD(hdCv, {
        preset: presetParaEscala(inicialHD, Q.escala),
        lado: CELULAR ? 1024 : 2048,
        cena: velho?.cena,
        // a régua da placa (medida uma vez, no fim do assado) só serve pra
        // SUBIR: com a página ocupada a espera divide a placa com o resto
        // (medido ~190 ms por ladrilho no app contra ~4 ms isolado), então
        // leitura lenta não prova nada; rápida prova. Descer é com o medidor.
        aoMedirPlaca(ms) {
          if (!CELULAR && presetPelaPlaca(ms) === 'ultra') inicialHD = 'ultra';
          hd?.qualidade(presetParaEscala(inicialHD, Q.escala));
        },
      });
    } catch { hd = null; }
    if (!hd) { desistirHD(); return; }
    medirHD();
  }
  function desistirHD() {
    if (usandoHD) mostrar(false, false);
    try { hd?.liberar(); } catch {}
    hdCv?.remove();
    hd = null; hdCv = null; hdDesistiu = true;
  }

  // o CSS do index.html é pelo id: quem estiver no ar é o #viagem-hiper
  function esconder(cv) { cv.removeAttribute('id'); cv.style.cssText = 'display:none'; }
  function acabarFusao() {
    if (!fundindo) return;
    const { cv, anim } = fundindo;
    fundindo = null;
    if (cv.id !== 'viagem-hiper') esconder(cv);
    anim?.cancel();
  }
  /**
   * Põe no ar o HD (`hdNoAr` true) ou o antigo. Com `fundir`, o que sai fica
   * por cima, com o mesmo estilo que tinha, e some em FUSAO_MS — só opacity
   * num elemento, a placa compõe sozinha.
   */
  function mostrar(hdNoAr, fundir) {
    if (hdNoAr === usandoHD) return;
    acabarFusao();
    const entra = hdNoAr ? hdCv : hiperCv, sai = hdNoAr ? hiperCv : hdCv;
    usandoHD = hdNoAr;
    if (!entra) return;
    if (fundir && sai && ligada && modo === 'hiper' && sai.animate) {
      const cs = getComputedStyle(sai);
      const op = cs.opacity;
      sai.style.cssText = `position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;display:block;` +
        `z-index:${cs.zIndex};mix-blend-mode:${cs.mixBlendMode};opacity:${op}`;
      sai.removeAttribute('id');
      entra.style.cssText = '';
      entra.id = 'viagem-hiper';
      sai.before(entra);                             // quem sai fica por cima
      const anim = sai.animate([{ opacity: op }, { opacity: 0 }], { duration: FUSAO_MS, easing: 'ease-in-out', fill: 'forwards' });
      fundindo = { cv: sai, anim };
      anim.onfinish = acabarFusao;
    } else {
      if (sai) esconder(sai);
      entra.style.cssText = '';
      entra.id = 'viagem-hiper';
      if (!entra.isConnected) document.body.prepend(entra);
    }
  }

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
    velho?.tamanho(FW, FH);
    medirHD();
    try { milk?.setRendererSize(FW, FH); } catch {}
  }
  // o HD recebe a tela INTEIRA em pixels do aparelho (dpr até 1,5: acima
  // disso o olho não vê diferença e a conta cresce ao quadrado); quanto disso
  // ele desenha de verdade é o preset que decide
  function medirHD() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    hd?.tamanho(innerWidth * dpr, innerHeight * dpr);
  }
  addEventListener('resize', () => { if (ligada) medir(); });
  aoMudarQualidade((q) => {
    hd?.qualidade(presetParaEscala(inicialHD, q.escala));
    if (ligada) medir();
  });

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

  // uma cena diferente da atual, sorteada
  const outraCena = (h) => Math.floor(Math.random() * (h.CENAS - 1) + h.cena + 1) % h.CENAS;

  /** O HD: monta na 1ª vez, prepara aos poucos e entra quando fica pronto. */
  function cuidarDoHD() {
    if (hdDesistiu || !velho) return;
    if (!hd) { montarHD(); return; }
    if (hd.falhou) { desistirHD(); return; }
    // a placa caiu: o antigo volta na hora; o HD se refaz sozinho e entra de novo
    if (usandoHD && !hd.pronto) { mostrar(false, false); return; }
    if (!usandoHD && !hd.perdido) {
      try {
        if (hd.preparar()) { hd.trocar(velho.cena, 0); mostrar(true, true); }
      } catch { desistirHD(); }
    }
  }

  let proximoQuadro = 0, dropCorte = -1;
  function quadro(agora) {
    requestAnimationFrame(quadro);
    if (!ligada || document.hidden) return;
    // 30 quadros por segundo num relógio que não escorrega: "agora - antes
    // < 33" num monitor de 60 Hz com o rAF tremendo pulava pra 20/s
    if (agora < proximoQuadro - 2) return;
    proximoQuadro = Math.max(proximoQuadro + 1000 / 30, agora - 1000 / 30);
    const dt = Math.min(0.1, (agora - tAntes) / 1000);
    tAntes = agora;

    // uma CENA nova a cada frase de 32 tempos (no hiperespaço ou no MilkDrop)
    const f = Math.floor(Math.max(0, E.batida) / 32);
    const virouFrase = E.tocando && f !== frase;
    if (virouFrase) frase = f;

    // ── hiperespaço: o shader, e só ele (é denso o bastante sozinho) ──
    if (modo === 'hiper') {
      cuidarDoHD();
      const h = hiper();
      if (!h) { modo = 'milk'; pintarModo(); return; }
      if (virouFrase && frase > 0) h.trocar(outraCena(h));
      // CORTE SECO no drop (só no HD, que sabe cortar): o clarão esconde a
      // emenda e a cena nova chega junto com a pancada. Vale o carimbo do
      // drop (E.drop), não "dropV > 0.95": a 6-10 quadros/s isso escapa
      if (E.drop !== dropCorte) {
        dropCorte = E.drop;
        if (usandoHD && E.dropV > 0.5 && !E.reduzido) h.trocar(outraCena(h), 0);
      }
      if (usandoHD) {
        try { hd.desenhar(E, dt, Q.nivel || 2); } catch { desistirHD(); }
      }
      // o antigo desenha quando está no ar e enquanto some por baixo da fusão
      if (!usandoHD || fundindo) velho?.desenhar(E, dt, Q.nivel || 2);
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
    const h = hiper();
    if (modo === 'hiper' && h) {
      if (h.cena >= h.CENAS - 1) {
        modo = 'milk'; acabarFusao(); pintarModo();
        hd?.dormir();                                // o MilkDrop não usa o HD: devolve a memória
        if (estado === 'ok') trocar(0.5);
      } else h.trocar();
    } else if (h) {
      modo = 'hiper'; pintarModo();
      // vindo do MilkDrop não há o que fundir: o HD corta direto pra 1ª cena
      if (usandoHD) h.trocar(0, 0); else h.trocar(0);
    } else trocar(1.2);
  }

  return {
    get ligada() { return ligada; },
    trocar: proxima,
    alternar(on = !ligada) {
      ligada = on;
      document.body.classList.toggle('viagem', on);
      pintarModo();
      if (on) { medir(); tAntes = 0; proximoQuadro = 0; }
      else { c.clearRect(0, 0, W, H); voadores.length = 0; acabarFusao(); hd?.dormir(); }
      return on;
    },
  };
}
