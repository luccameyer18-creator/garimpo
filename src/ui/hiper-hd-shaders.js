/**
 * SHADERS DO HIPERESPAÇO HD (hiper-hd.js) — escritos uma vez só, no dialeto
 * do WebGL1 (texture2D, gl_FragColor, varying); `cabecalho()` traduz pro
 * WebGL2 (GLSL ES 3.00) quando ele existe. Assim o mesmo texto roda nos dois.
 *
 * PASSES (em ordem, a cada quadro):
 *   PESADO   as 5 cenas procedurais (as mesmas do hiperespaco.js), em
 *            resolução BAIXA (1/2 a 1/4 da tela). É o único passe com laço
 *            caro por pixel.
 *   NITIDEZ  CAS no pesado, ainda em resolução baixa (barato).
 *   DETALHE  resolução CHEIA: amplia o pesado (bilinear), esculpe nele o
 *            detalhe fino ASSADO (2 texturas feitas uma vez só, lidas com
 *            1-2 consultas por pixel) e soma o RASTRO (o quadro anterior
 *            ampliado/girado/com a cor girando: o truque central do
 *            MilkDrop). Grava num par de texturas que se alternam.
 *   BRILHO   bloom em 1/4 e 1/8 da tela (reduz + borra em 2 direções).
 *   FINAL    na tela: aberração cromática que cresce com o grave, bloom,
 *            drop (exposição + clarão branco), vinheta, curva e pontilhado.
 *   ASSAR    (só no começo, 1 ladrilho por quadro) as 2 texturas de detalhe:
 *            o gasket de Apolônio e o conjunto de Kali. As duas emendam
 *            perfeitamente nas bordas (dá pra repetir e rodar infinitamente).
 *            Guardam DADOS, não cor — a cor sai da paleta na hora, então a
 *            música gira as cores sem reassar nada.
 *
 * Medido na Intel UHD, túnel 1080p: detalhe ≈ 3 ms, rastro ≈ 0,5 ms,
 * bloom ≈ 0,8 ms, o resto ≈ 2,3 ms.
 */

/** Cabeçalho que adapta o GLSL ES 1.00 abaixo ao WebGL2 ou ao WebGL1. */
export function cabecalho(gl2, frag, temLod) {
  if (gl2) {
    return '#version 300 es\nprecision highp float;\n' +
      (frag
        ? 'out vec4 _saida;\n#define gl_FragColor _saida\n#define varying in\n'
        : '#define attribute in\n#define varying out\n') +
      '#define texture2D texture\n#define texture2DLod textureLod\n';
  }
  if (!frag) return 'precision highp float;\n';
  return (temLod
    ? '#extension GL_EXT_shader_texture_lod : enable\n#define texture2DLod texture2DLodEXT\n'
    : '#define texture2DLod(s, u, l) texture2D(s, u)\n') +
    'precision highp float;\n';
}

