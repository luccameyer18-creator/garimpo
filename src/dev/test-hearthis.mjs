/**
 * Testes do módulo hearthis. Rodar com: npm test
 * Parte 1 = funções puras contra uma faixa de exemplo (rápido, offline).
 * Parte 2 = rede ao vivo: categoria, e a cadeia do stream com as regras de
 *           CORS do navegador (cada salto precisa de ACAO; depois de um salto
 *           entre domínios o Origin vira "null").
 */
import {
  normalizar, deckavel, preparar, urlDoStream, caminhoDaFaixa, pilhaDe, ehHearthis,
  atribuicao, categoria, emAlta, PREFIXO,
} from '../sources/hearthis.js';

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

// uma faixa como a API devolve (campos reais, valores de uma faixa medida)
const cru = {
  id: '14689787', private: '0', duration: '226', bpm: '126', key: 'Gbm', genre: 'Deep House',
  genre_slush: 'deephouse', title: 'Night Style Exotic - Free Your Soul', license: 'NoncommercialNoDerivatives',
  permalink: 'free-your-soul', permalink_url: 'https://hearthis.at/night-style/free-your-soul/',
  stream_url: 'https://hearthis.app/night-style/free-your-soul/listen/?s=Rgr',
  user: { permalink: 'night-style', username: 'Night Style Exotic' },
  playback_count: '1520', favoritings_count: '33', reshares_count: '4', fan_exclusive_play: '0', is_live: '0',
};

console.log('\n── 1 · normalização ─────────────────────────────────────────────');
const f = normalizar(cru);
eq('id é o caminho, com prefixo',  f.id, 'ht:night-style/free-your-soul');
eq('fonte',                        f.source, 'hearthis');
eq('handle com prefixo',           f.handle, 'ht:night-style');
eq('artista',                      f.artist, 'Night Style Exotic');
eq('gênero no nome do Audius',     f.genre, 'Deep House');
eq('BPM numérico',                 f.bpm, 126);
eq('Gbm → 11A',                    f.camelot, '11A');
eq('duração em número',            f.duration, 226);
eq('sinais vêm junto',             [f.sinais.plays, f.sinais.curtidas, f.sinais.reposts], [1520, 33, 4]);
eq('Hip Hop vira Hip-Hop/Rap',     normalizar({ ...cru, genre_slush: 'hiphop', bpm: '92' }).genre, 'Hip-Hop/Rap');
eq('meio-tempo dobra pela janela', normalizar({ ...cru, bpm: '63' }).bpm, 126);

console.log('\n── 2 · o que entra no deck ──────────────────────────────────────');
truthy('faixa completa entra',             deckavel(cru));
truthy('set de 1 h não entra',             !deckavel({ ...cru, duration: '3600' }));
truthy('sem BPM não entra',                !deckavel({ ...cru, bpm: '0' }));
truthy('sem tom não entra',                !deckavel({ ...cru, key: '' }));
truthy('privada não entra',                !deckavel({ ...cru, private: '1' }));
truthy('exclusiva de fã não entra',        !deckavel({ ...cru, fan_exclusive_play: '1' }));
eq('preparar filtra e normaliza',          preparar([cru, { ...cru, duration: '5000' }]).length, 1);
eq('"sem resultado" (objeto) vira []',     preparar({ success: false, message: 'No results found' }), []);

console.log('\n── 3 · stream, pilhas, crédito ──────────────────────────────────');
eq('stream em hearthis.AT, sem ?s=',       urlDoStream(f), 'https://hearthis.at/night-style/free-your-soul/listen/');
eq('caminho da faixa',                     caminhoDaFaixa(f), 'night-style/free-your-soul');
truthy('id sem caminho não vira URL',      (() => { try { urlDoStream({ id: 'ht:' }); return false; } catch { return true; } })());
eq('House cai no chip de gênero',          pilhaDe('house'), 'gen:House');
eq('Amapiano cai na crate que existe',     pilhaDe('amapiano'), 'lat:Amapiano');
eq('Dub Techno ganha chip próprio',        pilhaDe('dubtechno'), 'ht:dubtechno');
truthy('reconhece pela fonte',             ehHearthis({ source: 'hearthis' }));
truthy('reconhece pelo id (semente)',      ehHearthis({ id: PREFIXO + 'a/b' }));
truthy('faixa do Audius não é',            !ehHearthis({ id: '020m4lk', source: 'audius' }));
eq('crédito com link e licença',           atribuicao(f), { artist: 'Night Style Exotic',
  trackUrl: 'https://hearthis.at/night-style/free-your-soul/', license: 'NoncommercialNoDerivatives' });

console.log('\n── 4 · rede ao vivo ─────────────────────────────────────────────');
const SITE = 'https://luccameyer18-creator.github.io';
async function passaNoNavegador(url) {
  let u = url, origin = SITE;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(u, { headers: { Origin: origin }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const acao = r.headers.get('access-control-allow-origin');
    try { await r.body?.cancel(); } catch {}
    if (acao !== '*' && acao !== origin) return `sem CORS em ${new URL(u).host} (${r.status})`;
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      const prox = new URL(loc, u);
      if (prox.origin !== new URL(u).origin && origin !== new URL(u).origin) origin = 'null';
      u = prox.href;
      continue;
    }
    return r.ok ? 'ok' : `status ${r.status}`;
  }
  return 'redirecionou demais';
}
try {
  const lista = await categoria('deephouse', { count: 20 });
  truthy('categoria devolve faixas de deck', lista.length >= 10, `(${lista.length}/20)`);
  truthy('todas com BPM e tom',              lista.every((x) => x.bpm && x.camelot));
  truthy('todas entre 1 e 10 min',           lista.every((x) => x.duration >= 60 && x.duration <= 600));
  const amostra = lista.slice(0, 5);
  const res = await Promise.all(amostra.map((x) => passaNoNavegador(urlDoStream(x))));
  truthy('stream passa no CORS do navegador', res.every((r) => r === 'ok'), `(${res.filter((r) => r === 'ok').length}/${res.length}) ${res.find((r) => r !== 'ok') || ''}`);
} catch (e) {
  fail++; console.log(`  FALHA rede ao vivo: ${e.message}`);
}

console.log('\n── 5 · underground: o que está rolando ──────────────────────────');
try {
  const t0 = Date.now();
  const l = await emAlta({ limite: 40 });
  truthy('traz faixas',                      l.length >= 10, `(${l.length} em ${Date.now() - t0} ms)`);
  truthy('todas com carinho (♥ ou ↻)',       l.every((f) => (f.sinais.curtidas || 0) + (f.sinais.reposts || 0) > 0));
  const porArtista = {};
  for (const f of l) porArtista[f.handle] = (porArtista[f.handle] || 0) + 1;
  truthy('no máximo 2 por artista',          Object.values(porArtista).every((n) => n <= 2));
  truthy('nenhum set, trailer ou programa',  !l.some((f) => /trailer|full set|dj ?mix|podcast|radio ?show/i.test(f.title)));
} catch (e) {
  fail++; console.log(`  FALHA underground: ${e.message}`);
}

console.log(`\n${pass} ok, ${fail} falha(s)\n`);
process.exit(fail ? 1 : 0);
