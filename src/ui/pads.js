/**
 * SONS — os botões de disparo da cabine, tipo Stream Deck.
 *
 * Oito pads no mixer. Cada um já vem com um som de pista — buzina, sirene,
 * rewind, impacto, subida, laser, palmas, grave 808 — SINTETIZADO aqui mesmo
 * (Web Audio, sem arquivo: nada pra baixar e nenhum sample de terceiro com
 * direito autoral). A subida e as palmas seguem o BPM de quem está no ar: a
 * subida dura 8 tempos e as palmas caem na grade.
 *
 * Cada pad é seu: no ✎, troca por um arquivo de áudio do computador, grava
 * pelo microfone, ou volta ao padrão. O que você põe fica neste navegador
 * (IndexedDB) e não sai daqui — não vai pra galera nem pra lugar nenhum.
 *
 * Teclas 1–8 disparam os pads (fora de campo de texto). Som seu tocando:
 * tocar de novo PARA — sample longo não pode ficar preso na pista.
 *
 * Tudo entra no MASTER do mixer, antes do limitador: o volume geral vale pra
 * eles, e o visualizador reage ao som.
 */

import { t } from './i18n.js';

const PADRAO = [
  { id: 'buzina', ic: '📯' }, { id: 'sirene', ic: '🚨' }, { id: 'rewind', ic: '⏪' }, { id: 'impacto', ic: '💥' },
  { id: 'subida', ic: '🌪' }, { id: 'laser', ic: '🔫' }, { id: 'palmas', ic: '👏' }, { id: 'grave', ic: '🥁' },
];

// ─────────────────────────── os sons padrão ───────────────────────────

function ruido(ctx, seg) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seg), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(); s.buffer = b;
  return s;
}
function env(ctx, g, t0, ataque, pico, dur) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(pico, t0 + ataque);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

