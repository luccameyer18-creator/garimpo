/**
 * Interface. Não toca no AudioContext, não agenda nada, não calcula posição:
 * só chama métodos do Deck/Mixer e escuta eventos. É o que vai permitir o
 * professor entrar depois como mais um cliente da mesma API.
 */
import { Deck } from '../mix/deck.js';
import { Mixer, erroDeFase } from '../mix/mixer.js';
import { proximoPasso } from '../coach/guia.js';
import {
  trending, search, GENRES, attribution, prefetch, compativeis,
  keyCompatible, resolveStreamUrl,
} from '../sources/audius.js';

export const VERSAO = '2026-09-12.13';

const $ = (id) => document.getElementById(id);
/** Elemento que pode nao existir (diagnostico saiu da tela). */
const qd = (id) => document.getElementById(id) || { style: {}, classList: { add(){}, remove(){}, toggle(){} },
                                                    set textContent(v){}, get textContent(){return '';},
                                                    set innerHTML(v){}, hidden: true };
const fmt = (s, casas = 0) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(Math.abs(s) / 60), r = Math.abs(s) % 60;
  return `${s < 0 ? '-' : ''}${m}:${r.toFixed(casas).padStart(casas ? 5 : 2, '0')}`;
};

let ctx = null, mixer = null, pronto = false;
const decks = {};        // { A: Deck, B: Deck }
const vistas = {};       // { A: {...elementos}, B: {...} }
let medidor = null, bufMed = null, picoMaster = 0;

// ─────────────────────────── ligar o áudio ───────────────────────────

let fase = 'nao comecou', ligando = null;
const marcar = (f) => { fase = f; qd('dica').textContent = f; };

