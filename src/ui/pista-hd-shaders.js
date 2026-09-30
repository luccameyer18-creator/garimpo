/**
 * SHADERS DA PISTA HD (pista-hd.js) — GLSL ES 3.00 (só WebGL2; sem ele a
 * pista fica no Canvas 2D de sempre).
 *
 * A CENA: a câmera está no meio da pista, na altura dos olhos (y = 0),
 * olhando pra cabine (+z) um pouco pra cima. A treliça com as cabeças
 * móveis fica a ~9,5 m, 3 m acima dos olhos; o chão está em y = -1,7; a
 * parede do fundo (com o painel de LED) em z = 14.
 *
 * PASSES (em ordem, a cada quadro):
 *   LUZ      resolução BAIXA (1/2 a 1/4 da tela). Cada facho é uma conta
 *            FECHADA, sem marchar: o ponto do eixo do facho mais perto do
 *            raio do pixel dá a distância D, e a luz que o raio junta
 *            atravessando um cone gaussiano é ~ exp(-D²/2R²) / (R·sen θ)
 *            (forte perto da cabeça, sumindo longe; clarão quando aponta
 *            pra câmera), vezes o espalhamento pra frente da fumaça
 *            (Henyey-Greenstein, g = 0,4) e a densidade da fumaça, que é
 *            uma textura de ruído assada uma vez e rolando devagar. Mais: a
 *            lente de cada cabeça, a neblina do chão, a folha de laser
 *            ("teto falso") e, no 👁 só o show, a sala, a treliça e o painel
 *            de LED.
 *   REDUZIR/BORRAR  bloom em 1/4 e 1/8 da tela.
 *   GALERA   silhuetas por distância com sinal (cabeça, ombros, braços,
 *            boné, cabelo, celular aceso), uma instância por pessoa, em
 *            meia resolução, com contraluz na borda de cima.
 *   FINAL    tela cheia: amplia a luz, soma bloom, desenha os LASERS (leque
 *            de linhas finas: custo fixo por pixel, qualquer número de
 *            linhas), blinders, a galera por cima, exposição, curva de
 *            cinema (ACES), estrobo, vinheta e pontilhado.
 *   CONFETE  quadradinhos instanciados; a física é função do tempo desde o
 *            drop (a CPU não mexe em nada por quadro).
 *   RUIDO    (uma vez) a textura 256² de fumaça, que emenda nas bordas.
 */

export const CAB = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

/** Um triângulo que cobre a tela; vUv vai de 0 a 1 na parte visível. */
export const VERT = CAB + `
layout(location = 0) in vec2 p;
out vec2 vUv;
void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

// ───────────────────────────── RUIDO (assado uma vez) ─────────────────────────────
// Duas fbm de ruído de valor, periódicas (a rede de sorteio dá a volta), em R e G.
export const RUIDO = CAB + `
in vec2 vUv;
out vec4 o;
uniform float uTam;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 x, float per) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(mod(i, per)), b = hash(mod(i + vec2(1.0, 0.0), per));
  float c = hash(mod(i + vec2(0.0, 1.0), per)), d = hash(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uTam;
  float f = 0.0, amp = 0.5, per = 4.0;
  for (int k = 0; k < 5; k++) { f += amp * vnoise(uv * per, per); per *= 2.0; amp *= 0.5; }
  float g = 0.0; amp = 0.5; per = 6.0;
  for (int k = 0; k < 4; k++) { g += amp * vnoise(uv * per + vec2(17.0, 5.0), per); per *= 2.0; amp *= 0.5; }
  o = vec4(f / 0.97, g / 0.94, 0.0, 1.0);
}`;

// ───────────────────────────────── LUZ ─────────────────────────────────
export const MAXF = 12;
export const LUZ = CAB + `
#define MAXF ${MAXF}
in vec2 vUv;
out vec4 o;
uniform vec4 uF0[MAXF];      // cabeça: posição xyz, intensidade
uniform vec4 uF1[MAXF];      // eixo do facho xyz, abertura (tangente do meio ângulo)
uniform vec4 uF2[MAXF];      // cor rgb, onde o facho bate (m ao longo do eixo)
uniform vec4 uF3[MAXF];      // direção da câmera até a cabeça xyz, brilho da lente
uniform int uN;
uniform float uAsp, uTanF, uSp, uCp;   // proporção da tela, tan(fov/2), sen/cos da inclinação
uniform sampler2D uRuido;
uniform vec2 uDeriva;
uniform float uHaze, uGanho, uEsc, uSo, uNevoa;
uniform vec3 uCorMedia, uAmb;
uniform vec4 uFolha;         // folha de laser: altura, intensidade, relógio, -
uniform vec3 uFolhaCor;
uniform float uLed, uLedModo, uBat;
uniform float uEsp[32];
uniform vec3 uLedA, uLedB;

