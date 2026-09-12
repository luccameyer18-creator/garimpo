/**
 * Interface do deck. Não toca no AudioContext, não agenda nada, não calcula
 * posição — só chama métodos do Deck e escuta eventos. É o que vai permitir o
 * professor entrar depois como mais um cliente da mesma API.
 */
import { Deck } from '../mix/deck.js';
import { trending, search, GENRES, attribution, prefetch } from '../sources/audius.js';

const $ = (id) => document.getElementById(id);
const fmt = (s, casas = 0) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(Math.abs(s) / 60);
  const r = Math.abs(s) % 60;
  return `${s < 0 ? '-' : ''}${m}:${r.toFixed(casas).padStart(casas ? 5 : 2, '0')}`;
};

let ctx = null, deck = null, pronto = false;

/**
 * O AudioContext nasce no PRIMEIRO gesto e nunca é suspenso.
 * Medido: a thread de render do Chrome demora ~900 ms pra partir depois do
 * resume. Criar no play deixaria o primeiro play quase um segundo atrasado.
 */
async function ligar() {
  if (ctx) return;
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(new URL('../audio/worklets/turntable-reader.js', import.meta.url));
  await ctx.resume();

  const master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(ctx.destination);

  deck = await new Deck('A', ctx, { destination: master }).init();
  ligarEventos();
  pronto = true;

  $('dica').textContent = deck.temKeylock ? 'áudio ligado' : 'áudio ligado (sem keylock: signalsmith não carregou)';
  $('e-keylock').innerHTML = `keylock <b>${deck.temKeylock ? 'disponível' : 'indisponível'}</b>`;
  setInterval(() => {
    const l = ctx.outputLatency ?? 0;
    $('e-lat').textContent = `${(l * 1e3).toFixed(0)} ms`;
  }, 1000);
  requestAnimationFrame(quadro);
}
addEventListener('pointerdown', ligar, { once: true });
addEventListener('keydown', ligar, { once: true });

// ─────────────────────────── eventos do deck ───────────────────────────

function ligarEventos() {
  deck.addEventListener('loading', (e) => {
    const { estado, progresso, faixa } = e.detail;
    if (estado === 'carregando') {
      $('titulo').textContent = faixa?.title || '…';
      $('artista').textContent = progresso ? `carregando… ${Math.round(progresso * 100)}%` : 'carregando…';
      $('erro').hidden = true;
    }
  });

  deck.addEventListener('loaded', (e) => {
    const { faixa, duration, parcial, trocado } = e.detail;
    $('titulo').textContent = faixa.title;
    $('artista').textContent = faixa.artist + (parcial ? '  ·  tocável, baixando o resto…' : '');
    $('t-dur').textContent = fmt(duration);
    $('capa').src = faixa.artwork || '';
    $('capa').style.visibility = faixa.artwork ? 'visible' : 'hidden';
    $('bpm-val').textContent = faixa.bpm ?? '—';
    $('tag-tom').innerHTML = faixa.camelot ? `<b>${faixa.camelot}</b> ${faixa.key}` : '—';
    $('erro').hidden = true;
    desenharMini();
    if (!trocado) mostrarCreditos(faixa);
  });

  // rastro visivel: no celular nao da pra abrir console
  deck.addEventListener('passo', (e) => desenharPassos(e.detail.passos));

  deck.addEventListener('error', (e) => {
    desenharPassos(e.detail.passos, true);
    // falha de rede no Audius é frequente: mostrar e oferecer retry, nunca calar
    $('erro').hidden = false;
    $('erro').innerHTML = `não consegui carregar: ${e.detail.erro} — <a href="#" id="retry" style="color:var(--acc)">tentar de novo</a>`;
    $('retry').onclick = (ev) => { ev.preventDefault(); if (e.detail.faixa?.id) deck.carregarAudius(e.detail.faixa); };
  });

  deck.addEventListener('playing', () => {
    $('b-play').classList.toggle('lig', deck.tocando);
    $('b-play').textContent = deck.tocando ? 'PAUSE' : 'PLAY';
  });

  deck.addEventListener('rate', () => {
    const p = deck.pitch;
    $('p-val').textContent = `${p >= 0 ? '+' : ''}${(p * 100).toFixed(2)}%`;
    $('t-bpm').textContent = deck.bpmEfetivo ? deck.bpmEfetivo.toFixed(2) : '—';
  });

  deck.addEventListener('keylock', (e) => {
    const { pedido, ativo } = e.detail;
    $('b-keylock').classList.toggle('lig', ativo);
    $('b-keylock').classList.toggle('lock', ativo);
    // pedido mas não ativo = fora da janela de qualidade 0.70–1.45
    $('b-keylock').style.opacity = pedido && !ativo ? 0.55 : 1;
    $('b-keylock').title = pedido && !ativo
      ? 'keylock suspenso: fora da faixa de qualidade (0.70x–1.45x)'
      : 'trava o tom ao mudar o andamento';
  });

  deck.addEventListener('glitch', (e) => { $('e-glitch').textContent = e.detail.count; });

  // o keylock voltou pro vinil sozinho porque nao saiu som: avisar, nunca calar
  deck.addEventListener('keylockFalhou', (e) => {
    $('erro').hidden = false;
    $('erro').textContent = `keylock desligado sozinho: ${e.detail.motivo}`;
    $('e-keylock').innerHTML = 'keylock <b style="color:var(--bad)">falhou</b>';
    setTimeout(() => { $('erro').hidden = true; }, 6000);
  });
}

