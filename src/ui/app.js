/**
 * Interface do deck. Não toca no AudioContext, não agenda nada, não calcula
 * posição — só chama métodos do Deck e escuta eventos. É o que vai permitir o
 * professor entrar depois como mais um cliente da mesma API.
 */
import { Deck } from '../mix/deck.js';
import { trending, search, GENRES, attribution, prefetch, compativeis, keyCompatible, resolveStreamUrl } from '../sources/audius.js';

const $ = (id) => document.getElementById(id);
const fmt = (s, casas = 0) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(Math.abs(s) / 60);
  const r = Math.abs(s) % 60;
  return `${s < 0 ? '-' : ''}${m}:${r.toFixed(casas).padStart(casas ? 5 : 2, '0')}`;
};

let ctx = null, deck = null, pronto = false;
let medidor = null, bufMedidor = null, picoMaster = 0;

/** Nivel instantaneo do master, 0..1. */
function nivelMaster() {
  if (!medidor) return 0;
  medidor.getFloatTimeDomainData(bufMedidor);
  let s = 0;
  for (let i = 0; i < bufMedidor.length; i++) s += bufMedidor[i] * bufMedidor[i];
  return Math.sqrt(s / bufMedidor.length);
}

/**
 * O AudioContext nasce no PRIMEIRO gesto e nunca é suspenso.
 * Medido: a thread de render do Chrome demora ~900 ms pra partir depois do
 * resume. Criar no play deixaria o primeiro play quase um segundo atrasado.
 */
let ligando = null;

/** Versão do build. Sem isto não dá pra saber se o celular pegou cache. */
export const VERSAO = '2026-09-12.8';

/**
 * Fase atual de ligar(). Vai pro diagnóstico.
 * Quando algo TRAVA (em vez de quebrar) não há stack, não há erro e não há
 * log — a última fase concluída é a única pista de onde parou.
 */
let fase = 'nao comecou';
const marcar = (f) => { fase = f; $('dica').textContent = f; };

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
  if (ligando) return ligando;          // chamadas concorrentes esperam a mesma
  ligando = (async () => {
    try {
      marcar('criando AudioContext');

      // iOS: por padrão o Web Audio cai na categoria de sessão "ambient", que é
      // SILENCIADA pela chavinha física de mute do iPhone — enquanto um <audio>
      // comum ignora a chave. Resultado: tudo funciona, o app diz que está
      // tocando, e não sai som nenhum. Pedir "playback" corrige.
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
      } catch {}

      // resume() PRIMEIRO, ainda dentro do gesto. Se vier depois de um await
      // (addModule leva centenas de ms), a ativacao do toque ja expirou e o
      // celular recusa em silencio. No desktop passava; no celular nao.
      ctx = new AudioContext({ latencyHint: 'interactive' });
      const p = ctx.resume().catch(() => {});

      marcar('carregando o worklet');
      // addModule tambem ganha prazo: no iOS ha relato de ele nunca resolver
      // com o contexto suspenso, e ai o app inteiro fica parado aqui.
      await comPrazo(
        ctx.audioWorklet.addModule(new URL('../audio/worklets/turntable-reader.js', import.meta.url)),
        6000, 'addModule');

      marcar('retomando o contexto');
      await comPrazo(p, 1500, 'resume').catch(() => {});

      marcar('montando o grafo');
      const master = ctx.createGain();
      master.gain.value = 0.85;
      // Medidor no master. E o que distingue "o grafo nao esta produzindo som"
      // de "esta produzindo e o aparelho nao deixa ouvir" (chave de silencioso,
      // volume, saida errada). Sem isso a pergunta fica sem resposta.
      medidor = ctx.createAnalyser();
      medidor.fftSize = 256;
      bufMedidor = new Float32Array(medidor.fftSize);
      master.connect(medidor);
      master.connect(ctx.destination);

      marcar('criando o deck');
      deck = await comPrazo(new Deck('A', ctx, { destination: master }).init(), 9000, 'Deck.init');
      ligarEventos();
      pronto = true;
      fase = 'pronto';

      $('e-keylock').innerHTML = `keylock <b>${deck.temKeylock ? 'ok' : 'indisponível'}</b>`;
      $('e-estado').textContent = ctx.state;
      // nao dizer "ligado" se o contexto ainda esta suspenso: no iOS ele fica
      // assim ate um gesto valido, e mentir aqui esconde exatamente o problema
      $('dica').textContent = ctx.state === 'running'
        ? (deck.temKeylock ? 'áudio ligado' : 'áudio ligado (sem keylock)')
        : 'toque de novo para liberar o áudio';
      setInterval(() => {
        $('e-lat').textContent = `${((ctx.outputLatency ?? 0) * 1e3).toFixed(0)} ms`;
        if ($('e-estado').textContent !== ctx.state) $('e-estado').textContent = ctx.state;
      }, 1000);
      requestAnimationFrame(quadro);
    } catch (e) {
      // NUNCA falhar calado: sem isto o usuario toca e nao acontece nada
      pronto = false;
      ctx = null;
      fase = 'FALHOU em: ' + fase;
      $('dica').innerHTML = `<span style="color:var(--bad)">parou em "${fase}": ${e.message}</span> · toque de novo`;
      $('erro').hidden = false;
      $('erro').textContent = `falha ao ligar o áudio: ${e.name}: ${e.message}`;
      throw e;
    } finally {
      ligando = null;       // permite tentar de novo; antes o {once:true} matava
    }
  })();
  return ligando;
}

