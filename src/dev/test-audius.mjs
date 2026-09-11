/**
 * Testes do módulo Audius. Rodar com: npm test
 * Parte 1 = funções puras contra valores conhecidos (rápido, offline).
 * Parte 2 = rede ao vivo (resolveStreamUrl + probeStream).
 */
import {
  snapBpm, parseKey, keyCompatible, isDeckable, normalizeTrack,
  trending, resolveStreamUrl, probeStream, attribution, bpmWindow, GENRE_BPM,
} from '../sources/audius.js';

let pass = 0, fail = 0;
const eq = (nome, real, esperado) => {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a === b) { pass++; console.log(`  ok    ${nome}`); }
  else { fail++; console.log(`  FALHA ${nome}\n          esperado ${b}\n          obtido   ${a}`); }
};
const truthy = (nome, v, nota = '') => {
  if (v) { pass++; console.log(`  ok    ${nome} ${nota}`); }
  else { fail++; console.log(`  FALHA ${nome} ${nota}`); }
};

console.log('\n── 1 · Camelot (valores canônicos da roda) ─────────────────────');
// referência: 1A=Ab min, 5A=C min, 6A=G min, 8A=A min, 11A=F#/Gb min, 8B=C maj, 9B=G maj
eq('C minor        → 5A',  parseKey('C minor')?.camelot, '5A');
eq('G minor        → 6A',  parseKey('G minor')?.camelot, '6A');
eq('A minor        → 8A',  parseKey('A minor')?.camelot, '8A');
eq('A flat minor   → 1A',  parseKey('A flat minor')?.camelot, '1A');
eq('G flat minor   → 11A', parseKey('G flat minor')?.camelot, '11A');
eq('C major        → 8B',  parseKey('C major')?.camelot, '8B');
eq('G major        → 9B',  parseKey('G major')?.camelot, '9B');
eq('F major        → 7B',  parseKey('F major')?.camelot, '7B');
eq('E minor        → 9A',  parseKey('E minor')?.camelot, '9A');
eq('D sharp minor  → 2A',  parseKey('D sharp minor')?.camelot, '2A');
eq('rótulo normalizado',   parseKey('A flat minor')?.label, 'G# min');
eq('texto inválido',       parseKey('xyz'), null);
eq('nulo',                 parseKey(null), null);

console.log('\n── 2 · compatibilidade harmônica ──────────────────────────────');
truthy('8A com 8A (mesmo tom)',        keyCompatible('A minor', 'A minor').ok);
truthy('8A com 9A (vizinho)',          keyCompatible('A minor', 'E minor').ok);
truthy('8A com 8B (relativa)',         keyCompatible('A minor', 'C major').ok);
truthy('8A com 2A incompatível',       !keyCompatible('A minor', 'D sharp minor').ok);
eq('distância 8A→2A na roda',          keyCompatible('A minor','D sharp minor').distance, 6);
truthy('tom desconhecido não bloqueia', keyCompatible(null, 'A minor').ok);

console.log('\n── 3 · snapBpm (dobra de oitava é o que importa) ───────────────');
eq('119.97 → 120',  snapBpm(119.97), 120);
eq('128    → 128',  snapBpm(128), 128);
eq('128.5  → 128.5', snapBpm(128.5), 128.5);
const s649 = snapBpm(64.9);
truthy('64.9 dobra pra faixa de trabalho', s649 >= 120 && s649 <= 135, `→ ${s649}`);
// 35 -> 70 e CORRETO: o laco para na primeira oitava dentro da janela, e 70 BPM
// existe (hip-hop, downtempo). A ambiguidade de oitava e inerente; a janela por
// genero e que desambigua, nao o snap sozinho.
eq('35 sobe pra dentro da janela padrao', snapBpm(35), 70);
eq('35 com janela de DnB → 140', snapBpm(35, bpmWindow('Drum & Bass')), 140);
eq('87 com janela de DnB → 174', snapBpm(87, bpmWindow('Drum & Bass')), 174);
eq('64.9 com janela de Techno', snapBpm(64.9, bpmWindow('Techno')), 129.8);
eq('70 com janela de House → 140', snapBpm(70, bpmWindow('House')), 140);
eq('gênero desconhecido usa padrão', bpmWindow('Polka'), { min: 70, max: 180 });