function desenharPassos(passos, falhou = false) {
  const el = $('passos');
  if (!passos?.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = passos.map((p) =>
    `<div class="${p.nome === 'FALHOU' ? 'ruim' : ''}">` +
    `<span class="ms">${p.ms}ms</span><span class="nm">${p.nome}</span><span>${p.detalhe ?? ''}</span></div>`).join('');
  if (!falhou) setTimeout(() => { if (!$('passos').querySelector('.ruim')) el.hidden = true; }, 8000);
}

function mostrarCreditos(faixa) {
  if (faixa.source !== 'audius') { $('creditos').innerHTML = ''; return; }
  const a = attribution(faixa);
  // atribuição exigida pela Open Music License §1.5
  $('creditos').innerHTML =
    `${a.copyright} · <a href="${a.trackUrl}" target="_blank" rel="noopener">ouvir no Audius</a> · ` +
    `<a href="${a.licenseUrl}" target="_blank" rel="noopener">Open Music License</a>`;
}

// ─────────────────────────── desenho ───────────────────────────

const onda = $('onda'), mini = $('mini');
const ctx2d = onda.getContext('2d'), ctxMini = mini.getContext('2d');
const SEG_VISIVEL = 8; // janela da forma de onda ampliada

function ajustar(cv) {
  const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(r.width * dpr)) {
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
  }
  return dpr;
}

function quadro() {
  requestAnimationFrame(quadro);
  if (!pronto) return;
  desenharOnda();
  const pos = deck.displayPosition;
  $('t-pos').textContent = fmt(pos, 2);
  const rest = deck.duration - pos;
  $('t-rest').textContent = fmt(Math.max(0, rest));
  $('t-rest').style.color = rest < 30 && deck.tocando ? 'var(--quente)' : '';
  $('jog-marca').style.transform = `rotate(${(pos * 1.8 * 360) % 360}deg)`;
}

function desenharOnda() {
  const dpr = ajustar(onda);
  const L = onda.width, A = onda.height;
  ctx2d.clearRect(0, 0, L, A);
  // posição OUVIDA, não a do relógio: sem isso o playhead desenha adiantado
  const pos = deck.displayPosition;

  ctx2d.fillStyle = '#070909';
  ctx2d.fillRect(0, 0, L, A);

  if (deck.picos) {
    const { min, max, rms, binsPorSegundo } = deck.picos;
    const meio = A / 2;
    const pxPorSeg = L / SEG_VISIVEL;
    const de = pos - SEG_VISIVEL / 2;
    for (let x = 0; x < L; x++) {
      const t = de + (x / L) * SEG_VISIVEL;
      const b = Math.floor(t * binsPorSegundo);
      if (b < 0 || b >= min.length) continue;
      const hi = max[b] * meio * 0.95, lo = min[b] * meio * 0.95;
      const energia = Math.min(1, rms[b] * 3.2);
      ctx2d.fillStyle = `hsl(${210 - energia * 190} 85% ${34 + energia * 26}%)`;
      ctx2d.fillRect(x, meio - hi, 1, Math.max(1, hi - lo));
    }
    // marcador de cue
    const xc = L / 2 + (deck.cuePoint - pos) * pxPorSeg;
    if (xc >= 0 && xc <= L) {
      ctx2d.fillStyle = 'var(--quente)'; ctx2d.fillStyle = '#ff8a3d';
      ctx2d.fillRect(xc - 1 * dpr, 0, 2 * dpr, A);
    }
  }

  ctx2d.fillStyle = '#fff';
  ctx2d.fillRect(L / 2 - dpr, 0, 2 * dpr, A);
}