/**
 * Retomar o áudio é DIFERENTE de criar o deck, e no iOS isso importa.
 *
 * No iPhone todo navegador é WebKit por baixo (o Chrome inclusive), e lá o
 * AudioContext só sai de "suspended" se o resume() acontecer dentro de um gesto
 * válido. Meu handler antigo consumia o primeiro gesto para criar tudo, e os
 * gestos seguintes viam uma promessa pendente e não tentavam de novo — o
 * contexto ficava suspenso pra sempre.
 *
 * Agora: toda interação tenta retomar, quantas vezes for preciso.
 */
async function garantirRodando() {
  if (!ctx) return;
  if (ctx.state === 'running') return;
  try { await ctx.resume(); } catch {}
  if (ctx.state === 'running') {
    $('e-estado').textContent = 'ok';
    $('dica').textContent = 'áudio ligado';
    // o keylock pode ter sido pulado porque o contexto estava suspenso
    if (deck && !deck.temKeylock) {
      const ok = await deck.transport.tentarKeylockDepois();
      $('e-keylock').innerHTML = `keylock <b>${ok ? 'ok' : 'indisponível'}</b>`;
    }
  } else {
    $('e-estado').textContent = ctx.state;
    $('dica').textContent = 'toque de novo para liberar o áudio';
  }
}

