/**
 * Testes do TimeMap. Lógica pura: roda em Node, sem navegador.
 *   node src/dev/test-timemap.mjs
 */
import { TimeMap } from '../audio/timemap.js';

let pass = 0, fail = 0;
const near = (nome, real, esperado, tol = 1e-9) => {
  if (Math.abs(real - esperado) <= tol) { pass++; console.log(`  ok    ${nome}`); }
  else { fail++; console.log(`  FALHA ${nome}\n          esperado ${esperado}, obtido ${real} (dif ${real - esperado})`); }
};
const truthy = (nome, v, nota = '') => {
  if (v) { pass++; console.log(`  ok    ${nome} ${nota}`); }
  else { fail++; console.log(`  FALHA ${nome} ${nota}`); }
};

console.log('\n── 1 · extrapolação linear ────────────────────────────────────');
{
  const m = new TimeMap({ time: 10, pos: 5, rate: 1 });
  near('no próprio âncora', m.positionAt(10), 5);
  near('1 s depois em rate 1', m.positionAt(11), 6);
  near('antes do âncora extrapola pra trás', m.positionAt(9), 4);
  near('rate 1.08 por 2.5 s', new TimeMap({ time: 0, pos: 0, rate: 1.08 }).positionAt(2.5), 2.7);
  near('parado não anda', new TimeMap({ time: 0, pos: 3, rate: 0 }).positionAt(100), 3);
  near('taxa negativa anda pra trás', new TimeMap({ time: 0, pos: 10, rate: -1 }).positionAt(2), 8);
}

console.log('\n── 2 · segmentos agendados ────────────────────────────────────');
{
  const m = new TimeMap({ time: 0, pos: 0, rate: 1 });
  m.push({ t0: 10, p0: 10, rate: 2 });
  near('antes do segundo segmento', m.positionAt(5), 5);
  near('no limite usa o novo', m.positionAt(10), 10);
  near('depois usa rate 2', m.positionAt(12), 14);
  m.push({ t0: 11, p0: 100, rate: 0 });
  near('push mais recente descarta o agendado em t0 maior', m.positionAt(12), 100);
  truthy('não cresce sem limite', m.length <= 3, `(${m.length} segmentos)`);
}

console.log('\n── 3 · anchor: verdade do worklet ─────────────────────────────');
{
  const m = new TimeMap({ time: 0, pos: 0, rate: 1 });
  m.push({ t0: 20, p0: 50, rate: 2 }); // futuro agendado
  m.anchor({ time: 5, pos: 4.97, rate: 1 }); // worklet diz: na verdade estamos em 4.97
  near('passa a valer a verdade do worklet', m.positionAt(6), 5.97);
  near('o futuro agendado SOBREVIVE ao âncora', m.positionAt(21), 52);
  m.anchor({ time: 25, pos: 60, rate: 2 });
  truthy('âncora depois do futuro limpa o agendado', m.length === 1, `(${m.length})`);
}

console.log('\n── 4 · glideTo: a primitiva ───────────────────────────────────');
{
  // tocando em rate 1; precisamos estar 0.05 s adiantados daqui a 2 s
  const m = new TimeMap({ time: 0, pos: 0, rate: 1 });
  const agora = 0, emTempo = 2;
  const alvo = m.positionAt(emTempo) + 0.05; // 2.05
  const desvio = m.glideTo(alvo, emTempo, 1, { now: agora, lookahead: 0.04 });

  near('chega EXATAMENTE no alvo no instante pedido', m.positionAt(emTempo), alvo, 1e-9);
  near('retoma a taxa nominal depois', m.positionAt(emTempo + 1), alvo + 1, 1e-9);
  truthy('o desvio de taxa é pequeno e audivelmente aceitável',
    desvio > 0 && desvio < 0.06, `(${(desvio * 100).toFixed(2)}%)`);
  near('durante o glide a posição é contínua (sem salto)',
    m.positionAt(0.04), 0.04, 1e-9);

  // continuidade: amostrar denso e conferir que não há degrau
  let maiorSalto = 0;
  let ant = m.positionAt(0);
  for (let t = 0.001; t <= 3; t += 0.001) {
    const p = m.positionAt(t);
    maiorSalto = Math.max(maiorSalto, Math.abs(p - ant - 0.001));
    ant = p;
  }
  truthy('nenhum degrau em 3000 amostras', maiorSalto < 0.0001,
    `(maior desvio por passo: ${(maiorSalto * 1e6).toFixed(2)} µs)`);
}