float hazeEm(vec2 uv) {
  vec2 q = uv * vec2(uAsp, 1.0);
  float a = texture(uRuido, q * 0.8 + uDeriva).r;
  vec2 q2 = mat2(0.866, -0.5, 0.5, 0.866) * q * 1.4 - uDeriva * 1.6;
  float b = texture(uRuido, q2 + vec2(a * 0.35)).g;        // um domínio torto: fumaça, não nuvem
  return 0.78 + 0.6 * ((a * 0.55 + b * 0.45) - 0.5);
}

// a luz que o raio v junta perto do ponto t do eixo: seção gaussiana (σ = R/2,
// núcleo fino), o facho abrindo (R cresce) e a fumaça comendo a luz no caminho
float tubo(vec3 v, vec3 P, vec3 a, float k, float t) {
  vec3 Q = P + a * t;
  vec3 df = v * max(dot(v, Q), 0.0) - Q;
  float R = 0.05 + k * t;
  return exp(-2.0 * dot(df, df) / (R * R)) / R * exp(-0.035 * t);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 v = normalize(vec3(ndc.x * uAsp * uTanF, ndc.y * uTanF, 1.0));
  v = vec3(v.x, v.y * uCp + v.z * uSp, -v.y * uSp + v.z * uCp);
  float dens = uHaze * hazeEm(vUv);

  vec3 fumaca = vec3(0.0), lente = vec3(0.0);
  for (int i = 0; i < MAXF; i++) {
    if (i >= uN) break;
    vec4 f0 = uF0[i], f1 = uF1[i], f2 = uF2[i], f3 = uF3[i];
    vec3 P = f0.xyz, a = f1.xyz;
    // o ponto do eixo mais perto do raio do pixel (retas reversas, forma fechada)
    float b = dot(v, a);
    float d = -dot(v, P), e = -dot(a, P);
    // (o ponto sai da conta EXATA; só o brilho usa o seno travado — travar
    // os dois fazia um anel escuro em volta de quem olha pra dentro do facho)
    float s2r = max(1.0 - b * b, 1e-4);
    float tc = clamp((e - b * d) / s2r, 0.0, f2.w);
    float s2 = max(s2r, 0.03);
    // o brilho no ponto mais perto e na PONTA (onde o facho bate: a mancha de
    // impacto). Quase paralelo ao eixo o ponto mais perto pula de uma ponta
    // pra outra; ficar com o maior dos dois não deixa anel escuro
    float hg = pow(1.16 / (1.16 + 0.8 * b), 1.5);        // espalha pra frente (b = -cos)
    float tb = tubo(v, P, a, f1.w, tc);
    if (tc <= 0.0) tb = max(tb, tubo(v, P, a, f1.w, f2.w));   // só quando travou na cabeça
    float I = f0.w * hg / sqrt(s2) * tb;
    fumaca += f2.rgb * min(I, 5.0);
    // a lente: um ponto sempre, um clarão quando aponta pra câmera
    float c1 = 1.0 - dot(v, f3.xyz);
    lente += f2.rgb * f3.w * (exp(-c1 * 60000.0) + 0.1 * exp(-c1 * 2500.0)) + vec3(f3.w * 0.5 * exp(-c1 * 150000.0));
  }

  // a luz da sala acende a fumaça toda um pouco; no chão ela é mais grossa
  float chao = smoothstep(0.55, 0.0, vUv.y);
  fumaca += uCorMedia * (0.05 + uNevoa * chao * chao * 0.7);

  // FOLHA de laser: um plano fino acima das cabeças, visto de baixo
  if (uFolha.y > 0.0 && v.y > 0.015) {
    float t = uFolha.x / v.y;
    vec3 X = v * t;
    float z = X.z;
    if (z < 13.5 && z > 0.5) {
      // o "céu líquido": a folha é um feixe varrendo rápido; a fumaça faz ondas nela
      float n = texture(uRuido, X.xz * vec2(0.06, 0.16) + vec2(uFolha.z * 0.05, uFolha.z * 0.03)).r;
      float liq = 0.15 + 0.85 * n * n;
      float leque = smoothstep(1.35, 1.05, abs(X.x) / max(13.5 - z, 0.2));
      float borda = smoothstep(13.5, 12.6, z) * smoothstep(0.5, 4.0, z);
      fumaca += uFolhaCor * uFolha.y * min(0.012 / v.y, 0.8) * liq * leque * borda;
    }
  }
  vec3 c = fumaca * dens;

  if (uSo > 0.5) {
    // a sala escura e a treliça (tampa a fumaça atrás dela)
    c += uAmb * (0.6 + 0.4 * vUv.y);
    float tt = 9.5 / max(v.z, 0.05);
    float tr = smoothstep(0.03, 0.0, abs(v.y * tt - 3.32) - 0.1);
    c *= 1.0 - tr * 0.85;
    // PAINEL DE LED no fundo: células com vão escuro, pico baixo (não lava a sala)
    if (uLed > 0.0) {
      float t = 14.0 / max(v.z, 0.05);
      vec3 X = v * t;
      vec2 w = vec2((X.x + 4.8) / 9.6, (X.y + 0.7) / 2.8);
      if (w.x > 0.0 && w.x < 1.0 && w.y > 0.0 && w.y < 1.0) {
        vec2 cel = w * vec2(32.0, 14.0);
        vec2 f = fract(cel);
        float vao = smoothstep(0.0, 0.14, f.x) * smoothstep(1.0, 0.86, f.x) * smoothstep(0.0, 0.14, f.y) * smoothstep(1.0, 0.86, f.y);
        float linha = floor(cel.y) / 14.0;
        float aceso;
        if (uLedModo < 0.5) aceso = step(linha, uEsp[int(cel.x)] - 0.02);                    // barras do espectro
        else if (uLedModo < 1.5) aceso = step(0.55, fract(cel.x / 8.0 - uBat * 0.5));          // corrida
        else aceso = 1.0;                                                                       // cheio
        vec3 cor = mix(uLedA, uLedB, w.x);
        c += cor * aceso * vao * uLed * (1.0 - 0.3 * dens);
      }
    }
  }
  c += lente;
  o = vec4(c * uGanho * uEsc, 1.0);
}`;

// ───────────────────────────── BLOOM ─────────────────────────────
// Reduz (só o que passa do limiar, com joelho) e borra em 2 direções.
export const REDUZIR = CAB + `
in vec2 vUv;
out vec4 o;
uniform sampler2D uFonte;
uniform vec2 uTexel;
uniform float uLimiar;
void main() {
  vec3 c = texture(uFonte, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uFonte, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture(uFonte, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture(uFonte, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uLimiar, 0.0);
  k = k * k / (l * l + 1e-4) * (l > 0.0 ? 1.0 : 0.0);
  o = vec4(c * min(k, 1.0), 1.0);
}`;

export const BORRAR = CAB + `
in vec2 vUv;
out vec4 o;
uniform sampler2D uFonte;
uniform vec2 uDir;
void main() {
  vec3 c = texture(uFonte, vUv).rgb * 0.2270270;
  c += texture(uFonte, vUv + uDir * 1.3846154).rgb * 0.3162162;
  c += texture(uFonte, vUv - uDir * 1.3846154).rgb * 0.3162162;
  c += texture(uFonte, vUv + uDir * 3.2307692).rgb * 0.0702703;
  c += texture(uFonte, vUv - uDir * 3.2307692).rgb * 0.0702703;
  o = vec4(c, 1.0);
}`;

// ───────────────────────────── GALERA ─────────────────────────────
// Bandeiras (iA.w): 1 boné, 2 cabelo, 4 celular, 8 braços pra cima, 16 MASSA
// (a faixa escura de corpos da fileira, da borda de baixo até o peito).
export const VERT_GALERA = CAB + `
layout(location = 0) in vec2 p;        // canto do quadrado, 0..1
layout(location = 1) in vec4 iA;       // x, y da cabeça (px, de baixo), raio da cabeça (px), bandeiras
layout(location = 2) in vec4 iB;       // cabeça (balanço, em raios), aceno, névoa, meia largura do ombro
layout(location = 3) in vec4 iC;       // contraluz rgb, onde o quadrado começa embaixo (em raios)
uniform vec2 uRes;
out vec2 vL;
flat out vec4 vA; flat out vec4 vB; flat out vec4 vC;
void main() {
  int fl = int(iA.w + 0.5);
  vec2 px;
  if ((fl & 16) != 0) {
    px = vec2(p.x * uRes.x, p.y * iA.y);
    vL = vec2(0.0);
  } else {
    float y1 = (fl & 8) != 0 ? 2.75 : ((fl & 2) != 0 ? 1.5 : 1.25);
    vec2 loc = vec2(mix(-2.9, 2.9, p.x), mix(iC.w, y1, p.y));
    px = iA.xy + loc * iA.z;
    vL = loc;
  }
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  vA = iA; vB = iB; vC = iC;
}`;

export const GALERA = CAB + `
in vec2 vL;
flat in vec4 vA; flat in vec4 vB; flat in vec4 vC;
out vec4 o;
uniform vec3 uFogCor;
uniform float uRimK;
float sdCap(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float sdRBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r; }
float sdEli(vec2 p, vec2 r) { return (length(p / r) - 1.0) * min(r.x, r.y); }
// união macia: pescoço, ombros e braços se emendam como gente, não como peças
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
void main() {
  int fl = int(vA.w + 0.5);
  vec3 corpo = mix(vec3(0.016, 0.010, 0.028), uFogCor, vB.z);
  if ((fl & 16) != 0) { o = vec4(corpo, 1.0); return; }
  vec2 p = vL;
  float cab = vB.x, W = vB.w;
  float d = length((p - vec2(0.0, cab)) * vec2(1.0, 0.9)) - 0.82;                    // cabeça (um pouco oval)
  d = smin(d, sdRBox(p - vec2(0.0, -0.95 + cab * 0.4), vec2(0.28, 0.42), 0.12), 0.22); // pescoço
  d = smin(d, sdRBox(p - vec2(0.0, -8.1), vec2(W, 6.75), 1.1), 0.4);                  // ombros e corpo
  if ((fl & 1) != 0) d = min(d, sdEli(p - vec2(0.42, 0.42 + cab), vec2(0.95, 0.3)));
  else if ((fl & 2) != 0) d = smin(d, sdEli(p - vec2(0.0, 0.18 + cab), vec2(1.08, 0.98)), 0.1);
  vec2 mao = vec2(0.8, 0.35);                  // celular perto do rosto
  if ((fl & 8) != 0) {
    float ac = vB.y;
    vec2 om = vec2(0.78 * W, -1.75), co = vec2(1.05 * W, 0.1);
    vec2 me = vec2(-(1.45 + ac), 2.1), md = vec2(1.45 - ac, 2.1);
    float br = min(sdCap(p, vec2(-om.x, om.y), vec2(-co.x, co.y), 0.3), sdCap(p, om, co, 0.3));
    br = smin(br, min(sdCap(p, vec2(-co.x, co.y), me, 0.22), sdCap(p, co, md, 0.22)), 0.12);
    br = min(br, min(length(p - me), length(p - md)) - 0.27);                       // mãos
    d = smin(d, br, 0.25);
    mao = md;
  }
  float aa = 1.0 / vA.z;                       // um pixel, em raios de cabeça
  float m = smoothstep(aa, -aa, d);
  // CONTRALUZ: um fio de cor por dentro das bordas de CIMA (a luz vem de trás e do alto)
  vec2 gr = vec2(dFdx(d), dFdy(d));
  float cima = clamp(gr.y / (length(gr) + 1e-6), 0.0, 1.0);
  float rim = (1.0 - smoothstep(0.0, 0.13, -d)) * m * cima * cima;
  vec3 col = corpo * m + vC.rgb * rim * uRimK;
  float a = m;
  if ((fl & 4) != 0) {
    float ds = sdRBox(p - mao - vec2(0.0, 0.2), vec2(0.16, 0.28), 0.05);
    float tela = smoothstep(aa, -aa, ds);
    col = mix(col, vec3(0.62, 0.7, 0.95), tela);
    a = max(a, tela);
    col += vec3(0.4, 0.5, 0.9) * 0.1 * exp(-length(p - mao) * 1.6);
  }
  o = vec4(col, a);
}`;

// ───────────────────────────── FINAL ─────────────────────────────
export const FINAL = CAB + `
in vec2 vUv;
out vec4 o;
uniform sampler2D uLuz, uB1, uB2, uGal, uRuido;
uniform vec2 uRes;
uniform float uAsp, uInv, uK1, uK2, uExpo, uFlash, uCA, uQuadro, uSo, uGalK;
uniform vec4 uBlinder;                 // cor × quanto
uniform vec2 uBlA, uBlB;               // onde ficam os dois blinders (uv)
uniform vec4 uLz;                      // origem do leque (uv), linhas, intensidade
uniform vec2 uLzAng;                   // ângulo da 1ª linha, passo
uniform vec3 uLzCor;
uniform float uLzSem;
uniform vec2 uDeriva;
vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float h11(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec3 c;
  if (uCA > 0.0) {
    vec2 off = (vUv - 0.5) * uCA;
    c = vec3(texture(uLuz, vUv - off).r, texture(uLuz, vUv).g, texture(uLuz, vUv + off).b);
  } else c = texture(uLuz, vUv).rgb;
  vec3 bl = texture(uB1, vUv).rgb * uK1;
  if (uK2 > 0.0) bl += texture(uB2, vUv).rgb * uK2;
  c = (c + bl) * uInv;
  bl *= uInv;

  // LASERS: leque de linhas finas saindo de um ponto. O ângulo do pixel
  // diz qual linha está mais perto — custo fixo, com 8 ou 30 linhas.
  // (só gasta onde pode haver laser: abaixo da origem — o leque só desce —,
  // dentro do ângulo dele e perto de uma linha; o resto da tela pula)
  if (uLz.w > 0.0) {
    vec2 d = (vUv - uLz.xy) * uRes;
    if (d.y < 0.0) {
      float k = (atan(d.x, -d.y) - uLzAng.x) / uLzAng.y;      // em "linhas"
      if (k > -0.5 && k < uLz.z - 0.5) {
        float idx = floor(k + 0.5);
        float r = length(d);
        float dist = r * abs(sin((k - idx) * uLzAng.y));
        float w = uRes.y / 1080.0;
        if (dist < 30.0 * w) {
          float nucleo = exp(-dist * dist / (1.2 * w * w));
          float halo = exp(-dist / (7.0 * w)) * 0.2;
          float longe = smoothstep(6.0 * w, 70.0 * w, r) * exp(-r / (uRes.y * 0.85));
          float pont = 0.7 + 0.3 * h11(floor(r / (4.0 * w)) + idx * 13.0 + uLzSem);   // o pontilhado do laser na fumaça
          float fum = texture(uRuido, vUv * vec2(uAsp, 1.0) * 0.55 + uDeriva).r;
          c += uLzCor * (nucleo * 1.5 + halo) * longe * pont * uLz.w * (0.45 + fum);
        }
      }
    }
  }
  // BLINDERS: as lâmpadas quentes da plateia no drop
  if (uBlinder.a > 0.0) {
    vec2 q = vUv * vec2(uAsp, 1.0);
    float g = exp(-length(q - uBlA * vec2(uAsp, 1.0)) * 5.0) + exp(-length(q - uBlB * vec2(uAsp, 1.0)) * 5.0);
    c += uBlinder.rgb * uBlinder.a * (0.12 + 1.3 * g);
  }
  // a GALERA na frente (pré-multiplicada), com o brilho da fumaça entre ela e a câmera
  vec4 gal = texture(uGal, vUv) * uGalK;
  c = c * (1.0 - gal.a) + gal.rgb + bl * gal.a * 0.2;
  c = aces(c * uExpo);
  c = mix(c, vec3(1.0), uFlash);
  vec2 dv = (vUv - 0.5) * vec2(uAsp, 1.0);
  c *= mix(1.0, smoothstep(1.25, 0.35, length(dv)), uSo);
  c += (ign(gl_FragCoord.xy + uQuadro * 5.588238) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

// ───────────────────────────── CONFETE ─────────────────────────────
export const VERT_CONFETE = CAB + `
layout(location = 0) in vec2 p;        // canto, -0.5..0.5
layout(location = 1) in vec4 iS;       // x0, y0, vx, vy (sorteios 0..1 / -1..1)
layout(location = 2) in vec4 iT;       // giro inicial, velocidade de giro, vida, cor
uniform vec2 uRes;
uniform float uT, uU;
flat out vec3 vCor;
out float vA;
const vec3 CORES[6] = vec3[6](vec3(1.0, 0.31, 0.80), vec3(0.30, 0.79, 0.94), vec3(1.0, 0.70, 0.28),
                              vec3(0.18, 0.90, 0.66), vec3(0.78, 0.49, 1.0), vec3(1.0, 0.95, 0.70));
void main() {
  float t = uT;
  float vida = iT.z - t;
  float r0 = iT.x, vr = iT.y;
  float r = r0 + vr * t;
  float x = iS.x * uRes.x + iS.z * 20.0 * uU * t - 14.0 * uU / (2.0 * vr) * (cos(2.0 * r) - cos(2.0 * r0));
  float y = uRes.y * (1.0 + iS.y * 0.3) - (50.0 + iS.w * 80.0) * uU * t;
  float hh = 8.0 * uU * abs(cos(r * 1.7)) + 0.5;
  vec2 q = mat2(cos(r), sin(r), -sin(r), cos(r)) * (p * vec2(5.0 * uU, hh));
  bool viva = vida > 0.0 && t >= 0.0 && y > -20.0;
  gl_Position = viva ? vec4((vec2(x, y) + q) / uRes * 2.0 - 1.0, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  vA = clamp(vida, 0.0, 1.0) * 0.9;
  vCor = CORES[int(iT.w) % 6];
}`;

export const CONFETE = CAB + `
flat in vec3 vCor;
in float vA;
out vec4 o;
void main() { o = vec4(vCor * vA, vA); }`;