// sem {once:true}: se falhar, o próximo gesto tenta de novo
const tentarLigar = () => { ligar().then(garantirRodando).catch(() => {}); };
for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) {
  addEventListener(ev, tentarLigar);
}

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
    repintarLista();
    if (!trocado) mostrarCreditos(faixa);
    $('b-compat').disabled = !faixa.bpm;
    $('b-compat').textContent = faixa.bpm
      ? `mixa com esta (${faixa.bpm} ${faixa.camelot || ''})` : 'carregue uma faixa';
    // carregar nao e tocar. Sem dizer isso, a faixa entra e parece que nada
    // aconteceu — e o usuario reporta "nao saiu audio".
    if (!deck.tocando) {
      $('dica').innerHTML = 'faixa carregada — toque <b style="color:var(--ok)">PLAY</b>';
      $('b-play').classList.add('pulsa');
      setTimeout(() => $('b-play').classList.remove('pulsa'), 6000);
    }
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
    $('b-play').classList.remove('pulsa');
    if (deck.tocando) $('dica').textContent = 'tocando';
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

  // analise chegou: arquivo local ganha BPM e tom; faixa do Audius ganha o grid
  deck.addEventListener('analysis', (e) => {
    const { faixa, bpm, camelot, tom, confianca, ancora, ms } = e.detail;
    $('bpm-val').textContent = faixa.bpm ?? bpm ?? '—';
    if (faixa.camelot || camelot) {
      $('tag-tom').innerHTML = `<b>${faixa.camelot || camelot}</b> ${faixa.key || tom}`;
    }
    $('b-compat').disabled = !faixa.bpm;
    $('b-compat').textContent = faixa.bpm ? `mixa com esta (${faixa.bpm} ${faixa.camelot || ''})` : 'carregue uma faixa';
    $('e-grid').textContent = `${bpm ?? '?'} @ ${ancora}s`;
    repintarLista();
    $('e-grid').title = `confianca ${confianca}, analisado em ${ms} ms`;
  });

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
  const n = nivelMaster();
  if (n > picoMaster) picoMaster = n;
  $('e-nivel').textContent = n > 0.0005 ? (20 * Math.log10(n)).toFixed(0) + ' dB' : 'silencio';
  $('e-nivel').style.color = n > 0.0005 ? 'var(--ok)' : 'var(--mut)';
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
arquivo.onchange = async () => {
  try { await ligar(); } catch { return; }
  if (arquivo.files[0]) deck.carregarArquivo(arquivo.files[0]);
};
['dragenter', 'dragover'].forEach((t) => solta.addEventListener(t, (e) => {
  e.preventDefault(); solta.classList.add('sobre');
}));
['dragleave', 'drop'].forEach((t) => solta.addEventListener(t, (e) => {
  e.preventDefault(); solta.classList.remove('sobre');
}));
solta.addEventListener('drop', async (e) => {
  try { await ligar(); } catch { return; }
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

/**
 * Como esta faixa se relaciona com a que esta no deck.
 * A ideia e a mesma do professor: em vez do usuario procurar, a informacao
 * vem ate ele. Olhar a lista e ver de longe o que encaixa.
 */
function avaliar(t) {
  const base = deck?.faixa;
  if (!base?.bpm || !t.bpm) return null;
  const razao = t.bpm / base.bpm;
  const pitch = razao - 1;
  if (Math.abs(pitch) > 0.16) return { classe: 'longe', pitch, rotulo: null };

  const h = keyCompatible(
    base.camelot ? { camelot: base.camelot } : null,
    t.camelot ? { camelot: t.camelot } : null
  );
  const noPitchFacil = Math.abs(pitch) <= 0.08;   // cabe no fader de 8%
  if (h.ok && noPitchFacil) return { classe: 'otima', pitch, rotulo: h.reason };
  if (h.ok)                 return { classe: 'boa',   pitch, rotulo: h.reason + ', pitch alto' };
  if (noPitchFacil)         return { classe: 'boa',   pitch, rotulo: 'BPM casa, tom nao' };
  return { classe: 'longe', pitch, rotulo: null };
}

/** Repinta a lista inteira: chamado quando troca a faixa do deck. */
function repintarLista() {
  for (const el of document.querySelectorAll('#lista .item')) {
    const t = el.__faixa;
    if (!t) continue;
    const v = avaliar(t);
    el.classList.remove('otima', 'boa', 'longe');
    const marca = el.querySelector('.marca');
    if (!v) { if (marca) marca.textContent = ''; continue; }
    el.classList.add(v.classe);
    if (marca) {
      marca.textContent = v.rotulo
        ? `${v.pitch >= 0 ? '+' : ''}${(v.pitch * 100).toFixed(1)}%  ${v.rotulo}` : '';
      marca.style.color = v.classe === 'otima' ? 'var(--ok)'
                        : v.classe === 'boa' ? 'var(--quente)' : 'var(--mut)';
    }
  }
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
      const extra = t.pitchNecessario !== undefined
        ? `<br><span style="color:${t.harmonicamenteOk ? 'var(--ok)' : 'var(--mut)'}">${t.pitchNecessario >= 0 ? '+' : ''}${(t.pitchNecessario * 100).toFixed(1)}%</span>`
        : '';
      el.innerHTML = `<div class="n"><div class="t"></div><div class="a"></div>` +
                     (t.harmonia ? `<div class="a" style="color:${t.harmonicamenteOk ? 'var(--ok)' : 'var(--mut)'}">${t.harmonia}</div>` : '') +
                     `</div><div class="m">${t.bpm ?? '—'}<br>${t.camelot ?? ''}${extra}</div>`;
      el.querySelector('.t').textContent = t.title;
      el.querySelector('.a').textContent = t.artist;
      el.__faixa = t;
      const marca = document.createElement('div');
      marca.className = 'a marca';
      el.querySelector('.n').appendChild(marca);
      // aquece no hover (desktop) ou ao encostar (celular)
      let aquecida = false;
      const aquecer = () => { if (!aquecida) { aquecida = true; prefetch(t.id).catch(() => {}); } };
      el.onpointerenter = aquecer;

      // No celular a lista rola. Se o dedo escorrega alguns pixels, o Chrome
      // trata o gesto como scroll e CANCELA o click — o toque parece não fazer
      // nada. Então aceitamos por pointerup com tolerância de 12 px.
      let px = 0, py = 0, pid = null;
      el.addEventListener('pointerdown', (ev) => {
        px = ev.clientX; py = ev.clientY; pid = ev.pointerId; aquecer();
      });
      el.addEventListener('pointerup', async (ev) => {
        if (ev.pointerId !== pid) return;
        if (Math.hypot(ev.clientX - px, ev.clientY - py) > 12) return;  // foi scroll
        pid = null;
        el.style.borderColor = 'var(--acc)';          // confirma o toque na hora
        try { await ligar(); } catch { return; }      // ligar() já mostrou o erro
        deck.carregarAudius(t);
      });
      lista.appendChild(el);
    }
    repintarLista();
    // as tres primeiras ja aquecem sozinhas: sao as mais provaveis de clicar
    faixas.slice(0, 3).forEach((t) => prefetch(t.id).catch(() => {}));
  } catch (e) {
    lista.innerHTML = `<div class="aviso">Audius indisponível: ${e.message}</div>`;
  }
}
carregarLista(() => trending({ genre: 'House', limit: 40 }));
$('e-ver').textContent = VERSAO;

