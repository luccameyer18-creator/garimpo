/**
 * HIPERESPAÇO HD — a mesma viagem do hiperespaco.js, AO VIVO em Full HD,
 * sem pagar Full HD em cada pixel. É o jeito dos programas de VJ (Resolume,
 * MilkDrop) e dos jogos: a conta cara roda pequena, o que dá nitidez é barato.
 *
 *   1. PESADO em resolução baixa (1/2 a 1/4 da tela): as 5 cenas de sempre
 *      (crisântemo, túnel, mandala, joias, fractal), + nitidez CAS ainda
 *      pequena.
 *   2. DETALHE ASSADO: uma vez só (1 ladrilho por quadro, sem travar) duas
 *      texturas com muitas voltas de fractal — o gasket de Apolônio (pérolas)
 *      e o conjunto de Kali (filigrana). Por quadro elas só são LIDAS, em
 *      resolução cheia, com dobras baratas (log-polar = túnel infinito,
 *      caleidoscópio, zoom, giro) e esculpem a imagem ampliada. Ler textura
 *      é barato; cada pixel Full HD ganha detalhe de verdade.
 *   3. RASTRO em resolução cheia: o quadro anterior volta ampliado, girado e
 *      com a cor andando, e vai sumindo (o truque central do MilkDrop).
 *   4. COMPOSTO: bloom (1/4 e 1/8 da tela), aberração cromática que cresce
 *      com o grave, e o drop: exposição sobe + clarão branco do centro.
 *
 * CUSTO medido na Intel UHD 620 (1920x1080, preset 'alto'): ~6-8 ms de GPU
 * por quadro conforme a cena; esperando a GPU a cada quadro dá ~95 quadros/s.
 * 'baixo' (1280x720 ampliado): ~3,4 ms. Por quadro nada lê pixels de volta
 * nem espera a placa: a CPU só manda ~11 desenhos — não disputa a linha
 * principal com o resto do app.
 *
 * TROCA DE CENA = PORTAL que abre do centro (cada pixel calcula uma cena só;
 * duas só na borda do anel): a troca custa quase o mesmo que um quadro normal.
 *
 * NÃO TRAVA AO LIGAR: compilar os shaders leva ~1 s no ANGLE/D3D11. Com
 * KHR_parallel_shader_compile isso corre fora da página; sem ela, compila um
 * programa por quadro. Depois assa as texturas (1 ladrilho por quadro) e
 * desenha UM quadro escondido (o driver termina o que deixou pro 1º uso).
 * Até `pronto`, quem chama continua mostrando o hiperespaço antigo.
 *
 * MESMA INTERFACE do montarHiperespaco(): { CENAS, cena, trocar, tamanho,
 * desenhar(E, dt, nivel) } — mais `preparar()`, `pronto`, `falhou`, `perdido`,
 * `qualidade(preset)`, `dormir()` e `liberar()`. `trocar(i, seg)` aceita a
 * duração da fusão (0 = corte seco).
 */

import { cabecalho, VERT, PESADO, NITIDEZ, ASSAR, DETALHE, REDUZIR, BORRAR, FINAL } from './hiper-hd-shaders.js';

/**
 * PRESETS de qualidade. pesada = fração da saída no passe pesado; saida =
 * fração do canvas (1 = pixel nativo); brilho = níveis de bloom; iterF/iterM
 * = voltas do fractal e da mandala no passe pesado. 'minimo' é o degrau a
 * mais pro celular fraco, que já começa no 'medio'.
 */
export const PRESETS = {
  ultra:  { pesada: 1 / 2, saida: 1, brilho: 2, iterF: 11, iterM: 5 },
  alto:   { pesada: 1 / 3, saida: 1, brilho: 2, iterF: 11, iterM: 5 },
  medio:  { pesada: 1 / 4, saida: 1, brilho: 1, iterF: 9, iterM: 4 },
  baixo:  { pesada: 1 / 4, saida: 2 / 3, brilho: 1, iterF: 7, iterM: 4 },
  minimo: { pesada: 1 / 4, saida: 1 / 2, brilho: 1, iterF: 6, iterM: 3 },
};
export const ORDEM_PRESETS = ['ultra', 'alto', 'medio', 'baixo', 'minimo'];