/** Um triângulo que cobre a tela; vUv vai de 0 a 1 na parte visível. */
export const VERT = `
attribute vec2 p;
varying vec2 vUv;
void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

// ─────────────────────────── pedaços comuns ───────────────────────────
const COMUM = `
const float PI = 3.14159265;
const float TAU = 6.2831853;
uniform float uHue;
uniform sampler2D uPal;
// paleta iridescente, a mesma do hiperespaco.js (0.5 + 0.5 cos(2π(t + fase)))
// — mas lida de uma tabela de 256 cores (textura que repete): 1 consulta em
// vez de 3 cossenos por chamada, e ela é chamada muitas vezes por pixel
vec3 pal(float t) { return texture2DLod(uPal, vec2(t + uHue, 0.5), 0.0).rgb; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// grade hexagonal: distância até a borda da célula
float hexBorda(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
vec4 hexCel(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5, b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  return vec4(g, p - g);
}
// a mesma coordenada em todo passe (independe da resolução): centro 0, a
// menor dimensão vai de -0.5 a 0.5; respira com o grave e gira com o médio
uniform vec2 uRes;
uniform float uResp, uGiro;
vec2 coord(vec2 uv) {
  vec2 p = (uv - 0.5) * uRes / min(uRes.x, uRes.y);
  p *= uResp;
  p *= rot(uGiro);
  return p;
}
// TROCA DE CENA = PORTAL: a cena nova abre do centro num anel com borda de
// flor e engole a velha. Quanto da cena VELHA aparece aqui (1 = só ela).
// Cada pixel calcula UMA cena (duas só na faixa da borda): a troca custa
// quase o mesmo que um quadro normal, em vez do dobro de uma fusão.
uniform float uMix;
float portal(float r, float ang, float t) {
  float borda = uMix * 1.4 - 0.18;
  float rr = r * (1.0 + 0.07 * sin(ang * 6.0 + t * 2.0));
  return smoothstep(borda - 0.1, borda + 0.1, rr);
}`;

// ─────────────────────── PESADO (resolução baixa) ───────────────────────
// As 5 cenas do hiperespaco.js, sem mudar o desenho. O clarão do drop e a
// vinheta saíram daqui (vão pro FINAL, em resolução cheia).
export const PESADO = COMUM + `
varying vec2 vUv;
uniform float uT, uGrave, uMedio, uAgudo, uEnergia, uQuebra;
uniform float uCenaA, uCenaB;
uniform float uIterF, uIterM;   // voltas do fractal e da mandala (qualidade)

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
    if (float(i) >= uIterM) break;
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
    if (float(i) >= uIterF) break;
    z = abs(z) / dot(z, z) + k;
    m = min(m, length(z));
    acc += exp(-length(z) * 2.2);
  }
  acc *= 11.0 / uIterF;                   // menos voltas, mesmo brilho
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
  vec2 p = coord(vUv);
  float fA = uMix > 0.001 ? portal(length(p), atan(p.y, p.x), uT) : 1.0;
  vec3 c = vec3(0.0);
  if (fA > 0.001) c += cena(uCenaA, p) * fA;
  if (fA < 0.999) c += cena(uCenaB, p) * (1.0 - fA);
  c *= 1.0 - uQuebra * 0.45;              // quebra: escurece, esperando a volta
  c *= 0.75 + uEnergia * 0.5;
  gl_FragColor = vec4(c, 1.0);
}`;

// ───────────────────── NITIDEZ (resolução baixa) ─────────────────────
// CAS (AMD FidelityFX Contrast Adaptive Sharpening), 5 consultas: afia mais
// onde há pouco contraste e menos onde já está no limite, e nunca passa do
// mín/máx da vizinhança (sem halo). Roda ANTES de ampliar: 9x menos pixels
// que fazer isso em Full HD (medido: 1,7 ms → ~0,2 ms por quadro).
export const NITIDEZ = `
varying vec2 vUv;
uniform sampler2D uFonte;
uniform vec2 uTexel;
uniform float uForca;          // 0..1
void main() {
  vec3 a = texture2D(uFonte, vUv + vec2(0.0, -uTexel.y)).rgb;
  vec3 b = texture2D(uFonte, vUv + vec2(-uTexel.x, 0.0)).rgb;
  vec3 c = texture2D(uFonte, vUv).rgb;
  vec3 d = texture2D(uFonte, vUv + vec2(uTexel.x, 0.0)).rgb;
  vec3 e = texture2D(uFonte, vUv + vec2(0.0, uTexel.y)).rgb;
  vec3 mn = min(c, min(min(a, b), min(d, e)));
  vec3 mx = max(c, max(max(a, b), max(d, e)));
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
  vec3 w = amp * (-1.0 / mix(8.0, 5.0, uForca));
  gl_FragColor = vec4(clamp((c + (a + b + d + e) * w) / (1.0 + 4.0 * w), mn, mx), 1.0);
}`;

// ─────────────── ASSAR (uma vez, 2048² — 1024² no celular) ───────────────
// Cada textura guarda DADOS: r = índice de cor, g = traço fino, b = volume
// (preenchimento), a = variação. 2x2 amostras por texel (antisserrilhado).
export const ASSAR = `
const float TAU = 6.2831853;
uniform float uTam;       // lado da textura (2048, ou 1024 no celular)
uniform float uQual;      // 0 = Apolônio, 1 = Kali 4D
uniform vec4 uK;          // parâmetros do desenho
uniform vec4 uO;          // deslocamento (quebra simetrias que desperdiçam textura)
uniform float uIter;