console.log('\n── 5 · glideTo em correção de fase realista ───────────────────');
{
  // 128 BPM, deck seguidor meio tempo atrasado. Corrigir em 4 tempos.
  const bpm = 128, segPorTempo = 60 / bpm;       // 0.46875 s
  const erro = segPorTempo * 0.5;                 // 0.234 s de entrada a recuperar
  const janela = 4 * segPorTempo;                 // 1.875 s de saída
  const m = new TimeMap({ time: 0, pos: 0, rate: 1 });
  const alvo = m.positionAt(janela) + erro;
  const desvio = m.glideTo(alvo, janela, 1, { now: 0 });
  console.log(`        erro de ${(erro * 1e3).toFixed(0)} ms corrigido em ${janela.toFixed(2)}s → desvio de ${(desvio * 100).toFixed(1)}%`);
  truthy('corrige meio tempo em 4 tempos', Math.abs(m.positionAt(janela) - alvo) < 1e-9);
  truthy('desvio fica abaixo de 15% (audível mas aceitável em 4 tempos)',
    Math.abs(desvio) < 0.15, `(${(desvio * 100).toFixed(1)}%)`);
}

console.log('\n── 6 · sem janela vira salto ──────────────────────────────────');
{
  const m = new TimeMap({ time: 0, pos: 0, rate: 1 });
  const desvio = m.glideTo(99, 0.01, 1, { now: 0, lookahead: 0.04 }); // atTime antes do lookahead
  truthy('sinaliza Infinity quando não dá pra deslizar', desvio === Infinity);
  near('mesmo assim chega no alvo', m.positionAt(0.01), 99);
}

console.log('\n── 7 · timeUntil e prune ──────────────────────────────────────');
{
  const m = new TimeMap({ time: 0, pos: 0, rate: 1 });
  near('faltam 10 s pra posição 10', m.timeUntil(10, 0), 10);
  near('em rate 2 falta metade', new TimeMap({ time: 0, pos: 0, rate: 2 }).timeUntil(10, 0), 5);
  truthy('posição já passada devolve null', m.timeUntil(-5, 0) === null);
  truthy('parado devolve null', new TimeMap({ rate: 0 }).timeUntil(10, 0) === null);

  const p = new TimeMap({ time: 0, pos: 0, rate: 1 });
  for (let i = 1; i <= 50; i++) p.push({ t0: i, p0: i, rate: 1 });
  const antes = p.length;
  p.prune(40);
  truthy('prune corta o passado', p.length < antes, `(${antes} → ${p.length})`);
  near('e não muda a posição atual', p.positionAt(45), 45);
}

console.log('\n── 8 · busca binária concorda com varredura linear ────────────');
{
  const m = new TimeMap({ time: 0, pos: 0, rate: 1 });
  for (let i = 1; i <= 200; i++) m.push({ t0: i * 0.37, p0: i, rate: 1 + (i % 5) * 0.01 });
  const linear = (t) => { let s = m.segs[0]; for (const x of m.segs) if (x.t0 <= t) s = x; return s.p0 + (t - s.t0) * s.rate; };
  let difMax = 0;
  for (let t = -1; t < 80; t += 0.013) difMax = Math.max(difMax, Math.abs(m.positionAt(t) - linear(t)));
  truthy('idêntico à varredura linear em 6200 pontos', difMax === 0, `(dif max ${difMax})`);
}

console.log(`\n${'─'.repeat(62)}`);
console.log(`${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
