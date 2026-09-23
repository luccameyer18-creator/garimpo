/**
 * Quanto efeito, e quanta resolução — duas coisas separadas.
 *
 * MODO (quem escolhe é a PESSOA, no ✨ da cabine; fica guardado):
 *   3  bombando   tudo: lasers, galera, globo, reflexos, névoa, confete
 *   2  médio      lasers, galera, globo, névoa, confete (sem os reflexos)
 *   1  leve       névoa, globo, confete e o DROP
 *   0  off        nada — a CDJ sozinha
 * A 🎉 pista mostra tudo sempre: ela é o próprio "bombando".
 *
 * RESOLUÇÃO (quem ajusta é o MEDIDOR, sozinho): acompanha o tempo de cada
 * quadro da tela e, se engasgar, desenha os efeitos com menos pixels (a
 * placa amplia; fica um pouco mais suave, nunca some nada). Voltou a ficar
 * liso, sobe de novo. Antes o medidor desligava efeitos por conta própria —
 * aparecia "0/3" e a pessoa achava que tinha quebrado.
 *
 *   - engasgou em duas medições seguidas (mediana > 22 ms ou 1 em 10 quadros
 *     > 34 ms): desce um degrau de resolução
 *   - liso por 5 s (mediana < 18 ms): sobe um
 *   - os primeiros 12 s não contam (o acervo carregando engasga a tela)
 *
 * Quem desenha lê `qualidade.nivel` (o modo) e `qualidade.escala`; o CSS lê
 * a classe q0..q3 no <body>.
 */

const DEGRAUS = [1, 0.75, 0.55];

export const qualidade = {
  nivel: 3,
  escala: 1,
  fps: 0,
  medianaMs: 0,
};
try {
  const salvo = localStorage.getItem('garimpo.efeitos.modo');
  qualidade.nivel = salvo !== null && [0, 1, 2, 3].includes(Number(salvo))
    ? Number(salvo) : (matchMedia('(pointer: coarse)').matches ? 1 : 3);
} catch {}

const ouvintes = new Set();
/** Avisa quando o modo ou a resolução mudam. */
export function aoMudarQualidade(fn) { ouvintes.add(fn); }
const avisar = () => { for (const fn of ouvintes) { try { fn(qualidade); } catch {} } };

/** A pessoa escolheu um modo (0 off, 1 leve, 2 médio, 3 bombando). */
export function definirModo(n) {
  qualidade.nivel = Math.max(0, Math.min(3, n));
  for (const k of [0, 1, 2, 3]) document.body.classList.toggle('q' + k, k === qualidade.nivel);
  try { localStorage.setItem('garimpo.efeitos.modo', String(qualidade.nivel)); } catch {}
  avisar();
}

let degrau = 0, tempos = [], ultimo = 0, proximaAvaliacao = 0, lisoDesde = 0, esperaAte = 12000, engasgos = 0;

function mudarDegrau(d) {
  degrau = Math.max(0, Math.min(DEGRAUS.length - 1, d));
  qualidade.escala = DEGRAUS[degrau];
  avisar();
}

function medir(agora) {
  requestAnimationFrame(medir);
  if (document.hidden) { ultimo = 0; tempos = []; return; }
  if (ultimo) {
    const d = agora - ultimo;
    if (d < 250) tempos.push(d);          // aba voltando do fundo não conta
    if (tempos.length > 120) tempos.shift();
  }
  ultimo = agora;
  if (agora < proximaAvaliacao || tempos.length < 40) return;
  proximaAvaliacao = agora + 1000;

  const ord = [...tempos].sort((a, b) => a - b);
  const mediana = ord[Math.floor(ord.length / 2)];
  const p90 = ord[Math.floor(ord.length * 0.9)];
  qualidade.medianaMs = Math.round(mediana * 10) / 10;
  qualidade.fps = Math.round(1000 / mediana);
  if (agora < esperaAte) return;

  const engasgou = mediana > 22 || p90 > 34;
  const liso = mediana < 18 && p90 < 24;
  engasgos = engasgou ? engasgos + 1 : 0;
  if (engasgos >= 2 && degrau < DEGRAUS.length - 1) {
    mudarDegrau(degrau + 1);
    esperaAte = agora + 3000;
    lisoDesde = 0; tempos = []; engasgos = 0;
  } else if (liso) {
    if (!lisoDesde) lisoDesde = agora;
    if (agora - lisoDesde > 5000 && degrau > 0) {
      mudarDegrau(degrau - 1);
      esperaAte = agora + 5000;
      lisoDesde = 0; tempos = [];
    }
  } else lisoDesde = 0;
}

definirModo(qualidade.nivel);
requestAnimationFrame(medir);