// GASKET DE APOLÔNIO: círculos dentro de círculos (as "pérolas"). O fract()
// do laço repete o plano com período 2; como a textura cobre exatamente um
// período, as bordas emendam sozinhas.
vec4 apolo(vec2 uv) {
  vec2 p = uv * 2.0 + uK.zw;
  float s = uK.x;
  float esc = 1.0, trap = 1e3, it = 0.0;
  for (int i = 0; i < 14; i++) {
    if (float(i) >= uIter) break;
    p = -1.0 + 2.0 * fract(0.5 * p + 0.5);
    float r2 = dot(p, p);
    if (r2 < trap) { trap = r2; it = float(i); }
    float k = s / r2;
    p *= k; esc *= k;
  }
  float d = 0.25 * abs(p.y) / esc;          // distância até o traço
  float px = 2.0 / uTam;                     // um texel, em unidades de p
  float linha = exp(-d / (px * uK.y));
  // o traço fino tem ~1 texel (antisserrilhado em qualquer tamanho); já o
  // volume tem largura FIXA no desenho, pra pérola sair igual na textura menor
  float volume = max(exp(-d / (44.0 / 2048.0)), 0.55 * smoothstep(0.0, 0.5, d) * (1.0 - it / uIter));
  float idx = clamp(0.55 + 0.08 * log(trap), 0.0, 1.0);
  return vec4(idx, linha, volume, it / uIter);
}

// CONJUNTO DE KALI (o mesmo da cena "fractal", com muito mais voltas), num
// domínio ESPELHADO: tri() vai e volta, então a textura emenda nas 4 bordas
// e ganha simetria de caleidoscópio. uK = (escala, kx, ky, voltas extras).
vec2 tri(vec2 x) { return abs(fract(x) - 0.5) * 2.0; }
vec4 kali(vec2 uv) {
  vec2 z = (tri(uv) - 0.5) * uK.x + uO.xy;
  vec2 k = uK.yz;
  float acc = 0.0, m = 1e3, lin = 1e3, itm = 0.0;
  for (int i = 0; i < 24; i++) {
    if (float(i) >= uIter) break;
    z = abs(z) / dot(z, z) + k;
    float l = length(z);
    if (l < m) { m = l; itm = float(i); }
    acc += exp(-l * 2.2);
    lin = min(lin, min(abs(z.x), abs(z.y)));
  }
  // r = em que volta a órbita chegou mais perto (cor por nível de profundidade)
  // g = filigrana; b = orbes que brilham; a = densidade (variação de cor)
  return vec4(itm / uIter, exp(-lin * uO.z), smoothstep(0.55, 0.0, m), clamp(acc * 0.1, 0.0, 1.0));
}

void main() {
  vec4 soma = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    vec2 o = vec2(float(j - (j / 2) * 2), float(j / 2)) - 0.5;   // 2x2
    o = vec2(o.x * 0.9 - o.y * 0.3, o.y * 0.9 + o.x * 0.3) * 0.5;  // grade girada
    vec2 uv = (gl_FragCoord.xy + o) / uTam;
    soma += uQual < 0.5 ? apolo(uv) : kali(uv);
  }
  gl_FragColor = soma * 0.25;
}`;

// ─────────────────── DETALHE + RASTRO (resolução cheia) ───────────────────
export const DETALHE = COMUM + `
varying vec2 vUv;
uniform sampler2D uBaixa;      // o passe pesado
uniform sampler2D uAnt;        // o quadro anterior (rastro)
uniform sampler2D uAssA;       // Apolônio (dados)
uniform sampler2D uAssB;       // Kali 4D (dados)
uniform float uT, uVoo, uGrave, uMedio, uAgudo, uEnergia, uQuebra, uPulso;
uniform float uCenaA, uCenaB;
uniform float uDetalhe;        // 0 enquanto as texturas não ficaram prontas
uniform float uPix;            // tamanho de 1 pixel de saída, em unidades de coord()
uniform float uLado;           // lado da textura assada (2048 ou 1024)
uniform vec4 uFb;              // x = zoom, y = giro, z = retenção, w = ondulação
uniform float uFbMix, uCorGiro, uQuadro;