// Procurar por nome num catalogo independente nao funciona: "french house"
// devolve Rock e Comedy mal etiquetados. Procurar por 122 BPM em 8A funciona.
$('b-compat').onclick = () => {
  if (!deck?.faixa?.bpm) return;
  $('busca').value = '';
  carregarLista(() => compativeis(deck.faixa));
};

// ─────────────────────────── diagnóstico ───────────────────────────
// Sem console no celular e sem conseguir reproduzir o ambiente do usuário,
// esta é a única forma de saber o que aconteceu de verdade em vez de supor.

const problemas = [];
addEventListener('error', (e) => problemas.push('error: ' + e.message));
addEventListener('unhandledrejection', (e) =>
  problemas.push('rejeição: ' + String(e.reason?.message || e.reason)));

const DP = 'https://discoveryprovider.audius.co/v1';

async function sondar(nome, url, opts) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, opts);
    return `${nome}: ${r.status}${r.redirected ? ' REDIR' : ''} em ${Math.round(performance.now() - t0)}ms`;
  } catch (e) { return `${nome}: FALHOU ${e.name} — ${e.message}`; }
}

$('b-diag').onclick = async () => {
  const b = $('b-diag');
  b.textContent = 'checando…';
  const rel = {
    versao: VERSAO,
    fase,
    quando: new Date().toISOString(),
    ua: navigator.userAgent,
    tela: `${innerWidth}x${innerHeight} dpr${devicePixelRatio}`,
    rede: {
      tipo: navigator.connection?.effectiveType,
      downlink: navigator.connection?.downlink,
      rtt: navigator.connection?.rtt,
      economiaDeDados: navigator.connection?.saveData,
    },
    audio: ctx
      ? { estado: ctx.state, sampleRate: ctx.sampleRate,
          baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency }
      : 'NUNCA LIGOU',
    deck: deck
      ? { pronto, temKeylock: deck.temKeylock, estado: deck.estado,
          faixa: deck.faixa?.title, duracao: deck.duration, erro: deck.erro }
      : 'NAO EXISTE',
    passosDaUltimaCarga: deck?.passos ?? [],
    faixasNaLista: document.querySelectorAll('#lista .item').length,
    keylockDisponivel: deck?.temKeylock ?? null,
    tocando: deck?.tocando ?? null,
    nivelMasterAgora: +nivelMaster().toFixed(5),
    picoMasterDesdeOInicio: +picoMaster.toFixed(5),
    volumeDoAparelho: 'so voce consegue ver',
    problemas: problemas.slice(-8),
    sondas: [],
  };

  rel.sondas.push(await sondar('metadata', `${DP}/tracks/trending?genre=House&limit=1&app_name=garimpo`));
  try {
    const j = await (await fetch(`${DP}/tracks/trending?genre=House&limit=1&app_name=garimpo`)).json();
    const id = j.data?.[0]?.id;
    if (id) {
      // Usar resolveStreamUrl, que VERIFICA e sorteia outro validator se
      // precisar — era o que o app ja fazia. A sonda antiga chamava o endpoint
      // cru e reportava falha em faixas que o app carregava sem problema:
      // alarme falso no meu proprio diagnostico.
      const t0 = performance.now();
      const u = await resolveStreamUrl(id);
      rel.sondas.push(`resolve com verificacao: ${new URL(u).host} em ${Math.round(performance.now() - t0)}ms`);
      rel.sondas.push(await sondar('stream 64KB', u, { headers: { Range: 'bytes=0-65535' } }));
    }
  } catch (e) { rel.sondas.push('resolve FALHOU de verdade: ' + e.message); }

  const txt = JSON.stringify(rel, null, 1);
  try {
    await navigator.clipboard.writeText(txt);
    b.textContent = 'copiado — cole no chat';
  } catch {
    $('erro').hidden = false;
    $('erro').style.whiteSpace = 'pre-wrap';
    $('erro').textContent = txt;
    b.textContent = 'não copiou — está na tela';
  }
  setTimeout(() => { b.textContent = 'diagnóstico'; }, 8000);
};