/** Cada síntese recebe (ctx, saída, t0, segundos por tempo) e devolve a duração. */
const SINTESE = {
  // três toques curtos e um longo, três serras desafinadas: a buzina de baile
  buzina(ctx, out, t0) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 0.8;
    bp.connect(out);
    const toques = [[0, 0.13], [0.17, 0.13], [0.34, 0.13], [0.52, 0.75]];
    for (const [d, dur] of toques) {
      const g = ctx.createGain(); g.connect(bp);
      env(ctx, g, t0 + d, 0.012, 0.32, dur);
      for (const f of [415, 419, 523]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t0 + d);
        o.frequency.linearRampToValueAtTime(f * 0.94, t0 + d + dur);
        o.connect(g); o.start(t0 + d); o.stop(t0 + d + dur + 0.02);
      }
    }
    return 1.3;
  },
  // sirene de dub: sobe e desce com um vibrato rápido
  sirene(ctx, out, t0) {
    const o = ctx.createOscillator(); o.type = 'square';
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7;
    const prof = ctx.createGain(); prof.gain.value = 60;
    lfo.connect(prof).connect(o.frequency);
    o.frequency.setValueAtTime(420, t0);
    o.frequency.exponentialRampToValueAtTime(1250, t0 + 0.9);
    o.frequency.exponentialRampToValueAtTime(500, t0 + 1.8);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const g = ctx.createGain(); env(ctx, g, t0, 0.03, 0.22, 1.9);
    o.connect(lp).connect(g).connect(out);
    o.start(t0); lfo.start(t0); o.stop(t0 + 2); lfo.stop(t0 + 2);
    return 2;
  },
  // rewind: o "pião" da fita voltando — serra com o tom caindo e tremendo
  rewind(ctx, out, t0) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(1800, t0);
    o.frequency.exponentialRampToValueAtTime(90, t0 + 1.3);
    const lfo = ctx.createOscillator(); lfo.frequency.setValueAtTime(28, t0);
    lfo.frequency.exponentialRampToValueAtTime(6, t0 + 1.3);
    const prof = ctx.createGain(); prof.gain.value = 0.9;
    const g = ctx.createGain(); env(ctx, g, t0, 0.02, 0.2, 1.35);
    const am = ctx.createGain(); am.gain.value = 0.5;
    lfo.connect(prof).connect(am.gain);
    const n = ruido(ctx, 1.4); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900;
    const gn = ctx.createGain(); gn.gain.value = 0.25;
    o.connect(am).connect(g).connect(out);
    n.connect(bp).connect(gn).connect(g);
    o.start(t0); lfo.start(t0); n.start(t0);
    o.stop(t0 + 1.4); lfo.stop(t0 + 1.4);
    return 1.4;
  },
  // impacto: o chão caindo — seno despencando + estalo de ruído
  impacto(ctx, out, t0) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t0); o.frequency.exponentialRampToValueAtTime(32, t0 + 0.9);
    const g = ctx.createGain(); env(ctx, g, t0, 0.005, 0.9, 1.4);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + 1.5);
    const n = ruido(ctx, 0.6); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, t0); lp.frequency.exponentialRampToValueAtTime(200, t0 + 0.5);
    const gn = ctx.createGain(); env(ctx, gn, t0, 0.002, 0.5, 0.55);
    n.connect(lp).connect(gn).connect(out); n.start(t0);
    return 1.5;
  },
  // subida: 8 tempos de ruído abrindo e um tom subindo — acaba no 1
  subida(ctx, out, t0, tempo) {
    const dur = tempo * 8;
    const n = ruido(ctx, dur + 0.1);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(300, t0); bp.frequency.exponentialRampToValueAtTime(9000, t0 + dur);
    // começa já audível (0,03) e cresce: do 0,0001 os primeiros tempos eram mudos
    const g = ctx.createGain(); g.gain.setValueAtTime(0.03, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + dur * 0.97); g.gain.linearRampToValueAtTime(0, t0 + dur);
    n.connect(bp).connect(g).connect(out); n.start(t0); n.stop(t0 + dur + 0.05);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t0); o.frequency.exponentialRampToValueAtTime(1400, t0 + dur);
    const go = ctx.createGain(); go.gain.setValueAtTime(0.0001, t0);
    go.gain.exponentialRampToValueAtTime(0.08, t0 + dur * 0.97); go.gain.linearRampToValueAtTime(0, t0 + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
    o.connect(lp).connect(go).connect(out); o.start(t0); o.stop(t0 + dur + 0.05);
    return dur;
  },
  // laser: três "piu" de onda quadrada, em colcheias
  laser(ctx, out, t0, tempo) {
    for (let i = 0; i < 3; i++) {
      const ti = t0 + i * tempo / 2;
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(2200, ti); o.frequency.exponentialRampToValueAtTime(140, ti + 0.24);
      const g = ctx.createGain(); env(ctx, g, ti, 0.004, 0.16, 0.26);
      o.connect(g).connect(out); o.start(ti); o.stop(ti + 0.28);
    }
    return tempo * 1.5 + 0.3;
  },
  // palmas: oito, uma a cada meio tempo, na grade
  palmas(ctx, out, t0, tempo) {
    for (let i = 0; i < 8; i++) {
      const ti = t0 + i * tempo / 2;
      for (const d of [0, 0.011, 0.023]) {
        const n = ruido(ctx, 0.2);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.2;
        const g = ctx.createGain(); env(ctx, g, ti + d, 0.001, d ? 0.25 : 0.4, d ? 0.03 : 0.16);
        n.connect(bp).connect(g).connect(out); n.start(ti + d); n.stop(ti + d + 0.2);
      }
    }
    return tempo * 4 + 0.2;
  },
  // grave 808: o tom cai rápido e segura, com um pouco de saturação
  grave(ctx, out, t0) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(115, t0); o.frequency.exponentialRampToValueAtTime(48, t0 + 0.07);
    const sat = ctx.createWaveShaper();
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * 2.2); }
    sat.curve = c;
    const g = ctx.createGain(); env(ctx, g, t0, 0.004, 0.75, 1.7);
    o.connect(sat).connect(g).connect(out); o.start(t0); o.stop(t0 + 1.8);
    return 1.8;
  },
};