// consulta com o nível de mipmap calculado na mão (sem costura no atan)
// (vies > 0 puxa um mipmap mais suave: a filigrana do Kali tem traço de 1-2
// texels e, sem isso, vira granulado cintilando)
vec4 amostra(sampler2D s, vec2 uv, float escala, float vies) {
  return texture2DLod(s, uv, log2(max(escala * uPix * uLado, 1e-4)) + vies);
}
// log-polar conforme: um giro em volta = n repetições; afastar = voar.
// pol = (r, ângulo, log r), calculado UMA vez por pixel e reaproveitado
vec4 logPolar(sampler2D s, vec3 pol, float n, float torcao, float voo, float vies) {
  vec2 uv = vec2((pol.y + torcao * pol.z) * n / TAU, pol.z * n / TAU - voo);
  return amostra(s, uv, n / (TAU * pol.x) * sqrt(1.0 + torcao * torcao), vies);
}
// caleidoscópio: n espelhos; mexer em 'desl' é girar o tubo do caleidoscópio
vec4 caleido(sampler2D s, vec2 p, float n, float esc, vec2 desl, float vies) {
  float r = length(p), a = atan(p.y, p.x);
  float seg = TAU / n;
  a = mod(a, seg); a = abs(a - seg * 0.5);
  vec2 q = vec2(cos(a), sin(a)) * r;
  return amostra(s, q * esc + desl, esc, vies);
}
// dados assados → (cor a SOMAR, fator que MODULA o passe pesado). O fator
// esculpe a imagem ampliada com estrutura nítida (escurece os vãos, acende
// as pérolas/orbes); a cor somada são os traços finos, com a paleta de agora
// (as cores giram com a música sem reassar nada).
vec4 tingir(vec4 d, float desloc) {
  vec3 corpo = pal(d.r * 1.7 + d.a * 0.4 + desloc) * d.b;
  vec3 traco = mix(pal(d.r * 0.9 + 0.5 + desloc), vec3(1.0), 0.3) * d.g;
  return vec4(corpo * 0.22 + traco * (0.32 + uAgudo * 0.55), 0.18 + 0.95 * d.b + 0.45 * d.g);
}

