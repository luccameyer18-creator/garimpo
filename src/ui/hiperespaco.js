/**
 * HIPERESPAÇO — a viagem desenhada na placa de vídeo, no clima do que quem
 * fumou DMT descreve.
 *
 * Os relatos (e os estudos com participantes, ex.: Lawrence et al. 2022,
 * Sci. Reports, sobre a fenomenologia do DMT inalado) repetem as mesmas
 * imagens: geometria FRACTAL que se repete pra dentro, MANDALAS em
 * caleidoscópio com cores saturadas e iridescentes, a "flor de CRISÂNTEMO"
 * que abre, um TÚNEL de hiperespaço, TRELIÇAS que parecem joias, tudo
 * "respirando". No 5-MeO-DMT o relato é outro: dissolução numa LUZ BRANCA.
 * Nada aqui é vídeo de ninguém — é um shader (programa da placa de vídeo)
 * que gera tudo na hora, a partir da música.
 *
 * CENAS: crisântemo · túnel · mandala · joias · fractal. Troca a cada frase de
 * 32 tempos com fusão; o ↻ da cabine pula pra próxima.
 *
 * A MÚSICA manda em tudo (via `estadoPista`):
 *   grave    respira (zoom pulsando) e aproxima o túnel
 *   médio    gira
 *   agudo    acende o detalhe fino e o brilho das joias
 *   batida   o tempo da animação é o tempo da MÚSICA (em batidas)
 *   drop     o clarão branco do 5-MeO, que abre do centro e se dissolve
 *   quebra   tudo desacelera e escurece, esperando a volta
 *
 * LEVE: desenha em resolução baixa (a placa amplia), 30 quadros por segundo,
 * uma cena por vez (duas só durante a fusão). Sem WebGL, não liga — a viagem
 * cai no MilkDrop.
 */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uT, uGrave, uMedio, uAgudo, uEnergia, uPulso, uDrop, uQuebra, uHue, uNivel;
uniform float uCenaA, uCenaB, uMix;

const float PI = 3.14159265;

// paleta iridescente (cosseno), girando com a música
vec3 pal(float t) {
  return 0.5 + 0.5 * cos(6.2832 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.0, 0.33, 0.67) + uHue));
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// 1. CRISÂNTEMO: pétalas em anéis logarítmicos que nascem do centro
vec3 crisantemo(vec2 p) {
  float r = length(p), a = atan(p.y, p.x);
  float n = 8.0 + floor(uEnergia * 6.0) * 2.0;
  float anel = log(r + 1e-3) * 3.2 - uT * 0.5;
  float petala = abs(cos(a * n * 0.5 + anel * 1.7 + sin(anel) * 0.6));
  float faixa = abs(fract(anel) - 0.5);
  float f = smoothstep(0.55, 0.0, faixa * (1.2 - petala * 0.7));
  float fino = smoothstep(0.92, 1.0, petala) * (0.4 + uAgudo);
  vec3 c = pal(anel * 0.12 + petala * 0.2) * f + pal(anel * 0.2 + 0.5) * fino;
  return c * smoothstep(0.0, 0.15, r);
}

// grade hexagonal: distância até a borda da célula
float hexBorda(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}
vec4 hexCel(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5, b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  return vec4(g, p - g);
}

// 2. TÚNEL: coordenadas log-polares — a treliça corre na direção de quem olha
vec3 tunel(vec2 p) {
  float r = length(p), a = atan(p.y, p.x);
  vec2 q = vec2(a / PI * 3.0, 0.6 / (r + 0.05) + uT * (0.6 + uGrave * 1.2));
  vec4 h = hexCel(q * 1.4);
  float borda = 0.5 - hexBorda(h.xy);
  float linha = smoothstep(0.08, 0.0, borda);
  float brilho = smoothstep(0.35, 0.5, borda) * (0.3 + uAgudo * 0.9) * (0.5 + 0.5 * sin(h.w * 1.3 + uT * 2.0));
  vec3 c = pal(h.w * 0.07 + uT * 0.05) * linha + pal(h.z * 0.1 + 0.3) * brilho;
  return c * smoothstep(0.0, 0.35, r) * (1.0 + 0.6 / (r * 8.0 + 1.0));
}

// 3. MANDALA: caleidoscópio (dobra em N espelhos) + detalhe fractal
vec3 mandala(vec2 p) {
  float n = 6.0 + floor(uMedio * 4.0) * 2.0;
  float r = length(p), a = atan(p.y, p.x);
  float seg = PI * 2.0 / n;
  a = mod(a, seg); a = abs(a - seg * 0.5);
  vec2 q = vec2(cos(a), sin(a)) * r;
  vec3 c = vec3(0.0);
  float esc = 1.0;
  for (int i = 0; i < 5; i++) {
    q = abs(q * 1.6) - vec2(0.55 + 0.1 * sin(uT * 0.25), 0.3);
    q *= rot(0.3 + uT * 0.03);
    esc *= 1.6;
    float d = abs(length(q) - 0.4) / esc;
    c += pal(float(i) * 0.13 + r * 0.6 - uT * 0.04) * (0.0022 / (d + 0.002));
  }
  return c * (0.35 + uAgudo * 0.6);
}

// 4. JOIAS: cristais facetados numa treliça que gira devagar
vec3 joias(vec2 p) {
  p *= rot(uT * 0.04);
  p *= 3.0 + sin(uT * 0.125) * 0.6;
  vec4 h = hexCel(p);
  float d = hexBorda(h.xy);
  float face = atan(h.y, h.x) / PI * 3.0;
  float faceta = fract(face + 0.5);
  float centro = 0.5 - d;
  float gema = smoothstep(0.0, 0.05, centro);
  float luz = pow(max(0.0, sin(faceta * PI + dot(h.zw, vec2(0.7, 1.3)) + uT * 1.5)), 6.0);
  vec3 c = pal(dot(h.zw, vec2(0.05, 0.08)) + faceta * 0.15) * (0.25 + faceta * 0.4) * gema;
  c += vec3(1.0) * luz * gema * (0.2 + uAgudo * 1.1);
  c += pal(0.8) * smoothstep(0.03, 0.0, abs(centro)) * 0.6;
  return c;
}

