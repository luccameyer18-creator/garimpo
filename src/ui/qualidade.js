/**
 * O LIMIAR entre efeito e travada, achado em cada aparelho.
 *
 * Travar estraga tudo — um efeito bonito que engasga a CDJ é pior que
 * nenhum. Em vez de chutar quanto efeito cabe, isto MEDE: acompanha o tempo
 * de cada quadro da tela e ajusta o nível dos efeitos sozinho.
 *
 *   - engasgou em DUAS medições seguidas (mediana acima de ~22 ms, ou 1 em
 *     10 quadros acima de 34 ms): desce um nível
 *   - liso por 5 s seguidos (mediana abaixo de ~18 ms): tenta subir um
 *   - os primeiros 12 s não contam: é quando o acervo de 39 mil faixas carrega
 *     e a tela engasga por motivo que não é efeito — medindo ali, ele
 *     derrubava tudo até zero logo na abertura
 *   - sozinho ele não passa do nível 1; o 0 só com o aparelho em apuros de
 *     verdade (mediana acima de 45 ms)
 *   - a folga entre os dois limites e as esperas depois de cada troca impedem
 *     o vai-e-volta
 *
 *   3  tudo
 *   2  sem reflexos do globo; lasers e galera em resolução menor; viagem mais leve
 *   1  só a névoa, o confete e o DROP; viagem bem leve
 *   0  sem efeitos — a CDJ sozinha
 *
 * Quem desenha lê `qualidade.nivel`; o CSS lê a classe q0..q3 no <body>.
 * No celular começa no 2.
 */

export const qualidade = {
  nivel: matchMedia('(pointer: coarse)').matches ? 2 : 3,
  fps: 0,
  medianaMs: 0,
};

const ouvintes = new Set();
/** Avisa quando o nível muda. */
export function aoMudarQualidade(fn) { ouvintes.add(fn); }

function aplicar(n) {
  n = Math.max(0, Math.min(3, n));
  if (n === qualidade.nivel && document.body.classList.contains('q' + n)) return;
  qualidade.nivel = n;
  for (const k of [0, 1, 2, 3]) document.body.classList.toggle('q' + k, k === n);
  for (const fn of ouvintes) { try { fn(n); } catch {} }
}

let tempos = [], ultimo = 0, proximaAvaliacao = 0, lisoDesde = 0, esperaAte = 12000, engasgos = 0;

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
  const piso = mediana > 45 ? 0 : 1;
  engasgos = engasgou ? engasgos + 1 : 0;
  if (engasgos >= 2 && qualidade.nivel > piso) {
    aplicar(qualidade.nivel - 1);
    esperaAte = agora + 3000;              // dá tempo do nível novo mostrar efeito
    lisoDesde = 0; tempos = []; engasgos = 0;
  } else if (liso) {
    if (!lisoDesde) lisoDesde = agora;
    if (agora - lisoDesde > 5000 && qualidade.nivel < 3) {
      aplicar(qualidade.nivel + 1);
      esperaAte = agora + 5000;
      lisoDesde = 0; tempos = [];
    }
  } else lisoDesde = 0;
}

aplicar(qualidade.nivel);
requestAnimationFrame(medir);
