/**
 * PISTA HD — o club AO VIVO em Full HD, no mesmo esquema da viagem HD: a
 * conta cara roda pequena, o que dá nitidez é barato, e nada é vídeo.
 *
 *   LUZ      fachos de cabeça móvel na fumaça, numa conta fechada por facho
 *            (sem marchar), em 1/2 a 1/4 da tela; a fumaça é uma textura de
 *            ruído assada uma vez e rolando devagar ("céu líquido")
 *   BLOOM    1/4 e 1/8 da tela
 *   GALERA   silhuetas com contraluz e celulares acesos, uma instância por
 *            pessoa (a CPU só calcula pulo e braços: ~100 números por quadro)
 *   FINAL    lasers em resolução cheia, blinders, curva de cinema, estrobo
 *
 * O DIRETOR DE LUZ (tudo aqui, JS puro) faz o que um iluminador faz num club:
 * o show anda na GRADE de batidas — look novo a cada 8 compassos (32 tempos),
 * cor cortada no 1 do compasso, varridas espelhadas, chase de intensidade que
 * atravessa a treliça; o grave abre o zoom, o bumbo dá o soco de brilho. Antes
 * do drop (se a faixa tem marcador) a SUBIDA aperta os fachos, clareia e
 * acelera; no último tempo, BLACKOUT; no drop, blinder quente + todos os
 * fachos na plateia + leque de laser. Na quebra, fachos lentos, largos e de
 * uma cor só.
 *
 * SEGURANÇA: estrobo e blinder só no bombando (blinder suave no médio), nunca
 * com `prefers-reduced-motion`; um GOVERNADOR deixa no máximo 3 clarões em
 * qualquer janela de 1 s (WCAG 2.3.1), com 0,34 s entre eles; clarão é branco
 * ou âmbar, nunca vermelho saturado.
 *
 * MESMA INTERFACE da viagem HD: preparar(), pronto, falhou, perdido,
 * tamanho(w, h), qualidade(preset), dormir(), liberar() e desenhar(E, dt,
 * nivel, ctx). `ctx`: { soShow, black, visual: {hue, faixa} }.
 */

import { VERT, RUIDO, LUZ, MAXF, REDUZIR, BORRAR, VERT_GALERA, GALERA, FINAL, VERT_CONFETE, CONFETE } from './pista-hd-shaders.js';

/**
 * PRESETS: luz = fração da saída no passe de luz; saida = fração do canvas;
 * brilho = níveis de bloom; filas = fileiras de galera no máximo; gal =
 * fração da saída em que a galera é desenhada (a borda fica macia, como
 * silhueta contra a fumaça; em 1/3 custa metade de 1/2).
 */
export const PRESETS = {
  ultra:  { luz: 1 / 2, saida: 1, brilho: 2, filas: 3, gal: 1 / 2 },
  alto:   { luz: 1 / 3, saida: 1, brilho: 2, filas: 2, gal: 1 / 3 },
  medio:  { luz: 1 / 4, saida: 1, brilho: 1, filas: 2, gal: 1 / 3 },
  baixo:  { luz: 1 / 4, saida: 2 / 3, brilho: 1, filas: 2, gal: 1 / 2 },
  minimo: { luz: 1 / 4, saida: 1 / 2, brilho: 1, filas: 1, gal: 1 / 2 },
};
export const ORDEM_PRESETS = ['ultra', 'alto', 'medio', 'baixo', 'minimo'];

/** Degrau do medidor (qualidade.js: Q.escala 1 / 0.75 / 0.55) → preset. */
export function presetParaEscala(inicial, escala) {
  const i = Math.max(0, ORDEM_PRESETS.indexOf(inicial));
  const desce = escala >= 0.99 ? 0 : escala >= 0.7 ? 1 : 2;
  return ORDEM_PRESETS[Math.min(ORDEM_PRESETS.length - 1, i + desce)];
}

/** O preset de partida pelo quadro de aquecimento cronometrado (ms de GPU no 'alto'). */
export function presetPeloQuadro(ms) {
  if (!(ms > 0)) return 'alto';
  if (ms < 3) return 'ultra';
  if (ms < 9) return 'alto';
  if (ms < 16) return 'medio';
  return 'baixo';
}

// ───────── a sala ─────────
const TRELICA = { y: 3.1, z: 9.5 };
const CHAO = -1.7, FUNDO = 14, TETO = 5.5, PAREDE = 12;
const FOV = 60 * Math.PI / 180, INCLINA = 7 * Math.PI / 180;
const TAN_F = Math.tan(FOV / 2), SP = Math.sin(INCLINA), CP = Math.cos(INCLINA);
const LASER_DE = [0, 2.3, 13.5];

