/**
 * A LEITURA DAS SUAS TRANSIÇÕES — o DJ assistindo quem toca.
 *
 * Quem entra e mixa sozinho (modo solo, ou o piloto desligado) é lido em
 * silêncio: a cada transição o módulo percebe quando as duas faixas passam a
 * soar juntas e quando uma sai, e mede o que um DJ de verdade ouviria:
 *
 *   batida    o erro de fase médio enquanto as duas tocam (em tempos)
 *   graves    quantos segundos os DOIS graves ficaram abertos juntos (lama)
 *   frase     se a entrada e o golpe (o meio da troca) caíram no 1 da frase
 *   tom       se os tons combinam, ou se a técnica disfarçou a briga
 *   música    se o golpe caiu num DROP da que entra — é o "sentir a música"
 *
 * e adivinha a técnica pelo que a pessoa mexeu (grave, filtro, eco, loop, um
 * corte seco). O resultado vai pra quem chamou: a UI só MOSTRA se a pessoa
 * pediu a leitura; o aprendizado (meuestilo.js) guarda as boas de qualquer
 * jeito, no aparelho.
 *
 * Nada aqui escuta o áudio: tudo sai do mesmo estado que o professor lê, a
 * ~4 Hz. É barato e é a mesma verdade que ele usa pra dar as dicas.
 */
import { keyCompatible } from '../sources/audius.js';
import { TEMPOS_FRASE } from './momentos.js';

const SO_UM_POR = 1.5;      // s com uma faixa só pra dar a transição por encerrada
const GRAVE_ABERTO = 0.3;   // ganho de grave acima disso conta como "aberto"

/** O quadro que o app manda: o que cada deck faz e o que o mixer mostra. */
function audivel(q, id) {
  const d = q[id];
  if (!d?.tocando || (d.fader ?? 1) < 0.15) return false;
  return id === 'A' ? q.crossfader < 0.9 : q.crossfader > 0.1;
}

/** Distância (em tempos) da posição até o 1 de frase mais perto do deck. */
function foraDaFrase(d) {
  const g = d?.grid;
  if (!g?.bpm || d.pos == null) return null;
  const b = (d.pos - g.ancora) / (60 / g.bpm);
  const r = ((b % TEMPOS_FRASE) + TEMPOS_FRASE) % TEMPOS_FRASE;
  return Math.min(r, TEMPOS_FRASE - r);
}