// INVARIANTE que o bug dos dois laços violava: se alguma oitava do valor cabe
// na janela, o resultado TEM que estar na janela. Varredura exaustiva.
{
  let violacoes = 0, testados = 0;
  for (const g of [...Object.keys(GENRE_BPM), 'Polka']) {
    const w = bpmWindow(g);
    for (let raw = 21; raw <= 360; raw += 0.37) {
      const out = snapBpm(raw, w);
      testados++;
      // existe alguma oitava de raw dentro da janela?
      let cabe = false;
      for (let b = raw; b >= 20; b /= 2) if (b >= w.min && b <= w.max) cabe = true;
      for (let b = raw * 2; b <= 400; b *= 2) if (b >= w.min && b <= w.max) cabe = true;
      if (cabe && (out < w.min - 0.6 || out > w.max + 0.6)) {
        if (violacoes < 3) console.log(`          ex: raw=${raw.toFixed(2)} ${g} [${w.min},${w.max}] → ${out}`);
        violacoes++;
      }
    }
  }
  truthy(`invariante da janela em ${testados} combinações`, violacoes === 0, violacoes ? `${violacoes} violações` : '');
}
const s350 = snapBpm(350);
truthy('350 divide', s350 >= 70 && s350 <= 180, `→ ${s350}`);
eq('zero → null', snapBpm(0), null);
eq('null → null', snapBpm(null), null);

console.log('\n── 4 · filtros de playback ────────────────────────────────────');
const base = { is_streamable: true, is_stream_gated: false, duration: 200 };
truthy('faixa normal passa',              isDeckable(base));
truthy('gated reprova',                   !isDeckable({ ...base, is_stream_gated: true }));
truthy('não-streamable reprova',          !isDeckable({ ...base, is_streamable: false }));
truthy('restrita por api key reprova',    !isDeckable({ ...base, allowed_api_keys: ['x'] }));
truthy('set de 60 min reprova (deck)',    !isDeckable({ ...base, duration: 3600 }));
truthy('curta demais reprova',            !isDeckable({ ...base, duration: 20 }));

console.log('\n── 5 · rede ao vivo ───────────────────────────────────────────');
try {
  const t0 = Date.now();
  const tracks = await trending({ genre: 'Techno', limit: 30 });
  console.log(`  ${tracks.length} faixas de Techno em ${Date.now() - t0} ms`);
  const deckables = tracks.filter((t) => !t.isLongMix);
  console.log(`  ${deckables.length} carregáveis em deck, ${tracks.length - deckables.length} são sets longos`);
  const comBpm = tracks.filter((t) => t.bpm != null).length;
  const comTom = tracks.filter((t) => t.camelot != null).length;
  const comIsrc = tracks.filter((t) => t.isrc).length;
  console.log(`  bpm ${comBpm}/${tracks.length} | camelot ${comTom}/${tracks.length} | isrc ${comIsrc}/${tracks.length}`);
  truthy('todas as faixas têm BPM', comBpm === tracks.length);
  truthy('todas as faixas têm Camelot', comTom === tracks.length);

  // mostra as 5 primeiras com o BPM cru ao lado, pra ver a dobra de oitava agindo
  console.log('\n  amostra (bpm cru → snap):');
  for (const t of deckables.slice(0, 5)) {
    const dobrou = t.bpmRaw != null && Math.abs(t.bpmRaw - t.bpm) > 1 ? '  ← DOBROU OITAVA' : '';
    console.log(`    ${String(t.bpmRaw).padEnd(7)} → ${String(t.bpm).padEnd(6)} ${String(t.camelot).padEnd(4)} ${t.duration}s  ${t.title.slice(0, 34)}${dobrou}`);
  }

  console.log('\n  resolvendo e sondando 6 streams:');
  let okStreams = 0;
  for (const t of deckables.slice(0, 6)) {
    const t1 = Date.now();
    try {
      const url = await resolveStreamUrl(t.id);
      const p = await probeStream(url);
      const mb = p.bytes ? (p.bytes / 1048576).toFixed(1) + ' MB' : '?';
      if (p.ok && p.ranges) okStreams++;
      console.log(`    ${p.ok && p.ranges ? 'ok   ' : 'FALHA'} ${new URL(url).host.slice(0, 34).padEnd(35)} ${p.status} ${mb.padEnd(8)} ${Date.now() - t1}ms`);
    } catch (e) {
      console.log(`    FALHA ${t.id}: ${e.message}`);
    }
  }
  truthy(`streams com Range funcionando`, okStreams === 6, `${okStreams}/6`);

  const a = attribution(deckables[0]);
  console.log(`\n  atribuição OML §1.5: ${a.artist} | ${a.copyright} | ${a.trackUrl}`);
  truthy('atribuição tem artista e link', !!a.artist && !!a.trackUrl);
} catch (e) {
  fail++;
  console.log(`  FALHA rede: ${e.message}`);
}

console.log(`\n${'─'.repeat(62)}`);
console.log(`${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