// 5. FRACTAL: o conjunto de Kali, que muda de forma com a música
vec3 fractal(vec2 p) {
  vec2 z = p * (1.1 - uGrave * 0.25);
  vec2 k = vec2(-0.72 + 0.12 * sin(uT * 0.11), -0.65 + 0.1 * cos(uT * 0.07) + uMedio * 0.08);
  float acc = 0.0, m = 100.0;
  for (int i = 0; i < 11; i++) {
    z = abs(z) / dot(z, z) + k;
    m = min(m, length(z));
    acc += exp(-length(z) * 2.2);
  }
  vec3 c = pal(acc * 0.12 + uT * 0.02) * acc * 0.22;
  c += pal(m * 2.0 + 0.4) * smoothstep(0.06, 0.0, m) * (0.5 + uAgudo);
  return c;
}

vec3 cena(float i, vec2 p) {
  if (i < 0.5) return crisantemo(p);
  if (i < 1.5) return tunel(p);
  if (i < 2.5) return mandala(p);
  if (i < 3.5) return joias(p);
  return fractal(p);
}

void main() {
  vec2 p = (gl_FragCoord.xy - uRes * 0.5) / min(uRes.x, uRes.y);
  // RESPIRA com o grave e com o bumbo; GIRA com o médio
  p *= 1.0 - uPulso * 0.06 - uGrave * 0.05;
  p *= rot(uT * 0.02 * (0.5 + uMedio));
  vec3 c = cena(uCenaA, p);
  if (uMix > 0.001) c = mix(c, cena(uCenaB, p), uMix);
  // quebra: escurece e esfria, esperando a volta
  c *= 1.0 - uQuebra * 0.45;
  c *= 0.75 + uEnergia * 0.5;
  // o CLARÃO do 5-MeO no drop: luz branca que abre do centro e se dissolve
  float r = length(p);
  c += vec3(1.0, 0.97, 0.92) * uDrop * (0.35 + 0.35 * uNivel) * exp(-r * (2.5 - uDrop * 1.8));
  // vinheta suave
  c *= smoothstep(1.25, 0.25, r);
  gl_FragColor = vec4(pow(c, vec3(0.9)), 1.0);
}`;

/**
 * Monta o hiperespaço num canvas. Devolve null se não houver WebGL.
 * @param {HTMLCanvasElement} cv
 */
export function montarHiperespaco(cv) {
  const gl = cv.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false })
          || cv.getContext('experimental-webgl');
  if (!gl) return null;
  const sh = (tipo, src) => {
    const s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { console.warn('hiperespaço indisponível:', e.message); return null; }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ['uRes', 'uT', 'uGrave', 'uMedio', 'uAgudo', 'uEnergia', 'uPulso', 'uDrop', 'uQuebra', 'uHue',
                   'uNivel', 'uCenaA', 'uCenaB', 'uMix']) U[n] = gl.getUniformLocation(prog, n);

  const CENAS = 5;
  let cena = Math.floor(Math.random() * CENAS), proxima = cena, mix = 0, t = 0, hue = Math.random();
  // o que o shader recebe é SUAVIZADO: número cru de áudio treme
  const s = { grave: 0, medio: 0, agudo: 0, energia: 0 };

  return {
    CENAS,
    get cena() { return cena; },
    /** Pula pra próxima cena, com fusão de ~2 s. */
    trocar(para = (cena + 1) % CENAS) { if (mix === 0) { proxima = para; mix = 0.0001; } },
    tamanho(w, h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); },
    /**
     * Um quadro. `E` é o estadoPista; `dt` em segundos; `nivel` 1..3.
     */
    desenhar(E, dt, nivel) {
      const bps = (E.tocando && E.bpm ? E.bpm : 90) / 60;
      // o tempo da viagem anda no TEMPO DA MÚSICA (mais devagar na quebra)
      t += dt * bps * (E.quebra ? 0.35 : 1) * (E.tocando ? 1 : 0.4);
      const k = Math.min(1, dt * 6);
      for (const n of ['grave', 'medio', 'agudo', 'energia']) s[n] += ((E[n] || 0) - s[n]) * k;
      hue += dt * 0.01 + (E.dropV > 0.9 ? 0.002 : 0);
      if (mix > 0) { mix += dt / 2; if (mix >= 1) { cena = proxima; mix = 0; } }
      gl.uniform2f(U.uRes, cv.width, cv.height);
      gl.uniform1f(U.uT, t);
      gl.uniform1f(U.uGrave, s.grave); gl.uniform1f(U.uMedio, s.medio); gl.uniform1f(U.uAgudo, s.agudo);
      gl.uniform1f(U.uEnergia, s.energia);
      gl.uniform1f(U.uPulso, E.reduzido ? 0 : (E.pulso || 0));
      gl.uniform1f(U.uDrop, E.reduzido ? 0 : (E.dropV || 0));
      gl.uniform1f(U.uQuebra, E.quebra ? 1 : 0);
      gl.uniform1f(U.uHue, hue);
      gl.uniform1f(U.uNivel, (nivel - 1) / 2);
      gl.uniform1f(U.uCenaA, cena); gl.uniform1f(U.uCenaB, proxima); gl.uniform1f(U.uMix, mix);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