function desenharMini() {
  ajustar(mini);
  const L = mini.width, A = mini.height;
  ctxMini.fillStyle = '#070909'; ctxMini.fillRect(0, 0, L, A);
  if (!deck.picos) return;
  const { min, max } = deck.picos, meio = A / 2;
  for (let x = 0; x < L; x++) {
    const b = Math.floor((x / L) * min.length);
    const hi = max[b] * meio, lo = min[b] * meio;
    ctxMini.fillStyle = '#3a4655';
    ctxMini.fillRect(x, meio - hi, 1, Math.max(1, hi - lo));
  }
}

mini.onclick = (e) => {
  if (!deck?.duration) return;
  const r = mini.getBoundingClientRect();
  deck.seek(((e.clientX - r.left) / r.width) * deck.duration);
};

// ─────────────────────────── controles ───────────────────────────

$('b-play').onclick = () => deck?.alternar();
$('b-cue').onpointerdown = () => deck?.cuePress();
$('b-cue').onpointerup = () => deck?.cueRelease();
$('b-cue').onpointerleave = () => deck?.cueRelease();
$('b-keylock').onclick = () => deck?.setKeylock(!deck.keylockPedido);

$('p-fader').oninput = (e) => {
  const r = Number(document.querySelector('.faixa-sel .lig').dataset.r);
  deck?.setPitch(-Number(e.target.value) * r); // fader pra cima = mais rápido
};
document.querySelectorAll('.faixa-sel button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.faixa-sel button').forEach((x) => x.classList.remove('lig'));
    b.classList.add('lig');
    deck?.setPitchRange(Number(b.dataset.r));
    $('p-fader').value = 0;
    deck?.setPitch(0);
  };
});

// O BPM do Audius é detectado por máquina e erra meio-tempo (vi techno marcado
// como 64.9). Três formas de corrigir, da mais simples pra menos: digitar o
// número certo, ou dobrar, ou dividir.
function definirBpm(v) {
  if (!deck?.faixa || !isFinite(v) || v <= 0) return;
  deck.faixa.bpm = Math.round(v * 100) / 100;
  $('bpm-val').textContent = deck.faixa.bpm;
  $('t-bpm').textContent = deck.bpmEfetivo ? deck.bpmEfetivo.toFixed(2) : '—';
}
$('b-x2').onclick = (e) => { e.stopPropagation(); definirBpm((deck?.faixa?.bpm || 0) * 2); };
$('b-d2').onclick = (e) => { e.stopPropagation(); definirBpm((deck?.faixa?.bpm || 0) / 2); };

// clique no número => vira campo de digitação
$('bpm-val').onclick = () => {
  if (!deck?.faixa) return;
  const alvo = $('bpm-val');
  const inp = document.createElement('input');
  inp.value = deck.faixa.bpm ?? '';
  inp.inputMode = 'decimal';
  alvo.replaceWith(inp);
  inp.focus(); inp.select();
  const fechar = (aplicar) => {
    const v = parseFloat(inp.value.replace(',', '.'));
    inp.replaceWith(alvo);
    if (aplicar) definirBpm(v);
  };
  inp.onblur = () => fechar(true);
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') { inp.onblur = null; fechar(false); }
  };
};

addEventListener('keydown', (e) => {
  if (e.target.matches('input,select')) return;
  if (e.code === 'Space') { e.preventDefault(); deck?.alternar(); }
  if (e.code === 'KeyK') deck?.setKeylock(!deck.keylockPedido);
});