vec4 detalhe(float i, vec2 p, vec2 w) {
  float r = length(p);
  vec2 pw = p + w;
  float rw = max(length(pw), 1e-4);
  vec3 pol = vec3(rw, atan(pw.y, pw.x), log(rw));
  if (i < 0.5) {            // CRISÂNTEMO: pérolas de Apolônio em espiral, abrindo
    vec4 d = tingir(logPolar(uAssA, pol, 8.0, 0.55, uVoo * 0.35, 0.0), -uT * 0.02);
    return mix(vec4(0.0, 0.0, 0.0, 1.0), d, smoothstep(0.02, 0.2, r));
  }
  if (i < 1.5) {            // TÚNEL: filigrana do Kali forrando as paredes
    vec4 d = tingir(logPolar(uAssB, pol, 4.0, 0.0, uVoo, 0.7), uT * 0.01);
    vec4 e = tingir(logPolar(uAssA, pol, 8.0, -0.3, uVoo * 1.7, 0.0), 0.4);
    d.rgb += e.rgb * 0.4;
    return mix(vec4(0.0, 0.0, 0.0, 1.0), d, smoothstep(0.0, 0.3, r));
  }
  if (i < 2.5) {            // MANDALA: caleidoscópio do Kali, o tubo girando
    float n = 6.0 + floor(uMedio * 4.0) * 2.0;
    vec2 desl = vec2(0.13, 0.07) * uT * 0.35 + vec2(sin(uT * 0.05), cos(uT * 0.04)) * 0.3;
    vec4 d = tingir(caleido(uAssA, p + w, n, 1.25 + 0.2 * sin(uT * 0.1), desl, 0.0), r * 0.5 - uT * 0.03);
    vec4 e = tingir(caleido(uAssB, p, n, 0.8, desl * 0.7, 0.7), 0.5 - uT * 0.02);
    float buraco = 1.0 - min(d.a, 1.0);             // dentro das pérolas: a filigrana
    d.rgb = d.rgb * 1.6 + e.rgb * (0.25 + 0.6 * buraco);
    d.a = max(d.a, 0.6);
    return mix(vec4(0.0, 0.0, 0.0, 1.0), d, smoothstep(0.0, 0.08, r));
  }
  if (i < 3.5) {            // JOIAS: dentro de cada gema, um mundo de pérolas
    vec2 q = p * rot(uT * 0.04);
    float esc = 3.0 + sin(uT * 0.125) * 0.6;
    vec4 h = hexCel(q * esc);
    vec2 sorte = hash22(h.zw + 7.0);
    float lente = 1.0 - hexBorda(h.xy) * 1.5;                   // lente: curva no centro
    vec2 luv = (h.xy * rot(sorte.x * TAU + uT * 0.15)) * (0.45 + 0.2 * lente) + sorte;
    vec4 d = tingir(amostra(uAssA, luv, esc * 0.55, 0.0), sorte.y + uT * 0.02);
    return mix(vec4(0.0, 0.0, 0.0, 1.0), d, smoothstep(0.5, 0.44, hexBorda(h.xy)));
  }
  // FRACTAL: zoom infinito num mar de pérolas (log-polar com torção) — o
  // Kali do passe pesado aparece através delas; a filigrana gira por cima
  vec4 d = tingir(logPolar(uAssA, pol, 11.0, 0.35, uVoo * 0.45, 0.0), uT * 0.015);
  vec4 e = tingir(caleido(uAssB, p * rot(-uT * 0.05), 6.0, 1.3, vec2(uT * 0.01), 0.7), 0.3);
  float buraco = 1.0 - min(d.a, 1.0);               // cada pérola é uma janela pra filigrana
  d.rgb += e.rgb * (0.2 + 1.1 * buraco) * smoothstep(0.05, 0.3, r);
  d.a = max(d.a, 0.5);
  return d;
}

