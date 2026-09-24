/**
 * APARIÇÕES — as figuras que quem fumou DMT diz que VÊ, surgindo no hiperespaço.
 *
 * Os relatos se repetem de um jeito impressionante. No levantamento de
 * Davis et al. (2020, J. Psychopharmacology; 2.561 pessoas descrevendo o
 * "encontro com entidades" no DMT inalado) e nos estudos de fenomenologia
 * (Lawrence et al. 2022, Sci. Reports), voltam sempre:
 *   - SERES ("as entidades"): o ser de LUZ simétrico, de cabeça alongada e
 *     olhos grandes, feito de geometria e joia, com muitos braços; os ELFOS
 *     MÁQUINA do Terence McKenna ("bolas de basquete cravejadas de joias,
 *     quicando sozinhas e se transformando"); o LOUVA-A-DEUS / insetoide,
 *     um dos seres mais relatados;
 *   - o BOBO DA CORTE: chapéu de três pontas com sininhos, máscara que ri;
 *   - o OLHO que tudo vê, com a íris feita de anéis que giram;
 *   - a SERPENTE de escamas iridescentes atravessando o campo de visão;
 *   - a CÚPULA / o TEMPLO: arcos e colunas em perspectiva, "a sala";
 *   - ESCRITA desconhecida: glifos que piscam num anel.
 * Aqui elas são desenhadas EM LUZ (traço aceso, sem corpo), por cima do
 * shader — uma por vez, surgindo numa virada de frase, vivendo ~24 tempos e
 * se dissolvendo. Nada de imagem de terceiros: é tudo traço gerado na hora.
 *
 * Tudo pela música: respiram com o grave, mexem os braços/sininhos/escamas
 * no bumbo, piscam no tempo; no drop vem uma entidade ou o olho.
 */

export const TIPOS = ['entidade', 'elfos', 'mantis', 'olho', 'bobo', 'serpente', 'templo', 'glifos'];
/** Os SERES vêm mais: são o centro dos relatos ("as entidades"). */
export const PESOS = { entidade: 3, elfos: 2.5, mantis: 2.5, bobo: 1.5, olho: 1.5, serpente: 1, templo: 1, glifos: 1 };
export function sortearTipo(anterior = null) {
  const l = TIPOS.filter((t) => t !== anterior);
  const soma = l.reduce((x, t) => x + PESOS[t], 0);
  let r = Math.random() * soma;
  return l.find((t) => (r -= PESOS[t]) <= 0) || l[0];
}

const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;
const h01 = (n) => { const x = Math.sin(n * 91.7 + 13.1) * 43758.5453; return x - Math.floor(x); };

/**
 * Desenha uma aparição.
 * @param {CanvasRenderingContext2D} c
 * @param {string} tipo
 * @param {number} x, y  centro;  r  tamanho (raio)
 * @param {object} E     estadoPista (batida, pulso, grave, agudo, energia…)
 * @param {number} hue   matiz base
 * @param {number} semente  pra variar os glifos e os detalhes
 */