/**
 * Degrau do medidor (qualidade.js: Q.escala 1 / 0.75 / 0.55) → preset,
 * descendo a partir do preset inicial daquele aparelho.
 */
export function presetParaEscala(inicial, escala) {
  const i = Math.max(0, ORDEM_PRESETS.indexOf(inicial));
  const desce = escala >= 0.99 ? 0 : escala >= 0.7 ? 1 : 2;
  return ORDEM_PRESETS[Math.min(ORDEM_PRESETS.length - 1, i + desce)];
}

/**
 * O preset de partida pela régua da placa (`msAssar`: o último ladrilho
 * cronometrado com espera, projetado pro assado inteiro em 2048²). Na Intel
 * UHD 620 dá ~140 ms. Placa ~3x mais rápida vai pro 'ultra'; ~2x mais lenta
 * que a Intel começa no 'medio'. Depois o medidor ajusta.
 */
export function presetPelaPlaca(msAssar) {
  if (!(msAssar > 0)) return 'alto';
  if (msAssar < 50) return 'ultra';
  if (msAssar < 300) return 'alto';
  return 'medio';
}

const CENAS = 5;
const BANDAS = ['grave', 'medio', 'agudo', 'energia'];

// desenho de cada textura assada (afinado no olho)
const ASSADOS = [
  { qual: 0, iter: 11, k: [1.05, 0.9, 0.0, 0.0] },                          // Apolônio: s, traço
  { qual: 1, iter: 14, k: [1.6, -0.6, -0.75, 0.0], o: [0.05, 0.03, 45, 0] },  // Kali: escala, k; o.z = finura do traço
];

// o RASTRO de cada cena: zoom por segundo, giro (rad/s), ondulação
const RASTRO = [
  { zoom: 1.35, giro: 0.10, onda: 0.0015 },   // crisântemo: abre pra fora
  { zoom: 1.9,  giro: 0.05, onda: 0.0010 },   // túnel: voa pra frente
  { zoom: 1.12, giro: 0.35, onda: 0.0020 },   // mandala: gira
  { zoom: 0.92, giro: -0.08, onda: 0.0025 },  // joias: afunda devagar
  { zoom: 1.5,  giro: -0.18, onda: 0.0015 },  // fractal: mergulha girando
];

const FONTES = [['pesado', PESADO], ['nitidez', NITIDEZ], ['assar', ASSAR], ['detalhe', DETALHE],
  ['reduzir', REDUZIR], ['borrar', BORRAR], ['final', FINAL]];

// a música "parada" do quadro de aquecimento (nada de drop nem de pulso)
const PARADO = { tocando: false, bpm: 0, grave: 0, medio: 0, agudo: 0, energia: 0, pulso: 0, dropV: 0, quebra: false, reduzido: false };

/**
 * Monta o hiperespaço HD num canvas. Devolve null se não houver WebGL.
 * Não desenha nada ainda: chamar `preparar()` a cada quadro até `pronto`.
 * @param {HTMLCanvasElement} cv
 * @param {object} [op]
 * @param {string} [op.preset]      preset inicial (ver PRESETS)
 * @param {number} [op.lado]        lado das texturas assadas (2048; 1024 no celular)
 * @param {number} [op.cena]        cena inicial (senão, sorteia)
 * @param {function} [op.aoMedirPlaca]  (msAssar) => void, uma vez, no fim do assado
 */