void main() {
  vec2 p = coord(vUv);
  // o passe pesado já chega afiado (NITIDEZ, em resolução baixa); aqui é
  // só o bilinear da placa, de graça
  vec3 L = texture2D(uBaixa, vUv).rgb;
  float lumL = dot(L, vec3(0.3, 0.59, 0.11));

  // o passe pesado ENTORTA o detalhe fino: o detalhe nítido acompanha a forma
  vec2 w = (L.rg - L.gb) * 0.018;
  float r = length(p), ang = atan(p.y, p.x);
  float fA = uMix > 0.001 ? portal(r, ang, uT) : 1.0;
  vec4 D = vec4(0.0);
  if (fA > 0.001) D += detalhe(uCenaA, p, w) * fA;
  if (fA < 0.999) D += detalhe(uCenaB, p, w) * (1.0 - fA);
  float ener = (1.0 - uQuebra * 0.45) * (0.75 + uEnergia * 0.5);
  vec3 novo = L * mix(1.0, D.a, uDetalhe) + D.rgb * uDetalhe * ener * (0.4 + 0.8 * lumL);
  // a borda do portal brilha enquanto ele abre
  if (uMix > 0.001) novo += pal(ang * 0.16 + uT * 0.1) * (fA * (1.0 - fA) * 4.0) * 0.55 * sin(uMix * PI);

  // RASTRO (feedback): o quadro anterior, ampliado e girado em volta do
  // centro, com uma ondulação leve e a cor girando; some aos poucos
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 q = (vUv - 0.5) * asp;
  q = (q * rot(uFb.y)) / uFb.x;
  q += uFb.w * vec2(sin(q.y * 7.0 + uT * 0.7), cos(q.x * 6.0 - uT * 0.9));
  vec3 ant = texture2D(uAnt, q / asp + 0.5).rgb;
  ant = mix(ant, ant.gbr, uCorGiro) * uFb.z;
  float lumN = dot(novo, vec3(0.3, 0.59, 0.11));
  vec3 cor = novo + ant * uFbMix * (1.0 - smoothstep(0.0, 0.3, lumN));

  // pontilhado + um degrau pra baixo: textura de 8 bits não "gruda" no escuro
  cor += (hash12(gl_FragCoord.xy + uQuadro * 17.0) - 0.75) / 255.0;
  gl_FragColor = vec4(cor, 1.0);
}`;

// ───────────────────────────── BRILHO ─────────────────────────────
// Reduz pra 1/4 (ou de 1/4 pra 1/8), só com o que passa do limiar.
export const REDUZIR = `
varying vec2 vUv;
uniform sampler2D uFonte;
uniform vec2 uTexel;           // 1 / resolução da FONTE
uniform float uLimiar, uGanho;
void main() {
  vec3 c = texture2D(uFonte, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(uFonte, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture2D(uFonte, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture2D(uFonte, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uLimiar, 0.0);
  k = k * k / (l * (1.0 - uLimiar) + 1e-4);      // joelho suave
  gl_FragColor = vec4(c * k * uGanho, 1.0);
}`;

// Borrão gaussiano de 9 texels em 5 consultas (usando o filtro bilinear).
export const BORRAR = `
varying vec2 vUv;
uniform sampler2D uFonte;
uniform vec2 uDir;             // (1/largura, 0) ou (0, 1/altura)
void main() {
  vec3 c = texture2D(uFonte, vUv).rgb * 0.2270270;
  c += texture2D(uFonte, vUv + uDir * 1.3846154).rgb * 0.3162162;
  c += texture2D(uFonte, vUv - uDir * 1.3846154).rgb * 0.3162162;
  c += texture2D(uFonte, vUv + uDir * 3.2307692).rgb * 0.0702703;
  c += texture2D(uFonte, vUv - uDir * 3.2307692).rgb * 0.0702703;
  gl_FragColor = vec4(c, 1.0);
}`;

// ───────────────────────────── FINAL ─────────────────────────────
export const FINAL = `
varying vec2 vUv;
uniform sampler2D uCena, uBrilho1, uBrilho2;
uniform vec2 uRes;
uniform float uResp, uCA, uBrilhoK1, uBrilhoK2, uDrop, uNivel, uQuadro, uClarao;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 ombro(vec3 c) {            // curva suave: nada estoura seco no branco
  vec3 a = max(c - 0.8, 0.0);
  return min(c, 0.8) + 0.2 * (1.0 - exp(-a / 0.2));
}
void main() {
  vec2 d = vUv - 0.5;
  // ABERRAÇÃO CROMÁTICA: vermelho e azul se separam pra fora, com o grave
  vec2 off = d * uCA;
  vec3 c;
  c.r = texture2D(uCena, vUv - off).r;
  c.g = texture2D(uCena, vUv).g;
  c.b = texture2D(uCena, vUv + off).b;
  c += texture2D(uBrilho1, vUv).rgb * uBrilhoK1;
  if (uBrilhoK2 > 0.0) c += texture2D(uBrilho2, vUv).rgb * uBrilhoK2;
  // o CLARÃO do 5-MeO no drop: luz branca que abre do centro e se dissolve
  vec2 p = d * uRes / min(uRes.x, uRes.y) * uResp;
  float r = length(p);
  // (primeiro a EXPOSIÇÃO sobe — as cores acendem, não viram névoa — e um
  // núcleo branco que encolhe conforme o drop se acalma)
  c *= 1.0 + uDrop * uClarao * 0.45;
  c += vec3(1.0, 0.97, 0.92) * uDrop * uClarao * (0.35 + 0.35 * uNivel) * exp(-r * (4.5 - uDrop * 3.0));
  c *= smoothstep(1.25, 0.25, r);                  // vinheta suave
  c = ombro(pow(max(c, 0.0), vec3(0.95)));
  c = mix(c, c * c * (3.0 - 2.0 * min(c, 1.0)), 0.3);      // um pouco de S: preto mais fundo
  c += (hash12(gl_FragCoord.xy + uQuadro * 31.0) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