// ─────────────────────────── jog ───────────────────────────

const jog = $('jog');
let girando = false, angAnt = 0, tAnt = 0, raio = 1;

const angulo = (e) => {
  const r = jog.getBoundingClientRect();
  return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
};

jog.addEventListener('pointerdown', (e) => {
  if (!pronto) return;
  jog.setPointerCapture(e.pointerId);
  girando = true; jog.classList.add('ativo');
  angAnt = angulo(e); tAnt = e.timeStamp;
  raio = jog.getBoundingClientRect().width / 2;
  deck.touchStart();
});

jog.addEventListener('pointermove', (e) => {
  if (!girando) return;
  // eventos aglomerados + timeStamp de CADA um: usar o relógio do rAF pro dt
  // dá velocidade ruidosa e o prato fica mole
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs) {
    const a = angulo(ev);
    let d = a - angAnt;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    const dt = Math.max(0.001, (ev.timeStamp - tAnt) / 1000);
    angAnt = a; tAnt = ev.timeStamp;
    // 1 volta completa ≈ 1.8 s de áudio, como um prato de vinil
    const taxa = (d / (2 * Math.PI)) * 1.8 / dt;
    deck.setScratchRate(Math.abs(taxa) < 0.02 ? 0 : taxa);
  }
});

const soltarJog = (e) => {
  if (!girando) return;
  girando = false; jog.classList.remove('ativo');
  try { jog.releasePointerCapture(e.pointerId); } catch {}
  deck.touchEnd();
};
jog.addEventListener('pointerup', soltarJog);
jog.addEventListener('pointercancel', soltarJog);

// ─────────────────────────── fontes ───────────────────────────

const solta = $('solta'), arquivo = $('arquivo');
solta.onclick = () => arquivo.click();
arquivo.onchange = async () => { await ligar(); if (arquivo.files[0]) deck.carregarArquivo(arquivo.files[0]); };
['dragenter', 'dragover'].forEach((t) => solta.addEventListener(t, (e) => {
  e.preventDefault(); solta.classList.add('sobre');
}));
['dragleave', 'drop'].forEach((t) => solta.addEventListener(t, (e) => {
  e.preventDefault(); solta.classList.remove('sobre');
}));
solta.addEventListener('drop', async (e) => {
  await ligar();
  const f = e.dataTransfer.files[0];
  if (f) deck.carregarArquivo(f);
});

const genero = $('genero');
genero.innerHTML = GENRES.map((g) => `<option>${g}</option>`).join('');
genero.value = 'House';
genero.onchange = () => carregarLista(() => trending({ genre: genero.value, limit: 40 }));

let buscaTimer = null;
$('busca').oninput = (e) => {
  clearTimeout(buscaTimer);
  const q = e.target.value.trim();
  if (!q) return carregarLista(() => trending({ genre: genero.value, limit: 40 }));
  buscaTimer = setTimeout(() => carregarLista(() => search(q, { limit: 40 })), 350);
};

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
      el.innerHTML = `<div class="n"><div class="t"></div><div class="a"></div></div>
                      <div class="m">${t.bpm ?? '—'}<br>${t.camelot ?? ''}</div>`;
      el.querySelector('.t').textContent = t.title;
      el.querySelector('.a').textContent = t.artist;
      // aquece no hover: resolve a URL e abre a conexao com o validator.
      // Sem isso o clique paga resolve + DNS + TLS de um host novo (~2 s).
      let aquecida = false;
      el.onpointerenter = () => { if (!aquecida) { aquecida = true; prefetch(t.id).catch(() => {}); } };
      el.onclick = async () => { await ligar(); deck.carregarAudius(t); };
      lista.appendChild(el);
    }
    // as tres primeiras ja aquecem sozinhas: sao as mais provaveis de clicar
    faixas.slice(0, 3).forEach((t) => prefetch(t.id).catch(() => {}));
  } catch (e) {
    lista.innerHTML = `<div class="aviso">Audius indisponível: ${e.message}</div>`;
  }
}
carregarLista(() => trending({ genre: 'House', limit: 40 }));
