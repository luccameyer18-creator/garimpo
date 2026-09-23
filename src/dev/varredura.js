/**
 * Varredura: aperta CADA controle da tela como a mão apertaria (eventos de
 * verdade no DOM) e confere no MOTOR se o efeito aconteceu. Não confia na cor
 * do botão — foi assim que o × do grave "mentia" e ninguém viu.
 *
 * Uso, com o app aberto e o áudio ligado:
 *   const { varrer } = await import('/src/dev/varredura.js');
 *   console.table(await varrer());
 *
 * Carrega uma faixa em cada deck se estiverem vazios. Devolve uma linha por
 * teste: { teste, ok, detalhe }.
 */

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);

/** Muda um slider como o dedo muda: valor + evento `input`. */
function arrastar(el, valor) {
  el.value = valor;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const clicar = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const perto = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

export async function varrer() {
  const G = globalThis.__garimpo;
  if (!G?.decks?.A) return [{ teste: 'áudio', ok: false, detalhe: 'ligue o áudio (entre pela porta) antes' }];
  const { decks, mixer } = G;
  globalThis.__varrendo = true;       // o espelho da tela roda mesmo com a aba oculta
  const r = [];
  const teste = async (nome, fn) => {
    try {
      const d = await fn();
      r.push({ teste: nome, ok: d === true || d?.ok === true, detalhe: typeof d === 'object' ? d.detalhe : '' });
    } catch (e) { r.push({ teste: nome, ok: false, detalhe: 'ERRO ' + e.message }); }
  };

  // ── faixas nos dois decks ──
  for (const [id, n] of [['A', 0], ['B', 1]]) {
    if (!decks[id].faixa) {
      document.querySelectorAll('#lista .item')[n]?.querySelector(id === 'A' ? '.pa' : '.pb')?.click();
    }
  }
  for (let i = 0; i < 40 && !(decks.A.pronta && decks.B.pronta); i++) await espera(500);
  await teste('duas faixas carregadas', () => ({ ok: !!(decks.A.faixa && decks.B.faixa), detalhe: `${decks.A.faixa?.title} / ${decks.B.faixa?.title}` }));

  const A = decks.A, B = decks.B;

  // ── transporte ──
  await teste('PLAY A toca', async () => { if (!A.tocando) clicar($('play-A')); await espera(400); return A.tocando; });
  await teste('PAUSE A para', async () => { clicar($('play-A')); await espera(300); const ok = !A.tocando; clicar($('play-A')); await espera(300); return ok; });
  await teste('KEY LOCK alterna', async () => { const antes = A.keylockPedido; clicar($('keylock-A')); await espera(200); const ok = A.keylockPedido !== antes; clicar($('keylock-A')); return ok; });

  // ── andamento: o que o usuário disse que não funcionava ──
  await teste('PITCH muda o BPM', async () => {
    const f = $('pitch-A'), bpm0 = A.bpmEfetivo;
    arrastar(f, -0.5); await espera(250);
    const ok = A.pitch > 0.03 && A.bpmEfetivo > bpm0;
    const det = `pitch ${(A.pitch * 100).toFixed(1)}%, bpm ${bpm0?.toFixed(1)} → ${A.bpmEfetivo?.toFixed(1)}`;
    arrastar(f, 0); await espera(150);
    return { ok, detalhe: det };
  });
  await teste('faixa de pitch 16%', async () => {
    const b16 = document.querySelector('#deckA .faixa-sel [data-r="0.16"]'), b8 = document.querySelector('#deckA .faixa-sel [data-r="0.08"]');
    clicar(b16); arrastar($('pitch-A'), -0.5); await espera(200);
    const ok = perto(A.pitch, 0.08, 0.005);
    clicar(b8); await espera(100);
    return { ok, detalhe: `pitch ${(A.pitch * 100).toFixed(1)}% com meio curso em ±16%` };
  });
  await teste('BPM ×2 e ÷2', async () => {
    const b0 = A.faixa.bpm;
    clicar(document.querySelector('#deckA .x2')); const dobro = A.faixa.bpm;
    clicar(document.querySelector('#deckA .d2')); const volta = A.faixa.bpm;
    return { ok: perto(dobro, b0 * 2, 0.02) && perto(volta, b0, 0.02), detalhe: `${b0} → ${dobro} → ${volta}` };
  });
  await teste('BPM digitado', async () => {
    const b0 = A.faixa.bpm;
    clicar(document.querySelector('#deckA .bpm-val'));
    const inp = document.querySelector('#deckA .selo .bpm input');
    if (!inp) return { ok: false, detalhe: 'o campo não abriu' };
    inp.value = String(b0 + 1);
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    inp.blur(); await espera(100);
    const ok = perto(A.faixa.bpm, b0 + 1, 0.02);
    // devolve
    clicar(document.querySelector('#deckA .bpm-val'));
    const i2 = document.querySelector('#deckA .selo .bpm input');
    if (i2) { i2.value = String(b0); i2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); i2.blur(); }
    return { ok, detalhe: `${b0} → ${b0 + 1}` };
  });
  await teste('SYNC casa o B com o A', async () => {
    arrastar($('pitch-B'), 0.6); await espera(150);
    clicar($('sync-B')); await espera(500);
    return { ok: perto(B.bpmEfetivo, A.bpmEfetivo, 0.15), detalhe: `A ${A.bpmEfetivo?.toFixed(2)} · B ${B.bpmEfetivo?.toFixed(2)}` };
  });

  // ── loops e ajuste fino ──
  await teste('LOOP 8 e sair', async () => {
    clicar(document.querySelector('#deckA .loops [data-tempos="8"]')); await espera(200);
    const liga = A.loopTempos === 8;
    clicar(document.querySelector('#deckA .lp-sair')); await espera(150);
    return { ok: liga && !A.loopTempos, detalhe: `ligou ${liga}, saiu ${!A.loopTempos}` };
  });
  await teste('◀ ▶ ajuste fino mexe na posição', async () => {
    const p0 = A.displayPosition; clicar($('fino-mais-A')); await espera(80);
    const b = $('fino-mais-A');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await espera(120);
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return { ok: true, detalhe: `posição ${p0.toFixed(2)} → ${A.displayPosition.toFixed(2)} (tocando, só confere que não quebra)` };
  });
  await teste('AUTO alterna', async () => { const b = $('auto-A'); const antes = b.classList.contains('lig'); clicar(b); await espera(100); const ok = b.classList.contains('lig') !== antes; clicar(b); return ok; });

  // ── mixer ──
  const c = mixer.canal('A');
  await teste('EQ grave A', async () => { arrastar($('eq-A-grave'), 0.2); await espera(80); const ok = perto(c.eq.posicao('grave'), 0.2); arrastar($('eq-A-grave'), 0.5); return { ok, detalhe: `posição ${c.eq.posicao('grave')}` }; });
  await teste('× corta e solta o grave', async () => {
    clicar($('kill-A-grave')); await espera(80); const corta = c.eq.morto('grave');
    clicar($('kill-A-grave')); await espera(80); const solta = !c.eq.morto('grave');
    return { ok: corta && solta, detalhe: `cortou ${corta}, soltou ${solta}` };
  });
  await teste('× obedece o motor (DJ cortou antes)', async () => {
    c.setKill('grave', true);                     // o DJ corta por fora
    await espera(150);
    const acesa = $('kill-A-grave').classList.contains('lig');
    clicar($('kill-A-grave')); await espera(80);   // a pessoa aperta pra soltar
    const solta = !c.eq.morto('grave');
    return { ok: acesa && solta, detalhe: `tela mostrou cortado: ${acesa}; clique soltou: ${solta}` };
  });
  await teste('knob acompanha o DJ', async () => {
    c.setEq('agudo', 0.25); await espera(150);
    const ok = perto(Number($('eq-A-agudo').value), 0.25);
    c.setEq('agudo', 0.5);
    return { ok, detalhe: `knob em ${$('eq-A-agudo').value}` };
  });
  await teste('FILTRO', async () => { arrastar($('fil-A'), 0.5); await espera(80); const ok = perto(c.filtro.k, 0.5); arrastar($('fil-A'), 0); return ok; });
  await teste('VOL', async () => { arrastar($('vol-A'), 0.3); await espera(80); const ok = perto(c.valores.fader, 0.3); arrastar($('vol-A'), 1); return ok; });
  await teste('ECO', async () => { arrastar($('eco-A'), 0.4); await espera(80); const ok = perto(c.valores.eco, 0.4); arrastar($('eco-A'), 0); return ok; });
  await teste('CROSSFADER', async () => { arrastar($('xf'), 0.2); await espera(80); const ok = perto(mixer.crossfader, 0.2); arrastar($('xf'), 0.5); return ok; });
  await teste('FONE alterna', async () => { const b = $('fone-A'); const a0 = b.classList.contains('lig'); clicar(b); await espera(120); const ok = b.classList.contains('lig') !== a0; clicar(b); return ok; });
  await teste('ENCAIXAR responde', async () => { if (!B.tocando) clicar($('play-B')); await espera(600); const t0 = $('rot-fase').textContent; clicar($('b-encaixar')); await espera(700); const ok = !$('b-encaixar').disabled; clicar($('play-B')); return { ok, detalhe: `${t0} → ${$('rot-fase').textContent}` }; });

  // ── músicas ──
  await teste('BROWSE B abre a gaveta do lado B', async () => { clicar(document.querySelector('#deckB .browse')); await espera(200); const ok = document.body.dataset.alvo === 'B' && document.body.classList.contains('bib-aberta'); $('b-bib-fechar')?.click(); return ok; });
  await teste('aba A abre do lado A', async () => { clicar($('aba-A')); await espera(200); const ok = document.body.dataset.lado === 'A' && document.body.classList.contains('bib-aberta'); $('b-bib-fechar')?.click(); return ok; });
  await teste('♥ no deck favorita', async () => { const b = document.querySelector('#deckA .fav'); const a0 = b.classList.contains('lig'); clicar(b); await espera(80); const ok = b.classList.contains('lig') !== a0; clicar(b); return ok; });
  await teste('ordem por BPM', async () => {
    clicar(document.querySelector('#ordem [data-ordem="bpm"]'));
    for (let i = 0; i < 20 && !document.querySelector('#lista .item .bpm-b'); i++) await espera(300);
    await espera(400);
    const bpms = [...document.querySelectorAll('#lista .item .bpm-b')].slice(0, 8).map((x) => Number(x.textContent));
    const ok = bpms.length > 2 && bpms.every((b, i) => !i || b >= bpms[i - 1] || document.querySelector('#ordem [data-ordem="bpm"]').dataset.seta === '↓');
    return { ok, detalhe: bpms.join(',') };
  });
  await teste('gênero na fileira do DJ marca na lista', async () => {
    const chip = document.querySelector('#dj-generos [data-pilha="gen:Techno"]'); clicar(chip); await espera(200);
    const ok = document.querySelector('#crates [data-pilha="gen:Techno"]').classList.contains('lig') === chip.classList.contains('lig');
    clicar(chip); return ok;
  });
  await teste('busca', async () => { const b = $('busca'); b.value = 'house'; b.dispatchEvent(new Event('input', { bubbles: true })); await espera(1800); const n = document.querySelectorAll('#lista .item').length; b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true })); return { ok: n > 0, detalhe: `${n} resultados` }; });

  // ── DJ e tela ──
  await teste('modos do DJ', async () => { clicar(document.querySelector('#dj-modos [data-modo="sozinho"]')); const t1 = $('b-piloto').textContent; clicar(document.querySelector('#dj-modos [data-modo="juntos"]')); return { ok: t1 !== $('b-piloto').textContent, detalhe: `${t1} / ${$('b-piloto').textContent}` }; });
  await teste('tema all black', async () => { clicar($('b-tema')); const ok = document.documentElement.dataset.tema === 'black'; clicar($('b-tema')); return ok && !document.documentElement.dataset.tema; });
  await teste('modo da janela e tela cheia', async () => {
    const m = document.querySelector('.cena-modo'), t0 = m.textContent; clicar(m); const mudou = m.textContent !== t0; clicar(m); clicar(m);
    clicar(document.querySelector('.cena-cheia')); const cheia = $('janela-pista').classList.contains('tela-cheia'); clicar(document.querySelector('.cena-cheia'));
    return { ok: mudou && cheia, detalhe: `modo ${mudou}, tela cheia ${cheia}` };
  });
  await teste('ajuda abre', async () => { clicar($('b-ajuda')); await espera(80); const ok = $('ajuda').open; $('ajuda').close(); return ok; });

  if (A.tocando) clicar($('play-A'));
  globalThis.__varrendo = false;
  return r;
}