export function criarLeitura({ aoTerminar }) {
  let sozinho = null;       // o deck que estava no ar sozinho antes da transição
  let atual = null;         // a transição em curso
  let soUmDesde = 0;

  function comecar(q) {
    const sai = sozinho, entra = sai === 'A' ? 'B' : 'A';
    atual = {
      sai, entra, ini: q.agora, fim: q.agora, ultimo: q.agora,
      faixaSai: q[sai].faixa, faixaEntra: q[entra].faixa,
      bpm: q[sai].bpm || q[entra].bpm || 120,
      fraseIni: foraDaFrase(q[sai]),
      somaFase: 0, nFase: 0, gravesJuntos: 0,
      usou: { grave: false, filtro: false, eco: false, loop: false },
      xfIni: q.crossfader, cruzou: null, trocou: null,
    };
  }

  function acompanhar(q) {
    const a = atual, dt = Math.min(0.5, q.agora - a.ultimo);
    a.ultimo = q.agora;
    if (typeof q.fase === 'number') { a.somaFase += Math.abs(q.fase); a.nFase++; }
    const gS = q[a.sai].grave ?? 0.5, gE = q[a.entra].grave ?? 0.5;
    if (gS > GRAVE_ABERTO && gE > GRAVE_ABERTO) a.gravesJuntos += dt;
    if (gS < 0.15 || gE < 0.15) a.usou.grave = true;
    if (Math.abs(q[a.sai].filtro || 0) > 0.15 || Math.abs(q[a.entra].filtro || 0) > 0.15) a.usou.filtro = true;
    if ((q[a.sai].eco || 0) > 0.1) a.usou.eco = true;
    if (q[a.sai].loop) a.usou.loop = true;
    // o GOLPE: quando os graves TROCAM de dono — é o que o ouvido sente como
    // "entrou". Sem troca de graves, vale o crossfader passando do meio. Medir
    // pelo crossfader primeiro acusava "2 tempos fora" em transição certa:
    // o DJ leva o crossfader ao meio ANTES e troca o grave no 1 (medido na
    // simulação, festival e baile)
    const marca = () => ({ frase: foraDaFrase(q[a.sai]), drop: dropPerto(q, a.entra) });
    if (!a.cruzou && (a.xfIni - 0.5) * (q.crossfader - 0.5) < 0) a.cruzou = marca();
    if (!a.trocou && gE > 0.4 && gS < 0.2) a.trocou = marca();
  }

  /** O golpe caiu num DROP da que entra (±2 tempos)? */
  function dropPerto(q, id) {
    const d = q[id], lista = q.momentos?.[id];
    if (!lista?.length || d?.pos == null || !d.grid?.bpm) return false;
    const tol = 2 * 60 / d.grid.bpm;
    return lista.some((m) => m.tipo === 'drop' && Math.abs(m.t - d.pos) <= tol);
  }

  function fechar(q, ficou) {
    const a = atual;
    atual = null;
    if (ficou !== a.entra) return;                     // voltou atrás: não foi transição
    const dur = a.fim - a.ini;
    const per = 60 / a.bpm;
    const tempos = Math.round(dur / per);
    const tecnica = dur < 2 ? 'corte' : a.usou.eco ? 'eco' : a.usou.loop ? 'loop'
      : a.usou.filtro ? 'filtro' : a.usou.grave ? 'graves' : 'blend';

    // ── a nota: batida 40, graves 25, frase 20, tom 15 ──
    const itens = [];
    const fase = a.nFase ? a.somaFase / a.nFase : null;
    let nFase;
    if (fase == null || tecnica === 'corte') nFase = 32;
    // cheia até 0,03 tempo (~15 ms), zera em 0,15 (~70 ms): 40 ms já se ouve
    // como batida "dobrando" — com a régua antiga isso custava só 4 pontos
    else nFase = Math.round(40 * Math.max(0, Math.min(1, 1 - (fase - 0.03) / 0.12)));
    if (fase != null && tecnica !== 'corte') itens.push(fase <= 0.04 ? { ok: true, k: 'batida.ok' }
      : { ok: false, k: 'batida.mal', v: { ms: Math.round(fase * per * 1000) } });

    const nGraves = Math.round(25 * Math.max(0, Math.min(1, 1 - (a.gravesJuntos - 1) / 7)));
    if (tecnica !== 'corte') itens.push(a.gravesJuntos <= 1.5 ? { ok: true, k: 'graves.ok' }
      : { ok: false, k: 'graves.mal', v: { s: Math.round(a.gravesJuntos) } });

    // 2 tempos de folga: a mão humana e o crossfader gradual não caem no 1 exato
    const golpe = a.trocou || a.cruzou;
    const fr = golpe?.frase ?? a.fraseIni;
    const nFrase = fr == null ? 12 : fr <= 2 ? 20 : fr % 8 <= 2 || 8 - (fr % 8) <= 2 ? 12 : 4;
    if (fr != null) itens.push(fr <= 2 ? { ok: true, k: 'frase.ok' }
      : { ok: false, k: 'frase.mal', v: { t: Math.round(fr) } });

    const tom = keyCompatible({ camelot: a.faixaSai?.camelot }, { camelot: a.faixaEntra?.camelot });
    const disfarcou = ['eco', 'corte', 'filtro'].includes(tecnica);
    const nTom = tom.ok ? 15 : disfarcou ? 10 : 4;
    if (a.faixaSai?.camelot && a.faixaEntra?.camelot) itens.push(tom.ok ? { ok: true, k: 'tom.ok' }
      : disfarcou ? { ok: true, k: 'tom.disfarce', v: { tec: tecnica } } : { ok: false, k: 'tom.mal' });

    if (golpe?.drop) itens.push({ ok: true, k: 'drop' });

    const nota = Math.min(100, nFase + nGraves + nFrase + nTom + (golpe?.drop ? 5 : 0));
    aoTerminar({
      nota, itens, tecnica, tempos, dur,
      sai: a.faixaSai, entra: a.faixaEntra, fraseOk: fr != null && fr <= 2,
    });
  }

  return {
    /** Um quadro. `q`: { agora (s), crossfader, fase, momentos, A: {...}, B: {...} } */
    passo(q) {
      const aA = audivel(q, 'A'), aB = audivel(q, 'B');
      if (aA && aB) {
        soUmDesde = 0;
        if (!atual && sozinho && q[sozinho]?.faixa && q[sozinho === 'A' ? 'B' : 'A']?.faixa) comecar(q);
        if (atual) { atual.fim = q.agora; acompanhar(q); }
        return;
      }
      const ficou = aA ? 'A' : aB ? 'B' : null;
      if (atual) {
        if (!soUmDesde) soUmDesde = q.agora;
        if (q.agora - soUmDesde >= SO_UM_POR) fechar(q, ficou);
        return;
      }
      if (ficou) sozinho = ficou;
    },
    /** O piloto assumiu, ou a pessoa trocou de modo: esquece a transição pela metade. */
    zerar() { atual = null; soUmDesde = 0; },
  };
}