const LOOKS = ['varre', 'leque', 'cruza', 'onda', 'ceu'];
const JEITOS = ['pula', 'pula', 'balanca', 'cabeca', 'balanca', 'acena'];
const FILAS = [{ esc: 0.72, dy: 0.085, fog: 0.42 }, { esc: 0.92, dy: 0.045, fog: 0.2 }, { esc: 1.2, dy: 0, fog: 0 }];
const MAX_GENTE = 200;
const CONFETES = 120;

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const frac = (x) => x - Math.floor(x);
function hsv(h, s, v) {
  h = frac(h / 360) * 6;
  const f = (n) => { const k = (n + h) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
const misturar = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const BRANCO = [1, 0.93, 0.84];

/** Onde a câmera vê um ponto do mundo (uv 0..1). */
function projetar([x, y, z], asp) {
  const yc = y * CP - z * SP, zc = y * SP + z * CP;
  return [0.5 + 0.5 * x / (zc * asp * TAN_F), 0.5 + 0.5 * yc / (zc * TAN_F)];
}

/** Até onde o facho vai antes de bater no chão, no fundo, no teto ou nas paredes. */
function alcance(P, a) {
  let t = 40;
  if (a[1] < -1e-3) t = Math.min(t, (CHAO - P[1]) / a[1]);
  if (a[1] > 1e-3) t = Math.min(t, (TETO - P[1]) / a[1]);
  if (a[2] > 1e-3) t = Math.min(t, (FUNDO - P[2]) / a[2]);
  if (Math.abs(a[0]) > 1e-3) t = Math.min(t, (Math.sign(a[0]) * PAREDE - P[0]) / a[0]);
  // vindo pra câmera, bate na galera (a fileira da frente fica a ~2 m)
  if (a[2] < -1e-3) t = Math.min(t, (2 - P[2]) / a[2]);
  return Math.max(0.5, t);
}

/** pan (0 = pro fundo, π = pra câmera) e tilt (0 = pra baixo, π/2 = horizontal) → eixo. */
const eixo = (pan, tilt) => [Math.sin(tilt) * Math.sin(pan), -Math.cos(tilt), Math.sin(tilt) * Math.cos(pan)];

/**
 * Monta a pista HD num canvas. Devolve null sem WebGL2 (ou se o navegador só
 * tiver WebGL por software). Chamar `preparar()` a cada quadro até `pronto`.
 * @param {HTMLCanvasElement} cv
 * @param {object} [op]
 * @param {string} [op.preset]        preset inicial (ver PRESETS)
 * @param {function} [op.aoMedirPlaca] (msQuadro) => void, uma vez, no fim da preparação
 * @param {boolean} [op.hdr]          false = força a luz em 8 bits (teste)
 */
export function montarPistaHD(cv, op = {}) {
  const attrs = { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false,
    preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true };
  const gl = cv.getContext('webgl2', attrs);
  if (!gl) return null;

  // ───────── recursos da placa (refeitos inteiros se o contexto voltar) ─────────
  const FONTES = [['ruido', VERT, RUIDO], ['luz', VERT, LUZ], ['reduzir', VERT, REDUZIR], ['borrar', VERT, BORRAR],
    ['galera', VERT_GALERA, GALERA], ['final', VERT, FINAL], ['confete', VERT_CONFETE, CONFETE]];
  let extParalelo, hdr, maxLado;
  let progs, fila, vaoTela, vaoGal, vaoConf, bufTri, bufQuad, bufGal, bufConfQuad, bufConf, texRuido, fbRuido;
  let compilado, falhou = false, perdido = false, assado, aquecido, msQuadro = 0, avisarPlaca = true;
  const gente32 = new Float32Array(MAX_GENTE * 12);

  function criarRecursos() {
    extParalelo = gl.getExtension('KHR_parallel_shader_compile');
    // luz em ponto flutuante (16 bits) quando dá — o iPhone só tem o de meia
    // precisão; senão 8 bits guardando 1/4 (perde folga no brilho, funciona)
    hdr = op.hdr !== false && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    maxLado = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
    progs = {}; compilado = false; assado = false; aquecido = false;
    luz = gal = null; b4 = [null, null]; b8 = [null, null];
    fila = FONTES.slice();
    if (extParalelo) while (fila.length) compilar(...fila.shift());

    // triângulo da tela
    vaoTela = gl.createVertexArray();
    gl.bindVertexArray(vaoTela);
    bufTri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufTri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // galera: um quadrado 0..1 + 3 vec4 por pessoa (atualizados por quadro)
    vaoGal = gl.createVertexArray();
    gl.bindVertexArray(vaoGal);
    bufQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    bufGal = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufGal);
    gl.bufferData(gl.ARRAY_BUFFER, gente32.byteLength, gl.DYNAMIC_DRAW);
    for (let k = 0; k < 3; k++) {
      gl.enableVertexAttribArray(1 + k);
      gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, 48, k * 16);
      gl.vertexAttribDivisor(1 + k, 1);
    }

    // confete: sorteios fixos (a física é função do tempo desde o drop)
    vaoConf = gl.createVertexArray();
    gl.bindVertexArray(vaoConf);
    bufConfQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufConfQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const cf = new Float32Array(CONFETES * 8);
    for (let i = 0; i < CONFETES; i++) {
      const vr = (hash(i * 7 + 5) - 0.5) * 10;
      cf.set([hash(i * 7), hash(i * 7 + 1), hash(i * 7 + 2) * 2 - 1, hash(i * 7 + 3),
        hash(i * 7 + 4) * 6.28, Math.sign(vr || 1) * Math.max(0.6, Math.abs(vr)), 3 + hash(i * 7 + 6) * 1.5, i % 6], i * 8);
    }
    bufConf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufConf);
    gl.bufferData(gl.ARRAY_BUFFER, cf, gl.STATIC_DRAW);
    for (let k = 0; k < 2; k++) {
      gl.enableVertexAttribArray(1 + k);
      gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, 32, k * 16);
      gl.vertexAttribDivisor(1 + k, 1);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);

    // a textura da fumaça (assada no 1º passo de preparar)
    texRuido = textura(256, 256, { repetir: true });
    fbRuido = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbRuido);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texRuido, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function compilar(nome, fv, ff) {
    const sh = (tipo, src) => { const s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const vs = sh(gl.VERTEX_SHADER, fv), fs = sh(gl.FRAGMENT_SHADER, ff);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    const U = new Map();
    const u = (n) => { let l = U.get(n); if (l === undefined) { l = gl.getUniformLocation(prog, n); U.set(n, l); } return l; };
    progs[nome] = { prog, vs, fs, u };
    if (!extParalelo) gl.getProgramParameter(prog, gl.LINK_STATUS);
  }

  function conferirCompilacao() {
    if (compilado) return true;
    if (falhou || perdido || gl.isContextLost()) return false;
    if (fila.length) { compilar(...fila.shift()); return false; }
    if (extParalelo && !Object.values(progs).every((p) => gl.getProgramParameter(p.prog, extParalelo.COMPLETION_STATUS_KHR))) return false;
    for (const [nome, p] of Object.entries(progs)) {
      if (!gl.getProgramParameter(p.prog, gl.LINK_STATUS)) {
        if (gl.isContextLost()) return false;
        console.warn(`pista HD: shader ${nome} não compilou; fica a pista de antes.`,
          gl.getShaderInfoLog(p.fs) || gl.getShaderInfoLog(p.vs) || gl.getProgramInfoLog(p.prog));
        falhou = true;
        return false;
      }
    }
    compilado = true;
    return true;
  }
  const usar = (nome) => { gl.useProgram(progs[nome].prog); return progs[nome].u; };

  // ───────── texturas e alvos ─────────
  function textura(w, h, { repetir = false, flut = false } = {}) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (flut) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repetir ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }
  function alvo(w, h, flut) {
    const tex = textura(w, h, { flut });
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, flut ? 1 : 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb: f, w, h };
  }
  const apagar = (a) => { if (a) { gl.deleteTexture(a.tex); gl.deleteFramebuffer(a.fb); } };
  const ligarTex = (unidade, tex) => { gl.activeTexture(gl.TEXTURE0 + unidade); gl.bindTexture(gl.TEXTURE_2D, tex); };
  const naTela = (a) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, a ? a.fb : null);
    gl.viewport(0, 0, a ? a.w : gl.drawingBufferWidth, a ? a.h : gl.drawingBufferHeight);
  };
  const triangulo = (a) => { naTela(a); gl.bindVertexArray(vaoTela); gl.drawArrays(gl.TRIANGLES, 0, 3); };

  function assar() {
    const u = usar('ruido');
    gl.uniform1f(u('uTam'), 256);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbRuido);
    gl.viewport(0, 0, 256, 256);
    gl.bindVertexArray(vaoTela);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    assado = true;
  }

  // ───────── estado ─────────
  let preset = PRESETS[op.preset] ? op.preset : 'alto';
  let P = PRESETS[preset];
  let telaW = 0, telaH = 0, sujo = true;
  let luz = null, gal = null, b4 = [null, null], b8 = [null, null];
  let gente = [], genteChave = '';

  function apagarAlvos() {
    for (const a of [luz, gal, ...b4, ...b8]) apagar(a);
    luz = gal = null; b4 = [null, null]; b8 = [null, null];
  }
  function refazerAlvos() {
    sujo = false;
    if (!telaW || !telaH) return;
    const W = Math.max(2, Math.min(maxLado, Math.round(telaW * P.saida)));
    const H = Math.max(2, Math.min(maxLado, Math.round(telaH * P.saida)));
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    apagarAlvos();
    luz = alvo(Math.max(2, Math.round(W * P.luz)), Math.max(2, Math.round(H * P.luz)), hdr);
    gal = alvo(Math.max(2, Math.round(W * P.gal)), Math.max(2, Math.round(H * P.gal)), false);
    const w4 = Math.max(2, Math.round(W / 4)), h4 = Math.max(2, Math.round(H / 4));
    b4 = [alvo(w4, h4, hdr), alvo(w4, h4, hdr)];
    const w8 = Math.max(2, Math.round(w4 / 2)), h8 = Math.max(2, Math.round(h4 / 2));
    b8 = [alvo(w8, h8, hdr), alvo(w8, h8, hdr)];
    genteChave = '';
  }

  // ───────── O DIRETOR DE LUZ ─────────
  const F0 = new Float32Array(MAXF * 4), F1 = new Float32Array(MAXF * 4), F2 = new Float32Array(MAXF * 4), F3 = new Float32Array(MAXF * 4);
  const ESP = new Float32Array(32);
  const cabecas = [];                 // { P, wash, a (eixo atual), u (0..1 na treliça) }
  let cabecasChave = '';
  const D = {
    t: 0, bt: 0, btE: null, btm: 0, fase: 'idle', look: 'varre', semente: Math.floor(Math.random() * 997),
    dropVisto: undefined, desde: 99, dropReal: false, blinder: 0, blAmp: 1, flashT: 0, flashes: [], estroboAte: -1,
    conf: -1, confN: 0, deriva: [0, 0], quadro: 0,
  };
  const U = {};                       // o que vai pros shaders neste quadro

  function montarCabecas(nF, nW) {
    const chave = nF + '/' + nW;
    if (chave === cabecasChave) return;
    cabecasChave = chave;
    cabecas.length = 0;
    for (let i = 0; i < nF; i++) {
      const u = nF > 1 ? i / (nF - 1) : 0.5;
      cabecas.push({ P: [-7.2 + 14.4 * u, TRELICA.y, TRELICA.z], wash: false, u, a: eixo(Math.PI, 0.9) });
    }
    const pw = nW === 1 ? [0] : nW === 2 ? [-4.8, 4.8] : [-6.5, 0, 6.5];
    for (let i = 0; i < nW; i++) {
      cabecas.push({ P: [pw[i], TRELICA.y + 0.25, TRELICA.z - 1.2], wash: true, u: nW > 1 ? i / (nW - 1) : 0.5, a: eixo(Math.PI, 0.9) });
    }
  }

  /** Pra onde cada facho aponta: função da batida (e da fase do show). */
  function mira(c, look, bt, lento) {
    const u = c.u, lado = u < 0.5 ? -1 : 1, m = lado < 0 ? u : 1 - u;     // m: 0 na ponta, 0.5 no meio
    const PI = Math.PI;
    // os washes lavam o chão na frente da cabine (a câmera fica fora do cone)
    if (c.wash) return eixo(PI + (u - 0.5) * 0.9 + Math.sin(bt * PI / 32 + u * 3) * 0.2, 0.5 + Math.sin(bt * PI / 16 + u) * 0.1);
    switch (look) {
      case 'varre': return eixo(PI + lado * (0.3 + 0.42 * Math.sin(bt * PI / 16 + m * 1.6)), 0.95 + 0.3 * Math.sin(bt * PI / 8 + m * 2.2));
      case 'leque': return eixo(PI + (u - 0.5) * 2 * (0.15 + 0.55 * (0.5 + 0.5 * Math.sin(bt * PI / 8))), 0.8 + 0.18 * Math.sin(bt * PI / 16));
      case 'cruza': return eixo(PI - lado * (0.42 + 0.2 * Math.sin(bt * PI / 8)), 0.9 + 0.28 * Math.sin(bt * PI / 4 + u * PI));
      case 'onda':  return eixo(PI + (u - 0.5) * 0.7, 0.35 + 1.05 * (0.5 + 0.5 * Math.sin(bt * PI / 2 - u * PI * 2)));
      case 'ceu':   return eixo(PI + lado * (0.25 + 0.35 * Math.sin(bt * PI / 16 + m * 2)), 2.05 + 0.3 * Math.sin(bt * PI / 8 + m * 3));
      case 'plateia': {
        // o GOLPE do drop: todos na plateia perto da câmera, girando em
        // círculo pequeno (o clarão tremula)
        const ang = bt * PI / 2 + u * 6.28;
        const alvoC = [Math.cos(ang) * 1.8, -0.5 + Math.sin(ang) * 0.8, 0.8];
        const d = [alvoC[0] - c.P[0], alvoC[1] - c.P[1], alvoC[2] - c.P[2]];
        const n = Math.hypot(...d);
        return [d[0] / n, d[1] / n, d[2] / n];
      }
      case 'varrida':  // logo depois do golpe: um leque que varre a galera, rápido
        return eixo(PI + (u - 0.5) * 1.3 + 0.35 * Math.sin(bt * PI / 2), 0.62 + 0.12 * Math.sin(bt * PI + u * 3));
      default:      return eixo(PI + lado * 0.6 * Math.sin(bt * PI / 32 * lento + m * 2), 1.0 + 0.45 * Math.sin(bt * PI / 32 * lento + m * 3));
    }
  }

  /** Governador de clarões: no máx. 3 por segundo, 0,34 s entre eles. */
  function podePiscar() {
    while (D.flashes.length && D.t - D.flashes[0] > 1) D.flashes.shift();
    if (D.flashes.length >= 3) return false;
    if (D.flashes.length && D.t - D.flashes[D.flashes.length - 1] < 0.34) return false;
    D.flashes.push(D.t);
    return true;
  }

  function dirigir(E, dt, nivel, ctx, W, H) {
    D.t += dt; D.quadro++;
    const red = !!E.reduzido;
    const bps = (E.tocando && E.bpm ? E.bpm : 100) / 60;
    // o RELÓGIO do show: segue a grade quando ela anda; sem grade, anda sozinho
    if (E.tocando && E.batida !== D.btE) { D.bt = E.batida; D.btE = E.batida; }
    else D.bt += dt * (E.tocando ? bps : 0.35);
    const bt = D.bt;
    // o drop (pelo carimbo, como a viagem HD)
    let novoDrop = false;
    if (E.drop !== D.dropVisto) {
      if (D.dropVisto !== undefined && (E.dropV || 0) > 0.3) { novoDrop = true; D.desde = 0; D.dropReal = !!E.dropReal; }
      D.dropVisto = E.drop;
    } else D.desde += dt;
    const desde = D.desde * bps;                           // tempos desde o drop
    const pd = E.paraDrop ?? Infinity;                     // tempos até o próximo drop marcado

    // a FASE do show. A subida pega os 4 compassos antes do drop — ou só os 2
    // últimos, se a faixa está numa quebra (o miolo da quebra é calmo)
    const janela = E.quebra ? 8 : 16;
    let fase;
    if (!E.tocando) fase = 'idle';
    else if (!red && pd > 0 && pd <= 1) fase = 'blackout';        // "menos movimento": sem apagão
    else if (!red && pd > 0 && pd <= janela) fase = 'subida';
    else if (desde < 4) fase = 'drop';
    else if (desde < 16) fase = 'solta';
    else if (E.quebra) fase = 'quebra';
    else fase = 'groove';
    D.fase = fase;
    const prog = fase === 'subida' ? Math.max(0, Math.min(1, 1 - (pd - 1) / (janela - 1))) : 0;

    // velocidade do movimento (a subida acelera até 2x)
    const vel = red ? 0 : fase === 'quebra' || fase === 'idle' ? 0.35 : fase === 'subida' ? 1 + prog : 1;
    D.btm += dt * bps * vel;
    const btm = D.btm;

    // o LOOK: um a cada 8 compassos, sorteado (o mesmo set não vira sempre o mesmo show)
    // (antes da âncora da grade a batida é negativa: frase 0, não -1)
    const frase = Math.floor(Math.max(0, bt) / 32);
    let look = LOOKS[Math.floor(hash(frase * 3.1 + D.semente) * LOOKS.length)];
    if (fase === 'drop') look = desde < 1 ? 'plateia' : 'varrida';
    else if (fase === 'quebra' || fase === 'idle') look = 'lento';
    else if (fase === 'solta') look = frase % 2 ? 'leque' : 'cruza';
    D.look = look;

    // quantos fachos: leve 3, médio 6, bombando 8 (+ washes 1/2/3)
    const nF = [0, 3, 6, 8][nivel] || 3, nW = [0, 1, 2, 3][nivel] || 1;
    montarCabecas(fase === 'idle' ? Math.min(2, nF) : nF, fase === 'idle' ? 1 : nW);

    // CORES: base do estilo + acento + branco; troca cortada no 1 da frase
    const v = ctx.visual || { hue: 300, faixa: 140 };
    const hueBase = v.hue + frase * (v.faixa >= 360 ? 67 : v.faixa / 3);
    const cA = hsv(hueBase, 0.85, 1), cB = hsv(hueBase + v.faixa / 2 + 30, 0.85, 1);
    const luzK = (ctx.black ? 0.65 : 1);

    // intensidade por fase
    const Ifase = { idle: 0.45, groove: 1, solta: 1.15, drop: 1.05, subida: 0.8 + 0.55 * prog, blackout: 0, quebra: 0.4 }[fase];
    const Iwash = { idle: 0.55, groove: 0.45, solta: 0.55, drop: 0.6, subida: 0.35, blackout: 0, quebra: 0.55 }[fase];
    const pulso = red ? 0 : (E.pulso || 0);
    const grave = E.grave || 0;
    let zoom = { idle: 0.06, groove: 0.026 + grave * 0.02, solta: 0.034 + grave * 0.015, drop: 0.036, subida: 0.028 - 0.016 * prog, blackout: 0.02, quebra: 0.1 }[fase];

    const suave = 1 - Math.exp(-dt / (fase === 'drop' ? 0.06 : 0.12));
    let soma = [0, 0, 0], somaI = 0;
    for (let i = 0; i < cabecas.length; i++) {
      const c = cabecas[i];
      const alvoA = mira(c, look, btm, 1);
      // a cabeça GIRA até lá (rápido, mas sem teletransporte)
      const a = c.a;
      a[0] += (alvoA[0] - a[0]) * suave; a[1] += (alvoA[1] - a[1]) * suave; a[2] += (alvoA[2] - a[2]) * suave;
      const na = Math.hypot(a[0], a[1], a[2]) || 1;
      a[0] /= na; a[1] /= na; a[2] /= na;
      let I, k, cor;
      if (c.wash) {
        I = 0.26 * Iwash * (0.85 + 0.25 * pulso);
        k = 0.15;
        cor = fase === 'drop' ? cA : fase === 'quebra' ? cA : misturar(cA, cB, 0.3);
      } else {
        // CHASE: uma onda de brilho atravessa a treliça a cada 2 tempos
        const chase = red ? 1 : look === 'onda' ? 0.5 + 0.5 * Math.cos(2 * Math.PI * (bt / 2 - c.u))
          : fase === 'groove' || fase === 'solta' ? 0.72 + 0.28 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (bt / 2 - c.u))) : 1;
        I = 0.16 * Ifase * (0.78 + 0.32 * pulso) * chase;
        k = zoom;
        const par = i % 2 === 0;
        if (fase === 'drop') cor = par ? BRANCO : misturar(BRANCO, cA, 0.4);
        else if (fase === 'solta') cor = par ? cA : BRANCO;
        else if (fase === 'quebra' || fase === 'idle') cor = cA;
        else if (look === 'ceu') cor = cB;
        else cor = par ? cA : cB;
        if (fase === 'subida') cor = misturar(cor, BRANCO, prog * 0.8);
      }
      I *= luzK;
      const o = i * 4;
      F0[o] = c.P[0]; F0[o + 1] = c.P[1]; F0[o + 2] = c.P[2]; F0[o + 3] = I;
      F1[o] = a[0]; F1[o + 1] = a[1]; F1[o + 2] = a[2]; F1[o + 3] = k;
      F2[o] = cor[0]; F2[o + 1] = cor[1]; F2[o + 2] = cor[2]; F2[o + 3] = alcance(c.P, a);
      // a lente: direção da câmera até a cabeça e o quanto ela aponta pra cá
      const dn = Math.hypot(...c.P);
      const dc = [c.P[0] / dn, c.P[1] / dn, c.P[2] / dn];
      const encara = Math.max(0, -(a[0] * dc[0] + a[1] * dc[1] + a[2] * dc[2]));
      F3[o] = dc[0]; F3[o + 1] = dc[1]; F3[o + 2] = dc[2];
      F3[o + 3] = I * (c.wash ? 0.5 : 1) * (0.9 + 5 * Math.pow(encara, 12)) * (0.8 + 0.5 * (E.agudo || 0));
      soma = [soma[0] + cor[0] * I, soma[1] + cor[1] * I, soma[2] + cor[2] * I]; somaI += I;
      // onde o facho cai na tela (x): a galera ali ganha contraluz da cor dele
      if (!c.wash) {
        const alvo = [c.P[0] + a[0] * 4, c.P[1] + a[1] * 4, c.P[2] + a[2] * 4];
        c.telaX = projetar(alvo, W / H)[0]; c.cor = cor; c.I = I;
      }
    }
    U.n = cabecas.length;
    const mediaK = 0.9 * (ctx.soShow ? 1 : 0.4);
    U.corMedia = [soma[0] * mediaK, soma[1] * mediaK, soma[2] * mediaK];
    U.haze = (0.85 + grave * 0.3 + (fase === 'quebra' ? 0.25 : 0)) * (fase === 'blackout' ? 0.6 : 1);
    U.nevoa = (0.25 + grave * 0.45 + (E.dropV || 0) * 0.3) * (fase === 'quebra' ? 0.6 : 1) * [0, 0.6, 0.85, 1][nivel];
    const vd = dt * (1 + (E.energia || 0));
    D.deriva[0] += vd * 0.011; D.deriva[1] += vd * 0.004;
    U.deriva = [D.deriva[0] % 1000, D.deriva[1] % 1000];
    U.ganho = ctx.soShow ? 1 : 0.62;
    U.amb = [0.006, 0.004, 0.012];

    // FOLHA de laser: bombando, depois do drop ou no look "céu" com energia
    const folhaOn = nivel >= 3 && !red && (fase === 'solta' || (fase === 'groove' && look === 'ceu' && (E.energia || 0) > 0.6));
    U.folha = [2.3 + 0.55 * Math.sin(btm * Math.PI / 8), folhaOn ? 0.45 : 0, btm, 0];
    U.folhaCor = frase % 2 ? [0.25, 1, 0.4] : cB;

    // PAINEL DE LED (só no 👁 só o show; médio e bombando)
    U.led = ctx.soShow && nivel >= 2 ? (fase === 'blackout' ? 0 : fase === 'quebra' ? 0.09 : 0.16) : 0;
    U.ledModo = fase === 'subida' ? 1 : fase === 'drop' ? 2 : 0;
    U.ledA = cA; U.ledB = cB;
    if (U.ledModo === 2) U.led *= 0.5 + 0.5 * pulso;
    lerEspectro(E);

    // LASER: leque do fundo da cabine
    const nL = nivel >= 3 ? 22 : 16;
    let lz = 0;
    if (!red && E.tocando) {
      if (nivel >= 3 && (fase === 'drop' || fase === 'solta')) lz = fase === 'drop' ? (frac(bt) < 0.5 ? 1 : 0.55) : 0.8;
      else if (nivel >= 3 && fase === 'groove' && (E.energia || 0) > 0.6) lz = 0.45;
      else if (nivel === 2 && (fase === 'drop' || fase === 'solta')) lz = 0.6;
    }
    const asp = W / H;
    const origem = projetar(LASER_DE, asp);
    const meio = 0.45 * Math.sin(btm * Math.PI / 16);
    const abre = 0.3 + 0.32 * (0.5 + 0.5 * Math.sin(btm * Math.PI / 8)) + grave * 0.1;
    U.lz = [origem[0], origem[1], nL, lz * luzK];
    U.lzAng = [meio - abre, (2 * abre) / (nL - 1)];
    // laser é cor pura de diodo: verde, ciano, magenta (vai trocando por frase)
    U.lzCor = [[0.2, 1, 0.35], [0.15, 0.75, 1], [1, 0.2, 0.75]][frase % 3];
    U.lzSem = Math.floor(D.t * 12) % 97;

    // BLINDER no drop (quente, apaga esquentando) e ESTROBO governado
    if (novoDrop && !red && nivel >= 2 && podePiscar()) { D.blAmp = nivel >= 3 ? 1 : 0.5; D.blinder = D.blAmp; }
    D.blinder *= Math.exp(-dt / 0.4);
    if (D.blinder < 0.01) D.blinder = 0;
    const esfria = D.blAmp ? 1 - D.blinder / D.blAmp : 1;
    const bc = misturar([1, 0.82, 0.58], [1, 0.5, 0.18], esfria);
    U.blinder = [bc[0], bc[1], bc[2], D.blinder * 0.7 * luzK];
    if (novoDrop) D.estroboAte = D.dropReal ? Math.floor(bt) + 4 : -1;
    D.flashT -= dt;
    if (nivel >= 3 && !red && D.dropReal && bt < D.estroboAte && desde >= 0.9) {
      const b = Math.floor(bt);
      if (b !== D.estroboUlt) { D.estroboUlt = b; if (podePiscar()) D.flashT = 0.05; }
    }
    U.flash = D.flashT > 0 ? 0.5 : 0;
    // o "olho" da câmera: abre no blackout, fecha um pouco depois do clarão
    const dip = D.desde < 2 ? 0.12 * Math.exp(-(((D.desde - 0.7) / 0.35) ** 2)) : 0;
    U.expo = (fase === 'blackout' ? 1.35 : fase === 'drop' ? 0.85 : 1) * (1 - dip);
    U.ca = nivel >= 3 && !red ? 0.006 * (E.dropV || 0) : 0;

    // CONFETE: só no drop de verdade
    if (novoDrop && D.dropReal && !red) { D.conf = 0; D.confN = [0, 30, 60, 120][nivel]; }
    if (D.conf >= 0) { D.conf += dt; if (D.conf > 5) D.conf = -1; }

    // a GALERA
    moverGente(E, nivel, ctx, W, H, cA, cB);
  }

  function lerEspectro(E) {
    const esp = E.espectro;
    if (esp && esp.length >= 256) {
      // 32 faixas em escala log de ~47 Hz a ~11 kHz
      for (let i = 0; i < 32; i++) {
        const de = Math.floor(Math.pow(2, i / 32 * 7.9)), ate = Math.max(de + 1, Math.floor(Math.pow(2, (i + 1) / 32 * 7.9)));
        let s = 0;
        for (let j = de; j < ate; j++) s += esp[j];
        const alvo = Math.min(1, s / ((ate - de) * 255) * (1.2 + i / 20));
        ESP[i] += (alvo - ESP[i]) * (alvo > ESP[i] ? 0.6 : 0.2);
      }
    } else {
      for (let i = 0; i < 32; i++) {
        const b = i < 6 ? E.grave || 0 : i < 20 ? E.medio || 0 : E.agudo || 0;
        const alvo = Math.min(1, b * (0.7 + 0.35 * Math.sin(i * 1.7 + D.bt * 1.3)));
        ESP[i] += (alvo - ESP[i]) * 0.4;
      }
    }
  }

  function montarGente(W, H, filas) {
    const chave = `${W}x${H}/${filas}`;
    if (chave === genteChave) return;
    genteChave = chave;
    gente = [];
    const u = Math.max(0.5, Math.min(W, H * 1.6) / 600);
    let k = 0;
    FILAS.slice(3 - filas).forEach((fl, r) => {
      const passo = 30 * u * fl.esc;
      const n = Math.max(8, Math.ceil(W / passo));
      for (let i = 0; i < n; i++) {
        k++;
        gente.push({
          fila: r, esc: (0.82 + hash(k + 2) * 0.36) * fl.esc, dy: fl.dy, fog: fl.fog,
          x: (i + 0.5 + (hash(k) - 0.5) * 0.7) * (W / n),
          larg: 0.9 + hash(k + 9) * 0.35,
          jeito: JEITOS[Math.floor(hash(k + 21) * JEITOS.length)],
          salto: 0.6 + hash(k + 3) * 0.8,
          atraso: hash(k + 5) * 0.09 + (hash(k + 6) < 0.12 ? 0.5 : 0),
          braco: hash(k + 8), fase: hash(k + 11) * 6.28,
          celular: hash(k + 17) < 0.1, bone: hash(k + 19) < 0.22, cabelo: hash(k + 23) < 0.3,
        });
      }
    });
    U.nFilas = filas;
  }

  /** A cor (e a força) do facho que cai mais perto de `x` na tela. */
  const RIM = [0, 0, 0];
  function corDaLuzEm(x, padrao) {
    let melhor = null, dist = Infinity;
    for (const c of cabecas) {
      if (c.wash || c.telaX === undefined) continue;
      const d = Math.abs(c.telaX - x);
      if (d < dist) { dist = d; melhor = c; }
    }
    if (!melhor) return padrao;
    const k = Math.min(1.4, melhor.I / 0.16) * (0.55 + 0.45 * Math.exp(-dist * 8));
    RIM[0] = melhor.cor[0] * k; RIM[1] = melhor.cor[1] * k; RIM[2] = melhor.cor[2] * k;
    return RIM;
  }

  let nGente = 0;
  /** O pulo e os braços de cada um (o mesmo jeito da galera 2D de cena.js). */
  function moverGente(E, nivel, ctx, W, H, cA, cB) {
    const filas = Math.min(P.filas, nivel >= 3 ? 3 : nivel >= 2 ? 2 : 1);
    const gw = gal ? gal.w : Math.round(W / 2), gh = gal ? gal.h : Math.round(H / 2);
    montarGente(gw, gh, filas);
    const toca = E.tocando, red = !!E.reduzido, pulam = toca && !E.quebra;
    const alturaMax = ctx.soShow ? 0.34 : 0.14;
    const rimK = (0.35 + (E.agudo || 0) * 0.35 + (E.dropV || 0) * 0.3) * (ctx.black ? 0.65 : 1);
    const bt0 = D.bt, grave = E.grave || 0, dropV = red ? 0 : E.dropV || 0, energia = E.energia || 0;
    const topo = [Infinity, Infinity, Infinity];
    let n = 0;
    const escreve = (o, a, b, c) => { gente32.set(a, o); gente32.set(b, o + 4); gente32.set(c, o + 8); };
    const pessoas = [];
    for (const p of gente) {
      const hr = gh * alturaMax * 0.14 * p.esc;
      const bt = bt0 - p.atraso;
      const f = frac(bt);
      const noUm = ((Math.floor(bt) % 4) + 4) % 4 === 0;
      const pp = red ? 0 : Math.exp(-f * 5);
      const forca = (0.45 + grave * 0.9) * (noUm ? 1.3 : 1) * (1 + dropV * 1.2);
      let salto = 0, lado = 0, cabeca = 0;
      if (pulam && !red) {
        if (p.jeito === 'pula') salto = pp * p.salto * hr * 0.9 * forca;
        else if (p.jeito === 'balanca') { lado = Math.sin(bt * Math.PI / 2 + p.fase) * hr * 0.45; salto = pp * hr * 0.25 * forca; }
        else if (p.jeito === 'cabeca') { cabeca = pp * 0.5 * forca; salto = pp * hr * 0.12; }
        else { salto = pp * hr * 0.4 * forca; lado = Math.sin(bt * Math.PI + p.fase) * hr * 0.2; }
      } else if (toca && !red) lado = Math.sin(bt0 * Math.PI / 4 + p.fase) * hr * 0.35;
      const y = hr * 3.1 + salto + p.dy * gh;
      const bracos = toca && (p.braco < energia * 0.75 - 0.15 || p.braco < dropV * 0.95
        || (p.jeito === 'acena' && p.braco < 0.7) || (E.quebra && p.braco < 0.22));
      topo[p.fila] = Math.min(topo[p.fila], y - 2.6 * hr);
      pessoas.push({ p, hr, x: p.x + lado, y, cabeca, bracos, acena: red ? 0 : Math.sin(bt * Math.PI + p.fase) * 0.35 });
    }
    // de trás pra frente: a MASSA da fileira (a faixa de corpos até o peito)
    // e depois as pessoas dela (a galera já vem agrupada por fileira)
    for (let r = 0; r < filas && n < MAX_GENTE; r++) {
      if (isFinite(topo[r])) escreve(n++ * 12, [0, topo[r], 1, 16], [0, 0, FILAS[3 - filas + r].fog, 0], [0, 0, 0, 0]);
      for (const s of pessoas) {
        if (s.p.fila !== r || n >= MAX_GENTE) continue;
        const p = s.p;
        const fl = (p.bone ? 1 : p.cabelo ? 2 : 0) | (p.celular && toca ? 4 : 0) | (s.bracos ? 8 : 0);
        const rim = corDaLuzEm(s.x / gw, cA);
        const rk = rimK * (r === filas - 1 ? 1 : 0.55);
        const y0 = Math.min(-2.9, (topo[r] - s.y) / s.hr - 0.2);
        escreve(n++ * 12, [s.x, s.y, s.hr, fl], [-s.cabeca, s.acena, p.fog, 1.75 * p.larg], [rim[0] * rk, rim[1] * rk, rim[2] * rk, y0]);
      }
    }
    nGente = n;
    U.fogCor = [Math.min(0.2, U.corMedia[0] * 0.35), Math.min(0.2, U.corMedia[1] * 0.35), Math.min(0.2, U.corMedia[2] * 0.35)];
    U.galK = ctx.soShow ? 1 : 0.55;
  }

  // ───────── o quadro ─────────
  function desenharQuadro(E, dt, nivel, ctx) {
    const W = cv.width, H = cv.height;
    dirigir(E, dt, nivel, ctx, W, H);
    const esc = hdr ? 1 : 0.25;
    const asp = W / H;

    // 1. LUZ
    let u = usar('luz');
    gl.uniform4fv(u('uF0'), F0); gl.uniform4fv(u('uF1'), F1); gl.uniform4fv(u('uF2'), F2); gl.uniform4fv(u('uF3'), F3);
    gl.uniform1i(u('uN'), U.n);
    gl.uniform1f(u('uAsp'), asp); gl.uniform1f(u('uTanF'), TAN_F); gl.uniform1f(u('uSp'), SP); gl.uniform1f(u('uCp'), CP);
    ligarTex(0, texRuido); gl.uniform1i(u('uRuido'), 0);
    gl.uniform2fv(u('uDeriva'), U.deriva);
    gl.uniform1f(u('uHaze'), U.haze); gl.uniform1f(u('uGanho'), U.ganho); gl.uniform1f(u('uEsc'), esc);
    gl.uniform1f(u('uSo'), ctx.soShow ? 1 : 0); gl.uniform1f(u('uNevoa'), U.nevoa);
    gl.uniform3fv(u('uCorMedia'), U.corMedia); gl.uniform3fv(u('uAmb'), U.amb);
    gl.uniform4fv(u('uFolha'), U.folha); gl.uniform3fv(u('uFolhaCor'), U.folhaCor);
    gl.uniform1f(u('uLed'), U.led); gl.uniform1f(u('uLedModo'), U.ledModo); gl.uniform1f(u('uBat'), D.btm);
    gl.uniform1fv(u('uEsp'), ESP); gl.uniform3fv(u('uLedA'), U.ledA); gl.uniform3fv(u('uLedB'), U.ledB);
    triangulo(luz);

    // 2. BLOOM
    u = usar('reduzir');
    ligarTex(0, luz.tex); gl.uniform1i(u('uFonte'), 0);
    gl.uniform2f(u('uTexel'), 0.5 / luz.w, 0.5 / luz.h);
    gl.uniform1f(u('uLimiar'), 0.55 * esc);
    triangulo(b4[0]);
    u = usar('borrar'); gl.uniform1i(u('uFonte'), 0);
    ligarTex(0, b4[0].tex); gl.uniform2f(u('uDir'), 1 / b4[0].w, 0); triangulo(b4[1]);
    ligarTex(0, b4[1].tex); gl.uniform2f(u('uDir'), 0, 1 / b4[0].h); triangulo(b4[0]);
    if (P.brilho >= 2) {
      u = usar('reduzir');
      ligarTex(0, b4[0].tex); gl.uniform1i(u('uFonte'), 0);
      gl.uniform2f(u('uTexel'), 0.5 / b4[0].w, 0.5 / b4[0].h);
      gl.uniform1f(u('uLimiar'), 0);
      triangulo(b8[0]);
      u = usar('borrar'); gl.uniform1i(u('uFonte'), 0);
      ligarTex(0, b8[0].tex); gl.uniform2f(u('uDir'), 1 / b8[0].w, 0); triangulo(b8[1]);
      ligarTex(0, b8[1].tex); gl.uniform2f(u('uDir'), 0, 1 / b8[0].h); triangulo(b8[0]);
    }

    // 3. GALERA (meia resolução, pré-multiplicada)
    naTela(gal);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (nGente) {
      u = usar('galera');
      gl.uniform2f(u('uRes'), gal.w, gal.h);
      gl.uniform3fv(u('uFogCor'), U.fogCor);
      gl.uniform1f(u('uRimK'), 1);
      gl.bindVertexArray(vaoGal);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufGal);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, gente32, 0, nGente * 12);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nGente);
      gl.disable(gl.BLEND);
    }

    // 4. FINAL
    u = usar('final');
    ligarTex(0, luz.tex); ligarTex(1, b4[0].tex); ligarTex(2, b8[0].tex); ligarTex(3, gal.tex); ligarTex(4, texRuido);
    gl.uniform1i(u('uLuz'), 0); gl.uniform1i(u('uB1'), 1); gl.uniform1i(u('uB2'), 2); gl.uniform1i(u('uGal'), 3); gl.uniform1i(u('uRuido'), 4);
    gl.uniform2f(u('uRes'), W, H); gl.uniform1f(u('uAsp'), asp); gl.uniform1f(u('uInv'), 1 / esc);
    const kb = 0.55 + (E.agudo || 0) * 0.2 + (E.dropV || 0) * 0.3;
    gl.uniform1f(u('uK1'), kb); gl.uniform1f(u('uK2'), P.brilho >= 2 ? kb * 1.1 : 0);
    gl.uniform1f(u('uExpo'), U.expo); gl.uniform1f(u('uFlash'), U.flash); gl.uniform1f(u('uCA'), U.ca);
    gl.uniform1f(u('uQuadro'), D.quadro % 997); gl.uniform1f(u('uSo'), ctx.soShow ? 1 : 0); gl.uniform1f(u('uGalK'), U.galK);
    gl.uniform4fv(u('uBlinder'), U.blinder);
    gl.uniform2fv(u('uBlA'), projetar([-5.5, -0.6, 12.5], asp)); gl.uniform2fv(u('uBlB'), projetar([5.5, -0.6, 12.5], asp));
    gl.uniform4fv(u('uLz'), U.lz); gl.uniform2fv(u('uLzAng'), U.lzAng); gl.uniform3fv(u('uLzCor'), U.lzCor);
    gl.uniform1f(u('uLzSem'), U.lzSem); gl.uniform2fv(u('uDeriva'), U.deriva);
    triangulo(null);

    // 5. CONFETE
    if (D.conf >= 0 && D.confN) {
      u = usar('confete');
      gl.uniform2f(u('uRes'), W, H); gl.uniform1f(u('uT'), D.conf);
      gl.uniform1f(u('uU'), Math.max(1, Math.min(W, H * 1.6) / 600));
      gl.bindVertexArray(vaoConf);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, D.confN);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  // PLACA REINICIOU: para, e refaz tudo quando o navegador devolver
  cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); perdido = true; });
  cv.addEventListener('webglcontextrestored', () => {
    if (falhou) return;
    perdido = false;
    try { criarRecursos(); sujo = true; cabecasChave = ''; } catch { falhou = true; }
  });

  criarRecursos();

  const PARADO = { tocando: false, bpm: 0, batida: 0, grave: 0, medio: 0, agudo: 0, energia: 0, pulso: 0, dropV: 0, drop: -1e9, quebra: false, reduzido: false };
  const px1 = new Uint8Array(4);

  const api = {
    get pronto() { return compilado && assado && aquecido && !perdido && !falhou; },
    get falhou() { return falhou; },
    get perdido() { return perdido; },
    get preset() { return preset; },
    get msQuadro() { return msQuadro; },
    get fase() { return D.fase; },
    get look() { return D.look; },
    get resolucoes() {
      return { saida: [cv.width, cv.height], luz: luz ? [luz.w, luz.h] : null, galera: gal ? [gal.w, gal.h] : null, hdr, gente: nGente };
    },
    /**
     * Um passo da preparação (chamar a cada quadro enquanto a pista 2D
     * aparece): confere a compilação, assa a fumaça, desenha 3 quadros
     * escondidos e cronometra o último (a régua da placa).
     */
    preparar(ctx = {}) {
      if (api.pronto) return true;
      if (!conferirCompilacao()) return false;
      if (!assado) { assar(); return false; }
      if (sujo || !luz) refazerAlvos();
      if (!luz) return false;
      for (let i = 0; i < 2; i++) desenharQuadro(PARADO, 1 / 30, 2, ctx);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
      const t0 = performance.now();
      desenharQuadro(PARADO, 1 / 30, 3, ctx);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
      msQuadro = performance.now() - t0;
      aquecido = true;
      D.dropVisto = undefined;          // o 1º quadro de verdade só anota o drop atual, não dispara
      if (avisarPlaca) { avisarPlaca = false; try { op.aoMedirPlaca?.(msQuadro); } catch {} }
      return api.pronto;
    },
    tamanho(w, h) {
      w = Math.round(w); h = Math.round(h);
      if (w !== telaW || h !== telaH) { telaW = w; telaH = h; sujo = true; }
    },
    qualidade(nome) {
      if (!PRESETS[nome] || nome === preset) return;
      preset = nome; P = PRESETS[nome]; sujo = true;
    },
    /** A pista desligou: devolve a memória dos alvos de tela cheia. */
    dormir() {
      if (perdido || gl.isContextLost()) return;
      apagarAlvos(); sujo = true;
      cv.width = 1; cv.height = 1;
    },
    /** Um quadro. `E` é o estadoPista; `dt` em segundos; `nivel` 1..3. */
    desenhar(E, dt, nivel = 3, ctx = {}) {
      if (!api.pronto && !api.preparar(ctx)) return;
      if (sujo || !luz) refazerAlvos();
      if (!luz) return;
      desenharQuadro(E, dt, nivel, ctx);
    },
    liberar() {
      falhou = true;
      if (gl.isContextLost()) return;
      apagarAlvos();
      if (texRuido) gl.deleteTexture(texRuido);
      if (fbRuido) gl.deleteFramebuffer(fbRuido);
      for (const p of Object.values(progs || {})) { gl.deleteProgram(p.prog); gl.deleteShader(p.vs); gl.deleteShader(p.fs); }
      for (const b of [bufTri, bufQuad, bufGal, bufConfQuad, bufConf]) if (b) gl.deleteBuffer(b);
      for (const v of [vaoTela, vaoGal, vaoConf]) if (v) gl.deleteVertexArray(v);
      cv.width = 1; cv.height = 1;
      try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
    },
  };
  return api;
}