// ─────────────────────────── os seus sons (IndexedDB) ───────────────────────────

const BANCO = 'garimpo-pads';
function abrir() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('pads');
    r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
  });
}
async function guardar(i, valor) {
  const db = await abrir();
  await new Promise((ok, erro) => {
    const tx = db.transaction('pads', 'readwrite');
    valor ? tx.objectStore('pads').put(valor, i) : tx.objectStore('pads').delete(i);
    tx.oncomplete = ok; tx.onerror = () => erro(tx.error);
  });
}
async function lerTodos() {
  const db = await abrir();
  return new Promise((ok) => {
    const fora = {};
    const c = db.transaction('pads').objectStore('pads').openCursor();
    c.onsuccess = () => { const k = c.result; if (!k) return ok(fora); fora[k.key] = k.value; k.continue(); };
    c.onerror = () => ok(fora);
  });
}

// ─────────────────────────── a bancada ───────────────────────────

/**
 * @param {object} op
 * @param {HTMLElement} op.el        onde a bancada mora (dentro do mixer)
 * @param {function} op.ctx          () => AudioContext (ou null antes do som ligar)
 * @param {function} op.destino      () => nó de entrada do master
 * @param {function} op.bpm          () => BPM de quem está no ar
 * @param {function} op.antes        () => Promise — liga o áudio se ainda não ligou
 */