export function montarHiperespacoHD(cv, op = {}) {
  const attrs = { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false,
    preserveDrawingBuffer: false, powerPreference: 'high-performance' };
  let gl = cv.getContext('webgl2', attrs);
  const gl2 = !!gl;
  if (!gl) gl = cv.getContext('webgl', attrs) || cv.getContext('experimental-webgl', attrs);
  if (!gl) return null;

  const LADO = op.lado === 1024 ? 1024 : 2048;
  const LADRILHO = LADO / 4;                  // 16 ladrilhos por textura, em qualquer tamanho
  const LADRILHOS = 16;
  const UNI_PAL = 7;                          // a paleta mora na unidade 7

  // ───────── recursos da placa (refeitos inteiros se o contexto voltar) ─────────
  let extLod, extParalelo, maxLado;
  let progs, fila, buf, texPal, assados;
  let compilado, falhou = false, perdido = false;
  let ladrilho, assado, aquecido, detalheV, msAssar = 0, medido = false;

  function criarRecursos() {
    extLod = gl2 ? true : !!gl.getExtension('EXT_shader_texture_lod');
    extParalelo = gl.getExtension('KHR_parallel_shader_compile');
    maxLado = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
    progs = {}; compilado = false;
    ladrilho = 0; assado = false; aquecido = false; detalheV = 0;
    baixa = afiada = null; fb = [null, null]; b4 = [null, null]; b8 = [null, null];

    // com a extensão, pede todos de uma vez e a placa compila em paralelo;
    // sem ela, `preparar()` compila um por quadro (cada um trava um pouco,
    // em vez de tudo travar ~1 s de uma vez)
    fila = FONTES.slice();
    if (extParalelo) while (fila.length) compilar(...fila.shift());

    // triângulo que cobre a tela (atributo 0 em todos os programas)
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);

    // a PALETA numa tabela de 256 cores (repete): a mesma fórmula do
    // hiperespaco.js, 0.5 + 0.5·cos(2π(t + fase)); fica presa na unidade 7
    const pal = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const t = i / 256;
      [0, 0.33, 0.67].forEach((f, c) => { pal[i * 4 + c] = Math.round(255 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (t + f)))); });
      pal[i * 4 + 3] = 255;
    }
    texPal = textura(256, 1, { repetir: true, dados: pal });
    gl.activeTexture(gl.TEXTURE0 + UNI_PAL); gl.bindTexture(gl.TEXTURE_2D, texPal);
    gl.activeTexture(gl.TEXTURE0);

    // as duas texturas assadas (com mipmap: longe do centro do túnel não cintila)
    assados = ASSADOS.map((a) => ({ ...a, alvo: alvo(LADO, LADO, { repetir: true, mip: true }) }));
  }

  function compilar(nome, fonteFrag) {
    const sh = (tipo, src) => { const s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const vs = sh(gl.VERTEX_SHADER, cabecalho(gl2, false, extLod) + VERT);
    const fs = sh(gl.FRAGMENT_SHADER, cabecalho(gl2, true, extLod) + fonteFrag);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'p');
    gl.linkProgram(prog);
    const U = new Map();
    // localizador de uniforms com cache (sem criar função nova por quadro)
    const u = (n) => { let l = U.get(n); if (l === undefined) { l = gl.getUniformLocation(prog, n); U.set(n, l); } return l; };
    progs[nome] = { prog, vs, fs, u };
    // sem a extensão paralela, perguntar o status JÁ força o trabalho neste
    // quadro (senão ele ficaria todo pra primeira pergunta, lá no fim)
    if (!extParalelo) gl.getProgramParameter(prog, gl.LINK_STATUS);
  }

  /**
   * Os shaders ficaram prontos? Se algum não compilar (placa/driver
   * esquisito), NÃO joga erro a cada quadro: marca `falhou` e para — quem
   * chama volta pro hiperespaço antigo.
   */
  function conferirCompilacao() {
    if (compilado) return true;
    if (falhou || perdido || gl.isContextLost()) return false;
    if (fila.length) { compilar(...fila.shift()); return false; }
    if (extParalelo && !Object.values(progs).every((p) => gl.getProgramParameter(p.prog, extParalelo.COMPLETION_STATUS_KHR))) return false;
    for (const [nome, p] of Object.entries(progs)) {
      if (!gl.getProgramParameter(p.prog, gl.LINK_STATUS)) {
        if (gl.isContextLost()) return false;
        console.warn(`hiperespaço HD: shader ${nome} não compilou; fica o hiperespaço de antes.`,
          gl.getShaderInfoLog(p.fs) || gl.getProgramInfoLog(p.prog));
        falhou = true;
        return false;
      }
    }
    compilado = true;
    return true;
  }
  const usar = (nome) => { gl.useProgram(progs[nome].prog); return progs[nome].u; };

  // ───────── texturas e alvos ─────────
  function textura(w, h, { repetir = false, mip = false, dados = null } = {}) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);                 // nunca mexe na unidade 7 (paleta)
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, dados);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repetir ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }
  function alvo(w, h, opts) {
    const tex = textura(w, h, opts);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb: f, w, h };
  }
  const apagar = (a) => { if (a) { gl.deleteTexture(a.tex); gl.deleteFramebuffer(a.fb); } };
  const ligarTex = (unidade, tex) => { gl.activeTexture(gl.TEXTURE0 + unidade); gl.bindTexture(gl.TEXTURE_2D, tex); };
  const desenhaEm = (a) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, a ? a.fb : null);
    gl.viewport(0, 0, a ? a.w : gl.drawingBufferWidth, a ? a.h : gl.drawingBufferHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /**
   * Assa `n` ladrilhos (~2,5 ms de GPU cada numa Intel UHD; os 32 levam ~1 s
   * a 30 quadros/s). O ÚLTIMO é cronometrado com espera (uma vez só, ~3 ms
   * parado) — é a régua de quanta placa tem (`msAssar`).
   */
  function assar(n = 1) {
    if (assado) return;
    const u = usar('assar');
    gl.uniform1f(u('uTam'), LADO);
    gl.enable(gl.SCISSOR_TEST);
    const porLinha = LADO / LADRILHO;
    for (let i = 0; i < n && !assado; i++, ladrilho++) {
      const qual = Math.floor(ladrilho / LADRILHOS);
      const j = ladrilho % LADRILHOS;
      const ultimo = qual === assados.length - 1 && j === LADRILHOS - 1;
      const A = assados[qual];
      gl.uniform1f(u('uQual'), A.qual);
      gl.uniform1f(u('uIter'), A.iter);
      gl.uniform4f(u('uK'), ...A.k);
      gl.uniform4f(u('uO'), ...(A.o || [0, 0, 0, 0]));
      gl.bindFramebuffer(gl.FRAMEBUFFER, A.alvo.fb);
      gl.viewport(0, 0, LADO, LADO);
      gl.scissor((j % porLinha) * LADRILHO, Math.floor(j / porLinha) * LADRILHO, LADRILHO, LADRILHO);
      let t0 = 0;
      const medir = ultimo && !medido;
      if (medir) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); t0 = performance.now(); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (medir) {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
        // projetado pro assado inteiro EM 2048² (a régua não muda com a
        // textura menor do celular)
        msAssar = (performance.now() - t0) * LADRILHOS * assados.length * (2048 / LADO) ** 2;
        medido = true;
      }
      if (j === LADRILHOS - 1) {                      // terminou esta textura: mipmaps
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, A.alvo.tex);
        gl.generateMipmap(gl.TEXTURE_2D);
        if (qual === assados.length - 1) assado = true;
      }
    }
    gl.disable(gl.SCISSOR_TEST);
    if (assado && avisarPlaca) { avisarPlaca = false; try { op.aoMedirPlaca?.(msAssar); } catch {} }
  }
  const px1 = new Uint8Array(4);
  let avisarPlaca = true;              // aoMedirPlaca: só uma vez, mesmo se a placa cair e voltar

  // ───────── estado ─────────
  let preset = PRESETS[op.preset] ? op.preset : 'alto';
  let P = PRESETS[preset];
  let telaW = 0, telaH = 0, sujo = true;
  let baixa = null, afiada = null, fb = [null, null], b4 = [null, null], b8 = [null, null], q = 0;

  function apagarAlvos() {
    for (const a of [baixa, afiada, ...fb, ...b4, ...b8]) apagar(a);
    baixa = afiada = null; fb = [null, null]; b4 = [null, null]; b8 = [null, null];
  }
  // tamanho e preset só valem no próximo quadro: um arrastar de janela
  // dispara dezenas de 'resize' e cada refazer aloca ~4 texturas de tela cheia
  function refazerAlvos() {
    sujo = false;
    if (!telaW || !telaH) return;
    const W = Math.max(2, Math.min(maxLado, Math.round(telaW * P.saida)));
    const H = Math.max(2, Math.min(maxLado, Math.round(telaH * P.saida)));
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    apagarAlvos();
    const bw = Math.max(2, Math.round(W * P.pesada)), bh = Math.max(2, Math.round(H * P.pesada));
    baixa = alvo(bw, bh);
    afiada = alvo(bw, bh);
    fb = [alvo(W, H), alvo(W, H)];
    const w4 = Math.max(2, Math.round(W / 4)), h4 = Math.max(2, Math.round(H / 4));
    b4 = [alvo(w4, h4), alvo(w4, h4)];
    const w8 = Math.max(2, Math.round(w4 / 2)), h8 = Math.max(2, Math.round(h4 / 2));
    b8 = [alvo(w8, h8), alvo(w8, h8)];
  }

  let cena = Number.isInteger(op.cena) ? ((op.cena % CENAS) + CENAS) % CENAS : Math.floor(Math.random() * CENAS);
  let proxima = cena, mix = 0, fusaoSeg = 2;
  let t = 0, voo = 0, hue = Math.random(), quadro = 0, chute = 0, dropVisto;
  const s = { grave: 0, medio: 0, agudo: 0, energia: 0 };

  function passo(E, dt) {
    const bps = (E.tocando && E.bpm ? E.bpm : 90) / 60;
    const lento = (E.quebra ? 0.35 : 1) * (E.tocando ? 1 : 0.4);
    t += dt * bps * lento;                                  // o tempo da música
    const k = Math.min(1, dt * 6);
    for (const n of BANDAS) s[n] += ((E[n] || 0) - s[n]) * k;
    voo += dt * bps * lento * (0.18 + s.grave * 0.3 + (E.dropV || 0) * 0.5);
    hue += dt * 0.01 + ((E.dropV || 0) > 0.9 ? 0.002 : 0);
    if (mix > 0) { mix += dt / Math.max(0.05, fusaoSeg); if (mix >= 1) { cena = proxima; mix = 0; } }
    // o drop dá um CHUTE no rastro (zoom e giro fortes que se acalmam)
    const dv = E.reduzido ? 0 : (E.dropV || 0);
    // (pelo carimbo do drop, não por "dropV passou de 0.95": com a página
    // pesada a viagem desenha 6-10x/s e o dropV já caiu disso no quadro seguinte)
    if (E.drop !== dropVisto) { if (dropVisto !== undefined && dv > 0.5) chute = 1; dropVisto = E.drop; }
    chute *= Math.exp(-dt / 0.45);
  }

  function desenharQuadro(E, dt, nivel) {
    const W = cv.width, H = cv.height;
    const resp = 1 - (E.reduzido ? 0 : (E.pulso || 0)) * 0.06 - s.grave * 0.05;
    const giro = t * 0.02 * (0.5 + s.medio);
    const quebra = E.quebra ? 1 : 0;
    const dv = E.reduzido ? 0 : (E.dropV || 0);

    // ── 1. PESADO (baixa resolução) ──
    let u = usar('pesado');
    gl.uniform2f(u('uRes'), baixa.w, baixa.h);
    gl.uniform1f(u('uResp'), resp); gl.uniform1f(u('uGiro'), giro);
    gl.uniform1f(u('uHue'), hue); gl.uniform1f(u('uT'), t);
    gl.uniform1f(u('uGrave'), s.grave); gl.uniform1f(u('uMedio'), s.medio);
    gl.uniform1f(u('uAgudo'), s.agudo); gl.uniform1f(u('uEnergia'), s.energia);
    gl.uniform1f(u('uQuebra'), quebra);
    gl.uniform1f(u('uCenaA'), cena); gl.uniform1f(u('uCenaB'), proxima); gl.uniform1f(u('uMix'), mix);
    gl.uniform1f(u('uIterF'), P.iterF); gl.uniform1f(u('uIterM'), P.iterM);
    gl.uniform1i(u('uPal'), UNI_PAL);
    desenhaEm(baixa);

    // ── 1b. NITIDEZ (CAS, ainda em baixa resolução) ──
    u = usar('nitidez');
    ligarTex(0, baixa.tex); gl.uniform1i(u('uFonte'), 0);
    gl.uniform2f(u('uTexel'), 1 / baixa.w, 1 / baixa.h);
    gl.uniform1f(u('uForca'), 0.8);
    desenhaEm(afiada);

    // ── 2. DETALHE + RASTRO (resolução cheia) ──
    const dst = fb[q], src = fb[1 - q];
    u = usar('detalhe');
    ligarTex(0, afiada.tex); ligarTex(1, src.tex); ligarTex(2, assados[0].alvo.tex); ligarTex(3, assados[1].alvo.tex);
    gl.uniform1i(u('uBaixa'), 0); gl.uniform1i(u('uAnt'), 1); gl.uniform1i(u('uAssA'), 2); gl.uniform1i(u('uAssB'), 3);
    gl.uniform1i(u('uPal'), UNI_PAL);
    gl.uniform2f(u('uRes'), W, H);
    gl.uniform1f(u('uResp'), resp); gl.uniform1f(u('uGiro'), giro);
    gl.uniform1f(u('uHue'), hue); gl.uniform1f(u('uT'), t); gl.uniform1f(u('uVoo'), voo);
    gl.uniform1f(u('uGrave'), s.grave); gl.uniform1f(u('uMedio'), s.medio);
    gl.uniform1f(u('uAgudo'), s.agudo); gl.uniform1f(u('uEnergia'), s.energia);
    gl.uniform1f(u('uQuebra'), quebra); gl.uniform1f(u('uPulso'), E.pulso || 0);
    gl.uniform1f(u('uCenaA'), cena); gl.uniform1f(u('uCenaB'), proxima); gl.uniform1f(u('uMix'), mix);
    detalheV = assado ? Math.min(1, detalheV + dt * 1.5) : 0;   // o detalhe entra suave
    gl.uniform1f(u('uDetalhe'), detalheV);
    gl.uniform1f(u('uPix'), resp / Math.min(W, H));
    gl.uniform1f(u('uLado'), LADO);
    // rastro: durante a troca (portal) mistura o movimento das duas cenas
    const ra = RASTRO[cena], rb = RASTRO[proxima], m = mix;
    const zoomSeg = (ra.zoom + (rb.zoom - ra.zoom) * m) * (1 + s.grave * 0.25) + chute * 2.2;
    const giroSeg = (ra.giro + (rb.giro - ra.giro) * m) * (0.6 + s.medio) + chute * 0.9;
    const reter = Math.pow(E.quebra ? 0.15 : 0.04, dt);         // quanto do rastro fica por quadro
    gl.uniform4f(u('uFb'), Math.pow(zoomSeg, dt), giroSeg * dt, reter, (ra.onda + (rb.onda - ra.onda) * m) * (1 + s.agudo));
    gl.uniform1f(u('uFbMix'), E.quebra ? 0.9 : 0.75);
    gl.uniform1f(u('uCorGiro'), Math.min(0.5, dt * 1.2));
    gl.uniform1f(u('uQuadro'), quadro % 997);
    desenhaEm(dst);

    // ── 3. BRILHO (bloom em 1/4 e 1/8) ──
    const brilho = P.brilho;
    if (brilho >= 1) {
      u = usar('reduzir');
      ligarTex(0, dst.tex); gl.uniform1i(u('uFonte'), 0);
      gl.uniform2f(u('uTexel'), 1 / W, 1 / H);
      gl.uniform1f(u('uLimiar'), 0.72 - s.energia * 0.1);
      gl.uniform1f(u('uGanho'), 1.0);
      desenhaEm(b4[0]);
      u = usar('borrar'); gl.uniform1i(u('uFonte'), 0);
      ligarTex(0, b4[0].tex); gl.uniform2f(u('uDir'), 1 / b4[0].w, 0); desenhaEm(b4[1]);
      ligarTex(0, b4[1].tex); gl.uniform2f(u('uDir'), 0, 1 / b4[0].h); desenhaEm(b4[0]);
      if (brilho >= 2) {
        u = usar('reduzir');
        ligarTex(0, b4[0].tex); gl.uniform1i(u('uFonte'), 0);
        gl.uniform2f(u('uTexel'), 0.5 / b4[0].w, 0.5 / b4[0].h);
        gl.uniform1f(u('uLimiar'), 0.0); gl.uniform1f(u('uGanho'), 1.0);
        desenhaEm(b8[0]);
        u = usar('borrar'); gl.uniform1i(u('uFonte'), 0);
        ligarTex(0, b8[0].tex); gl.uniform2f(u('uDir'), 1 / b8[0].w, 0); desenhaEm(b8[1]);
        ligarTex(0, b8[1].tex); gl.uniform2f(u('uDir'), 0, 1 / b8[0].h); desenhaEm(b8[0]);
      }
    }

    // ── 4. FINAL (na tela) ──
    u = usar('final');
    ligarTex(0, dst.tex); ligarTex(1, b4[0].tex); ligarTex(2, b8[0].tex);
    gl.uniform1i(u('uCena'), 0); gl.uniform1i(u('uBrilho1'), 1); gl.uniform1i(u('uBrilho2'), 2);
    gl.uniform2f(u('uRes'), W, H);
    gl.uniform1f(u('uResp'), resp);
    const pulso = E.reduzido ? 0 : (E.pulso || 0);
    // aberração: ~2 px parado, ~12 px nas bordas no pico do grave/drop (Full HD)
    gl.uniform1f(u('uCA'), E.reduzido ? 0 : 0.002 + s.grave * 0.004 + pulso * s.grave * 0.006 + dv * 0.01);
    const kb = 0.35 + s.agudo * 0.35 + dv * 0.3;
    gl.uniform1f(u('uBrilhoK1'), brilho >= 1 ? kb : 0);
    gl.uniform1f(u('uBrilhoK2'), brilho >= 2 ? kb * 1.2 : 0);
    gl.uniform1f(u('uDrop'), dv); gl.uniform1f(u('uNivel'), (nivel - 1) / 2);
    gl.uniform1f(u('uClarao'), 1);
    gl.uniform1f(u('uQuadro'), quadro % 997);
    desenhaEm(null);

    q = 1 - q; quadro++;
  }

  // PLACA REINICIOU / driver caiu: tudo o que estava na placa se perde. Para
  // de desenhar (quem chama mostra o hiperespaço antigo) e, quando o
  // navegador devolve o contexto, refaz tudo — compila e assa de novo, aos
  // poucos, como da primeira vez. preventDefault() é o que permite a volta.
  cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); perdido = true; });
  cv.addEventListener('webglcontextrestored', () => {
    if (falhou) return;
    perdido = false;
    try { criarRecursos(); sujo = true; } catch { falhou = true; }
  });

  criarRecursos();

  const api = {
    CENAS,
    get cena() { return cena; },
    /** Compilou, assou e já desenhou um quadro escondido: pode mostrar. */
    get pronto() { return compilado && assado && aquecido && !perdido && !falhou; },
    /** Algum shader não compilou: desistir do HD de vez. */
    get falhou() { return falhou; },
    /** A placa caiu; volta sozinho (recompila e reassa) quando o navegador devolver. */
    get perdido() { return perdido; },
    get msAssar() { return msAssar; },
    get preset() { return preset; },
    get resolucoes() {
      return { saida: [cv.width, cv.height], pesada: baixa ? [baixa.w, baixa.h] : null, lado: LADO, gl2 };
    },
    /**
     * Um passo da preparação, pra chamar a cada quadro enquanto a viagem
     * mostra o hiperespaço antigo: confere a compilação, assa um ladrilho e,
     * no fim, desenha um quadro escondido. Devolve `pronto`.
     */
    preparar() {
      if (api.pronto) return true;
      if (!conferirCompilacao()) return false;
      if (!assado) { assar(1); return false; }
      if (sujo || !baixa) refazerAlvos();
      if (!baixa) return false;
      passo(PARADO, 1 / 30);
      desenharQuadro(PARADO, 1 / 30, 2);
      aquecido = true;
      return api.pronto;
    },
    /** Pula pra cena `para`: o PORTAL abre em `seg` segundos (0 = corte seco). */
    trocar(para = (cena + 1) % CENAS, seg = 2) {
      para = ((para % CENAS) + CENAS) % CENAS;
      if (seg <= 0) { cena = proxima = para; mix = 0; return; }
      if (mix === 0 && para !== cena) { proxima = para; fusaoSeg = seg; mix = 0.0001; }
    },
    /** Tamanho da TELA em pixels do aparelho (o preset decide quanto disso é desenhado). */
    tamanho(w, h) {
      w = Math.round(w); h = Math.round(h);
      if (w !== telaW || h !== telaH) { telaW = w; telaH = h; sujo = true; }
    },
    /** Troca o preset (ver PRESETS) — só refaz texturas, não recompila. */
    qualidade(nome) {
      if (!PRESETS[nome] || nome === preset) return;
      preset = nome; P = PRESETS[nome]; sujo = true;
    },
    /**
     * A viagem desligou (ou foi pro MilkDrop): devolve a memória das
     * texturas de tela cheia (~40-60 MB em 1080p). Shaders e texturas
     * assadas ficam — voltar é imediato.
     */
    dormir() {
      if (perdido || gl.isContextLost()) return;
      apagarAlvos(); sujo = true;
      cv.width = 1; cv.height = 1;
    },
    /** Um quadro. `E` é o estadoPista; `dt` em segundos; `nivel` 1..3. */
    desenhar(E, dt, nivel = 3) {
      if (!api.pronto && !api.preparar()) return;
      if (sujo || !baixa) refazerAlvos();
      if (!baixa) return;
      passo(E, dt);
      desenharQuadro(E, dt, nivel);
    },
    /** Solta tudo da placa (desistiu do HD de vez). */
    liberar() {
      falhou = true;
      if (gl.isContextLost()) return;
      apagarAlvos();
      for (const a of assados || []) apagar(a.alvo);
      if (texPal) gl.deleteTexture(texPal);
      for (const p of Object.values(progs || {})) { gl.deleteProgram(p.prog); gl.deleteShader(p.vs); gl.deleteShader(p.fs); }
      if (buf) gl.deleteBuffer(buf);
      cv.width = 1; cv.height = 1;
    },
  };
  return api;
}