/** Prazo em tudo: travar é pior que falhar, porque não deixa rastro. */
function comPrazo(p, ms, oQue) {
  let t;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${oQue} travou (${ms}ms)`)), ms); }),
  ]);
}

async function ligar() {
  if (pronto) return;
  if (ligando) return ligando;
  ligando = (async () => {
    try {
      marcar('criando AudioContext');
      // iOS: sem isto o Web Audio cai na categoria "ambient", que a chavinha de
      // silencioso corta e que perde pro app que segura a sessão.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}

      ctx = new AudioContext({ latencyHint: 'interactive' });
      const p = ctx.resume().catch(() => {});   // dentro do gesto, antes do await

      marcar('carregando o motor');
      await comPrazo(
        ctx.audioWorklet.addModule(new URL('../audio/worklets/turntable-reader.js', import.meta.url)),
        6000, 'addModule');
      await comPrazo(p, 1500, 'resume').catch(() => {});

      marcar('montando o mixer');
      medidor = ctx.createAnalyser();
      medidor.fftSize = 256;
      bufMed = new Float32Array(medidor.fftSize);
      const saida = ctx.createGain();
      saida.connect(medidor);
      saida.connect(ctx.destination);
      mixer = new Mixer(ctx, { destination: saida });

      for (const id of ['A', 'B']) {
        marcar(`criando o deck ${id}`);
        decks[id] = await comPrazo(
          new Deck(id, ctx, { destination: mixer.canal(id).entrada }).init(), 9000, `Deck ${id}`);
        montarVista(id);
      }
      marcar('ligando o mixer');
      ligarMixer();
      pronto = true;
      // handle de depuracao: sem isto so da pra inspecionar o estado pelo
      // diagnostico, que e lento pra iterar
      globalThis.__garimpo = { decks, mixer, vistas, get ctx() { return ctx; } };
      fase = 'pronto';

      const comLock = decks.A.temKeylock;
      qd('e-keylock').innerHTML = `keylock <b>${comLock ? 'ok' : 'indisponível'}</b>`;
      qd('e-estado').textContent = ctx.state;
      qd('dica').textContent = ctx.state === 'running'
        ? (comLock ? 'pronto' : 'pronto (sem keylock)')
        : 'toque de novo para liberar o áudio';

      setInterval(() => {
        qd('e-lat').textContent = `${((ctx.outputLatency ?? 0) * 1e3).toFixed(0)} ms`;
        if (qd('e-estado').textContent !== ctx.state) qd('e-estado').textContent = ctx.state;
      }, 1000);
      requestAnimationFrame(quadro);
    } catch (e) {
      pronto = false; ctx = null;
      fase = 'FALHOU em: ' + fase;
      qd('dica').innerHTML = `<span style="color:var(--bad)">parou em "${fase}": ${e.message}</span> · toque de novo`;
      throw e;
    } finally { ligando = null; }
  })();
  return ligando;
}

/**
 * Retomar é diferente de criar. No iPhone todo navegador é WebKit, e lá o
 * contexto só sai de "suspended" com resume() dentro de um gesto válido —
 * então toda interação tenta de novo, quantas vezes precisar.
 */
async function garantirRodando() {
  if (!ctx || ctx.state === 'running') return;
  try { await ctx.resume(); } catch {}
  qd('e-estado').textContent = ctx.state;
  if (ctx.state === 'running') {
    qd('dica').textContent = 'pronto';
    for (const id of ['A', 'B']) {
      if (decks[id] && !decks[id].temKeylock) await decks[id].transport.tentarKeylockDepois();
    }
    if (decks.A) qd('e-keylock').innerHTML = `keylock <b>${decks.A.temKeylock ? 'ok' : 'indisponível'}</b>`;
  } else {
    qd('dica').textContent = 'toque de novo para liberar o áudio';
  }
}

const tentarLigar = () => { ligar().then(garantirRodando).catch(() => {}); };
for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) addEventListener(ev, tentarLigar);

// ─────────────────────────── um deck ───────────────────────────

function montarVista(id) {
  const no = $('tpl-deck').content.firstElementChild.cloneNode(true);
  no.dataset.d = id;
  no.querySelector('.letra').textContent = id;
  $('deck' + id).replaceWith(no);
  no.id = 'deck' + id;

  const q = (s) => no.querySelector(s);
  const v = {
    raiz: no, titulo: q('.titulo'), artista: q('.artista'), capa: q('.capa'),
    bpmVal: q('.bpm-val'), tom: q('.tom'), onda: q('.onda'), mini: q('.mini'),
    jog: q('.jog'), marcaJog: q('.marca-jog'),
    play: q('.play'), cue: q('.cue'), keylock: q('.keylock'), sync: q('.sync'),
    pos: q('.pos'), dur: q('.dur'), rest: q('.rest'), visorBpm: q('.visor .bpm'),
    efeito: q('.efeito'), erro: q('.erro'), passos: q('.passos'),
    pval: q('.val'), fader: q('.fader'), faixaSel: q('.faixa-sel'),
    ctxOnda: q('.onda').getContext('2d'), ctxMini: q('.mini').getContext('2d'),
  };
  // ids estaveis: e por eles que o professor aponta pros controles
  v.play.id = 'play-' + id;
  v.cue.id = 'cue-' + id;
  v.sync.id = 'sync-' + id;
  v.keylock.id = 'keylock-' + id;
  v.jog.id = 'jog-' + id;
  vistas[id] = v;
  const d = decks[id];

  // ── eventos do deck ──
  d.addEventListener('loading', (e) => {
    if (e.detail.estado !== 'carregando') return;
    v.titulo.textContent = e.detail.faixa?.title || '…';
    v.artista.textContent = 'carregando…';
    v.erro.hidden = true;
  });

  d.addEventListener('loaded', (e) => {
    const { faixa, duration, parcial, trocado } = e.detail;
    v.titulo.textContent = faixa.title;
    v.artista.textContent = faixa.artist + (parcial ? '  ·  tocável, baixando o resto…' : '');
    v.dur.textContent = fmt(duration);
    v.capa.src = faixa.artwork || '';
    v.capa.style.visibility = faixa.artwork ? 'visible' : 'hidden';
    v.bpmVal.textContent = faixa.bpm ?? '—';
    v.tom.innerHTML = faixa.camelot ? `<b>${faixa.camelot}</b> ${faixa.key}` : '—';
    v.erro.hidden = true;
    desenharMini(id);
    repintarLista();
    efeitoDoTom(id);
    atualizarCompat();
    if (!trocado) mostrarCreditos(faixa);
    if (!d.tocando) {
      v.play.classList.add('pulsa');
      setTimeout(() => v.play.classList.remove('pulsa'), 5000);
    }
  });

  d.addEventListener('passo', (e) => desenharPassos(id, e.detail.passos));
  d.addEventListener('error', (e) => {
    desenharPassos(id, e.detail.passos, true);
    v.erro.hidden = false;
    v.erro.innerHTML = `não carregou: ${e.detail.erro} — <a href="#" style="color:var(--acc)">tentar de novo</a>`;
    v.erro.querySelector('a').onclick = (ev) => {
      ev.preventDefault();
      if (e.detail.faixa?.id) d.carregarAudius(e.detail.faixa);
    };
  });

  d.addEventListener('playing', () => {
    v.play.classList.toggle('lig', d.tocando);
    v.play.classList.remove('pulsa');
    v.play.textContent = d.tocando ? 'PAUSE' : 'PLAY';
  });

  d.addEventListener('rate', () => {
    v.pval.textContent = `${d.pitch >= 0 ? '+' : ''}${(d.pitch * 100).toFixed(2)}%`;
    v.visorBpm.textContent = d.bpmEfetivo ? d.bpmEfetivo.toFixed(2) : '—';
    efeitoDoTom(id);
  });

  d.addEventListener('keylock', () => {
    v.keylock.classList.toggle('lig', d.keylockAtivo);
    v.keylock.classList.toggle('lock', d.keylockAtivo);
    v.keylock.style.opacity = d.keylockPedido && !d.keylockAtivo ? 0.55 : 1;
    efeitoDoTom(id);
  });

  d.addEventListener('analysis', (e) => {
    const { faixa, bpm, camelot, tom } = e.detail;
    v.bpmVal.textContent = faixa.bpm ?? bpm ?? '—';
    if (faixa.camelot || camelot) v.tom.innerHTML = `<b>${faixa.camelot || camelot}</b> ${faixa.key || tom}`;
    v.visorBpm.textContent = d.bpmEfetivo ? d.bpmEfetivo.toFixed(2) : '—';
    repintarLista();
    atualizarCompat();
  });

  d.addEventListener('glitch', (e) => { qd('e-glitch').textContent = e.detail.count; });
  d.addEventListener('keylockFalhou', (e) => {
    caoDeGuarda.push({ deck: id, quando: new Date().toISOString().slice(11,19), ...e.detail });
    v.erro.hidden = false;
    v.erro.innerHTML = `${e.detail.motivo}. <span style="color:var(--mut)">A música continua, só com o tom acompanhando o andamento.</span>`;
    setTimeout(() => { v.erro.hidden = true; }, 6000);
  });

  // ── controles ──
  v.play.onclick = () => d.alternar();
  v.cue.onpointerdown = () => { d.cuePress(); v.cue.classList.add('aceso'); };
  v.cue.onpointerup = () => { d.cueRelease(); v.cue.classList.remove('aceso'); };
  v.cue.onpointerleave = () => { d.cueRelease(); v.cue.classList.remove('aceso'); };
  v.keylock.onclick = () => {
    d.setKeylock(!d.keylockPedido);
    if (Math.abs(d.pitch) < 0.001) {
      v.efeito.innerHTML = '<span style="color:var(--mut)">keylock ' +
        (d.keylockPedido ? 'ligado' : 'desligado') + ' — mova o PITCH pra ouvir a diferença</span>';
    }
    efeitoDoTom(id);
  };
  v.sync.onclick = () => sincronizar(id);

  v.fader.oninput = (e) => {
    const r = Number(v.faixaSel.querySelector('.lig').dataset.r);
    d.setPitch(-Number(e.target.value) * r);
  };
  v.faixaSel.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      v.faixaSel.querySelectorAll('button').forEach((x) => x.classList.remove('lig'));
      b.classList.add('lig');
      d.setPitchRange(Number(b.dataset.r));
      v.fader.value = 0; d.setPitch(0);
    };
  });

  // BPM editável: o do Audius é detectado por máquina e erra oitava
  const setBpm = (val) => {
    if (!d.faixa || !isFinite(val) || val <= 0) return;
    d.faixa.bpm = Math.round(val * 100) / 100;
    v.bpmVal.textContent = d.faixa.bpm;
    v.visorBpm.textContent = d.bpmEfetivo ? d.bpmEfetivo.toFixed(2) : '—';
    repintarLista(); atualizarCompat();
  };
  no.querySelector('.x2').onclick = (e) => { e.stopPropagation(); setBpm((d.faixa?.bpm || 0) * 2); };
  no.querySelector('.d2').onclick = (e) => { e.stopPropagation(); setBpm((d.faixa?.bpm || 0) / 2); };
  v.bpmVal.onclick = () => {
    if (!d.faixa) return;
    const inp = document.createElement('input');
    inp.value = d.faixa.bpm ?? ''; inp.inputMode = 'decimal';
    v.bpmVal.replaceWith(inp); inp.focus(); inp.select();
    const fechar = (aplicar) => {
      const val = parseFloat(inp.value.replace(',', '.'));
      inp.replaceWith(v.bpmVal);
      if (aplicar) setBpm(val);
    };
    inp.onblur = () => fechar(true);
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { inp.onblur = null; fechar(false); }
    };
  };

  v.mini.onclick = (e) => {
    if (!d.duration) return;
    const r = v.mini.getBoundingClientRect();
    d.seek(((e.clientX - r.left) / r.width) * d.duration);
  };

  ligarJog(id);
}

/** Mostra o que o keylock está fazendo agora — com pitch zero ele não faz nada. */
function efeitoDoTom(id) {
  const d = decks[id], v = vistas[id];
  if (!d?.faixa) { v.efeito.textContent = ''; return; }
  const semitons = 12 * Math.log2(d.nominalRate);
  if (Math.abs(semitons) < 0.02) {
    v.efeito.innerHTML = '<span style="color:var(--mut)">pitch em zero: keylock não muda nada</span>';
    return;
  }
  const s = `${semitons >= 0 ? '+' : '−'}${Math.abs(semitons).toFixed(2)} semitom`;
  if (d.keylockAtivo) {
    v.efeito.innerHTML = `<span style="color:var(--lock)">tom travado</span> <span style="color:var(--mut)">(sem keylock iria ${s})</span>`;
  } else if (d.keylockPedido) {
    v.efeito.innerHTML = `<span style="color:var(--quente)">keylock ${d.transport?.motivoSemKeylock || 'indisponível'}</span> <span style="color:var(--mut)">— tom ${s}</span>`;
  } else {
    v.efeito.innerHTML = `<span style="color:var(--quente)">tom ${s}</span> <span style="color:var(--mut)">— ligue KEY LOCK</span>`;
  }
}

/**
 * SYNC: casa o BPM do deck com o outro e mostra o quanto mexeu.
 * Fase ainda não — isso vem na etapa do medidor de fase, e prometer alinhamento
 * de fase sem implementar seria pior que não ter o botão.
 */
function sincronizar(id) {
  const outro = id === 'A' ? 'B' : 'A';
  const a = decks[id], b = decks[outro];
  if (!a?.faixa?.bpm || !b?.faixa?.bpm) {
    qd('dica').textContent = 'SYNC precisa de BPM nos dois decks';
    return;
  }
  const alvo = b.bpmEfetivo;
  let razao = alvo / a.faixa.bpm;
  while (razao > 1.5) razao /= 2;
  while (razao < 0.67) razao *= 2;
  const pitch = razao - 1;
  const limite = a.transport.pitchRange;
  if (Math.abs(pitch) > limite) {
    qd('dica').innerHTML = `SYNC precisa de ${(pitch * 100).toFixed(1)}%, mais que o fader de ${(limite * 100).toFixed(0)}% — troque a faixa do pitch`;
    return;
  }
  a.setPitch(pitch);
  vistas[id].fader.value = -pitch / limite;
  vistas[id].sync.classList.add('lig');
  setTimeout(() => vistas[id].sync.classList.remove('lig'), 1800);
  qd('dica').textContent = `${id} sincronizado com ${outro}: ${a.bpmEfetivo.toFixed(2)} BPM`;
}

// ─────────────────────────── jog ───────────────────────────

function ligarJog(id) {
  const d = decks[id], jog = vistas[id].jog;
  let girando = false, angAnt = 0, tAnt = 0;
  const ang = (e) => {
    const r = jog.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  jog.addEventListener('pointerdown', (e) => {
    if (!pronto) return;
    jog.setPointerCapture(e.pointerId);
    girando = true; jog.classList.add('ativo');
    angAnt = ang(e); tAnt = e.timeStamp;
    d.touchStart();
  });
  jog.addEventListener('pointermove', (e) => {
    if (!girando) return;
    // eventos aglomerados + timeStamp de cada um: usar o relógio do rAF pro dt
    // dá velocidade ruidosa e o prato fica mole
    for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
      const a = ang(ev);
      let dd = a - angAnt;
      if (dd > Math.PI) dd -= 2 * Math.PI;
      if (dd < -Math.PI) dd += 2 * Math.PI;
      const dt = Math.max(0.001, (ev.timeStamp - tAnt) / 1000);
      angAnt = a; tAnt = ev.timeStamp;
      const taxa = (dd / (2 * Math.PI)) * 1.8 / dt;   // 1 volta ≈ 1.8 s de áudio
      d.setScratchRate(Math.abs(taxa) < 0.02 ? 0 : taxa);
    }
  });
  const soltar = (e) => {
    if (!girando) return;
    girando = false; jog.classList.remove('ativo');
    try { jog.releasePointerCapture(e.pointerId); } catch {}
    d.touchEnd();
  };
  jog.addEventListener('pointerup', soltar);
  jog.addEventListener('pointercancel', soltar);
}

// ─────────────────────────── mixer ───────────────────────────

function ligarMixer() {
  document.querySelectorAll('[data-eq]').forEach((el) => {
    el.oninput = () => mixer.canal(el.dataset.d).setEq(el.dataset.eq, Number(el.value));
  });
  document.querySelectorAll('[data-kill]').forEach((b) => {
    b.onclick = () => {
      const on = !b.classList.contains('lig');
      b.classList.toggle('lig', on);
      mixer.canal(b.dataset.d).setKill(b.dataset.kill, on);
    };
  });
  document.querySelectorAll('[data-filtro]').forEach((el) => {
    el.oninput = () => mixer.canal(el.dataset.d).setFiltro(Number(el.value));
  });
  document.querySelectorAll('[data-fader]').forEach((el) => {
    el.oninput = () => mixer.canal(el.dataset.d).setFader(Number(el.value));
  });
  // guardas: um controle que some do HTML nao pode derrubar a montagem inteira
  const em = (id, fn) => { const el = $(id); if (el) el.oninput = fn; else console.warn('[ui] falta #' + id); };
  em('xf', (e) => mixer.setCrossfader(Number(e.target.value)));
  em('master', (e) => mixer.setMaster(Number(e.target.value)));
}

// ─────────────────────────── desenho ───────────────────────────

const SEG_VISIVEL = 8;

function ajustar(cv) {
  const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const L = Math.round(r.width * dpr), A = Math.round(r.height * dpr);
  // confere a ALTURA tambem: a onda agora e flexivel, entao ela muda de
  // tamanho quando a janela muda e o canvas precisa acompanhar
  if (cv.width !== L || cv.height !== A) { cv.width = L; cv.height = A; }
  return dpr;
}

function quadro() {
  requestAnimationFrame(quadro);
  if (!pronto) return;

  const n = nivelMaster();
  if (n > picoMaster) picoMaster = n;
  $('vu-master').style.width = Math.min(100, n * 190) + '%';

  for (const id of ['A', 'B']) {
    const d = decks[id], v = vistas[id];
    if (!d) continue;
    desenharOnda(id);
    const pos = d.displayPosition;
    v.pos.textContent = fmt(pos, 2);
    const rest = d.duration - pos;
    v.rest.textContent = fmt(Math.max(0, rest));
    v.rest.style.color = rest < 30 && d.tocando ? 'var(--quente)' : '';
    v.marcaJog.style.transform = `rotate(${(pos * 1.8 * 360) % 360}deg)`;
    if (v.visorBpm) v.visorBpm.textContent = d.bpmEfetivo ? d.bpmEfetivo.toFixed(1) : '—';
    const nv = mixer.canal(id).nivel;
    $('vu-' + id).style.width = Math.min(100, nv * 190) + '%';
  }
  desenharFase();
  if (performance.now() - ultimoProf > 220) { ultimoProf = performance.now(); rodarProfessor(); }
}

let ultimoProf = 0, ultimaFala = '', apontados = [];

/**
 * Desenha o professor e ACENDE os controles que ele aponta.
 *
 * O mecanismo de acender e o mesmo que os "controles fantasma" vao usar na
 * Fase 6, quando o professor executar acoes por conta propria — por isso ele
 * e generico: recebe ids e liga uma classe.
 */
function rodarProfessor() {
  const est = {
    audioOk: pronto && ctx?.state === 'running',
    crossfader: mixer?.crossfader ?? 0.5,
    fase: erroDeFase(decks.A, decks.B),
    eq: { A: { grave: mixer?.canal('A').eq.get('grave') },
          B: { grave: mixer?.canal('B').eq.get('grave') } },
  };
  for (const id of ['A', 'B']) {
    const d = decks[id];
    est[id] = d ? {
      temFaixa: !!d.faixa, tocando: d.tocando, bpm: d.faixa?.bpm,
      camelot: d.faixa?.camelot, grid: d.grid, pitch: d.pitch, bpmEfetivo: d.bpmEfetivo,
    } : null;
  }

  const p = proximoPasso(est);
  const chave = p.num + p.fala;
  if (chave === ultimaFala) return;      // so redesenha quando muda
  ultimaFala = chave;

  $('prof-rosto').textContent = p.num;
  $('prof-fala').innerHTML = p.fala + (p.porque ? `<small>${p.porque}</small>` : '');
  $('prof').classList.toggle('azul', p.cor === 'azul');

  for (const el of apontados) el?.classList.remove('apontado');
  apontados = (p.apontar || []).map((id) => $(id)).filter(Boolean);
  for (const el of apontados) el.classList.add('apontado');
}

function nivelMaster() {
  if (!medidor) return 0;
  medidor.getFloatTimeDomainData(bufMed);
  let s = 0;
  for (let i = 0; i < bufMed.length; i++) s += bufMed[i] * bufMed[i];
  return Math.sqrt(s / bufMed.length);
}

function desenharOnda(id) {
  const d = decks[id], v = vistas[id];
  const dpr = ajustar(v.onda);
  const c = v.ctxOnda, L = v.onda.width, A = v.onda.height;
  c.fillStyle = '#070909'; c.fillRect(0, 0, L, A);
  const pos = d.displayPosition;

  if (d.picos) {
    const { min, max, rms, binsPorSegundo } = d.picos;
    const meio = A / 2, pxSeg = L / SEG_VISIVEL, de = pos - SEG_VISIVEL / 2;
    for (let x = 0; x < L; x++) {
      const t = de + (x / L) * SEG_VISIVEL;
      const b = Math.floor(t * binsPorSegundo);
      if (b < 0 || b >= min.length) continue;
      const hi = max[b] * meio * 0.95, lo = min[b] * meio * 0.95;
      const e = Math.min(1, rms[b] * 3.2);
      c.fillStyle = `hsl(${210 - e * 190} 85% ${34 + e * 26}%)`;
      c.fillRect(x, meio - hi, 1, Math.max(1, hi - lo));
    }
    // grid de batidas: é o que deixa ver se os dois decks estão alinhados
    if (d.grid?.bpm) {
      const per = 60 / d.grid.bpm;
      c.fillStyle = 'rgba(255,255,255,.22)';
      const prim = Math.ceil((de - d.grid.ancora) / per);
      for (let k = prim; ; k++) {
        const t = d.grid.ancora + k * per;
        if (t > de + SEG_VISIVEL) break;
        const x = (t - de) * pxSeg;
        const forte = ((k % 4) + 4) % 4 === 0;
        c.fillStyle = forte ? 'rgba(255,255,255,.42)' : 'rgba(255,255,255,.16)';
        c.fillRect(x, forte ? 0 : A * 0.34, dpr, forte ? A : A * 0.32);
      }
    }
    const xc = L / 2 + (d.cuePoint - pos) * pxSeg;
    if (xc >= 0 && xc <= L) { c.fillStyle = '#ff8a3d'; c.fillRect(xc - dpr, 0, 2 * dpr, A); }
  }
  c.fillStyle = '#fff';
  c.fillRect(L / 2 - dpr, 0, 2 * dpr, A);
}

function desenharMini(id) {
  const d = decks[id], v = vistas[id];
  ajustar(v.mini);
  const c = v.ctxMini, L = v.mini.width, A = v.mini.height;
  c.fillStyle = '#070909'; c.fillRect(0, 0, L, A);
  if (!d.picos) return;
  const { min, max } = d.picos, meio = A / 2;
  c.fillStyle = id === 'A' ? '#3d5a7a' : '#7a5f3d';
  for (let x = 0; x < L; x++) {
    const b = Math.floor((x / L) * min.length);
    c.fillRect(x, meio - max[b] * meio, 1, Math.max(1, (max[b] - min[b]) * meio));
  }
}

/**
 * Medidor de fase — o visual que mais ensina, porque beatmatch é invisível
 * sem ele. Duas marcas correndo; quando alinham, trava em verde.
 */
function desenharFase() {
  const cv = $('fase'), c = cv.getContext('2d');
  ajustar(cv);
  const L = cv.width, A = cv.height;
  c.fillStyle = '#070909'; c.fillRect(0, 0, L, A);

  const e = erroDeFase(decks.A, decks.B);
  if (!e) {
    $('rot-fase').textContent = decks.A?.grid && decks.B?.grid
      ? 'toque play nos dois' : 'carregue os dois decks';
    $('rot-fase').style.color = 'var(--mut)';
    return;
  }

  const meio = L / 2;
  c.strokeStyle = 'rgba(255,255,255,.18)';
  c.beginPath(); c.moveTo(meio, 0); c.lineTo(meio, A); c.stroke();

  // erro em frações de tempo, mapeado na largura
  const x = meio + e.emTempos * L * 0.9;
  const perto = Math.abs(e.emTempos) < 0.02;
  c.fillStyle = perto ? '#3ddc84' : Math.abs(e.emTempos) < 0.08 ? '#ffb03d' : '#ff5d5d';
  c.fillRect(x - 2, 4, 4, A - 8);

  c.fillStyle = 'rgba(255,255,255,.5)';
  c.font = `${10 * (devicePixelRatio || 1)}px ui-monospace,monospace`;
  c.fillText('A', 4, A - 5);
  c.textAlign = 'right'; c.fillText('B', L - 4, A - 5); c.textAlign = 'left';

  const ms = Math.abs(e.emMs).toFixed(0);
  $('rot-fase').textContent = perto
    ? `em fase (${ms} ms)`
    : `${e.emTempos > 0 ? 'B adiantado' : 'B atrasado'} ${ms} ms`;
  $('rot-fase').style.color = perto ? 'var(--ok)' : 'var(--mut)';
}

function desenharPassos(id, passos, falhou = false) {
  const el = vistas[id].passos;
  if (!passos?.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = passos.map((p) =>
    `<div class="${p.nome === 'FALHOU' ? 'ruim' : ''}">` +
    `<span class="ms">${p.ms}ms</span><span class="nm">${p.nome}</span><span>${p.detalhe ?? ''}</span></div>`).join('');
  if (!falhou) setTimeout(() => { if (!el.querySelector('.ruim')) el.hidden = true; }, 8000);
}

function mostrarCreditos(faixa) {
  if (faixa.source !== 'audius') return;
  const a = attribution(faixa);
  // atribuição exigida pela Open Music License §1.5
  $('creditos').innerHTML =
    `${a.copyright} · <a href="${a.trackUrl}" target="_blank" rel="noopener">ouvir no Audius</a> · ` +
    `<a href="${a.licenseUrl}" target="_blank" rel="noopener">Open Music License</a>`;
}

// ─────────────────────────── biblioteca ───────────────────────────

/** Qual deck recebe a próxima faixa: o que estiver parado, senão o A. */
function deckLivre() {
  if (!decks.A) return 'A';
  if (!decks.A.faixa) return 'A';
  if (!decks.B.faixa) return 'B';
  if (!decks.A.tocando && decks.B.tocando) return 'A';
  if (!decks.B.tocando && decks.A.tocando) return 'B';
  return mixer && mixer.crossfader > 0.5 ? 'A' : 'B';   // carrega no que está mudo
}

/** Faixa de referência pra comparar: a que está tocando, senão a do A. */
function referencia() {
  if (decks.A?.tocando && decks.A.faixa?.bpm) return decks.A.faixa;
  if (decks.B?.tocando && decks.B.faixa?.bpm) return decks.B.faixa;
  return decks.A?.faixa?.bpm ? decks.A.faixa : decks.B?.faixa?.bpm ? decks.B.faixa : null;
}

function avaliar(t) {
  const base = referencia();
  if (!base?.bpm || !t.bpm) return null;
  const pitch = t.bpm / base.bpm - 1;
  if (Math.abs(pitch) > 0.16) return { classe: 'longe', pitch, rotulo: null };
  const h = keyCompatible(
    base.camelot ? { camelot: base.camelot } : null,
    t.camelot ? { camelot: t.camelot } : null);
  const facil = Math.abs(pitch) <= 0.08;
  if (h.ok && facil) return { classe: 'otima', pitch, rotulo: h.reason };
  if (h.ok) return { classe: 'boa', pitch, rotulo: h.reason + ', pitch alto' };
  if (facil) return { classe: 'boa', pitch, rotulo: 'BPM casa, tom não' };
  return { classe: 'longe', pitch, rotulo: null };
}

function repintarLista() {
  for (const el of document.querySelectorAll('#lista .item')) {
    const t = el.__faixa;
    if (!t) continue;
    const v = avaliar(t);
    el.classList.remove('otima', 'boa', 'longe');
    const m = el.querySelector('.marca');
    if (!v) { if (m) m.textContent = ''; continue; }
    el.classList.add(v.classe);
    if (m) {
      m.textContent = v.rotulo ? `${v.pitch >= 0 ? '+' : ''}${(v.pitch * 100).toFixed(1)}%  ${v.rotulo}` : '';
      m.style.color = v.classe === 'otima' ? 'var(--ok)' : v.classe === 'boa' ? 'var(--quente)' : 'var(--mut)';
    }
  }
}

function atualizarCompat() {
  const base = referencia();
  $('b-compat').disabled = !base?.bpm;
  $('b-compat').textContent = base?.bpm
    ? `mixa com ${base.bpm} ${base.camelot || ''}` : 'carregue uma faixa';
}

async function carregarLista(fn) {
  const lista = $('lista');
  lista.innerHTML = '<div style="color:var(--mut);padding:8px">buscando…</div>';
  try {
    const faixas = (await fn()).filter((t) => !t.isLongMix);
    lista.innerHTML = '';
    if (!faixas.length) { lista.innerHTML = '<div style="color:var(--mut);padding:8px">nada aqui</div>'; return; }
    for (const t of faixas) {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `<div class="n"><div class="t"></div><div class="a"></div><div class="a marca"></div></div>
        <div class="m">${t.bpm ?? '—'}<br>${t.camelot ?? ''}</div>
        <div class="carregar"><button class="pa">A</button><button class="pb">B</button></div>`;
      el.querySelector('.t').textContent = t.title;
      el.querySelector('.a').textContent = t.artist;
      el.__faixa = t;

      let aquecida = false;
      const aquecer = () => { if (!aquecida) { aquecida = true; prefetch(t.id).catch(() => {}); } };
      el.onpointerenter = aquecer;
      el.addEventListener('pointerdown', aquecer);

      const por = async (id) => {
        try { await ligar(); } catch { return; }
        await garantirRodando();
        decks[id].carregarAudius(t);
      };
      el.querySelector('.pa').onclick = (e) => { e.stopPropagation(); por('A'); };
      el.querySelector('.pb').onclick = (e) => { e.stopPropagation(); por('B'); };

      // toque no corpo do item = deck livre. Tolerância de 12 px porque a lista
      // rola e o Chrome cancela o click se o dedo escorrega.
      let px = 0, py = 0, pid = null;
      el.addEventListener('pointerdown', (ev) => { px = ev.clientX; py = ev.clientY; pid = ev.pointerId; });
      el.addEventListener('pointerup', (ev) => {
        if (ev.pointerId !== pid || ev.target.closest('.carregar')) return;
        if (Math.hypot(ev.clientX - px, ev.clientY - py) > 12) return;
        pid = null;
        por(deckLivre());
      });

      lista.appendChild(el);
    }
    repintarLista();
    faixas.slice(0, 3).forEach((t) => prefetch(t.id).catch(() => {}));
  } catch (e) {
    lista.innerHTML = `<div class="aviso">Audius indisponível: ${e.message}</div>`;
  }
}

const genero = $('genero');
genero.innerHTML = GENRES.map((g) => `<option>${g}</option>`).join('');
genero.value = 'House';
genero.onchange = () => carregarLista(() => trending({ genre: genero.value, limit: 40 }));

let tBusca = null;
$('busca').oninput = (e) => {
  clearTimeout(tBusca);
  const q = e.target.value.trim();
  if (!q) return carregarLista(() => trending({ genre: genero.value, limit: 40 }));
  tBusca = setTimeout(() => carregarLista(() => search(q, { limit: 40 })), 350);
};

$('b-compat').onclick = () => {
  const base = referencia();
  if (!base?.bpm) return;
  $('busca').value = '';
  carregarLista(() => compativeis(base));
};

$('b-ajuda').onclick = () => $('ajuda').showModal();
$('fechar-ajuda').onclick = () => $('ajuda').close();

const arquivo = $('arquivo');
$('b-arquivo').onclick = () => arquivo.click();
arquivo.onchange = async () => {
  try { await ligar(); } catch { return; }
  await garantirRodando();
  if (arquivo.files[0]) decks[deckLivre()].carregarArquivo(arquivo.files[0]);
};
['dragenter', 'dragover'].forEach((t) => addEventListener(t, (e) => e.preventDefault()));
addEventListener('drop', async (e) => {
  e.preventDefault();
  try { await ligar(); } catch { return; }
  await garantirRodando();
  if (e.dataTransfer.files[0]) decks[deckLivre()].carregarArquivo(e.dataTransfer.files[0]);
});

addEventListener('keydown', (e) => {
  if (e.target.matches('input,select')) return;
  if (e.code === 'Space') { e.preventDefault(); decks.A?.alternar(); }
  if (e.code === 'KeyB') { e.preventDefault(); decks.B?.alternar(); }
});

carregarLista(() => trending({ genre: 'House', limit: 40 }));
qd('e-ver').textContent = VERSAO;

// ─────────────────────────── diagnóstico ───────────────────────────

const problemas = [];
const caoDeGuarda = [];
addEventListener('error', (e) => problemas.push('error: ' + e.message));
addEventListener('unhandledrejection', (e) => problemas.push('rejeição: ' + String(e.reason?.message || e.reason)));

const DP = 'https://discoveryprovider.audius.co/v1';

async function sondar(nome, url, opts) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, opts);
    return `${nome}: ${r.status} em ${Math.round(performance.now() - t0)}ms`;
  } catch (e) { return `${nome}: FALHOU ${e.name} — ${e.message}`; }
}

$('b-diag').onclick = async () => {
  const b = $('b-diag');
  b.textContent = 'checando…';
  const info = (id) => decks[id] ? {
    faixa: decks[id].faixa?.title, bpm: decks[id].faixa?.bpm,
    bpmMetadata: decks[id].faixa?.bpmMetadata, camelot: decks[id].faixa?.camelot,
    grid: decks[id].grid, tocando: decks[id].tocando, pitch: decks[id].pitch,
    keylockPedido: decks[id].keylockPedido, keylockATIVO: decks[id].keylockAtivo,
    motivoSemKeylock: decks[id].transport?.motivoSemKeylock,
    passos: decks[id].passos,
  } : 'nao existe';

  const rel = {
    versao: VERSAO, fase, quando: new Date().toISOString(),
    ua: navigator.userAgent, tela: `${innerWidth}x${innerHeight} dpr${devicePixelRatio}`,
    rede: { tipo: navigator.connection?.effectiveType, downlink: navigator.connection?.downlink,
            rtt: navigator.connection?.rtt, economiaDeDados: navigator.connection?.saveData },
    audio: ctx ? { estado: ctx.state, sampleRate: ctx.sampleRate,
                   baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency } : 'NUNCA LIGOU',
    nivelMasterAgora: +nivelMaster().toFixed(5),
    picoMasterDesdeOInicio: +picoMaster.toFixed(5),
    limitadorReduzindo: mixer ? +mixer.reducao.toFixed(1) : null,
    crossfader: mixer?.crossfader,
    deckA: info('A'), deckB: info('B'),
    fase_entre_decks: erroDeFase(decks.A, decks.B),
    faixasNaLista: document.querySelectorAll('#lista .item').length,
    quedasDeKeylock: caoDeGuarda,
    problemas: problemas.slice(-8),
    sondas: [],
  };
  rel.sondas.push(await sondar('metadata', `${DP}/tracks/trending?genre=House&limit=1&app_name=garimpo`));
  try {
    const j = await (await fetch(`${DP}/tracks/trending?genre=House&limit=1&app_name=garimpo`)).json();
    const id = j.data?.[0]?.id;
    if (id) {
      const t0 = performance.now();
      const u = await resolveStreamUrl(id);
      rel.sondas.push(`resolve verificado: ${new URL(u).host} em ${Math.round(performance.now() - t0)}ms`);
      rel.sondas.push(await sondar('stream 64KB', u, { headers: { Range: 'bytes=0-65535' } }));
    }
  } catch (e) { rel.sondas.push('resolve FALHOU: ' + e.message); }

  const txt = JSON.stringify(rel, null, 1);
  try { await navigator.clipboard.writeText(txt); b.textContent = 'copiado — cole no chat'; }
  catch {
    const v = vistas.A;
    if (v) { v.erro.hidden = false; v.erro.style.whiteSpace = 'pre-wrap'; v.erro.textContent = txt; }
    b.textContent = 'na tela';
  }
  setTimeout(() => { b.textContent = 'diagnóstico'; }, 8000);
};