export function montarPads({ el, ctx, destino, bpm, antes = async () => {} }) {
  const meus = {};            // i -> { nome, blob, buffer? }
  const tocando = {};         // i -> BufferSource do som seu
  let editando = false, escolhido = null, gravador = null;

  el.innerHTML = `
    <div class="pads-topo"><b data-i18n="pads.titulo">${t('pads.titulo')}</b>
      <button class="pads-editar" title="${t('pads.editar')}">✎</button></div>
    <div class="pads-grade">${PADRAO.map((p, i) =>
      `<button class="pad" data-i="${i}" title="${i + 1}"><i>${p.ic}</i><span></span></button>`).join('')}</div>
    <div class="pads-edita" hidden>
      <span class="pads-qual"></span>
      <button data-a="arquivo">📁 <span>${t('pads.arquivo')}</span></button>
      <button data-a="gravar">🎙 <span>${t('pads.gravar')}</span></button>
      <button data-a="padrao">↺ <span>${t('pads.padrao')}</span></button>
      <input type="file" accept="audio/*" hidden>
    </div>`;
  const botoes = [...el.querySelectorAll('.pad')];
  const edita = el.querySelector('.pads-edita');
  const arquivo = edita.querySelector('input');

  function rotular() {
    botoes.forEach((b, i) => {
      const m = meus[i];
      b.querySelector('i').textContent = m ? '★' : PADRAO[i].ic;
      b.querySelector('span').textContent = m ? m.nome.slice(0, 10) : t('pads.n.' + PADRAO[i].id);
      b.classList.toggle('seu', !!m);
      b.classList.toggle('escolhido', editando && escolhido === i);
    });
  }

  function bate(i, dur = 0.25) {
    const b = botoes[i];
    b.classList.remove('bate'); void b.offsetWidth; b.classList.add('bate');
    clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('bate'), Math.min(1600, dur * 1000));
  }

  async function disparar(i) {
    await antes();
    const c = ctx(), out = destino();
    if (!c || !out) return;
    const saida = c.createGain(); saida.gain.value = 0.8; saida.connect(out);
    const m = meus[i];
    if (m) {
      // tocando: tocar de novo PARA
      if (tocando[i]) { try { tocando[i].stop(); } catch {} delete tocando[i]; botoes[i].classList.remove('vivo'); return; }
      if (!m.buffer) { try { m.buffer = await c.decodeAudioData(await m.blob.arrayBuffer()); } catch { return; } }
      const s = c.createBufferSource(); s.buffer = m.buffer; s.connect(saida); s.start();
      tocando[i] = s; botoes[i].classList.add('vivo');
      s.onended = () => { if (tocando[i] === s) { delete tocando[i]; botoes[i].classList.remove('vivo'); } };
      bate(i);
      return;
    }
    const tempo = 60 / (bpm() || 124);
    const dur = SINTESE[PADRAO[i].id](c, saida, c.currentTime + 0.005, tempo);
    setTimeout(() => saida.disconnect(), (dur + 0.5) * 1000);
    bate(i, dur);
  }

  // ── editar: escolhe um pad, e aí arquivo, microfone ou padrão ──
  function escolher(i) {
    escolhido = i;
    edita.hidden = false;
    edita.querySelector('.pads-qual').textContent = t('pads.qual', { n: i + 1 });
    rotular();
  }
  async function trocar(i, nome, blob) {
    meus[i] = { nome, blob };
    try { await guardar(i, { nome, blob }); } catch {}
    rotular();
  }
  edita.addEventListener('click', async (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a == null || escolhido == null) return;
    const i = escolhido;
    if (a === 'arquivo') arquivo.click();
    if (a === 'padrao') { delete meus[i]; try { await guardar(i, null); } catch {} rotular(); }
    if (a === 'gravar') {
      const b = e.target.closest('button');
      if (gravador) { gravador.stop(); return; }
      try {
        const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
        const pedacos = [];
        gravador = new MediaRecorder(fluxo);
        gravador.ondataavailable = (ev) => pedacos.push(ev.data);
        gravador.onstop = async () => {
          fluxo.getTracks().forEach((x) => x.stop());
          gravador = null;
          b.querySelector('span').textContent = t('pads.gravar');
          b.classList.remove('gravando');
          await trocar(i, t('pads.gravacao'), new Blob(pedacos, { type: pedacos[0]?.type || 'audio/webm' }));
        };
        gravador.start();
        b.querySelector('span').textContent = t('pads.parar');
        b.classList.add('gravando');
        // no máximo 8 s: é um disparo, não uma música
        setTimeout(() => { if (gravador?.state === 'recording') gravador.stop(); }, 8000);
      } catch { edita.querySelector('.pads-qual').textContent = t('pads.semMic'); }
    }
  });
  arquivo.onchange = async () => {
    const f = arquivo.files?.[0];
    arquivo.value = '';
    if (!f || escolhido == null) return;
    if (f.size > 8 * 1024 * 1024) { edita.querySelector('.pads-qual').textContent = t('pads.grande'); return; }
    await trocar(escolhido, f.name.replace(/\.[^.]+$/, ''), f);
  };

  el.querySelector('.pads-editar').onclick = () => {
    editando = !editando;
    el.classList.toggle('editando', editando);
    if (!editando) { escolhido = null; edita.hidden = true; }
    rotular();
  };
  el.querySelector('.pads-grade').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.pad');
    if (!b) return;
    const i = Number(b.dataset.i);
    if (editando) escolher(i); else disparar(i);
  });
  addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 8 && !editando) disparar(n - 1);
  });

  rotular();
  lerTodos().then((todos) => { for (const [k, v] of Object.entries(todos)) if (v?.blob) meus[k] = v; rotular(); }).catch(() => {});
  /** O DJ dispara pelo NOME do som padrão (é a vaga dele — se você trocou, toca o seu). */
  const dispararNome = (nome) => { const i = PADRAO.findIndex((p) => p.id === nome); if (i >= 0) disparar(i); };
  /** O pad está soando (o som seu tocando, ou a batida acesa do som padrão): é o LED do pad na controladora. */
  const ativo = (i) => !!tocando[i] || !!botoes[i]?.classList.contains('bate');
  return { disparar, dispararNome, rotular, ativo };
}