export function desenharAparicao(c, tipo, x, y, r, E, hue, semente = 1) {
  const b = E.batida || 0;
  const pp = E.reduzido ? 0 : (E.pulso || 0);
  const resp = 1 + (E.grave || 0) * 0.06 + pp * 0.04;          // respira com o grave e o bumbo
  c.save();
  c.translate(x, y);
  c.scale(resp, resp);
  c.lineCap = 'round'; c.lineJoin = 'round';
  const linha = (w) => { c.lineWidth = Math.max(1, r * w); };
  const cor = (dh, l = 65, a = 1) => { c.strokeStyle = c.fillStyle = hsl(hue + dh, 95, l, a); };

  if (tipo === 'olho') {
    // amêndoa, íris de anéis girando, pupila em fenda; pisca a cada 8 tempos
    const fase = ((b % 8) + 8) % 8;
    const pisca = fase > 7.6 ? Math.abs(fase - 7.8) / 0.2 : 1;
    c.save(); c.scale(1, Math.max(0.05, pisca));
    cor(0, 70); linha(0.035);
    c.beginPath(); c.moveTo(-r, 0); c.quadraticCurveTo(0, -r * 0.85, r, 0); c.quadraticCurveTo(0, r * 0.85, -r, 0); c.stroke();
    for (let k = 1; k <= 6; k++) {
      cor(k * 25, 60 + k * 3, 0.9); linha(0.012);
      c.setLineDash([r * 0.04 * k, r * 0.03]);
      c.lineDashOffset = (k % 2 ? 1 : -1) * b * r * 0.05;
      c.beginPath(); c.arc(0, 0, r * 0.07 * k, 0, 6.283); c.stroke();
    }
    c.setLineDash([]);
    cor(200, 8); c.beginPath(); c.ellipse(0, 0, r * 0.06, r * 0.3, 0, 0, 6.283); c.fill();
    cor(40, 80); linha(0.015); c.stroke();
    c.restore();
    // raios em volta (os "cílios" de luz)
    cor(60, 70, 0.7); linha(0.012);
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * 6.283 + b * 0.02;
      const l1 = r * 1.1, l2 = r * (1.25 + ((k % 3) === 0 ? 0.25 : 0) + pp * 0.15);
      c.beginPath(); c.moveTo(Math.cos(a) * l1, Math.sin(a) * l1 * 0.75); c.lineTo(Math.cos(a) * l2, Math.sin(a) * l2 * 0.75); c.stroke();
    }
  } else if (tipo === 'entidade') {
    // o ser de luz: simétrico, cabeça alongada, olhos grandes, corpo de joia,
    // quatro braços que dançam no tempo, um halo de pontos
    const acena = E.reduzido ? 0 : Math.sin(b * Math.PI / 2) * 0.35;
    for (const lado of [-1, 1]) {
      c.save(); c.scale(lado, 1);
      // braços
      for (let k = 0; k < 2; k++) {
        cor(120 + k * 40, 62, 0.85); linha(0.03);
        const ombroY = r * (0.15 + k * 0.28);
        const ang = -0.6 + k * 0.9 + acena * (k ? -1 : 1) + pp * 0.2;
        const cx = r * 0.55 + Math.cos(ang) * r * 0.45, cy = ombroY + Math.sin(ang) * r * 0.45;
        c.beginPath(); c.moveTo(r * 0.18, ombroY);
        c.quadraticCurveTo(r * 0.5, ombroY - r * 0.1, cx, cy); c.stroke();
        for (let d = -1; d <= 1; d++) {                  // três dedos longos
          c.beginPath(); c.moveTo(cx, cy);
          c.lineTo(cx + Math.cos(ang + d * 0.4) * r * 0.18, cy + Math.sin(ang + d * 0.4) * r * 0.18); c.stroke();
        }
      }
      // corpo de joia (metade)
      cor(280, 60, 0.9); linha(0.022);
      c.beginPath(); c.moveTo(0, -r * 0.05); c.lineTo(r * 0.2, r * 0.15); c.lineTo(r * 0.12, r * 0.75); c.lineTo(0, r * 0.95); c.stroke();
      c.beginPath(); c.moveTo(0, r * 0.3); c.lineTo(r * 0.2, r * 0.15); c.moveTo(0, r * 0.6); c.lineTo(r * 0.12, r * 0.75); c.stroke();
      c.restore();
    }
    // cabeça alongada e os olhos grandes (pretos com brilho)
    cor(180, 70); linha(0.028);
    c.beginPath(); c.ellipse(0, -r * 0.42, r * 0.22, r * 0.36, 0, 0, 6.283); c.stroke();
    for (const lado of [-1, 1]) {
      c.save(); c.translate(lado * r * 0.09, -r * 0.42); c.rotate(lado * 0.45);
      // olho: contorno aceso (a camada só SOMA luz — preto não aparece)
      cor(200, 72); linha(0.016); c.beginPath(); c.ellipse(0, 0, r * 0.075, r * 0.13, 0, 0, 6.283); c.stroke();
      cor(180, 88, 0.95); c.beginPath(); c.arc(-r * 0.02, -r * 0.04, r * 0.02 + (E.agudo || 0) * r * 0.012, 0, 6.283); c.fill();
      c.restore();
    }
    // o terceiro olho / a joia na testa
    cor(50, 75); c.beginPath(); c.arc(0, -r * 0.7, r * 0.035 + pp * r * 0.02, 0, 6.283); c.fill();
    // halo de pontos
    for (let k = 0; k < 28; k++) {
      const a = k / 28 * 6.283 + b * 0.05;
      cor(k * 13, 70, 0.4 + 0.5 * ((k + Math.floor(b)) % 4 === 0 ? 1 : 0));
      c.beginPath(); c.arc(Math.cos(a) * r * 1.05, -r * 0.2 + Math.sin(a) * r * 1.05, r * 0.012, 0, 6.283); c.fill();
    }
  } else if (tipo === 'elfos') {
    // os elfos máquina: três joias facetadas com carinha, quicando no tempo
    // e se transformando (as facetas giram e mudam de número)
    for (let k = 0; k < 3; k++) {
      const bt = b + k * 0.33;
      const f = ((bt % 1) + 1) % 1;
      const pulo = E.reduzido ? 0 : Math.abs(Math.sin(f * Math.PI)) * r * 0.35 * (0.6 + (E.grave || 0));
      const ex = (k - 1) * r * 0.75, ey = r * 0.3 - pulo;
      const rr = r * (0.26 + 0.04 * Math.sin(bt * 0.5));
      const lados = 5 + ((Math.floor(bt / 4) + k) % 4);            // se transformam a cada compasso
      const gira = bt * 0.6;
      cor(k * 110 + b * 5, 62); linha(0.022);
      c.beginPath();
      for (let i = 0; i <= lados; i++) { const a = gira + i / lados * 6.283; const px = ex + Math.cos(a) * rr, py = ey + Math.sin(a) * rr; i ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.stroke();
      cor(k * 110 + 60, 70, 0.6); linha(0.01);                     // as facetas por dentro
      for (let i = 0; i < lados; i++) { const a = gira + i / lados * 6.283; c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex + Math.cos(a) * rr, ey + Math.sin(a) * rr); c.stroke(); }
      cor(0, 92); c.beginPath(); c.arc(ex - rr * 0.3, ey - rr * 0.1, rr * 0.11, 0, 6.283); c.arc(ex + rr * 0.3, ey - rr * 0.1, rr * 0.11, 0, 6.283); c.fill();
      cor(50, 85); linha(0.014); c.beginPath(); c.arc(ex, ey + rr * 0.15, rr * 0.28, 0.2, Math.PI - 0.2); c.stroke();   // o sorriso
      cor(170, 80, 0.8);                                           // brilhinhos em volta
      for (let i = 0; i < 4; i++) { const a = bt * 2 + i * 1.57; c.beginPath(); c.arc(ex + Math.cos(a) * rr * 1.35, ey + Math.sin(a) * rr * 1.35, r * 0.012, 0, 6.283); c.fill(); }
    }
  } else if (tipo === 'mantis') {
    // o louva-a-deus / insetoide: cabeça triangular, olhos enormes, pescoço
    // fino, braços de garra dobrados que se mexem no bumbo, corpo em gomos
    const bate = E.reduzido ? 0 : pp * 0.25;
    cor(95, 60); linha(0.026);
    c.beginPath(); c.moveTo(0, -r * 0.95); c.lineTo(-r * 0.32, -r * 0.62); c.lineTo(0, -r * 0.38); c.lineTo(r * 0.32, -r * 0.62); c.closePath(); c.stroke();
    for (const lado of [-1, 1]) {
      cor(40, 70); linha(0.016); c.beginPath(); c.ellipse(lado * r * 0.2, -r * 0.68, r * 0.1, r * 0.14, lado * 0.5, 0, 6.283); c.stroke();
      cor(120, 80, 0.9); c.beginPath(); c.arc(lado * r * 0.22, -r * 0.72, r * 0.02 + (E.agudo || 0) * r * 0.012, 0, 6.283); c.fill();
      cor(80, 65, 0.9); linha(0.012);                                // antenas
      c.beginPath(); c.moveTo(lado * r * 0.06, -r * 0.92);
      c.quadraticCurveTo(lado * r * 0.3, -r * 1.3, lado * r * (0.55 + bate), -r * 1.2); c.stroke();
    }
    cor(95, 60); linha(0.022);
    c.beginPath(); c.moveTo(0, -r * 0.38); c.lineTo(0, -r * 0.05); c.stroke();          // pescoço
    for (let k = 0; k < 4; k++) {                                                        // gomos do corpo
      cor(95 + k * 25, 58); c.beginPath(); c.ellipse(0, r * (0.05 + k * 0.22), r * (0.16 - k * 0.015), r * 0.11, 0, 0, 6.283); c.stroke();
    }
    for (const lado of [-1, 1]) {                                                        // braços de garra
      c.save(); c.scale(lado, 1);
      cor(140, 62); linha(0.024);
      const ang = -0.3 - bate;
      const cx = r * 0.45, cy = -r * 0.05 + Math.sin(ang) * r * 0.25;
      c.beginPath(); c.moveTo(r * 0.12, r * 0.02); c.lineTo(cx, cy); c.lineTo(r * 0.2, -r * 0.35 - bate * r * 0.3); c.stroke();
      for (let d = 0; d < 4; d++) { const t = d / 4; const px = cx + (r * 0.2 - cx) * t, py = cy + (-r * 0.35 - cy) * t; c.beginPath(); c.moveTo(px, py); c.lineTo(px - r * 0.05, py + r * 0.03); c.stroke(); }
      c.restore();
    }
  } else if (tipo === 'bobo') {
    // o bobo da corte: rosto-máscara que ri, chapéu de três pontas com
    // sininhos que pulam no bumbo, gola em zigue-zague
    cor(330, 68); linha(0.03);
    c.beginPath(); c.arc(0, 0, r * 0.38, 0, 6.283); c.stroke();
    c.beginPath(); c.moveTo(-r * 0.22, r * 0.08); c.quadraticCurveTo(0, r * 0.32, r * 0.22, r * 0.08); c.stroke();  // o riso
    for (const lado of [-1, 1]) {                                   // olhos em losango
      c.beginPath(); c.moveTo(lado * r * 0.2, -r * 0.12); c.lineTo(lado * r * 0.13, -r * 0.05);
      c.lineTo(lado * r * 0.06, -r * 0.12); c.lineTo(lado * r * 0.13, -r * 0.19); c.closePath(); c.stroke();
    }
    const pontas = [[-0.95, -0.95], [0, -1.25], [0.95, -0.95]];
    pontas.forEach(([px, py], k) => {
      cor(k * 90 + 20, 62); linha(0.03);
      const balanco = E.reduzido ? 0 : Math.sin(b * Math.PI + k) * 0.08;
      const tx = r * (px + balanco), ty = r * (py - pp * 0.08);
      c.beginPath(); c.moveTo(-r * 0.36 + k * r * 0.36, -r * 0.3);
      c.quadraticCurveTo(r * px * 0.5, r * py * 0.9, tx, ty); c.stroke();
      cor(50, 75); c.beginPath(); c.arc(tx, ty + r * 0.05, r * 0.06, 0, 6.283); c.fill();   // sininho
    });
    cor(200, 65); linha(0.025);
    c.beginPath();
    for (let k = 0; k <= 12; k++) { const xx = -r * 0.55 + k * r * 0.092; const yy = r * (0.46 + (k % 2) * 0.14); k ? c.lineTo(xx, yy) : c.moveTo(xx, yy); }
    c.stroke();
  } else if (tipo === 'serpente') {
    // a serpente de escamas iridescentes, ondulando e atravessando
    const n = 46;
    const avan = (b * 0.08) % 1;
    for (let k = n; k >= 0; k--) {
      const s = k / n;
      const xx = (s - 0.5) * r * 3.2;
      const yy = Math.sin(s * 9 - b * 0.8 + avan) * r * 0.35 * (0.4 + s * 0.6);
      const raio = r * (0.03 + 0.09 * Math.sin(s * Math.PI));
      cor(s * 200 + b * 4, 55 + (k % 2) * 15, 0.85);
      linha(0.012);
      c.beginPath(); c.arc(xx, yy, raio, 0, 6.283); c.stroke();
      if (k === n) {                                              // a cabeça, com olhos
        cor(60, 80); c.beginPath(); c.arc(xx + raio * 0.3, yy - raio * 0.3, raio * 0.2, 0, 6.283); c.fill();
      }
    }
  } else if (tipo === 'templo') {
    // a cúpula / o templo: arcos encaixados sumindo no centro, colunas,
    // e o chão em grade — "a sala" que tanta gente descreve
    for (let k = 7; k >= 1; k--) {
      const s = k / 7;
      const z = ((s - (b * 0.03) % (1 / 7) * 7 / 7) % 1 + 1) % 1 || 1;
      const w = r * 1.4 * z, h = r * 1.6 * z;
      cor(k * 30 + 180, 50 + z * 25, 0.25 + z * 0.6); linha(0.018 * z + 0.004);
      c.beginPath();
      c.moveTo(-w, h * 0.55); c.lineTo(-w, -h * 0.1);
      c.arc(0, -h * 0.1, w, Math.PI, 0);
      c.lineTo(w, h * 0.55); c.stroke();
    }
    cor(40, 70, 0.5); linha(0.01);
    for (let k = -4; k <= 4; k++) { c.beginPath(); c.moveTo(k * r * 0.05, r * 0.2); c.lineTo(k * r * 0.4, r * 0.9); c.stroke(); }
    for (let k = 1; k <= 4; k++) { const yy = r * (0.2 + k * k * 0.045); c.beginPath(); c.moveTo(-r * 1.6, yy); c.lineTo(r * 1.6, yy); c.stroke(); }
  } else {
    // glifos: escrita desconhecida num anel que gira, piscando no tempo
    const n = 16;
    for (let k = 0; k < n; k++) {
      const a = k / n * 6.283 + b * 0.03;
      const liga = ((k + Math.floor(b * 2)) % 5) !== 0;
      if (!liga) continue;
      c.save();
      c.translate(Math.cos(a) * r, Math.sin(a) * r);
      c.rotate(a + Math.PI / 2);
      cor(k * 22 + b * 3, 70, 0.9); linha(0.018);
      // cada glifo: 3 a 5 traços entre pontos de uma grade 3x3
      const pts = [];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) pts.push([(i - 1) * r * 0.07, (j - 1) * r * 0.09]);
      const tr = 3 + Math.floor(h01(semente * 7 + k) * 3);
      c.beginPath();
      for (let t = 0; t < tr; t++) {
        const p1 = pts[Math.floor(h01(semente + k * 13 + t * 3) * 9)], p2 = pts[Math.floor(h01(semente + k * 17 + t * 5 + 1) * 9)];
        c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]);
      }
      c.stroke();
      if (h01(semente + k) > 0.6) { c.beginPath(); c.arc(0, -r * 0.13, r * 0.018, 0, 6.283); c.stroke(); }
      c.restore();
    }
    cor(0, 75, 0.5); linha(0.01);
    c.beginPath(); c.arc(0, 0, r * 0.8, 0, 6.283); c.stroke();
    c.beginPath(); c.arc(0, 0, r * 1.2, 0, 6.283); c.stroke();
  }
  c.restore();
}
