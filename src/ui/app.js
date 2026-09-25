/**
 * Interface. Não toca no AudioContext, não agenda nada, não calcula posição:
 * só chama métodos do Deck/Mixer e escuta eventos. É o que vai permitir o
 * professor entrar depois como mais um cliente da mesma API.
 */
import { Deck } from '../mix/deck.js';
import { t, idioma, setIdioma, traduzirDOM, IDIOMAS } from './i18n.js';
import { Mixer, erroDeFase } from '../mix/mixer.js';
import { montarPads } from './pads.js';
import * as pastas from '../sources/pastas.js';
import { plano, autoajuste } from '../coach/guia.js';
import { montarFila, resumo as resumoFila } from '../coach/fila.js';
import { momentos, proximoMomento, faltaPara } from '../coach/momentos.js';
import { montarSet, resumoSet } from '../coach/setlist.js';
import * as crate from '../sources/crate.js';
import { garimparLote, LOTE_GENEROS } from '../sources/garimpar.js';
import { carregarSemente, SEMENTES } from '../sources/semente.js';
import { puxar as puxarGalera, votarLixo, puxarLixo, enviarFeedback } from '../sources/galera.js';
import { Piloto } from '../coach/piloto.js';
import { ESTILOS, TECNICAS } from '../coach/tecnicas.js';
import { decidirSet, aplicarDecisoes, julgarFaixas, julgarPassagens } from '../coach/jev.js';
import { criarLeitura } from '../coach/leitura.js';
import { aprender, registrarEstilo, paresBons, quantasBoas, esquecerMeuEstilo } from '../coach/meuestilo.js';
import { montarMascote } from './mascote.js';
import { montarPista } from './pista.js';
import { montarCena } from './cena.js';
import { montarViagem } from './viagem.js';
import { qualidade } from './qualidade.js';
import * as bib from './biblioteca.js';
import { abrirGuia, guiaVisto } from './tour.js';
import { montarControladora } from '../controle/controladora.js';
import {
  trending, search, GENRES, attribution, prefetch, compativeis,
  keyCompatible, resolveStreamUrl, CRATES, crateBr,
} from '../sources/audius.js';
import {
  ehHearthis, atribuicao as atribuicaoHearthis, detalhe as detalheHearthis, aquecer as aquecerHearthis,
} from '../sources/hearthis.js';

/** Faixa do Audius? As da semente antiga não têm `source` e são todas de lá. */
const doAudius = (f) => !!f && (!f.source || f.source === 'audius');

export const VERSAO = '2026-09-12.18';

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
// espectro do master pra pista, o visualizador e o mascote (grave/médio/agudo)
let analisador = null, bufEsp = null, saidaMaster = null;
function lerEspectro() {
  if (!analisador) return null;
  analisador.getByteFrequencyData(bufEsp);
  return bufEsp;
}
let fila = [];   // sequencia sugerida do set
/**
 * Como o DJ toca e de onde. Declarados aqui em cima porque a pintura da
 * biblioteca (que roda cedo) já lê a fonte.
 *   modoDj   'juntos' (padrão: ele conduz e te passa a vez — e se você não
 *            mexer, ele toca o set inteiro sozinho) | 'solo' (você toca; ele
 *            monta o set e só sinaliza). O "só DJ" saiu: o junto já é ele.
 *   fonteDj  'generos' (os marcados) | 'favoritas' (o que tem ♥)
 */
let modoDj = 'juntos', fonteDj = 'generos';
try {
  modoDj = localStorage.getItem('garimpo.dj.modo') || 'juntos';
  if (modoDj !== 'solo') modoDj = 'juntos';      // quem tinha "só DJ" guardado cai no junto
  // a fileira de gêneros do DJ saiu (os gêneros moram no bloco com abas da
  // lista): o ♥ dela virou a ★ da lista, então a fonte começa sempre nos gêneros
  fonteDj = 'generos';
} catch {}

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
      analisador = ctx.createAnalyser();
      analisador.fftSize = 1024;               // 47 Hz por faixa a 48 kHz
      analisador.smoothingTimeConstant = 0.55;
      bufEsp = new Uint8Array(analisador.frequencyBinCount);
      saida.connect(analisador);
      saidaMaster = saida;              // o MilkDrop escuta daqui
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
      globalThis.__garimpo = { decks, mixer, vistas, get ctx() { return ctx; }, get piloto() { return piloto; } };
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

/** A porta do club sai de cena quando o áudio liga — é o mesmo toque. */
const tentarLigar = () => {
  ligar()
    .then(() => {
      if (!$('porta').classList.contains('saiu')) {
        document.body.classList.add('entrou');
        // a cascata acaba e SAI: animação de transform presa no último quadro
        // faz a coluna virar a moldura de tudo que é position:fixed dentro dela
        // — o visualizador em tela cheia ficava do tamanho da coluna
        setTimeout(() => document.body.classList.remove('entrou'), 900);
        // primeira vez: o guia mostra a cabine antes de tudo; no fim dele (ou
        // nas outras vezes, direto) a gaveta abre, que o primeiro passo é
        // escolher música
        const escolher = () => { if (!decks.A?.faixa) abrirBibPara('A'); };
        if (!guiaVisto()) setTimeout(() => abrirGuia({ depois: (fim) => { window.garimpoEvento?.('guia', { fim: fim ? 'sim' : 'pulou' }); escolher(); } }), 700);
        else escolher();
      }
      $('porta').classList.add('saiu');
      return garantirRodando();
    })
    .catch((e) => { $('porta-erro').textContent = t('porta.erro', { e: e?.message || '' }); });
};
for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) addEventListener(ev, tentarLigar);

/**
 * Celular: a cabine é DEITADA. No primeiro toque (é o que o navegador exige),
 * tela cheia e trava deitado — no Android funciona; no iPhone o Safari não
 * deixa travar, e aí fica o aviso "vira o celular" (#girar, só CSS). Uma vez
 * só: se a pessoa sair da tela cheia, é escolha dela.
 */
const celular = matchMedia('(pointer:coarse) and (max-width:1040px), (pointer:coarse) and (max-height:540px)');
function deitar() {
  const el = document.documentElement;
  if (!celular.matches || document.fullscreenElement || !el.requestFullscreen) return Promise.resolve(false);
  return el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation?.lock?.('landscape'))
    .then(() => true, () => false);
}
let jaDeitou = false;
for (const ev of ['touchend', 'click']) {
  addEventListener(ev, () => { if (!jaDeitou) { jaDeitou = true; deitar(); } }, { capture: true });
}
if (document.documentElement.requestFullscreen && screen.orientation?.lock) {
  $('b-girar').hidden = false;
  $('b-girar').onclick = () => deitar();
}
// deitado não existe painel preso do lado: a gaveta sempre flutua
const deitado = matchMedia('(orientation:landscape) and (max-width:1040px)');
const acertarGaveta = () => {
  let fixa = false;
  try { fixa = localStorage.getItem('garimpo.bib.fixa') === '1'; } catch {}
  document.body.classList.toggle('bib-fixa', fixa && !deitado.matches);
};
deitado.addEventListener('change', acertarGaveta);

// ─────────────────────────── um deck ───────────────────────────

function montarVista(id) {
  const no = $('tpl-deck').content.firstElementChild.cloneNode(true);
  no.dataset.d = id;
  no.querySelector('.letra').textContent = id;
  $('deck' + id).replaceWith(no);
  no.id = 'deck' + id;

  const q = (s) => no.querySelector(s);
  q('.browse').onclick = () => abrirBibPara(id);
  q('.onda-modo').textContent = '≋ ' + t('onda.' + modoOnda);
  q('.onda-modo').onclick = trocarModoOnda;
  const v = {
    raiz: no, titulo: q('.titulo'), artista: q('.artista'), capa: q('.capa'),
    bpmVal: q('.bpm-val'), tom: q('.tom'), onda: q('.onda'), mini: q('.mini'),
    jog: q('.jog'), marcaJog: q('.marca-jog'), anelJog: q('.anel-jog'),
    finos: [...no.querySelectorAll('.fino')], auto: q('.auto'),
    loops: [...no.querySelectorAll('.lp')], loopSair: q('.lp-sair'),
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
  v.auto.id = 'auto-' + id;
  v.finos[0].id = 'fino-menos-' + id;
  v.finos[1].id = 'fino-mais-' + id;
  v.fader.id = 'pitch-' + id;
  vistas[id] = v;
  /**
   * ♥ no deck: favorita a música que está NELE. Gostou do que está tocando?
   * Um toque, sem ter que achar a faixa na lista. É daqui que sai o set
   * "♥ favoritas" do DJ.
   */
  const fav = q('.fav');
  v.pintarFav = () => {
    const f = decks[id]?.faixa;
    const on = !!f && bib.ehFavorita(f.id);
    fav.classList.toggle('lig', on);
    fav.textContent = on ? '♥' : '♡';
    fav.disabled = !f;
  };
  /** 👎 isto não é música: sai do garimpo daqui e vale um voto pra galera. */
  q('.lixo').onclick = () => {
    const f = decks[id]?.faixa;
    if (!f?.id) return;
    bib.marcarLixo([f.id]);
    votarLixo([f.id], 'gente');
    v.artista.textContent = t('deck.lixoFeito');
    recarregar();
  };
  fav.onclick = () => {
    const f = decks[id]?.faixa;
    if (!f) return;
    bib.alternarFavorita(f);
    v.pintarFav();
    fav.classList.add('pulou');
    setTimeout(() => fav.classList.remove('pulou'), 220);
    repintarLista();
    pintarBiblioteca();
  };
  v.pintarFav();
  const d = decks[id];

  // ── eventos do deck ──
  d.addEventListener('loading', (e) => {
    if (e.detail.estado !== 'carregando') return;
    v.titulo.textContent = e.detail.faixa?.title || '…';
    v.artista.textContent = t('deck.carregando');
    v.erro.hidden = true;
  });

  d.addEventListener('loaded', (e) => {
    const { faixa, duration, parcial, trocado } = e.detail;
    v.titulo.textContent = faixa.title;
    v.artista.textContent = faixa.artist + (parcial ? t('deck.parcial') : '');
    v.dur.textContent = fmt(duration);
    v.capa.src = faixa.artwork || '';
    v.capa.style.visibility = faixa.artwork ? 'visible' : 'hidden';
    // faixa vinda do acervo embarcado não traz capa (ver semente.js): busca uma
    // só, agora que ela está de fato na tela
    if (!faixa.artwork && faixa.id) buscarCapa(faixa, v);
    v.bpmVal.textContent = faixa.bpm ?? '—';
    v.tom.innerHTML = faixa.camelot ? `<b>${faixa.camelot}</b> ${faixa.key}` : '—';
    v.pintarFav();
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
      // pela fonte da faixa: mandar tudo pro Audius fazia a nova tentativa de
      // uma faixa do hearthis (ou de uma pasta) falhar de novo, sempre
      if (e.detail.faixa?.id) carregarFaixa(id, e.detail.faixa);
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
    const { faixa, bpm, camelot, tom, trimDb, volumeDb } = e.detail;
    // GANHO AUTOMATICO: faixas do Audius vem com volumes muito diferentes — medi
    // uma 7x mais baixa que a outra. Sem igualar, toda transicao vira degrau.
    if (typeof trimDb === 'number' && mixer) {
      mixer.canal(id).setTrim(trimDb);
      v.efeito.dataset.vol = `${volumeDb} dBFS, trim ${trimDb >= 0 ? '+' : ''}${trimDb} dB`;
    }
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
    // ÷2, ×2 ou digitado: a grade de batidas escala junto, senão o SYNC e o
    // ENCAIXAR continuariam no andamento errado
    if (d.grid?.bpm && d.faixa.bpm) d.grid.bpm *= val / d.faixa.bpm;
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
    /**
     * Fecha UMA vez. O Enter aplica direto — antes ele só chamava blur(), e se
     * o campo nunca tinha pegado o foco (outro campo roubou, janela sem foco)
     * o blur não disparava: o campo ficava preso na tela e o BPM não mudava.
     */
    let fechado = false;
    const fechar = (aplicar) => {
      if (fechado) return;
      fechado = true;
      const val = parseFloat(inp.value.replace(',', '.'));
      inp.replaceWith(v.bpmVal);
      if (aplicar) setBpm(val);
    };
    inp.onblur = () => fechar(true);
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); fechar(true); }
      if (e.key === 'Escape') fechar(false);
    };
  };

  v.mini.onclick = (e) => {
    if (!d.duration) return;
    const r = v.mini.getBoundingClientRect();
    d.seek(((e.clientX - r.left) / r.width) * d.duration);
  };

  ligarJog(id);
  ligarFinos(id);
  ligarAuto(id);
  ligarLoops(id);
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
  if (!a?.bpmNatural || !b?.bpmNatural) {
    qd('dica').textContent = 'SYNC precisa de BPM nos dois decks';
    return;
  }
  // pelo andamento MEDIDO dos dois (ver Deck.bpmNatural), não pelo do Audius
  const alvo = b.bpmEfetivo;
  let razao = alvo / a.bpmNatural;
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

/**
 * O jog, com DUAS zonas — e é isto que conserta "o jog é sensível demais".
 *
 * O problema nunca foi a física do scratch: 1 volta = 1.8 s é o que um vinil a
 * 33⅓ rpm faz de verdade. O problema é que o prato aqui tem 100 px, então um
 * peteleco de 40 px já move 0.25 s de áudio — e não existia lugar nenhum onde
 * errar a mão não estragasse o som.
 *
 * Agora existe:
 *
 *   anel de fora (r > 0.58)  →  AJUSTE FINO. É um pitch bend: a música continua
 *                               tocando e só acelera/freia de leve. 1 volta
 *                               inteira vale 0.25 s, 7× menos que o centro, e o
 *                               desvio de taxa é preso em ±18%. Não dá pra
 *                               estragar: o pior caso é ficar 18% fora por um
 *                               instante, que se ouve como um empurrão.
 *   centro       (r ≤ 0.58)  →  SCRATCH, inalterado. Quem quer parar a música
 *                               com a mão continua podendo.
 *
 * A zona é decidida no pointerdown e não muda no meio do gesto: trocar de modo
 * com o dedo no ar é como se perde a referência.
 */
function ligarJog(id) {
  const d = decks[id], jog = vistas[id].jog;
  let girando = false, angAnt = 0, tAnt = 0, modo = 'scratch';

  const geo = () => {
    const r = jog.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, raio: r.width / 2 };
  };
  const ang = (e, g) => Math.atan2(e.clientY - g.cy, e.clientX - g.cx);

  jog.addEventListener('pointerdown', (e) => {
    if (!pronto) return;
    const g = geo();
    const dist = Math.hypot(e.clientX - g.cx, e.clientY - g.cy) / g.raio;
    modo = dist > 0.58 ? 'fino' : 'scratch';
    jog.setPointerCapture(e.pointerId);
    girando = true;
    jog.classList.add('ativo', modo);
    angAnt = ang(e, g); tAnt = e.timeStamp;
    d.touchStart();
  });

  jog.addEventListener('pointermove', (e) => {
    if (!girando) return;
    const g = geo();
    const base = d.tocando ? d.nominalRate : 0;
    // eventos aglomerados + timeStamp de cada um: usar o relogio do rAF pro dt
    // da velocidade ruidosa e o prato fica mole
    for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
      const a = ang(ev, g);
      let dd = a - angAnt;
      if (dd > Math.PI) dd -= 2 * Math.PI;
      if (dd < -Math.PI) dd += 2 * Math.PI;
      const dt = Math.max(0.001, (ev.timeStamp - tAnt) / 1000);
      angAnt = a; tAnt = ev.timeStamp;
      const voltas = dd / (2 * Math.PI);

      if (modo === 'fino') {
        // pitch bend: a taxa nominal mais um desvio pequeno e preso
        const desvio = Math.max(-0.18, Math.min(0.18, (voltas * SEG_POR_VOLTA_FINA) / dt));
        d.setScratchRate(base + desvio);
      } else {
        const taxa = voltas * SEG_POR_VOLTA_SCRATCH / dt;
        d.setScratchRate(Math.abs(taxa) < 0.02 ? 0 : taxa);
      }
    }
  });

  const soltar = (e) => {
    if (!girando) return;
    girando = false;
    jog.classList.remove('ativo', 'fino', 'scratch');
    try { jog.releasePointerCapture(e.pointerId); } catch {}
    d.touchEnd();
  };
  jog.addEventListener('pointerup', soltar);
  jog.addEventListener('pointercancel', soltar);
  jog.addEventListener('lostpointercapture', soltar);
}

/**
 * Loop — o efeito que mais serve numa transição de verdade.
 *
 * Segura a faixa que está saindo numa frase de 4, 8 ou 16 tempos enquanto a
 * outra entra, e você deixa de depender de a música ter comprimento suficiente.
 * É também o único efeito que não colore o som: não some nada, não distorce
 * nada, só repete — por isso é o primeiro a existir aqui.
 *
 * Tocar no botão que já está aceso sai do loop. Tocar em outro tamanho troca o
 * tamanho sem sair, que é como se faz "fechando" um loop de 8 pra 4 pra 2
 * quando a transição está no ponto.
 */
function ligarLoops(id) {
  const d = decks[id], v = vistas[id];
  const pintar = () => {
    for (const b of v.loops) b.classList.toggle('lig', d.loopTempos === Number(b.dataset.tempos));
    v.loopSair.classList.toggle('pode', !!d.loopTempos);
  };
  for (const b of v.loops) {
    b.onclick = () => {
      const n = Number(b.dataset.tempos);
      if (d.loopTempos === n) { d.clearLoop(); }
      else if (!d.loopDeTempos(n)) {
        qd('dica').textContent = t('fx.semGrade');
        return;
      }
      pintar();
    };
  }
  v.loopSair.onclick = () => { d.clearLoop(); pintar(); };
  d.addEventListener('loaded', () => { d.clearLoop(); pintar(); });
  // loop que veio de fora (o piloto, a controladora): acende o botão certo
  d.addEventListener('loop', pintar);
}

/** 1 volta no anel vale isto de áudio. Baixo de proposito: é o ajuste fino. */
const SEG_POR_VOLTA_FINA = 0.25;
/** 1 volta no centro vale isto. É o vinil de verdade a 33⅓ rpm. */
const SEG_POR_VOLTA_SCRATCH = 1.8;

/**
 * Botões de milissegundo — o ajuste que não precisa de mão firme nenhuma.
 *
 * Um clique desloca 5 ms. Segurar repete, e acelera até 20 ms por passo, porque
 * quando o erro é de 200 ms ninguém vai clicar 40 vezes.
 */
function ligarFinos(id) {
  const d = decks[id];
  for (const b of vistas[id].finos) {
    const dir = Number(b.dataset.dir);
    let t = null, n = 0;
    const passo = () => {
      if (!d?.faixa) return;
      const ms = Math.min(20, 5 + n * 1.5);
      d.deslocar(dir * ms / 1000, { emSeg: 0.25 });
      n++;
      t = setTimeout(passo, n < 3 ? 260 : 110);
    };
    const parar = () => { clearTimeout(t); t = null; n = 0; };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); n = 0; passo(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, parar);
  }
}

/**
 * AUTO — o autoajuste discreto, pra quando você só quer ouvir.
 *
 * Faz UMA coisa e deliberadamente não mais: mantém andamento e fase no lugar.
 * Cortar grave, abrir crossfader e escolher a próxima música continuam suas,
 * porque essas são decisões musicais e não erros mensuráveis — e um piloto que
 * toma decisão musical por você não ensina nada.
 *
 * Corrige devagar (um décimo do erro por ciclo, no máximo 12 ms) pra que a
 * correção seja inaudível. Um salto de 200 ms de uma vez se ouve; 20 correções
 * de 10 ms, não.
 */
const autoLigado = { A: false, B: false };
let tAuto = 0;

function ligarAuto(id) {
  vistas[id].auto.onclick = () => {
    autoLigado[id] = !autoLigado[id];
    vistas[id].auto.classList.toggle('lig', autoLigado[id]);
    vistas[id].auto.title = t(autoLigado[id] ? 'deck.auto.lig' : 'deck.auto.dica');
  };
}

function rodarAuto(est) {
  if (performance.now() - tAuto < 420) return;     // devagar: correção tem que ser inaudível
  tAuto = performance.now();
  for (const id of ['A', 'B']) {
    if (!autoLigado[id] || !decks[id]?.faixa) continue;
    for (const a of autoajuste(est, id)) {
      if (a.o === 'sync') { sincronizar(id); }
      else if (a.o === 'deslocar') {
        const ms = Math.max(-12, Math.min(12, a.ms * 0.35));
        decks[id].deslocar(ms / 1000, { emSeg: 0.3 });
      }
    }
  }
}

// ─────────────────────────── mixer ───────────────────────────

/**
 * A TELA ESPELHA O MOTOR, ~15 vezes por segundo.
 *
 * Os controles só mudavam quando a MÃO mexia. Quando o DJ automático cortava
 * um grave ou girava um EQ, o som mudava e a tela não — ele dizia "troquei os
 * agudos" e o knob ficava parado, e o × do grave cortado continuava apagado.
 * Pra quem estava olhando, ele mentia. Agora a tela lê do motor: o que se vê
 * é o que se ouve. O controle que a pessoa está arrastando não é tocado.
 */
let tEspelho = 0, arrastado = null;
setInterval(() => { if (!document.hidden || globalThis.__varrendo) espelharMixer(performance.now()); }, 80);
addEventListener('pointerdown', (e) => { if (e.target?.type === 'range') arrastado = e.target; }, true);
addEventListener('pointerup', () => { arrastado = null; }, true);
addEventListener('pointercancel', () => { arrastado = null; }, true);
function espelharMixer(agora) {
  if (!mixer || agora - tEspelho < 66) return;
  tEspelho = agora;
  const igualar = (el, v) => {
    if (!el || v == null || el === arrastado) return;
    if (Math.abs(Number(el.value) - v) > 0.004) el.value = v;
  };
  for (const d of ['A', 'B']) {
    const c = mixer.canal(d);
    for (const b of ['grave', 'medio', 'agudo']) {
      $(`kill-${d}-${b}`)?.classList.toggle('lig', c.eq.morto(b));
      igualar($(`eq-${d}-${b}`), c.eq.posicao(b));
    }
    igualar($(`fil-${d}`), c.filtro?.k);
    igualar($(`vol-${d}`), c.valores.fader);
    igualar($(`eco-${d}`), c.valores.eco);
  }
  igualar($('xf'), mixer.crossfader);
  igualar($('master'), mixer.valorMaster);   // a controladora também mexe no volume geral
  for (const d of ['A', 'B']) {
    const dk = decks[d], faixa = dk?.transport?.pitchRange;
    if (faixa) igualar($('pitch-' + d), -dk.pitch / faixa);
  }
}

function ligarMixer() {
  document.querySelectorAll('[data-eq]').forEach((el) => {
    el.oninput = () => mixer.canal(el.dataset.d).setEq(el.dataset.eq, Number(el.value));
  });
  document.querySelectorAll('[data-kill]').forEach((b) => {
    b.onclick = () => {
      // lê o MOTOR, não a cor do botão: se o DJ cortou o grave, o botão pode
      // estar desatualizado, e inverter a cor cortava de novo em vez de soltar
      const on = !mixer.canal(b.dataset.d).eq.morto(b.dataset.kill);
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

let ultimoProf = 0, ultimaLista = '', apontados = [];

/**
 * A última coisa que o DJ automático disse (ver `#narra` no piloto.js e os
 * campos `diz`/`porque`/`mostra` das técnicas). Vira um item do professor:
 * mesma barra, mesma luz no controle — o DJ ensina pelo mesmo canal.
 */
let narracao = null, nNarracao = 0;
/**
 * O que a controladora de DJ tem a dizer ("senti sua DDJ-FLX4", "seu knob está
 * em outro lugar"): entra no topo do professor por alguns segundos, com a luz
 * no controle da tela — o Garimpeiro fala da mão da pessoa pelo mesmo canal.
 */
let avisoCtl = null;
function avisoControladora({ fala, porque = null, apontar = [], cor = 'agora', ms = 7000 }) {
  avisoCtl = { ate: performance.now() + ms, item: { id: 'ctl:' + (++nNarracao), cor, fala, porque, apontar } };
  ultimoProf = 0;
}
function itemNarracao(n) {
  return {
    // o número muda a cada fala: é o que faz a luz reacender no controle novo
    id: 'dj:' + n.k,
    // rosa = sua vez · violeta = o DJ mexeu (a legenda fica na barra do professor)
    cor: n.vez ? 'urgente' : n.acertou ? 'depois' : 'dj',
    fala: '🎧 ' + t(n.diz, n.vars),
    porque: n.porque ? t(n.porque, n.vars) : (n.vars?.ia ? 'Jev: ' + n.vars.ia : null),
    apontar: n.mostra || [],
  };
}
// declarado aqui e montado no fim do arquivo: o professor roda antes disso
let mascote = null;

/**
 * Desenha o plano do professor e ACENDE os controles, na cor e com o numero.
 *
 * Mudou de um passo pra uma lista de até 3 porque quando três coisas estão
 * erradas ao mesmo tempo, mostrar só uma esconde o que é urgente. E a luz no
 * controle passou a carregar a COR e o NÚMERO do item: sem isso, com dois
 * controles acesos, não havia como saber qual frase era de qual botão — foi
 * exatamente a reclamação de quem não conhece a controladora.
 *
 * É o mesmo mecanismo que os "controles fantasma" vão usar na Fase 6.
 */
function rodarProfessor() {
  const est = montarEstado();
  rodarAuto(est);
  // a leitura só vale pra quem TOCA: com o DJ mixando, as transições são dele
  if (piloto?.ativo) leitura?.zerar();
  else {
    const q = quadroLeitura(est); leitura?.passo(q); est.saiu = leitura?.saiuDe(q);
    /**
     * A que ACABOU de sair ainda toca, com o grave cortado, do outro lado do
     * crossfader. Pras regras ela é um deck LIVRE: senão cada uma achava que
     * havia transição acontecendo ("encaixe a batida", "traga o crossfader")
     * sobre uma música que já saiu. O certo agora é escolher a próxima.
     */
    if (est.saiu && est[est.saiu]) {
      est[est.saiu] = { ...est[est.saiu], tocando: false, temFaixa: false };
      est.ambosAudiveis = false; est.fase = null;
    }
  }

  let itens = plano(est);
  // com o DJ automático tocando, a barra vira a NARRAÇÃO dele: o que acabou
  // de fazer, por quê, e o controle aceso. As regras do professor ficam
  // quietas — senão ele reclamaria dos graves que o próprio DJ está trocando.
  if (piloto?.ativo && narracao) {
    // o que é URGENTE continua aparecendo, mesmo com o DJ no comando: grave
    // cortado no deck que toca sozinho, som estourando, áudio caído
    const urgentes = itens.filter((i) => ['grave-esquecido', 'limitador', 'audio'].includes(i.id));
    itens = [...urgentes, itemNarracao(narracao)].slice(0, 3);
  }
  // a controladora fala pelo mesmo canal, por alguns segundos (ver avisoControladora)
  if (avisoCtl && performance.now() < avisoCtl.ate) itens = [avisoCtl.item, ...itens].slice(0, 3);

  // o Garimpeiro: lâmpada na cor do conselho mais urgente, e dança no BPM
  // do deck que está no ar — sem precisar ler texto
  if (mascote) {
    mascote.humor(itens[0]?.cor || null);
    const noAr = decks.A?.tocando && (mixer?.crossfader ?? 0.5) <= 0.5 ? decks.A
               : decks.B?.tocando ? decks.B : decks.A?.tocando ? decks.A : null;
    mascote.batida(noAr?.bpmEfetivo || 0);
  }
  /**
   * A chave de redesenho é a ESTRUTURA do plano, não o texto.
   *
   * Era `id + fala`, e a fala tem número vivo: "134 ms fora", "acaba em 18s",
   * "em 12 tempos". Então a chave mudava a cada 220 ms, e a cada 220 ms o
   * professor apagava e reacendia todas as luzes e etiquetas — a animação
   * reiniciava e os botões pareciam tremer. Foi o que quem usa viu.
   *
   * Agora: se só o texto mudou, troca o texto no lugar e não mexe em classe
   * nenhuma. Luz só apaga e acende quando muda QUAL ajuste está na lista.
   */
  const chave = itens.map((i) => i.id + ':' + (i.apontar || []).map((a) => a.id).join(',')).join('|');
  if (chave === ultimaLista) {
    const els = $('prof-plano').querySelectorAll('.item .txt');
    itens.forEach((it, k) => {
      const html = it.fala + (it.porque ? `<small data-por="${t('prof.porque')}">${it.porque}</small>` : '');
      if (els[k] && els[k].innerHTML !== html) els[k].innerHTML = html;
    });
    return;
  }
  ultimaLista = chave;
  // disse uma coisa nova: o Garimpeiro mexe a boca — é ELE falando
  mascote?.fala();

  const cx = $('prof-plano');
  cx.innerHTML = itens.length
    ? itens.map((it, k) => `<div class="item c-${it.cor}"><i>${k + 1}</i><div class="txt">${it.fala}` +
        (it.porque ? `<small data-por="${t('prof.porque')}">${it.porque}</small>` : '') + '</div></div>').join('')
    : '<div class="item c-depois"><i>✓</i><div class="txt">Está tudo no lugar. ' +
      '<b>Ouça</b> e sinta a música.<small>Quando não há nada pra corrigir, o trabalho é escutar.</small></div></div>';
  $('prof').classList.toggle('azul', itens[0]?.cor === 'depois');

  // apaga o que estava aceso
  for (const el of apontados) {
    el.classList.remove('apontado', 'c-urgente', 'c-agora', 'c-depois', 'c-dj');
    el.removeAttribute('data-rotulo');
  }
  /**
   * Acende SÓ NA COR. Havia uma etiqueta de texto pendurada em cada controle
   * aceso ("o DJ mexeu aqui", "sua vez", "1 · PLAY…") e, com dois ou três
   * ajustes ao mesmo tempo, elas cobriam os próprios controles. A frase já
   * está na barra do professor; no controle basta a cor — e a legenda das
   * cores fica lá em cima.
   */
  apontados = [];
  itens.forEach((it) => {
    for (const alvo of it.apontar || []) {
      const el = $(typeof alvo === 'string' ? alvo : alvo.id);
      if (!el) continue;
      el.classList.add('apontado', 'c-' + it.cor);
      apontados.push(el);
    }
  });
}

/**
 * O estado que o professor lê. Uma fonte só, e nenhuma regra faz conta de áudio
 * por conta própria — é o que impede o professor de discordar da realidade.
 */
/**
 * Quanto tempo de audio se perdeu no ultimo minuto.
 *
 * Contagem cumulativa nao serve de aviso: ela so cresce, e depois de meia hora
 * qualquer limiar estoura. O que importa e a taxa recente.
 */
const historicoFalhas = [];
function taxaDeFalhas() {
  const ms = Math.max(decks.A?.transport.ultimoAnchor?.glitchMs || 0,
                      decks.B?.transport.ultimoAnchor?.glitchMs || 0);
  const agora = performance.now();
  historicoFalhas.push({ agora, ms });
  while (historicoFalhas.length > 1 && agora - historicoFalhas[0].agora > 60000) historicoFalhas.shift();
  const velho = historicoFalhas[0];
  const janela = (agora - velho.agora) / 60000;
  return janela > 0.15 ? (ms - velho.ms) / janela : 0;   // precisa de 9 s de historico
}

function montarEstado() {
  const est = {
    audioOk: pronto && ctx?.state === 'running',
    crossfader: mixer?.crossfader ?? 0.5,
    fase: medirEncaixe(),
    eq: { A: { grave: mixer?.canal('A').eq.get('grave') },
          B: { grave: mixer?.canal('B').eq.get('grave') } },
    reducao: mixer?.reducao ?? 0,
    nivelA: mixer?.canal('A').nivel ?? 0,
    nivelB: mixer?.canal('B').nivel ?? 0,
    // o medidor é PRÉ-fader; sem a posição do fader o professor não sabe o que
    // de fato sai, e pedia "suba o volume" com o fader já no máximo
    faderA: mixer?.canal('A').valores.fader ?? 1,
    faderB: mixer?.canal('B').valores.fader ?? 1,
    // os dois decks contam o MESMO buraco (e da thread de audio, nao do deck),
    // entao somar contava duas vezes. O maximo e a contagem real.
    glitches: Math.max(decks.A?.transport.ultimoAnchor?.glitchCount || 0,
                       decks.B?.transport.ultimoAnchor?.glitchCount || 0),
    glitchMsPorMin: taxaDeFalhas(),
  };
  for (const id of ['A', 'B']) {
    const d = decks[id];
    est[id] = d ? {
      temFaixa: !!d.faixa, tocando: d.tocando, bpm: d.faixa?.bpm,
      camelot: d.faixa?.camelot, grid: d.grid, pitch: d.pitch, bpmEfetivo: d.bpmEfetivo,
      restante: d.duration - d.displayPosition,
      keylockPedido: d.keylockPedido, keylockAtivo: d.keylockAtivo,
      motivoKeylock: d.transport?.motivoSemKeylock,
    } : null;
  }
  est.ambosAudiveis = est.A?.tocando && est.B?.tocando &&
                      est.crossfader > 0.12 && est.crossfader < 0.88;

  // ── momento de virada chegando ──
  // quem ainda nao esta no ar procura DROP (hora de trazer); quem ja esta
  // dividindo o som procura QUEBRA (hora de tirar)
  for (const id of ['A', 'B']) {
    if (!est[id]?.tocando) continue;
    const pra = est.ambosAudiveis ? 'sair' : 'entrar';
    const m = proximoMomento(momentosDe[id], decks[id].displayPosition, { pra, antecedencia: 1 });
    const f = faltaPara(m, decks[id]);
    if (m && f && f.seg < 22) est[id].momento = { ...m, ...f, deck: id };
  }
  return est;
}

function nivelMaster() {
  if (!medidor) return 0;
  medidor.getFloatTimeDomainData(bufMed);
  let s = 0;
  for (let i = 0; i < bufMed.length; i++) s += bufMed[i] * bufMed[i];
  return Math.sqrt(s / bufMed.length);
}

/**
 * Momentos de virada por deck. Recalculados só quando a análise muda — são
 * ~40 frases por faixa, não vale refazer a 60 Hz.
 */
const momentosDe = { A: [], B: [] };
export function recalcularMomentos(id) {
  momentosDe[id] = momentos(decks[id]);
  return momentosDe[id];
}

/**
 * A ONDA COLORIDA POR FREQUÊNCIA. Três jeitos de ver, trocados no ≋ do deck
 * (vale pros dois e fica guardado):
 *   bandas   estilo rekordbox: grave azul atrás, médio âmbar, agudo branco na
 *            frente — o grave aparecendo e sumindo é o que guia a troca de
 *            graves, e aqui ele salta aos olhos
 *   rgb      estilo Serato: uma cor por trecho, grave puxa pro vermelho,
 *            médio pro verde, agudo pro azul
 *   energia  a de antes: cor pela intensidade
 */
const MODOS_ONDA = ['bandas', 'rgb', 'energia'];
let modoOnda = 'bandas';
try { if (MODOS_ONDA.includes(localStorage.getItem('garimpo.onda'))) modoOnda = localStorage.getItem('garimpo.onda'); } catch {}
const COR_BANDA = { grave: '#2f6bff', medio: '#ffa531', agudo: '#f2f4ff' };
function trocarModoOnda() {
  modoOnda = MODOS_ONDA[(MODOS_ONDA.indexOf(modoOnda) + 1) % MODOS_ONDA.length];
  try { localStorage.setItem('garimpo.onda', modoOnda); } catch {}
  for (const id of ['A', 'B']) {
    const b = vistas[id]?.raiz.querySelector('.onda-modo');
    if (b) b.textContent = '≋ ' + t('onda.' + modoOnda);
    if (decks[id]) desenharMini(id);
  }
}

function desenharOnda(id) {
  const d = decks[id], v = vistas[id];
  const dpr = ajustar(v.onda);
  const c = v.ctxOnda, L = v.onda.width, A = v.onda.height;
  // transparente: o fundo translúcido do CSS deixa a pista aparecer por trás
  c.clearRect(0, 0, L, A);
  const pos = d.displayPosition;
  if (!d.picos) {
    // deck vazio: uma linha parada no meio, em vez de um buraco preto
    c.fillStyle = 'rgba(255,255,255,.07)';
    c.fillRect(0, A / 2, L, dpr);
  }

  if (d.picos) {
    const { min, max, rms, binsPorSegundo, grave, medio, agudo } = d.picos;
    const meio = A / 2, pxSeg = L / SEG_VISIVEL, de = pos - SEG_VISIVEL / 2;
    const binDe = (x) => Math.floor((de + (x / L) * SEG_VISIVEL) * binsPorSegundo);
    const modo = grave ? modoOnda : 'energia';
    /**
     * Um passo por pixel de TELA, não por pixel do canvas: numa tela de alta
     * densidade são 2 pixels de canvas por pixel visível, e desenhar os dois
     * é trabalho que o olho não vê. E cada banda vira UM desenho (um path com
     * todos os retângulos, um fill só) em vez de centenas de fillRect.
     * É a conta que mais se repete por quadro: 3 bandas x 2 decks x cada coluna.
     */
    const passo = Math.max(1, Math.round(dpr));
    if (modo === 'bandas') {
      const { refG, refM, refA } = d.picos;
      const bandas = [[grave, refG, 1, COR_BANDA.grave], [medio, refM, 0.78, COR_BANDA.medio], [agudo, refA, 0.5, COR_BANDA.agudo]];
      for (const [arr, ref, teto, cor] of bandas) {
        c.beginPath();
        for (let x = 0; x < L; x += passo) {
          const b = binDe(x);
          if (b < 0 || b >= min.length) continue;
          const amp = Math.max(max[b], -min[b]) * meio * 0.95;
          const h = amp * teto * Math.min(1, arr[b] / ref);
          if (h >= 0.5) c.rect(x, meio - h, passo, h * 2);
        }
        c.fillStyle = cor;
        c.fill();
      }
    } else {
      const { refG, refM, refA } = d.picos;
      for (let x = 0; x < L; x += passo) {
        const b = binDe(x);
        if (b < 0 || b >= min.length) continue;
        const hi = max[b] * meio * 0.95, lo = min[b] * meio * 0.95;
        if (modo === 'rgb') {
          const g = Math.min(1, grave[b] / refG), m = Math.min(1, medio[b] / refM), a = Math.min(1, agudo[b] / refA);
          const s = Math.max(g, m, a, 0.001);
          c.fillStyle = `rgb(${(g / s * 255) | 0},${(m / s * 235) | 0},${(a / s * 255) | 0})`;
        } else {
          const e = Math.min(1, rms[b] * 3.2);
          c.fillStyle = `hsl(${210 - e * 190} 85% ${34 + e * 26}%)`;
        }
        c.fillRect(x, meio - hi, passo, Math.max(1, hi - lo));
      }
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
    /**
     * Momentos de virada. É a resposta pra "como você achou a hora certa":
     * eu entrava em múltiplo de frase, e agora dá pra ver onde elas caem.
     *   ▲ verde  = drop, a música abrindo — hora de TRAZER a próxima
     *   ▼ rosa   = quebra, a música fechando — hora de TIRAR esta
     *   traço    = limite de frase comum
     */
    for (const m of momentosDe[id] || []) {
      if (m.t < de || m.t > de + SEG_VISIVEL) continue;
      const x = (m.t - de) * pxSeg;
      if (m.tipo === 'frase' && !m.bloco) continue;   // só os de bloco, senão polui
      const cor = m.tipo === 'drop' ? '#2ee6a8' : m.tipo === 'quebra' ? '#ff4ecd' : 'rgba(255,255,255,.3)';
      c.fillStyle = cor;
      c.fillRect(x - dpr / 2, 0, dpr, A);
      if (m.tipo !== 'frase') {
        const s = 5 * dpr, y = m.tipo === 'drop' ? s + 1 : A - s - 1;
        c.beginPath();
        c.moveTo(x, m.tipo === 'drop' ? 1 : A - 1);
        c.lineTo(x - s, y); c.lineTo(x + s, y); c.closePath(); c.fill();
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
  c.clearRect(0, 0, L, A);
  if (!d.picos) return;
  const { min, max, grave, medio, agudo, refG, refM, refA } = d.picos, meio = A / 2;
  const porBanda = grave && modoOnda !== 'energia';
  if (!porBanda) c.fillStyle = id === 'A' ? '#3d5a7a' : '#7a5f3d';
  for (let x = 0; x < L; x++) {
    const b = Math.floor((x / L) * min.length);
    if (porBanda) {
      // a cor do trecho é a mistura das três bandas, pesada pela energia de cada
      const g = Math.min(1, grave[b] / refG), m = Math.min(1, medio[b] / refM), a = Math.min(1, agudo[b] / refA);
      const s = g + m + a || 1;
      c.fillStyle = `rgb(${((g * 47 + m * 255 + a * 242) / s) | 0},${((g * 107 + m * 165 + a * 244) / s) | 0},${((g * 255 + m * 49 + a * 255) / s) | 0})`;
    }
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

  const e = medirEncaixe();
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
  // O rastro tecnico e ferramenta MINHA de depuracao. So aparece quando algo
  // falha; no caminho feliz ele e ruido na cara de quem so quer mixar.
  if (!falhou || !passos?.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = passos.map((p) =>
    `<div class="${p.nome === 'FALHOU' ? 'ruim' : ''}">` +
    `<span class="ms">${p.ms}ms</span><span class="nm">${p.nome}</span><span>${p.detalhe ?? ''}</span></div>`).join('');
  if (!falhou) setTimeout(() => { if (!el.querySelector('.ruim')) el.hidden = true; }, 8000);
}

function mostrarCreditos(faixa) {
  if (ehHearthis(faixa)) {
    // o crédito que o hearthis pede: o artista e o link pra faixa lá. Montado
    // com textContent porque o nome vem de quem subiu a música
    const a = atribuicaoHearthis(faixa);
    const el = $('creditos');
    el.textContent = a.artist + ' · ';
    const link = document.createElement('a');
    link.href = a.trackUrl; link.target = '_blank'; link.rel = 'noopener';
    link.textContent = 'ouvir no hearthis.at';
    el.appendChild(link);
    if (a.license) el.appendChild(document.createTextNode(' · ' + a.license));
    return;
  }
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
    el.__pintarEstrela?.();
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
  $('b-fila').disabled = !base?.bpm;
  if (fila.length) desenharFila();
  $('b-compat').textContent = base?.bpm
    ? `mixa com ${base.bpm} ${base.camelot || ''}` : 'carregue uma faixa';
}

/**
 * Só a busca MAIS RECENTE desenha a lista.
 *
 * As buscas são assíncronas e levam tempos diferentes (uma varredura do acervo
 * custa ~775 ms). Sem esta trava, trocar de gênero rápido fazia uma busca
 * antiga terminar depois e sobrescrever a nova — medido: a lista mostrou 300
 * faixas no modo "só favoritas", que tinha 3.
 */
let pedidoLista = 0;

/**
 * Cor do selo de tom: a posição na roda de Camelot vira matiz (12 posições,
 * 30° cada). Tons vizinhos na roda saem com cores vizinhas, então "casa pelo
 * tom" dá pra ver de relance, sem ler o código. Maior (B) sai mais claro.
 */
function corDoTom(camelot) {
  const m = /^(\d{1,2})([AB])$/.exec(camelot || '');
  if (!m) return '';
  return ` style="--h:${(Number(m[1]) - 1) * 30}"`;
}

async function carregarLista(fn) {
  const meu = ++pedidoLista;
  const lista = $('lista');
  lista.innerHTML = '<div style="color:var(--mut);padding:8px">buscando…</div>';
  try {
    // `faixa`, nao `t`: `t` e a funcao de traducao, e uma variavel de laco com
    // esse nome sombreava ela dentro do laco. A lista parava de carregar com
    // "t is not a function" — e so parou depois que a estrela passou a chamar
    // t() ali dentro, entao o bug nasceu longe da causa.
    const faixas = (await fn()).filter((x) => !x.isLongMix);
    if (meu !== pedidoLista) return;      // chegou atrasada: já pediram outra
    lista.innerHTML = '';
    if (!faixas.length) { lista.innerHTML = '<div style="color:var(--mut);padding:8px">nada aqui</div>'; return; }
    for (const faixa of faixas) {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `<div class="n"><div class="t"></div><div class="a"></div><div class="a marca"></div></div>
        <div class="m"><span class="bpm-b">${faixa.bpm ?? '—'}</span><span class="tom-b"${corDoTom(faixa.camelot)}>${faixa.camelot ?? ''}</span></div>
        <button class="fixar" title="">★</button>
        <button class="pasta-b" title="">📁</button>
        <div class="carregar"><button class="pa">A</button><button class="pb">B</button></div>`;
      el.querySelector('.t').textContent = faixa.title;
      el.querySelector('.a').textContent = faixa.artist + (ehHearthis(faixa) ? ' · hearthis' : '');
      el.__faixa = faixa;

      // cada fonte aquece do seu jeito, e arquivo de pasta não aquece. Mandar
      // tudo pro prefetch do Audius gastava quatro tentativas com id alheio
      const doHt = ehHearthis(faixa);
      let aquecida = !doHt && !doAudius(faixa);
      const aquecer = () => {
        if (aquecida) return;
        aquecida = true;
        if (doHt) aquecerHearthis(faixa); else prefetch(faixa.id).catch(() => {});
      };
      // no hearthis aquecer já é baixar: só quando o ponteiro PARA no item
      let parado = null;
      el.onpointerenter = () => { if (doHt) parado = setTimeout(aquecer, 250); else aquecer(); };
      el.onpointerleave = () => clearTimeout(parado);
      el.addEventListener('pointerdown', aquecer);

      const por = async (id) => {
        try { await ligar(); } catch { return; }
        await garantirRodando();
        carregarFaixa(id, faixa);
        // veio do BROWSE de um deck: carregou, a gaveta sai e você volta pra mix
        if (alvoBib) fecharBrowse(id);
      };
      el.querySelector('.pa').onclick = (e) => { e.stopPropagation(); por('A'); };
      el.querySelector('.pb').onclick = (e) => { e.stopPropagation(); por('B'); };

      // estrela: FAVORITA. O modo favoritas mostra só elas — e o DJ toca só elas
      const estrela = el.querySelector('.fixar');
      const pintarEstrela = () => {
        const on = bib.ehFavorita(faixa.id);
        estrela.classList.toggle('lig', on);
        estrela.title = t(on ? 'bib.desfavoritar' : 'bib.favoritar');
      };
      estrela.onclick = (e) => {
        e.stopPropagation();
        bib.alternarFavorita(faixa);
        pintarEstrela();
        for (const x of Object.values(vistas)) x.pintarFav?.();
        if (bib.estado.ordem === 'favoritas') recarregar(); else pintarBiblioteca();
      };
      el.__pintarEstrela = pintarEstrela;
      pintarEstrela();

      // 📁: guardar numa pasta (ou tirar). Um menu pequeno DENTRO do item, com
      // as pastas marcadas ✓ e "+ nova pasta" no fim
      const bPasta = el.querySelector('.pasta-b');
      const pintarPasta = () => {
        const n = pastas.pastasDa(faixa.id).length;
        bPasta.classList.toggle('lig', n > 0);
        bPasta.title = t('pastas.menu');
      };
      pintarPasta();
      bPasta.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.menu-pasta').forEach((m) => m.remove());
        const menu = document.createElement('div');
        menu.className = 'menu-pasta';
        const desenhar = () => {
          const minhas = pastas.pastasDa(faixa.id);
          menu.innerHTML = pastas.listar().map((p) =>
            `<button data-p="${p.id}" class="${minhas.includes(p.id) ? 'lig' : ''}">${minhas.includes(p.id) ? '✓ ' : ''}${p.nome}</button>`).join('') +
            `<button data-nova>${t('pastas.nova')}</button>`;
        };
        desenhar();
        menu.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        menu.addEventListener('pointerup', (ev) => ev.stopPropagation());
        menu.onclick = (ev) => {
          ev.stopPropagation();
          const b = ev.target.closest('button');
          if (!b) return;
          if (b.dataset.nova != null) {
            const inp = document.createElement('input');
            inp.className = 'pasta-nome'; inp.placeholder = t('pastas.nome'); inp.maxLength = 40;
            b.replaceWith(inp); inp.focus();
            inp.addEventListener('keydown', (k) => {
              k.stopPropagation();
              if (k.key === 'Enter' && inp.value.trim()) { const id = pastas.criar(inp.value); if (id) pastas.adicionar(id, faixa); menu.remove(); pintarPasta(); }
              if (k.key === 'Escape') menu.remove();
            });
            return;
          }
          const id = b.dataset.p;
          if (pastas.contem(id, faixa.id)) pastas.remover(id, faixa.id); else pastas.adicionar(id, faixa);
          desenhar(); pintarPasta();
        };
        el.appendChild(menu);
        setTimeout(() => document.addEventListener('pointerdown', function fora(ev) {
          if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', fora); }
        }), 0);
      };

      // toque no corpo do item = deck livre. Tolerância de 12 px porque a lista
      // rola e o Chrome cancela o click se o dedo escorrega.
      let px = 0, py = 0, pid = null;
      el.addEventListener('pointerdown', (ev) => { px = ev.clientX; py = ev.clientY; pid = ev.pointerId; });
      el.addEventListener('pointerup', (ev) => {
        // os botões do item (A/B, ★, 📁 e o menu dele) não carregam a faixa
        if (ev.pointerId !== pid || ev.target.closest('.carregar, .fixar, .pasta-b, .menu-pasta')) return;
        if (Math.hypot(ev.clientX - px, ev.clientY - py) > 12) return;
        pid = null;
        por(alvoBib || deckLivre());
      });

      lista.appendChild(el);
    }
    repintarLista();
    faixas.filter(doAudius).slice(0, 3).forEach((x) => prefetch(x.id).catch(() => {}));
  } catch (e) {
    lista.innerHTML = `<div class="aviso">Audius indisponível: ${e.message}</div>`;
  }
}

/**
 * A biblioteca: UM menu de gêneros (seleção múltipla) que serve à lista E ao
 * DJ, busca, modo favoritas e ordem escolhível. A lógica mora em
 * biblioteca.js; aqui só desenha e liga os cliques.
 */
let tBusca = null;

/** Nota de "combina com o que está tocando", pra ordem `combina`. */
function pontuarCombina(faixa) {
  const v = avaliar(faixa);
  return !v ? 0 : v.classe === 'otima' ? 3 : v.classe === 'boa' ? 2 : 1;
}

/**
 * Os chips acendem NA HORA; a varredura espera 150 ms sem clique.
 *
 * Cada varredura do acervo custa ~775 ms, e cinco cliques rápidos disparavam
 * cinco — 3,9 s até a lista assentar, mesmo com as quatro primeiras sendo
 * descartadas no fim. Assim a resposta visual é imediata e só a última
 * seleção custa uma varredura.
 */
let tRecarregar = null;
function recarregar() {
  pintarBiblioteca();
  clearTimeout(tRecarregar);
  tRecarregar = setTimeout(() =>
    carregarLista(() => bib.faixasDaLista({ texto: $('busca').value, pontuarCombina })), 150);
}

function pintarBiblioteca() {
  const sel = new Set(bib.estado.selecionadas);
  for (const b of document.querySelectorAll('#crates button[data-pilha], #dj-generos button[data-pilha]')) {
    b.classList.toggle('lig', b.dataset.pilha === '*' ? !sel.size : sel.has(b.dataset.pilha));
  }
  for (const b of $('ordem').querySelectorAll('button[data-ordem]')) {
    const ativo = b.dataset.ordem === bib.estado.ordem;
    b.classList.toggle('lig', ativo);
    b.dataset.seta = ativo && ['bpm', 'tom', 'nome'].includes(b.dataset.ordem)
      ? (bib.estado.decrescente ? '↓' : '↑') : '';
  }
  const fav = fonteDj === 'favoritas';
  $('dj-generos').querySelector('.fav')?.classList.toggle('lig', fav);
  $('dj-generos').classList.toggle('so-fav', fav);
  const n = sel.size;
  const nomes = bib.GRUPOS.flatMap((g) => g.itens).filter((i) => sel.has(i.chave)).map((i) => i.nome);
  $('gen-resumo').textContent = nomes.length ? nomes.join(', ') : t('bib.tudoChip');
  $('bib-resumo').textContent = bib.estado.ordem === 'favoritas'
    ? t('bib.soFavoritas', { n: bib.estado.favoritas.length })
    : n ? t('bib.generos', { n }) : t('bib.tudo');
}

/**
 * Carrega uma faixa num deck, venha de onde vier: do Audius, ou um arquivo
 * seu guardado numa pasta. Música sua tocada pela primeira vez ensina à
 * pasta o BPM, o tom e a duração que a análise do deck achou.
 */
let primeiraMusica = true;
async function carregarFaixa(id, faixa) {
  if (primeiraMusica) { primeiraMusica = false; window.garimpoEvento?.('musica', { fonte: ehHearthis(faixa) ? 'hearthis' : faixa?.source === 'local' ? 'arquivo' : 'audius' }); }
  if (ehHearthis(faixa)) return decks[id].carregarHearthis(faixa);
  if (faixa?.source !== 'local') return decks[id].carregarAudius(faixa);
  const file = faixa.file || await pastas.arquivo(faixa.localId);
  if (!file) { qd('dica').textContent = t('pastas.semArquivo'); return; }
  const r = decks[id].carregarArquivo(file, { id: faixa.id, localId: faixa.localId, title: faixa.title, artist: faixa.artist });
  if (faixa.localId) aprenderLocal(id, faixa.localId);
  return r;
}
async function aprenderLocal(id, localId) {
  const t0 = performance.now();
  while (performance.now() - t0 < 90000) {
    const d = decks[id];
    if (d.faixa?.localId !== localId) return;
    if (d.pronta) {
      pastas.atualizarLocal(localId, { bpm: d.bpmNatural ? Math.round(d.bpmNatural * 100) / 100 : null,
                                       camelot: d.faixa.camelot || null, duration: Math.round(d.duration) || null });
      return;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}

/**
 * OS GÊNEROS NUM BLOCO SÓ, COM ABAS.
 *
 * Eram ~120 chips empilhados em seis grupos: abrir "gêneros" empurrava a lista
 * de músicas pra fora da gaveta. Agora é um bloco: em cima, o que está
 * MARCADO (com ✕ pra tirar) e o "tudo"; no meio, as abas (⚡ eletrônico,
 * 🇧🇷 brasil… 🐢 slowed), cada uma com o número de marcados nela; embaixo, só
 * os chips da aba. A fileira do DJ mostra a MESMA aba (◂ ▸ troca) — marcar
 * lá marca aqui, é uma seleção só.
 */
// quem chega pela primeira vez abre na ⚡ (os gêneros), não na 📁 pastas — vazia pra quem nunca criou uma
let abaGen = (() => { try { const v = localStorage.getItem('garimpo.bib.aba'); return v == null ? 1 : Number(v) || 0; } catch { return 1; } })();
function desenharChips() {
  if (abaGen >= bib.GRUPOS.length) abaGen = 0;
  const g = bib.GRUPOS[abaGen];
  const sel = new Set(bib.estado.selecionadas);
  const todos = bib.GRUPOS.flatMap((x) => x.itens);
  const marcados = todos.filter((i) => sel.has(i.chave));
  $('crates').innerHTML =
    `<div class="gen-marcados"><button data-pilha="*" class="chip-tudo">${t('bib.tudoChip')}</button>` +
      (marcados.length ? marcados.map((i) => `<button class="marcado" data-pilha="${i.chave}">${i.nome} <b>✕</b></button>`).join('')
                       : `<span class="gen-nada">${t('bib.nadaMarcado')}</span>`) + '</div>' +
    `<div class="gen-abas" role="tablist">` + bib.GRUPOS.map((x, k) => {
      const n = x.itens.filter((i) => sel.has(i.chave)).length;
      return `<button role="tab" class="gen-aba${k === abaGen ? ' lig' : ''}" data-aba="${k}" aria-selected="${k === abaGen}" title="${t(x.grupo)}">` +
             `<i>${x.ic || '•'}</i><span>${t('aba.' + x.grupo.slice(10))}</span>${n ? `<b>${n}</b>` : ''}</button>`;
    }).join('') + '</div>' +
    `<div class="gen-chips" role="tabpanel"><span class="gen-desc">${t(g.grupo)}</span>` +
      g.itens.map((i) => `<button data-pilha="${i.chave}">${i.nome}${i.pasta ? ` <small>${i.n}</small>` : ''}</button>`).join('') +
      (g.grupo === 'app.grupo.pastas' ? acoesPastas(marcados) : '') + '</div>';
  $('dj-generos').innerHTML =
    `<button class="fav" data-fonte="favoritas">♥ ${t('dj.fav')}</button>` +
    `<button data-pilha="*" class="chip-tudo">${t('bib.tudoChip')}</button>` +
    `<button class="dj-aba" data-passo="-1" title="${t('bib.abaAnterior')}">◂</button>` +
    `<button class="dj-aba nome" data-passo="1" title="${t('bib.abaProxima')}">${g.ic || ''} ${t('aba.' + g.grupo.slice(10))} ▸</button>` +
    // marcados de OUTRAS abas continuam à vista, na frente
    marcados.filter((i) => !g.itens.includes(i)).map((i) => `<button data-pilha="${i.chave}">${i.nome}</button>`).join('') +
    g.itens.map((i) => `<button data-pilha="${i.chave}">${i.nome}</button>`).join('');
}
/** + nova pasta, e renomear/apagar quando UMA pasta está marcada. */
function acoesPastas(marcados) {
  const ps = marcados.filter((i) => i.pasta);
  let h = `<button class="pasta-acao" data-pasta-nova>${t('pastas.nova')}</button>`;
  if (ps.length === 1) {
    h += `<button class="pasta-acao" data-pasta-renomear="${ps[0].chave.slice(6)}">✎ ${t('pastas.renomear')}</button>` +
         `<button class="pasta-acao perigo" data-pasta-apagar="${ps[0].chave.slice(6)}">🗑 ${t('pastas.apagar')}</button>`;
  }
  if (!bib.GRUPOS[0].itens.length) h += `<span class="gen-nada">${t('pastas.dica')}</span>`;
  return h;
}
/** Um campo de nome no lugar do botão; Enter confirma, Esc desiste. */
function pedirNome(botao, inicial, feito) {
  const inp = document.createElement('input');
  inp.className = 'pasta-nome'; inp.value = inicial || ''; inp.placeholder = t('pastas.nome'); inp.maxLength = 40;
  botao.replaceWith(inp); inp.focus(); inp.select();
  let fechado = false;
  const fim = (ok) => { if (fechado) return; fechado = true; if (ok && inp.value.trim()) feito(inp.value.trim()); else desenharChips(); };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') fim(true); if (e.key === 'Escape') fim(false); });
  inp.addEventListener('blur', () => fim(true));
}
pastas.aoMudar(() => { bib.porPastas(); desenharChips(); pintarBiblioteca(); });

function irAba(k) {
  abaGen = ((k % bib.GRUPOS.length) + bib.GRUPOS.length) % bib.GRUPOS.length;
  try { localStorage.setItem('garimpo.bib.aba', String(abaGen)); } catch {}
  desenharChips(); pintarBiblioteca();
}
$('crates').addEventListener('click', (e) => {
  const a = e.target.closest('[data-aba]');
  if (a) { e.stopPropagation(); irAba(Number(a.dataset.aba)); return; }
  const b = e.target.closest('[data-pasta-nova], [data-pasta-renomear], [data-pasta-apagar]');
  if (!b) return;
  e.stopPropagation();
  if (b.dataset.pastaNova != null) {
    pedirNome(b, '', (nome) => { const id = pastas.criar(nome); if (id) { bib.alternarGenero('pasta:' + id); desenharChips(); recarregar(); } });
  } else if (b.dataset.pastaRenomear) {
    const id = b.dataset.pastaRenomear;
    pedirNome(b, pastas.listar().find((p) => p.id === id)?.nome, (nome) => pastas.renomear(id, nome));
  } else if (b.dataset.pastaApagar) {
    const id = b.dataset.pastaApagar;
    const nome = pastas.listar().find((p) => p.id === id)?.nome || '';
    if (confirm(t('pastas.apagarConfirma', { n: nome }))) pastas.apagar(id).then(() => recarregar());
  }
}, true);
desenharChips();
// as 🚀 apostas da semana chegam depois (rede): redesenha os chips quando vierem
bib.carregarApostas().then((mudou) => { if (mudou) { desenharChips(); pintarBiblioteca(); } });
/**
 * Os gêneros ficam num menu que abre e fecha. Abertos o tempo todo eram ~40
 * chips empurrando a lista pra baixo; fechados, o botão mostra o que está
 * marcado, que é o que importa na maior parte do tempo.
 */
function abrirGeneros(aberto) {
  $('crates').hidden = !aberto;
  $('b-generos').setAttribute('aria-expanded', String(aberto));
  try { localStorage.setItem('garimpo.bib.generosAbertos', aberto ? '1' : '0'); } catch {}
}
$('b-generos').onclick = () => abrirGeneros($('crates').hidden);
try { abrirGeneros(localStorage.getItem('garimpo.bib.generosAbertos') === '1'); } catch { abrirGeneros(false); }
/**
 * Na GAVETA LARGA (mesmo corte do CSS) os gêneros ficam SEMPRE abertos, na
 * coluna da esquerda, e o botão de abrir/fechar some. Tem que ser pelo
 * `hidden`, não por CSS: a regra global `[hidden] { display:none !important }`
 * ganhava, e a coluna ficava vazia sem botão pra abrir — no celular deitado
 * e no computador. Fora dela (📌 fixa, celular pequeno) volta o que a pessoa
 * tinha escolhido.
 */
const gavetaLarga = matchMedia('(min-width:1041px), (orientation:landscape) and (min-width:640px) and (max-width:1040px)');
function generosDaGaveta() {
  if (gavetaLarga.matches && !document.body.classList.contains('bib-fixa')) { $('crates').hidden = false; return; }
  let pref = false;
  try { pref = localStorage.getItem('garimpo.bib.generosAbertos') === '1'; } catch {}
  $('crates').hidden = !pref;
  $('b-generos').setAttribute('aria-expanded', String(pref));
}
gavetaLarga.addEventListener('change', generosDaGaveta);
generosDaGaveta();

/**
 * A fileira de gêneros do DJ: os MESMOS chips da lista (marcar aqui marca lá),
 * mais o ♥ que troca a fonte pra favoritas. Tudo à vista, sem menu.
 */
$('dj-generos').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.passo) { irAba(abaGen + Number(b.dataset.passo)); return; }
  if (b.dataset.fonte) {
    fonteDj = fonteDj === 'favoritas' ? 'generos' : 'favoritas';
  } else {
    fonteDj = 'generos';
    bib.alternarGenero(b.dataset.pilha);
    if (bib.estado.ordem === 'favoritas') bib.escolherOrdem('embaralhar');
    desenharChips();
  }
  try { localStorage.setItem('garimpo.dj.fonte', fonteDj); } catch {}
  recarregar();
  refazerProximas();
});

/**
 * Marcou outros gêneros com o DJ tocando: as PRÓXIMAS do set são refeitas a
 * partir da música que está no ar (o encaixe de tom e BPM continua valendo),
 * e o Garimpeiro avisa. Espera 1,5 s de calma: quem marca três gêneros
 * seguidos não precisa de três sets.
 */
let tRefazer = null;
function avisarTroca(chave, vars = {}) {
  narracao = { diz: chave, vars: { g: $('gen-resumo').textContent, ...vars }, k: ++nNarracao };
  ultimoProf = 0;
}
function refazerProximas() {
  if (!piloto?.ativo || modoDj === 'solo') return;
  clearTimeout(tRefazer);
  tRefazer = setTimeout(async () => {
    try {
      const soFav = fonteDj === 'favoritas' || bib.estado.ordem === 'favoritas';
      const cands = soFav ? bib.favoritasParaSet() : await bib.candidatasDoSet();
      const noAr = piloto.fila?.[piloto.indice];
      if (!noAr) return;
      const pote = cands.filter((f) => f.id !== noAr.id);
      if (pote.length < 2) { avisarTroca('n.trocouNada'); return; }
      /**
       * Trocar de gênero é virar o clima: o set novo NÃO precisa casar BPM com
       * a que está tocando (psy a 140 depois de um samba a 95 nunca casaria, e
       * a troca não acontecia). Ele começa pela faixa do gênero novo de BPM
       * mais PERTO da atual — a virada fica a menor possível — e segue
       * encadeado dali.
       */
      // com BPM do set, a troca continua a RAMPA de onde ela está agora: a
      // ponte é a do gênero novo mais perto do BPM que a rampa pede neste
      // minuto, e o resto do set vai dali até o BPM do fim
      const rampa = rampaAgora();
      const bpmAgora = rampa?.bpmIni || noAr.bpm || 120;
      const ponte = pote.reduce((m, f) => (Math.abs(f.bpm - bpmAgora) < Math.abs(m.bpm - bpmAgora) ? f : m));
      const s = montarSet(pote, {
        minutos: Number($('pref-min').value), energia: $('pref-energia').value, variedade: $('pref-variedade').value,
        semente: ponte, recentes: soFav ? jaTocadas : [...jaTocadas, ...jaSugeridas], variar: !soFav,
        ...(rampa || {}), preferir: paresBons(),
      });
      let novas = s.fila.filter((f) => f.id !== noAr.id);
      // pouca corrente (o gênero novo mora longe no BPM, psy a 140): completa
      // com as dele em ordem de BPM a partir da ponte — o andamento sobe aos
      // poucos até o clima novo, em vez de parar numa faixa só
      if (novas.length < 4) {
        const ja = new Set(novas.map((f) => f.id));
        const resto = pote.filter((f) => !ja.has(f.id))
          .sort((a, b) => Math.abs(a.bpm - ponte.bpm) - Math.abs(b.bpm - ponte.bpm));
        novas = [...novas, ...resto].slice(0, 10);
      }
      if (novas.length < 1) { avisarTroca('n.trocouNada'); return; }
      // TROCA JÁ; o Jev decide as técnicas depois, em segundo plano. Esperar
      // por ele segurava a troca vários segundos (medido: ~17 s do clique até
      // o deck mudar); a técnica que chegar tarde vale pras passagens que
      // ainda não começaram
      if (!piloto?.ativo || !piloto.substituirProximas(novas)) return;
      decidirSet([noAr, ...novas], piloto.estilo).then((decisao) => {
        if (!decisao) return;
        const com = aplicarDecisoes([noAr, ...novas], decisao).slice(1);
        for (const d of com) { const f = piloto.fila?.find((x) => x.id === d.id); if (f) Object.assign(f, { tecnica: d.tecnica, tempos: d.tempos, porqueIA: d.porqueIA, probsIA: d.probsIA }); }
      }).catch(() => {});
      if (!soFav) registrarSugeridas(novas);
      fila = piloto.fila.slice(piloto.indice);
      desenharFila();
      narracao = { diz: 'n.trocou', porque: 'n.trocou.p', vars: { n: novas.length, g: $('gen-resumo').textContent }, k: ++nNarracao };
      ultimoProf = 0;
    } catch {}
  }, 700);            // espera a pessoa terminar de marcar os chips, não mais
}
// roda do mouse rola a fileira pro lado
$('dj-generos').addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  e.currentTarget.scrollLeft += e.deltaY;
  e.preventDefault();
}, { passive: false });

/** Os três modos do DJ, em botões. O texto do botão grande diz o que vai acontecer. */
function pintarModoDj() {
  for (const b of $('dj-modos').querySelectorAll('button')) b.classList.toggle('lig', b.dataset.modo === modoDj);
  if (!piloto?.ativo) {
    $('b-piloto').textContent = t('dj.b.' + modoDj);
    $('piloto-nota').textContent = t('dj.d.' + modoDj);
    $('piloto-nota').style.color = 'var(--mut)';
  }
}
$('dj-modos').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-modo]');
  if (!b) return;
  modoDj = b.dataset.modo;
  try { localStorage.setItem('garimpo.dj.modo', modoDj); } catch {}
  if (piloto?.ativo) piloto.juntos = modoDj === 'juntos';
  pintarModoDj();
});
window.addEventListener('idioma', pintarModoDj);

$('crates').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-pilha]');
  if (!b) return;
  bib.alternarGenero(b.dataset.pilha);
  // escolher gênero sai do modo favoritas: a pessoa quer ver o gênero
  if (bib.estado.ordem === 'favoritas') bib.escolherOrdem('embaralhar');
  desenharChips();         // os marcados e o número de cada aba mudaram
  recarregar();
  refazerProximas();       // com o DJ tocando, as próximas seguem os gêneros novos
});

$('ordem').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ordem]');
  if (!b) return;
  bib.escolherOrdem(b.dataset.ordem);
  recarregar();
});

$('busca').oninput = () => {
  clearTimeout(tBusca);
  tBusca = setTimeout(recarregar, 300);
};

// ─────────────────────────── fila do set ───────────────────────────
// Sistema proprio, separado do texto do professor: o topo diz o que FAZER
// agora; a fila diz o que vem DEPOIS. Misturar os dois polui os dois.

function desenharFila() {
  const cx = $('fila-cx'), el = $('fila');
  if (!fila.length) { cx.hidden = true; return; }
  cx.hidden = false;
  const livre = deckLivre();
  $('fila-resumo').textContent = resumoFila(fila, referencia());

  el.innerHTML = '';
  // `faixa`, nunca `t`: `t` é a função de tradução, e já me pegou uma vez aqui
  // dentro — laço com variável `t` sombreia ela e o arquivo inteiro quebra.
  fila.forEach((faixa, i) => {
    const d = document.createElement('div');
    d.className = 'fila-item' + (i === 0 ? ' proxima' : '');
    // a primeira vai pro deck livre; as seguintes alternam
    const destino = i === 0 ? livre : (livre === 'A' ? (i % 2 ? 'B' : 'A') : (i % 2 ? 'A' : 'B'));
    d.innerHTML = `<div class="ord">${i + 1}</div>
      <div class="n"><div class="t"></div><div class="a"></div></div>
      <button class="destino p${destino.toLowerCase()}">${destino}</button>`;
    d.querySelector('.t').textContent = faixa.title;
    /**
     * Marca a transição DIFÍCIL em vez de fingir que todas são iguais.
     *
     * Quando a corrente não acha faixa de tom compatível ela afrouxa e casa só
     * pelo andamento (ver setlist.js). Isso é legítimo — é o que um DJ faz —
     * mas exige cortar os médios na entrada. Esconder seria deixar a pessoa
     * errar sem saber por quê.
     */
    const dificil = (faixa.nivel ?? 0) >= 2;
    d.classList.toggle('dificil', dificil);
    // a primeira abre o set: não há de onde ela venha, então nem pitch nem motivo
    const comoEntra = i === 0 ? t('fila.abre')
      : `${faixa.pitch >= 0 ? '+' : ''}${((faixa.pitch || 0) * 100).toFixed(1)}% · ` +
        (dificil ? t('fila.soAndamento') : (faixa.motivo || ''));
    // a técnica que vai ser usada pra ENTRAR com esta faixa — quem está
    // aprendendo lê o nome e ouve a técnica acontecendo
    const tec = i > 0 && faixa.tecnica && TECNICAS[faixa.tecnica]
      ? ` · → ${TECNICAS[faixa.tecnica].nome}${faixa.tempos ? ' ' + faixa.tempos : ''}` : '';
    d.querySelector('.a').textContent = `${faixa.bpm} ${faixa.camelot || ''} · ${comoEntra}${tec}`;
    d.querySelector('.destino').onclick = async () => {
      try { await ligar(); } catch { return; }
      await garantirRodando();
      carregarFaixa(destino, faixa);
      fila = fila.filter((x) => x.id !== faixa.id);
      desenharFila();
    };
    el.appendChild(d);
  });
}

$('b-fila').onclick = async () => {
  const base = referencia();
  if (!base?.bpm) return;
  const b = $('b-fila');
  b.textContent = 'montando…'; b.disabled = true;
  try {
    fila = await montarFila(base, { tamanho: 6, energia: 'subir' });
    desenharFila();
  } catch (e) {
    $('fila-cx').hidden = false;
    $('fila').innerHTML = `<div class="aviso">não consegui montar: ${e.message}</div>`;
  } finally { b.textContent = 'montar sequência'; b.disabled = false; }
};
$('b-fila-fechar').onclick = () => { fila = []; $('fila-cx').hidden = true; };

$('b-compat').onclick = () => {
  const base = referencia();
  if (!base?.bpm) return;
  $('busca').value = '';
  carregarLista(() => compativeis(base));
};

$('b-ajuda').onclick = () => $('ajuda').showModal();
$('fechar-ajuda').onclick = () => $('ajuda').close();
// o guia da primeira vez, quantas vezes quiser: fecha a ajuda e a gaveta e começa
$('b-rever-guia').onclick = () => {
  $('ajuda').close();
  abrirGuia({ antes: () => abrirBib(false) });
};

const arquivo = $('arquivo');
$('b-arquivo').onclick = () => arquivo.click();
/**
 * Música sua: vai pro deck livre E fica guardada na pasta "minhas músicas"
 * (neste navegador, só aqui). Vários arquivos de uma vez: todos pra pasta,
 * o primeiro pro deck.
 */
async function subirArquivos(files) {
  try { await ligar(); } catch { return; }
  await garantirRodando();
  const lista = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(f.name));
  if (!lista.length) return;
  pastas.garantirMinhas(t('pastas.minhas'));
  let primeira = null;
  for (const f of lista) {
    try {
      const faixa = await pastas.guardarArquivo(f);
      pastas.adicionar(pastas.MINHAS, faixa);
      primeira ||= { ...faixa, file: f };
    } catch { /* sem IndexedDB: ainda toca, só não guarda */ primeira ||= { source: 'local', title: f.name, file: f }; }
  }
  if (primeira?.localId) carregarFaixa(deckLivre(), primeira);
  else if (primeira) decks[deckLivre()].carregarArquivo(primeira.file);
  qd('dica').textContent = t('pastas.guardou', { n: lista.length });
}
arquivo.multiple = true;
// copia ANTES de limpar: a FileList é viva, e limpar o campo esvaziava a lista
arquivo.onchange = () => { const fs = [...arquivo.files]; arquivo.value = ''; subirArquivos(fs); };
['dragenter', 'dragover'].forEach((t) => addEventListener(t, (e) => e.preventDefault()));
addEventListener('drop', async (e) => {
  e.preventDefault();
  try { await ligar(); } catch { return; }
  await garantirRodando();
  if (e.dataTransfer.files?.length) subirArquivos([...e.dataTransfer.files]);
});

addEventListener('keydown', (e) => {
  if (e.target.matches('input,select')) return;
  if (e.code === 'Space') { e.preventDefault(); decks.A?.alternar(); }
  if (e.code === 'KeyB') { e.preventDefault(); decks.B?.alternar(); }
});

// primeira carga: a seleção e a ordem que a pessoa deixou da última vez
recarregar();
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


// ─────────────────── encaixe exato, pré-escuta e saídas ───────────────────

/**
 * ENCAIXAR — o botão que faltava.
 *
 * O professor mandava "arraste o jog até ficar verde", e quem nunca mixou não
 * tem como acertar 20 ms à mão num prato de 100 px. Aqui o erro de fase é
 * medido e desfeito deslizando, não saltando: a taxa muda o suficiente pra
 * recuperar o atraso na janela e volta pro normal. Inaudível por construção.
 *
 * Corrige sempre o deck B, porque é a convenção do resto do app (o A é o que
 * está no ar, o B é o que está entrando).
 */
$('b-encaixar').onclick = () => {
  const r = medirEncaixe();
  if (!r) { qd('dica').textContent = 'preciso das duas faixas tocando pra medir o encaixe'; return; }
  const aplicado = decks.B.deslocar(-r.emMs / 1000, { emSeg: 0.5 });
  qd('dica').textContent = `encaixei o B: ${r.emMs > 0 ? 'atrasei' : 'adiantei'} ` +
    `${Math.abs(aplicado * 1000).toFixed(0)} ms (erro era ${r.emMs.toFixed(0)} ms)`;
};

/**
 * O encaixe vem da GRADE. Ponto.
 *
 * Tentei medir pelo áudio pra não depender da âncora (ver mixer.js) e o
 * resultado foi instável a ponto de estragar uma transição. A grade, desde que
 * a análise passou a rodar na faixa inteira e não só no prefixo, é exata e não
 * treme.
 */
function medirEncaixe() {
  return erroDeFase(decks.A, decks.B);
}

/**
 * Pré-escuta no fone — a segunda saída.
 *
 * O barramento fica no mesmo AudioContext e sai por um <audio> com setSinkId,
 * porque um segundo AudioContext teria relógio próprio e os decks não poderiam
 * alimentar os dois. O preço é atraso SÓ no fone, e por isso a nota na tela
 * avisa: serve pra conferir a batida, não pra casar de ouvido só pelo fone.
 *
 * enumerateDevices() esconde o nome das saídas até haver permissão de
 * microfone — daí o texto "nome oculto" em vez de um dropdown misterioso.
 */
async function popularSaidas() {
  const sel = $('saida-fone');
  let ds = [];
  try { ds = await Mixer.saidas(); } catch {}
  sel.innerHTML = '<option value="">fone: saída padrão</option>' +
    ds.map((d) => `<option value="${d.id}">${d.nome}</option>`).join('');
  if (!ds.length) {
    $('fone-nota').textContent = 'sem lista de saídas neste navegador';
    $('fone-nota').style.color = 'var(--fraco)';
  }
}
popularSaidas();
navigator.mediaDevices?.addEventListener?.('devicechange', popularSaidas);

$('saida-fone').onchange = async () => {
  if (!mixer) return;
  const r = await mixer.ligarFone($('saida-fone').value || null);
  $('fone-nota').textContent = r.ok ? `fone ok · +${r.latenciaMs} ms de atraso` : r.motivo;
  $('fone-nota').style.color = r.ok ? 'var(--cue)' : 'var(--bad)';
};

for (const id of ['A', 'B']) {
  const b = $('fone-' + id);
  b.onclick = async () => {
    if (!mixer) return;
    await garantirRodando();
    const ligando = !b.classList.contains('lig');
    b.classList.toggle('lig', ligando);
    mixer.setCue(id, ligando);
    if (ligando) {
      const r = await mixer.ligarFone($('saida-fone').value || null);
      $('fone-nota').textContent = r.ok
        ? `fone: ${mixer.cueAtivos.join('+') || '—'} · +${r.latenciaMs} ms de atraso`
        : r.motivo;
      $('fone-nota').style.color = r.ok ? 'var(--cue)' : 'var(--bad)';
    } else if (!mixer.cueAtivos.length) {
      mixer.desligarFone();
      $('fone-nota').textContent = '';
    }
  };
}


// ─────────────────────── o professor toca o set ───────────────────────

/**
 * O piloto: monta um set com suas preferências e toca do começo ao fim.
 *
 * Ele usa os MESMOS métodos que a sua mão usaria — nada de caminho
 * privilegiado. E solta na hora que você encostar em qualquer controle, que é
 * a única forma de um piloto ser útil em vez de irritante.
 */
let piloto = null;

function garantirPiloto() {
  if (piloto) return piloto;
  piloto = new Piloto({
    decks, mixer, pads,           // pads: ele solta um som no drop, como a mão faria
    // encaixa QUEM ENTRA. O botão corrige sempre o B — com a nova entrando no
    // A, o piloto deslizava a faixa que estava NO AR, e a pista ouvia
    encaixar: (id = 'B') => {
      const outro = id === 'A' ? 'B' : 'A';
      const r = erroDeFase(decks[outro], decks[id]);
      if (r) decks[id].deslocar(-r.emMs / 1000, { emSeg: 0.5 });
    },
    sincronizar: (id) => sincronizar(id),
    carregar: async (id, faixa, { rapido = false } = {}) => {
      await carregarFaixa(id, faixa);
      // 150 s: numa rede lenta uma faixa de 8 MB leva isso; desistir antes
      // fazia o DJ pular música atrás de música enquanto a pista ficava muda
      const t0 = performance.now();
      while (performance.now() - t0 < 150000) {
        const d = decks[id];
        if (d.estado === 'erro') return false;
        // `rapido`: basta o começo decodificado pra tocar (ver Piloto.tocar) —
        // se a rede dá conta de trazer o resto antes dele acabar
        if (rapido && d.estado === 'pronto' && d.faixa?.id === faixa.id && d.cabeNoPrefixo !== false) return true;
        // espera a analise cobrir a faixa INTEIRA, nao so o prefixo: e a grade
        // da faixa toda que faz a fase fechar
        if (d.pronta) return true;   // inteira e analisada: ver Deck.pronta
        await new Promise((r) => setTimeout(r, 600));
      }
      return false;
    },
  });
  piloto.addEventListener('passo', (e) => {
    const { passo, faixa, resta, motivo, erro, seg, tipo, deck, proxima } = e.detail;
    $('piloto-nota').textContent = erro ? `piloto parou: ${erro}`
      // servidor lento (Piloto.#carregarComPrazo): diz o que fez, sem "faltam N"
      : passo === 'adiou' ? t('piloto.adiou', { faixa, proxima })
      : passo === 'pulou' ? t('piloto.pulou', { faixa })
      : passo === 'esperando'
        ? t(tipo === 'quebra' ? 'piloto.esperaQuebra' : 'piloto.esperaFrase', { s: seg, d: deck })
      : motivo ? `piloto ${passo} — ${motivo}`
      : faixa ? `${passo}: ${faixa}${resta != null ? ` · faltam ${resta}` : ''}`
      : passo;
    $('piloto-nota').style.color = erro ? 'var(--bad)' : 'var(--neon)';
    if (passo === 'fim do set' || passo === 'parado' || erro) pararPiloto();
  });
  piloto.addEventListener('crossfader', (e) => { $('xf').value = e.detail.x; });
  piloto.addEventListener('narra', (e) => {
    narracao = { ...e.detail, k: ++nNarracao };
    if (e.detail.acertou) mascote?.comemora();
    ultimoProf = 0;                  // mostra já, sem esperar o próximo ciclo
  });
  // esperando a hora certa também é aula: diz o que ele está esperando
  piloto.addEventListener('passo', (e) => {
    const { passo, seg, tipo, deck } = e.detail;
    if (passo === 'esperando') {
      const k = narracao?.diz === 'n.espera' ? narracao.k : ++nNarracao;
      narracao = { diz: 'n.espera', porque: 'n.espera.p', k,
                   vars: { s: seg, d: deck, m: t(tipo === 'quebra' ? 'n.espera.quebra' : 'n.espera.frase') } };
    } else if (passo === 'parado' || passo === 'fim do set') narracao = null;
  });
  piloto.addEventListener('tocou', (e) => registrarTocada(e.detail.faixa));
  /**
   * Mostra QUAL técnica ele está fazendo e QUEM decidiu (Jev ou o estilo).
   * Ver o nome da técnica enquanto ela acontece é metade do valor pra quem
   * está aprendendo: ouve o filtro abrindo e lê "varredura de filtro".
   */
  piloto.addEventListener('passo', (e) => {
    if (e.detail.passo !== 'tecnica') return;
    const { tecnica, tempos, porque } = e.detail;
    $('piloto-tecnica').innerHTML =
      `${tecnica} · ${tempos} ${t('piloto.tempos')}` +
      (porque ? ` <span class="ia">· Jev: ${porque}</span>` : ` · ${t('piloto.porEstilo')}`) +
      `<span class="barra"><i id="piloto-barra" style="width:0%"></i></span>`;
  });
  piloto.addEventListener('progresso', (e) => {
    const b = document.getElementById('piloto-barra');
    if (b) b.style.width = Math.min(100, (e.detail.tempo / e.detail.de) * 100) + '%';
  });
  return piloto;
}

function pararPiloto() {
  $('b-piloto').classList.remove('lig');
  $('b-piloto').textContent = t('dj.b.' + modoDj);
  $('b-pular').hidden = true;
  document.body.classList.remove('dj-tocando');
  piloto?.assumirControle?.();
}

$('b-piloto').onclick = async () => {
  if (piloto?.ativo) { pararPiloto(); $('piloto-nota').textContent = 'piloto desligado'; return; }
  await garantirRodando();
  const b = $('b-piloto');
  // solo: ele só monta o set e sinaliza — não assume nada, então não vira "parar"
  const solo = modoDj === 'solo';
  if (!solo) { b.classList.add('lig'); b.textContent = t('app.piloto.parar'); $('b-pular').hidden = false; document.body.classList.add('dj-tocando'); }
  window.garimpoEvento?.('dj', { modo: modoDj, estilo: $('pref-estilo').value });
  $('piloto-nota').style.color = 'var(--neon)';
  $('piloto-nota').textContent = 'garimpando faixas…';
  try {
    // o DJ toca do MESMO lugar que a lista mostra: gêneros marcados, ou favoritas
    // ★ na lista = o DJ toca as favoritas (era o ♥ da fileira que saiu)
    const soFavoritas = fonteDj === 'favoritas' || bib.estado.ordem === 'favoritas';
    // espera os sinais de qualidade no máximo ~2,5 s: o que não chegou vem depois
    const cands = soFavoritas ? bib.favoritasParaSet() : await bib.candidatasDoSet({ esperaSinais: 2500 });
    if (cands.length < 2) throw new Error(t(soFavoritas ? 'dj.poucasFav' : 'pref.semFaixas'));
    // passagens que o Jev achou que não combinam: o montador não repete
    const evitar = new Set();
    const montar = (pote) => montarSet(pote, {
      minutos: Number($('pref-min').value),
      energia: $('pref-energia').value,
      variedade: $('pref-variedade').value, evitar,
      ...bpmDoSet(), preferir: paresBons(),
      obrigatorias: [],
      // evita o que TOCOU e o que já foi SUGERIDO: pedir outro set traz outras
      // músicas. No set de favoritas não — ali repetir é o ponto.
      recentes: soFavoritas ? jaTocadas : [...jaTocadas, ...jaSugeridas],
      variar: !soFavoritas,
      // com faixas escolhidas, quem abre o set é a primeira delas, não o deck
      semente: referencia()?.bpm ? referencia() : null,
    });
    let s = montar(cands);
    if (s.fila.length < 2) throw new Error(t('pref.poucas'));

    /**
     * Filtro de trash ANTES de tocar: o Jev lê título, artista, tags e
     * popularidade de cada faixa do set e reprova o que não é música. As
     * reprovadas vão pro lixo (daqui e da galera) e o set é remontado sem
     * elas. Duas voltas no máximo; favoritas não passam pelo juiz.
     */
    if (!soFavoritas) {
      let tiradas = 0;
      for (let volta = 0; volta < 2; volta++) {
        $('piloto-nota').textContent = t('jev.julgando', { n: s.fila.length });
        const juiz = await julgarFaixas(s.fila).catch(() => null);
        if (!juiz?.reprovadas.length) break;
        const ids = juiz.reprovadas.map((f) => f.id);
        tiradas += ids.length;
        bib.marcarLixo(ids);
        votarLixo(ids, 'jev');
        const novo = montar(cands.filter((f) => !bib.ehLixo(f.id)));
        if (novo.fila.length < 2) break;
        s = novo;
      }
      if (tiradas) $('piloto-tecnica').textContent = t('jev.tirou', { n: tiradas });
      /**
       * Depois do trash, a EMENDA: o Jev julga cada passagem. As que ele acha
       * que pulam de mundo viram "evitar" e o set é remontado — até 2 voltas,
       * e só fica o novo se ele tiver MENOS passagens ruins.
       */
      let trocadas = 0;
      let ruinsAgora = null;
      for (let volta = 0; volta < 2; volta++) {
        $('piloto-nota').textContent = t('jev.passagens', { n: s.fila.length - 1 });
        const juiz = await julgarPassagens(s.fila).catch(() => null);
        if (!juiz) break;
        if (ruinsAgora == null) ruinsAgora = juiz.ruins.length;
        if (!juiz.ruins.length) break;
        for (const r of juiz.ruins) evitar.add(r.de.id + '>' + r.para.id);
        const novo = montar(cands.filter((f) => !bib.ehLixo(f.id)));
        if (novo.fila.length < 2) break;
        const juiz2 = await julgarPassagens(novo.fila).catch(() => null);
        if (juiz2 && juiz2.ruins.length < juiz.ruins.length) { trocadas += juiz.ruins.length - juiz2.ruins.length; s = novo; }
        if (!juiz2?.ruins.length) break;
      }
      if (trocadas) $('piloto-tecnica').textContent = t('jev.emendas', { n: trocadas });
      registrarSugeridas(s.fila);
    }

    /**
     * O Jev decide o set INTEIRO num pedido só — técnica e duração de cada
     * transição. Sem proxy, sem chave ou sem rede, devolve null e o piloto usa
     * o escolhedor por estilo: a IA melhora o set, a falta dela não o impede.
     */
    const estilo = $('pref-estilo').value || 'pista';
    $('piloto-nota').textContent = t('jev.pensando', { n: s.fila.length - 1 });
    const decisao = await decidirSet(s.fila, estilo).catch(() => null);
    if (decisao) s.fila = aplicarDecisoes(s.fila, decisao);
    $('piloto-tecnica').textContent = decisao
      ? t('jev.decidiu', { n: decisao.decisoes.filter((d) => d.tecnica).length,
                          ms: decisao.ms, tok: decisao.tokens?.input_tokens ?? '?' })
      : t('jev.semIA');
    garantirPiloto().estilo = estilo;
    piloto.juntos = modoDj === 'juntos';

    fila = s.fila;
    desenharFila();
    const resumo = resumoSet(s) + (s.naoCoube?.length
      ? ' · ' + t('pref.naoCoube', { n: s.naoCoube.length }) : '')
      // pediu fechar num BPM e não deu (pouco tempo pra tanta subida, ou o
      // gênero não tem faixa lá): diz, em vez de fingir que chegou
      + (bpmDoSet().bpmFim && s.fimFora > 3 ? ' · ' + t('bpm.longe', { fim: bpmDoSet().bpmFim }) : '');
    $('fila-resumo').textContent = resumo;
    $('piloto-nota').textContent = resumo;
    if (s.naoCoube?.length) {
      $('piloto-nota').style.color = 'var(--cue)';
      $('piloto-nota').title = s.naoCoube.map((x) => `${x.title}: ${x.porque}`).join('\n');
    }
    if (solo) {
      // você toca: a primeira já vai pro deck A (ou pro livre), e daqui pra
      // frente o professor sinaliza — a lista "próximas" mostra a ordem e a
      // técnica sugerida de cada passagem
      const alvo = decks.A?.tocando ? deckLivre() : 'A';
      carregarFaixa(alvo, s.fila[0]);
      $('piloto-nota').textContent = t('dj.soloPronto', { d: alvo });
      $('piloto-nota').style.color = 'var(--ok)';
      return;
    }
    await garantirPiloto().tocar(s.fila);
  } catch (e) {
    $('piloto-nota').textContent = 'piloto: ' + e.message;
    $('piloto-nota').style.color = 'var(--bad)';
    pararPiloto();
  }
};

/**
 * Você encostou: o piloto sai.
 *
 * Escuta na fase de captura e em pointerdown pra sair ANTES de a ação
 * acontecer — se ele soltasse depois, ele e você dariam o comando junto, que é
 * o pior dos dois mundos. Os controles do próprio piloto ficam de fora.
 */
document.addEventListener('pointerdown', (e) => {
  if (!piloto?.ativo || piloto.juntos) return;
  if (e.target.closest('#b-piloto, .piloto-cx, #b-ajuda, #b-diag, .lista, #busca, #crates')) return;
  if (!e.target.closest('button, input, .jog, select')) return;
  pararPiloto();
  $('piloto-nota').textContent = 'você assumiu — o piloto soltou';
  $('piloto-nota').style.color = 'var(--cue)';
}, true);


// ─────────────────────────── idioma ───────────────────────────

/**
 * Três idiomas. O português é o original: foi nele que as frases do professor
 * foram escritas e testadas com alguém aprendendo de verdade — as outras duas
 * traduzem o sentido, não as palavras.
 *
 * Trocar de idioma redesenha o texto fixo pelo `data-i18n` e força o professor
 * a se redesenhar zerando a chave da última lista; sem isso ele só trocaria de
 * língua quando o conselho mudasse, o que pode demorar um minuto inteiro.
 */
$('idioma').innerHTML = IDIOMAS.map((i) =>
  `<option value="${i.id}">${i.nome}</option>`).join('');
$('idioma').value = idioma();
$('idioma').onchange = () => setIdioma($('idioma').value);

window.addEventListener('idioma', () => {
  ultimaLista = '';                       // obriga o professor a redesenhar agora
  $('b-piloto').textContent = piloto?.ativo ? t('app.piloto.parar') : t('app.piloto');
  for (const id of ['A', 'B']) {
    const v = vistas[id];
    if (v && !decks[id]?.faixa) {
      v.titulo.textContent = t('deck.vazio');
      v.artista.textContent = t('deck.escolha');
    }
    if (v) v.auto.title = t(autoLigado[id] ? 'deck.auto.lig' : 'deck.auto.dica');
  }
});

document.documentElement.lang = idioma() === 'pt' ? 'pt-BR' : idioma();
traduzirDOM();


// ──────────────── o que o professor vai tocar ────────────────

/**
 * O painel ⚙ do DJ ficou só com o que não cabe na biblioteca: esquecer o que
 * já tocou. Os gêneros e as músicas do set agora se escolhem NA LISTA — um
 * menu só pra navegar e pra dizer ao DJ o que tocar.
 */
$('b-prefs').onclick = () => { $('prefs').hidden = !$('prefs').hidden; };

/** Minimizar o painel do DJ: fica só a linha do botão grande. Lembra. */
function minimizarDj(min) {
  $('dj-painel').classList.toggle('min', min);
  $('b-dj-min').textContent = min ? '▴' : '▾';
  try { localStorage.setItem('garimpo.dj.min', min ? '1' : '0'); } catch {}
}
$('b-dj-min').onclick = () => minimizarDj(!$('dj-painel').classList.contains('min'));
try { minimizarDj(localStorage.getItem('garimpo.dj.min') === '1'); } catch {}

/**
 * SÓ A VIAGEM: com a viagem ligada, esconde a CDJ inteira (a música segue) e
 * deixa só o visual. Voltar: o mesmo botão, ou Esc. Desligar a viagem também
 * volta.
 */
function soViagem(on) {
  document.body.classList.toggle('so-viagem', on);
  const qual = document.body.classList.contains('viagem') ? 'viagem.so' : 'pista.so';
  $('b-so-viagem').textContent = t(on ? 'viagem.voltar' : qual);
}
document.addEventListener('show', () => soViagem(document.body.classList.contains('so-viagem')));
document.addEventListener('so-show', () => soViagem(true));
$('b-so-viagem').onclick = () => soViagem(!document.body.classList.contains('so-viagem'));
$('b-so-pular').onclick = () => $('b-pular').click();
addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('so-viagem')) soViagem(false); });
new MutationObserver(() => {
  const b = document.body.classList;
  if (!b.contains('viagem') && !b.contains('pista-cheia')) { if (b.contains('so-viagem')) soViagem(false); }
  else if (!b.contains('so-viagem')) soViagem(false);   // repinta o rótulo (viagem ↔ pista)
})
  .observe(document.body, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('idioma', () => { pintarBiblioteca(); repintarLista(); });


// ──────────── memória do que já tocou, e o botão de pular ────────────

/**
 * As últimas faixas tocadas, pra que dois sets seguidos não sejam o mesmo set.
 *
 * O montador é guloso e era determinístico: mesmo pote, mesma corrente, sempre.
 * Quem apertou play três vezes ouviu as mesmas duas faixas três vezes. Agora o
 * montador recebe esta lista e cobra caro por repetir — caro, não proibido: num
 * catálogo pequeno, proibir esvaziaria o pote e o set morreria no terceiro
 * passo.
 *
 * 60 é a memória: grande o bastante pra cobrir dois sets inteiros, pequena o
 * bastante pra não travar um catálogo de ~90 candidatas.
 */
const MEMORIA = 60;
let jaTocadas = [];
try { jaTocadas = JSON.parse(localStorage.getItem('garimpo.tocadas') || '[]'); } catch {}

/** O que já apareceu num set (tocado ou não). Memória maior: 240 faixas. */
let jaSugeridas = [];
try { jaSugeridas = JSON.parse(localStorage.getItem('garimpo.sugeridas') || '[]'); } catch {}
function registrarSugeridas(faixas) {
  const ids = faixas.map((f) => f.id);
  jaSugeridas = [...ids, ...jaSugeridas.filter((x) => !ids.includes(x))].slice(0, 240);
  try { localStorage.setItem('garimpo.sugeridas', JSON.stringify(jaSugeridas)); } catch {}
}

function registrarTocada(faixa) {
  if (!faixa?.id) return;
  jaTocadas = [faixa.id, ...jaTocadas.filter((x) => x !== faixa.id)].slice(0, MEMORIA);
  try { localStorage.setItem('garimpo.tocadas', JSON.stringify(jaTocadas)); } catch {}
}

$('b-esquecer').onclick = () => {
  jaTocadas = []; jaSugeridas = [];
  try { localStorage.removeItem('garimpo.tocadas'); localStorage.removeItem('garimpo.sugeridas'); } catch {}
  $('piloto-nota').textContent = t('pref.esqueceu');
  $('piloto-nota').style.color = 'var(--mut)';
};

$('b-pular').onclick = () => {
  if (!piloto?.ativo) return;
  piloto.pular();
  $('piloto-nota').textContent = t('piloto.pulando');
  $('piloto-nota').style.color = 'var(--cue)';
};

// ──────────────────────── sugestões ────────────────────────

/**
 * Caixa de sugestões — pra quem recebeu o link e quer pedir alguma coisa.
 *
 * Fica NO APARELHO de quem escreveu, e só sai de lá se a pessoa apertar enviar:
 * aí abre a folha de compartilhamento do sistema (WhatsApp, e-mail, o que
 * tiver) com o texto pronto. Não existe servidor aqui, e inventar um endereço
 * de destino fixo seria mandar a mensagem de alguém pra um lugar que ela não
 * escolheu — então quem escolhe é ela, sempre.
 *
 * Onde não há `navigator.share` (desktop), cai pra copiar pra área de
 * transferência, que resolve o mesmo problema com um passo a mais.
 */
let sugestoes = [];
try { sugestoes = JSON.parse(localStorage.getItem('garimpo.sugestoes') || '[]'); } catch {}

function guardarSugestoes() {
  try { localStorage.setItem('garimpo.sugestoes', JSON.stringify(sugestoes.slice(0, 50))); } catch {}
}

function desenharSugestoes() {
  const cx = $('sug-lista');
  cx.innerHTML = sugestoes.length
    ? sugestoes.map((g, i) =>
        `<div class="sug-item" data-i="${i}"><span class="quando">${g.quando}</span>` +
        `<span>${g.texto.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</span>` +
        `<button class="x">×</button></div>`).join('')
    : `<div class="sug-item" style="opacity:.6">${t('sug.vazio')}</div>`;
  for (const b of cx.querySelectorAll('.x')) {
    b.onclick = () => {
      sugestoes.splice(Number(b.parentElement.dataset.i), 1);
      guardarSugestoes(); desenharSugestoes();
    };
  }
}

function textoDaSugestao() {
  const txt = $('sug-texto').value.trim();
  if (!txt) return null;
  const nome = $('sug-nome').value.trim();
  return `Garimpo — sugestão${nome ? ` de ${nome}` : ''}:\n\n${txt}`;
}

$('b-sugerir').onclick = () => { desenharSugestoes(); $('sugestoes').showModal(); };
$('fechar-sugestoes').onclick = () => $('sugestoes').close();

$('b-sug-enviar').onclick = async () => {
  const txt = textoDaSugestao();
  if (!txt) { $('sug-nota').textContent = t('sug.escreva'); return; }
  sugestoes.unshift({ texto: $('sug-texto').value.trim(), quando: new Date().toLocaleDateString() });
  guardarSugestoes(); desenharSugestoes();
  // direto pra quem faz o Garimpo (Worker). Sem rede: cai no compartilhar/copiar
  const chegou = await enviarFeedback({
    texto: $('sug-texto').value.trim(), nome: $('sug-nome').value.trim() || null,
    idioma: document.documentElement.lang || null,
  });
  if (chegou) {
    window.garimpoEvento?.('feedback', {});
    $('sug-nota').textContent = t('sug.chegou');
    $('sug-nota').style.color = 'var(--ok)';
    $('sug-texto').value = '';
    return;
  }
  try {
    if (navigator.share) { await navigator.share({ text: txt }); $('sug-nota').textContent = t('sug.enviada'); }
    else { await navigator.clipboard.writeText(txt); $('sug-nota').textContent = t('sug.copiada'); }
    $('sug-texto').value = '';
  } catch {
    // a pessoa cancelou a folha de compartilhamento: a sugestão fica guardada
    $('sug-nota').textContent = t('sug.guardou');
  }
  $('sug-nota').style.color = 'var(--ok)';
};

$('b-sug-copiar').onclick = async () => {
  const txt = textoDaSugestao();
  if (!txt) { $('sug-nota').textContent = t('sug.escreva'); return; }
  try { await navigator.clipboard.writeText(txt); $('sug-nota').textContent = t('sug.copiada'); }
  catch { $('sug-nota').textContent = t('sug.semCopia'); }
  $('sug-nota').style.color = 'var(--ok)';
};


// ─────────────────────────── eco ───────────────────────────

/**
 * ECO — o knob e a divisão de tempo.
 *
 * A divisão alterna entre ½ tempo, 1 tempo e ¼ de tempo, que cobrem o que se
 * usa de verdade: ½ é o eco padrão de transição, 1 deixa o rastro largo pra
 * finais, ¼ fecha e vira efeito de tensão.
 *
 * O tempo do atraso é recalculado quando o BPM efetivo muda — se ficasse fixo,
 * um SYNC que muda o andamento deixaria o eco fora de tempo, e é isso que faz
 * um eco soar como defeito.
 */
const DIVISOES = [
  { d: 0.5, rot: '½' },
  { d: 1, rot: '1' },
  { d: 0.25, rot: '¼' },
];
const ecoDiv = { A: 0, B: 0 };

for (const id of ['A', 'B']) {
  const sl = $('eco-' + id), bt = $('eco-div-' + id);
  if (!sl || !bt) continue;
  sl.oninput = () => {
    mixer?.setEco(id, Number(sl.value));
    sincronizarEco(id);
  };
  const pintar = () => {
    bt.textContent = DIVISOES[ecoDiv[id]].rot;
    bt.title = t('mix.eco.div', { v: DIVISOES[ecoDiv[id]].rot });
  };
  bt.onclick = () => { ecoDiv[id] = (ecoDiv[id] + 1) % DIVISOES.length; pintar(); sincronizarEco(id); };
  pintar();
}

function sincronizarEco(id) {
  const bpm = decks[id]?.bpmEfetivo;
  if (bpm && mixer) mixer.setEcoTempo(id, bpm, DIVISOES[ecoDiv[id]].d);
}

/** O eco acompanha o andamento: SYNC e pitch mudam o BPM, o atraso segue. */
setInterval(() => { for (const id of ['A', 'B']) sincronizarEco(id); }, 900);
window.addEventListener('idioma', () => {
  for (const id of ['A', 'B']) {
    const bt = $('eco-div-' + id);
    if (bt) bt.title = t('mix.eco.div', { v: DIVISOES[ecoDiv[id]].rot });
  }
});


// ─────────────────────── acervo local (garimpo) ───────────────────────

let cavando = null;

async function mostrarAcervo() {
  try {
    const n = await crate.contar();
    $('acervo-n').textContent = n
      ? t('acervo.tem', { n: n.toLocaleString('pt-BR') })
      : t('acervo.vazio');
    $('acervo-n').style.color = n > 2000 ? 'var(--ok)' : 'var(--mut)';
  } catch {
    $('acervo-n').textContent = t('acervo.indisponivel');
    $('b-garimpar').disabled = true;
  }
}

/**
 * O LOTE DO DIA (ideia do Lucca). O "garimpar mais" era um garimpo sem fim
 * que a pessoa fazia uma vez e esquecia; agora é UM lote por dia de até 1.000
 * músicas novas do gênero que ela escolhe — ela volta amanhã pra mais, e cada
 * lote vai pro acervo de todo mundo (garimparLote em sources/garimpar.js).
 * Parou no meio? Continua no mesmo dia, do mesmo gênero, até fechar os 1.000.
 */
const LOTE_MAX = 1000;
const hojeStr = () => new Date().toLocaleDateString('sv');
const loteDeHoje = () => { const l = bib.ultimoLote(); return l?.dia === hojeStr() ? l : null; };
const nomeGenero = (g) => (g === 'Tudo' ? t('lote.tudo') : g);
function botaoLote() {
  const b = $('b-garimpar'), l = loteDeHoje();
  b.classList.toggle('feito', !!l?.completo);
  b.textContent = cavando ? t('acervo.parar') : !l ? t('lote.bt') : l.completo ? t('lote.feito') : t('lote.continuar');
}
function mostrarLote() {
  bib.porPastas();
  irAba(0);
  bib.marcarGenero('lote:ultimo');
  desenharChips(); recarregar();
}
async function cavarLote(genero) {
  const antes = loteDeHoje();
  const ids0 = antes?.genero === genero ? antes.ids : [];
  cavando = new AbortController();
  const b = $('b-garimpar');
  b.classList.add('lig'); botaoLote();
  let r = null;
  try {
    r = await garimparLote({
      genero, alvo: LOTE_MAX - ids0.length, signal: cavando.signal,
      aoAndar: ({ n, frente }) => {
        $('acervo-n').textContent = t('lote.cavando', { n: (ids0.length + n).toLocaleString('pt-BR'), max: LOTE_MAX.toLocaleString('pt-BR'), g: nomeGenero(genero), f: frente });
        $('acervo-n').style.color = 'var(--neon)';
      },
    });
  } catch (e) {
    $('acervo-n').textContent = t('acervo.erro', { m: e.message });
  }
  cavando = null;
  b.classList.remove('lig');
  if (r) {
    const ids = [...ids0, ...r.ids];
    // completo: chegou nos 1.000 OU as fontes acabaram (não adianta voltar hoje)
    const completo = ids.length >= LOTE_MAX || !r.parou;
    try { localStorage.setItem('garimpo.lote', JSON.stringify({ dia: hojeStr(), genero, ids, completo })); } catch {}
    window.garimpoEvento?.('lote', { genero, faixa: ids.length >= 900 ? '900+' : ids.length >= 300 ? '300-899' : '<300' });
    await mostrarAcervo();
    $('acervo-n').textContent = t(ids.length ? 'lote.pronto' : 'lote.nada', { n: ids.length.toLocaleString('pt-BR'), g: nomeGenero(genero) });
    $('acervo-n').style.color = 'var(--ok)';
    if (ids.length) mostrarLote();
  }
  botaoLote();
}
$('b-garimpar').onclick = () => {
  if (cavando) { cavando.abort(); return; }
  const l = loteDeHoje();
  if (l && !l.completo) { cavarLote(l.genero); return; }       // continua o de hoje
  if (l) {
    mostrarLote();
    $('acervo-n').textContent = t('lote.amanha', { n: l.ids.length.toLocaleString('pt-BR'), g: nomeGenero(l.genero) });
    $('acervo-n').style.color = 'var(--ok)';
    return;
  }
  $('lote-generos').innerHTML = LOTE_GENEROS.map((g) =>
    `<button data-g="${g.id}">${g.tudo ? t('lote.tudo') : g.id}</button>`).join('');
  $('lote').showModal();
};
$('lote-generos').onclick = (e) => {
  const g = e.target.closest('[data-g]')?.dataset.g;
  if (!g) return;
  $('lote').close();
  cavarLote(g);
};
$('fechar-lote').onclick = () => $('lote').close();
botaoLote();

/**
 * Na primeira visita, carrega o acervo que vem junto com o app.
 *
 * Sem isto, quem recebe o link abre o Garimpo vazio — o acervo do IndexedDB é
 * do aparelho de quem garimpou, não do endereço. A semente é um arquivo
 * estático no mesmo servidor, então custa zero e chega comprimido.
 *
 * Roda depois do primeiro quadro pra não disputar com a montagem da tela.
 */
(async () => {
  await new Promise((r) => setTimeout(r, 400));
  // uma semente por fonte (Audius, depois hearthis), cada uma com a sua versão
  let novasDaSemente = 0;
  for (const s of SEMENTES) {
    const r = await carregarSemente({
      ...s,
      aoAndar: ({ feitas, de }) => {
        $('acervo-n').textContent = t('acervo.semeando', { i: feitas, de });
        $('acervo-n').style.color = 'var(--acc)';
      },
    });
    if (r.carregou) novasDaSemente += r.novas;
  }
  // depois o que a galera garimpou desde a última visita, e o que ela tirou
  const g = await puxarGalera();
  const lixoDaGalera = await puxarLixo();
  if (lixoDaGalera) bib.definirLixoGalera(lixoDaGalera);
  await mostrarAcervo();
  if (novasDaSemente || g.novas) recarregar();
})();

mostrarAcervo();
window.addEventListener('idioma', mostrarAcervo);


/**
 * Busca a capa de uma faixa que veio sem ela.
 *
 * Uma requisição por faixa CARREGADA, não por faixa listada — é a diferença
 * entre 1 e 26 mil. O resultado fica na própria faixa, então trocar de deck e
 * voltar não busca de novo.
 */
const capasBuscadas = new Set();
async function buscarCapa(faixa, v) {
  if (capasBuscadas.has(faixa.id) || faixa.source === 'local') return;
  capasBuscadas.add(faixa.id);
  try {
    let url;
    if (ehHearthis(faixa)) {
      const d = await detalheHearthis(faixa);
      url = d?.artwork_url || d?.thumb;
    } else {
      const r = await fetch(`https://api.audius.co/v1/tracks/${faixa.id}?app_name=garimpo`);
      if (!r.ok) return;
      const d = (await r.json()).data;
      url = d?.artwork?.['480x480'] || d?.artwork?.['150x150'];
    }
    if (!url) return;
    faixa.artwork = url;
    // só pinta se esta faixa ainda for a que está no deck
    if (v.capa && v.titulo.textContent === faixa.title) {
      v.capa.src = url;
      v.capa.style.visibility = 'visible';
    }
  } catch { /* sem capa é só estético; nunca vale quebrar o carregamento */ }
}


// ─────────────────────────── estilo do DJ ───────────────────────────

/**
 * O jeito de tocar: cada escola prefere técnicas diferentes (ver tecnicas.js).
 * Fica lembrado entre visitas — quem gosta de techno hipnótico não quer
 * escolher de novo toda vez.
 */
registrarEstilo();
function opcoesDeEstilo() {
  const antes = $('pref-estilo').value;
  $('pref-estilo').innerHTML = Object.entries(ESTILOS).map(([id, e]) =>
    `<option value="${id}" title="${e.escola} — ${e.como}">${id === 'seu' ? '🧠 ' : ''}${e.nome}</option>`).join('');
  if (antes && ESTILOS[antes]) $('pref-estilo').value = antes;
}
opcoesDeEstilo();
try { $('pref-estilo').value = ESTILOS[localStorage.getItem('garimpo.estilo')] ? localStorage.getItem('garimpo.estilo') : 'pista'; } catch {}

// ─────────────────── a leitura das suas transições ───────────────────

/**
 * O DJ ASSISTE QUEM TOCA (coach/leitura.js + coach/meuestilo.js). Ele sempre
 * APRENDE — as suas transições boas viram o estilo "🧠 o seu" e as duplas que
 * você juntou atraem o montador do set — mas só FALA se você pedir: quem só
 * quer ouvir música nova e curtir tocando não recebe nota de ninguém. O
 * interruptor fica no ⚙ do DJ e é lembrado.
 */
let leituraLigada = false;
try { leituraLigada = localStorage.getItem('garimpo.leitura') === '1'; } catch {}
const sessao = { n: 0, soma: 0 };
function quadroLeitura(est) {
  const q = { agora: performance.now() / 1000, crossfader: est.crossfader, fase: est.fase?.emTempos, momentos: momentosDe };
  for (const id of ['A', 'B']) {
    const d = decks[id], c = mixer?.canal(id);
    q[id] = d ? { tocando: d.tocando, faixa: d.faixa, fader: c?.valores.fader, grave: c?.eq.get('grave'),
                  filtro: c?.filtro?.k, eco: c?.valores.eco, loop: d.loopTempos > 0, pos: d.displayPosition,
                  bpm: d.bpmEfetivo, grid: d.grid } : null;
  }
  return q;
}
// `var`: o professor pode rodar antes desta linha; aí ela ainda é undefined
var leitura = criarLeitura({ aoTerminar: (r) => {
  sessao.n++; sessao.soma += r.nota;
  window.garimpoEvento?.('transicao', { tecnica: r.tecnica, faixa: r.nota >= 85 ? '85+' : r.nota >= 70 ? '70-84' : r.nota >= 50 ? '50-69' : '<50' });
  if (aprender(r)) { if (registrarEstilo()) opcoesDeEstilo(); mostrarMeuEstilo(); }
  if (!leituraLigada) return;
  // o Jev dá o parecer da ESCOLHA (as duas músicas combinam?) no MESMO
  // cartão: espera por ele no máximo 2,5 s — dois avisos seguidos, o segundo
  // apagava a nota antes de dar pra ler
  const jev = r.sai && r.entra
    ? Promise.race([julgarPassagens([r.sai, r.entra]).catch(() => null), new Promise((ok) => setTimeout(ok, 2500, null))])
    : Promise.resolve(null);
  jev.then((j) => {
    if (!leituraLigada) return;
    const p = j?.notas?.[0];
    const selo = r.nota >= 85 ? '🔥' : r.nota >= 70 ? '✓' : '👀';
    avisoControladora({
      // em cima o que importa de relance (nota, técnica, média); embaixo os
      // pontos, o que pede atenção PRIMEIRO — a linha de baixo é cortada no fim
      fala: t('leitura.fala', { selo, nota: r.nota, tec: TECNICAS[r.tecnica]?.nome || r.tecnica, tempos: r.tempos })
        + (sessao.n > 1 ? ' · ' + t('leitura.sessao', { n: sessao.n, media: Math.round(sessao.soma / sessao.n) }) : ''),
      porque: [
        ...[...r.itens].sort((a, b) => a.ok - b.ok).map((x) => (x.ok ? '✓ ' : '• ') + t('leitura.' + x.k, x.v || {})),
        ...(typeof p === 'number' ? [t(p >= 0.5 ? 'leitura.jev.ok' : 'leitura.jev.mal', { p: Math.round(p * 100) })] : []),
      ].join(' · '),
      cor: r.nota >= 70 ? 'depois' : 'agora', ms: 12000,
    });
  });
} });
function mostrarMeuEstilo() {
  const n = quantasBoas();
  $('b-leitura').textContent = t(leituraLigada ? 'leitura.bt.sim' : 'leitura.bt.nao');
  $('b-leitura').classList.toggle('lig', leituraLigada);
  $('meu-estilo').textContent = n >= 3 ? t('leitura.aprendeu', { n }) : n ? t('leitura.aprendendo', { n }) : t('leitura.nada');
  $('b-esquecer-estilo').hidden = !n;
}
$('b-leitura').onclick = () => {
  leituraLigada = !leituraLigada;
  try { localStorage.setItem('garimpo.leitura', leituraLigada ? '1' : '0'); } catch {}
  mostrarMeuEstilo();
};
$('b-esquecer-estilo').onclick = () => {
  esquecerMeuEstilo();
  if ($('pref-estilo').value === 'seu') $('pref-estilo').value = 'pista';
  opcoesDeEstilo(); mostrarMeuEstilo();
};
mostrarMeuEstilo();
try { $('pref-variedade').value = localStorage.getItem('garimpo.variedade') || 'equilibrado'; } catch {}

/**
 * BPM DO SET: onde ele começa e onde termina. O montador (setlist.js) faz a
 * rampa entre os dois ao longo da duração escolhida, e só pega faixa que cabe
 * nessa faixa de andamento. Vazio = automático (aí vale a energia). Com o fim
 * definido a energia não manda mais — o select apaga pra deixar isso claro.
 */
const lerBpm = (id) => { const v = Math.round(Number($(id).value)); return v >= 60 && v <= 200 ? v : null; };
function bpmDoSet() { return { bpmIni: lerBpm('pref-bpm-ini'), bpmFim: lerBpm('pref-bpm-fim') }; }
/** A rampa no minuto em que o set está: pra troca de gênero continuar dali. */
function rampaAgora() {
  const { bpmIni, bpmFim } = bpmDoSet();
  if (!bpmFim || !piloto?.fila?.length) return bpmIni ? { bpmIni } : null;
  const min = Number($('pref-min').value);
  const tocado = piloto.fila.slice(0, piloto.indice).reduce((s, f) => s + (f.duration || 240) * 0.8, 0);
  const de = bpmIni || piloto.fila[0].bpm || bpmFim;
  const agora = de + (bpmFim - de) * Math.min(1, tocado / (min * 60));
  return { bpmIni: Math.round(agora), bpmFim, minutos: Math.max(10, Math.round(min - tocado / 60)) };
}
function mostrarBpmSet() {
  const { bpmIni, bpmFim } = bpmDoSet();
  $('pref-energia').disabled = !!bpmFim;
  $('pref-energia').title = bpmFim ? t('bpm.manda') : 'curva de energia';
  $('b-prefs').classList.toggle('lig', !!(bpmIni || bpmFim));
  $('b-prefs').title = bpmIni || bpmFim ? `BPM ${bpmIni ?? 'auto'} → ${bpmFim ?? 'auto'}` : t('pref.abrir');
}
try {
  const b = JSON.parse(localStorage.getItem('garimpo.bpmSet') || '{}');
  if (b.ini) $('pref-bpm-ini').value = b.ini;
  if (b.fim) $('pref-bpm-fim').value = b.fim;
} catch {}
for (const id of ['pref-bpm-ini', 'pref-bpm-fim']) {
  $(id).addEventListener('input', () => {
    const { bpmIni, bpmFim } = bpmDoSet();
    try { localStorage.setItem('garimpo.bpmSet', JSON.stringify({ ini: bpmIni, fim: bpmFim })); } catch {}
    mostrarBpmSet();
  });
}
$('b-bpm-auto').onclick = () => {
  $('pref-bpm-ini').value = ''; $('pref-bpm-fim').value = '';
  try { localStorage.removeItem('garimpo.bpmSet'); } catch {}
  mostrarBpmSet();
};
mostrarBpmSet();
$('pref-variedade').onchange = () => { try { localStorage.setItem('garimpo.variedade', $('pref-variedade').value); } catch {} };
/**
 * TROCAR O ESTILO NO MEIO DO SET. Antes só mudava metade: os gestos e o tempo
 * em cada faixa seguiam o estilo novo, mas as técnicas e durações das próximas
 * passagens continuavam as que o Jev decidiu no começo, pro estilo VELHO — e
 * nada avisava. Agora as próximas esquecem a decisão antiga (o escolhedor do
 * estilo novo já vale na próxima passagem), o Jev decide de novo em segundo
 * plano, e o Garimpeiro diz o que mudou. As músicas não mudam: estilo é o
 * jeito de tocar, não o que tocar.
 */
let pedidoEstilo = 0;
$('pref-estilo').onchange = () => {
  const est = $('pref-estilo').value;
  try { localStorage.setItem('garimpo.estilo', est); } catch {}
  if (!piloto) return;
  piloto.estilo = est;
  if (!piloto.ativo || !piloto.fila?.length) return;
  const proximas = piloto.fila.slice(piloto.indice + 1);
  for (const f of proximas) { delete f.tecnica; delete f.tempos; delete f.porqueIA; delete f.probsIA; }
  avisarTroca('n.estilo', { e: ESTILOS[est]?.nome || est, n: proximas.length });
  const meu = ++pedidoEstilo;
  const base = piloto.fila.slice(piloto.indice);
  decidirSet(base, est).then((decisao) => {
    if (!decisao || meu !== pedidoEstilo || !piloto?.ativo || piloto.estilo !== est) return;
    for (const d of aplicarDecisoes(base, decisao).slice(1)) {
      const k = piloto.fila.findIndex((x) => x.id === d.id);
      // só a que ainda não começou: a passagem em curso já tem técnica
      if (k > piloto.indice) Object.assign(piloto.fila[k], { tecnica: d.tecnica, tempos: d.tempos, porqueIA: d.porqueIA, probsIA: d.probsIA });
    }
    fila = piloto.fila.slice(piloto.indice);
    desenharFila();
  }).catch(() => {});
  fila = piloto.fila.slice(piloto.indice);
  desenharFila();
};


// ─────────────────────────── o Garimpeiro ───────────────────────────

/**
 * O mascote do professor mora à esquerda da lista de conselhos. Ver
 * mascote.js: ele traduz o estado em corpo — cor, dança, picareta — pra quem
 * está de olho nos controles e não no texto.
 */
mascote = montarMascote($('prof'));

// cava enquanto o garimpo roda
new MutationObserver(() => mascote.cavando($('b-garimpar').classList.contains('lig')))
  .observe($('b-garimpar'), { attributes: true, attributeFilter: ['class'] });


// ─────────────────────────── a pista de club ───────────────────────────

/**
 * O deck que está SOANDO mais: o que toca, pesado pelo crossfader. É ele que
 * dita a batida da pista e do mascote.
 */
function deckNoAr() {
  const a = decks.A?.tocando, b = decks.B?.tocando;
  if (a && b) return (mixer?.crossfader ?? 0.5) <= 0.5 ? decks.A : decks.B;
  return a ? decks.A : b ? decks.B : null;
}

montarPista({
  deckNoAr,
  nivel: () => { try { return nivelMaster(); } catch { return 0; } },
  momentos: (id) => momentosDe[id],
  espectro: lerEspectro,
  estilo: () => (piloto?.ativo ? piloto.estilo : $('pref-estilo').value) || 'pista',
});

// a viagem da página inteira (🌀): MilkDrop de fundo, formas voando na frente
/**
 * Os pads de som do mixer. O BPM é o de quem está no ar — o lado do
 * crossfader decide; se só um toca, é ele.
 */
const pads = montarPads({
  el: $('pads'),
  ctx: () => ctx,
  destino: () => mixer?.master,
  antes: () => garantirRodando(),
  bpm: () => {
    const a = decks.A, b = decks.B;
    const lado = (mixer?.crossfader ?? 0.5) <= 0.5 ? a : b, outro = lado === a ? b : a;
    return (lado?.tocando ? lado : outro?.tocando ? outro : lado)?.bpmEfetivo || 124;
  },
});

const viagem = montarViagem({ audio: () => (ctx && saidaMaster ? { ctx, no: saidaMaster } : null) });

// a janela da pista, na cabine: o que o DJ vê
montarCena($('janela-pista'), {
  viagem,
  // estável de propósito: muda quando o ESTADO muda (tocando, quebra, estilo),
  // nunca por contagem — número pulando no canto parecia mensagem aleatória
  rotulo: (e) => e.tocando
    ? `<span class="vivo"></span>${t(e.quebra ? 'cena.quebra' : 'cena.aoVivo')}${e.bpm ? ` · ${Math.round(e.bpm)} BPM` : ''}`
    : `<span class="vivo off"></span>${t('cena.vazia')}`,
});
// o nível de efeitos e os fps medidos entram no diagnóstico (⚙ do topo)
globalThis.__qualidade = qualidade;

/**
 * A gaveta de músicas (ver "gaveta de músicas" no index.html).
 *
 * `bib-fixa` = coluna presa do lado, como era; sem ela, o painel flutua e a
 * aba abre e fecha. Clicar fora fecha — mas só com a gaveta flutuando, e só
 * se o clique não foi na própria gaveta ou na aba.
 */
function abrirBib(aberta) {
  document.body.classList.toggle('bib-aberta', aberta);
  for (const l of ['A', 'B']) $('aba-' + l).setAttribute('aria-expanded', String(aberta && alvoBib === l));
  if (!aberta) mirar(null);
}

/**
 * De que lado a gaveta abre: o do deck. Trocar de lado com ela FECHADA é
 * instantâneo (ela está fora da tela dos dois jeitos); com transição ela
 * atravessaria a tela inteira de um lado pro outro.
 */
function ladoDaGaveta(id) {
  if (document.body.dataset.lado === id) return;
  document.body.classList.add('sem-trans');
  document.body.dataset.lado = id;
  void document.body.offsetWidth;
  document.body.classList.remove('sem-trans');
}

/**
 * O BROWSE do deck: abre a gaveta MIRANDO aquele deck. É o gesto da CDJ —
 * com a música tocando, aperta browse, acha a próxima, carrega, volta.
 */
let alvoBib = null;
function mirar(id) {
  alvoBib = id;
  if (id) document.body.dataset.alvo = id; else delete document.body.dataset.alvo;
  $('alvo-bib').hidden = !id;
  if (id) $('alvo-bib').textContent = t('bib.alvo', { d: id });
}
function abrirBibPara(id) {
  // o mesmo BROWSE de novo fecha, como na CDJ
  if (alvoBib === id && document.body.classList.contains('bib-aberta')) { fecharBrowse(); return; }
  // aberta do OUTRO lado: fecha antes, pra ela não atravessar a tela
  if (document.body.classList.contains('bib-aberta') && document.body.dataset.lado !== id) abrirBib(false);
  ladoDaGaveta(id);
  mirar(id);
  abrirBib(true);
  // no celular não há gaveta: a lista mora embaixo, então o BROWSE rola até ela
  if (!gaveta()) $('col-lib').scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (matchMedia('(pointer:fine)').matches) $('busca').focus({ preventScroll: true });
}
/** Tela larga ou deitada = painel de músicas vira gaveta (mesmo corte do CSS). */
const gaveta = () => matchMedia('(min-width:1041px), (orientation:landscape) and (max-width:1040px)').matches;
/** Carregou pelo BROWSE: com a gaveta flutuando ela fecha; presa, só desmira. */
function fecharBrowse(id = null) {
  if (document.body.classList.contains('bib-fixa') || !gaveta()) mirar(null);
  else abrirBib(false);
  // no celular, volta pro deck que recebeu a música
  if (id && !gaveta()) $('deck' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function fixarBib(fixa) {
  document.body.classList.toggle('bib-fixa', fixa);
  generosDaGaveta();
  $('b-bib-fixar').title = t(fixa ? 'bib.soltar' : 'bib.fixar');
  try { localStorage.setItem('garimpo.bib.fixa', fixa ? '1' : '0'); } catch {}
}
/** A gaveta começa logo abaixo da barra do professor, que tem altura fixa. */
function medirTopoBib() {
  const y = $('prof').getBoundingClientRect().bottom + 9;
  document.documentElement.style.setProperty('--bib-topo', Math.round(y) + 'px');
}
$('aba-A').onclick = () => abrirBibPara('A');
$('aba-B').onclick = () => abrirBibPara('B');
$('b-bib-fechar').onclick = () => abrirBib(false);
$('b-bib-fixar').onclick = () => fixarBib(!document.body.classList.contains('bib-fixa'));
document.addEventListener('pointerdown', (e) => {
  if (document.body.classList.contains('bib-fixa') || !document.body.classList.contains('bib-aberta')) return;
  if (e.target.closest('#col-lib, #porta, dialog, .browse, .aba-bib')) return;
  abrirBib(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrirBib(false); });
addEventListener('resize', medirTopoBib);
medirTopoBib();
try { fixarBib(localStorage.getItem('garimpo.bib.fixa') === '1'); } catch { fixarBib(false); }
acertarGaveta();

/**
 * Dois temas: COLORIDO (neon, o padrão) e ALL BLACK (preto de verdade, cores
 * fundas, pista baixa). O atributo vai no <html>; o CSS e a pista leem dali.
 * O index.html aplica o tema salvo antes da página pintar, pra não piscar.
 */
$('b-tema').onclick = () => {
  const black = document.documentElement.dataset.tema !== 'black';
  if (black) document.documentElement.dataset.tema = 'black';
  else delete document.documentElement.dataset.tema;
  try { localStorage.setItem('garimpo.tema', black ? 'black' : ''); } catch {}
};

pintarModoDj();

// o Garimpeiro recebe na porta, já dançando
const mascotePorta = montarMascote($('porta-masc'));
mascotePorta.humor(null);
mascotePorta.batida(122);


/**
 * O preenchimento dos faders (ver "FADERS DE MESA" no index.html).
 *
 * CSS não enxerga o valor de um input, então o trilho aceso vem de duas
 * variáveis escritas aqui. Por intervalo e não só no evento `input`: quem
 * mais mexe nos controles durante um set é o DJ automático, e ele muda o
 * valor por código, sem evento nenhum.
 */
function pintarTrilhos() {
  for (const el of document.querySelectorAll('input[type=range]')) {
    const mn = Number(el.min || 0), mx = Number(el.max || 100), v = Number(el.value);
    const p = mx > mn ? ((v - mn) / (mx - mn)) * 100 : 0;
    const centro = mn < 0 || 'eq' in el.dataset || el.classList.contains('xf');
    const de = centro ? Math.min(50, p) : 0, ate = centro ? Math.max(50, p) : p;
    const k = de.toFixed(1) + '|' + ate.toFixed(1);
    if (el._trilho === k) continue;
    el._trilho = k;
    el.style.setProperty('--de', de.toFixed(1) + '%');
    el.style.setProperty('--ate', ate.toFixed(1) + '%');
  }
}
document.addEventListener('input', (ev) => { if (ev.target.type === 'range') pintarTrilhos(); });
setInterval(pintarTrilhos, 120);
pintarTrilhos();

// ─────────────────────────── controladora de DJ ───────────────────────────

/**
 * A controladora de verdade (ver src/controle/controladora.js). Ela recebe o
 * que a mão usa na tela — os mesmos decks, o mesmo mixer, os mesmos botões —
 * e nada além disso: se a controladora consegue, a tela consegue.
 */
montarControladora({
  g: {
    deck: (id) => decks[id],
    mixer: () => mixer,
    pads: () => pads,
    sampleRate: () => ctx?.sampleRate || 48000,
    ligarAudio: () => { garantirRodando(); },
    // mexer na controladora é encostar num controle: o piloto solta (a mesma regra do pointerdown)
    gesto: () => {
      if (!piloto?.ativo || piloto.juntos) return;
      pararPiloto();
      $('piloto-nota').textContent = 'você assumiu — o piloto soltou';
      $('piloto-nota').style.color = 'var(--cue)';
    },
    sincronizar: (id) => sincronizar(id),
    encaixar: (id) => {
      const r = erroDeFase(decks[id === 'A' ? 'B' : 'A'], decks[id]);
      if (r) decks[id].deslocar(-r.emMs / 1000, { emSeg: 0.5 });
    },
    fone: (id, on) => { const b = $('fone-' + id); if (b && b.classList.contains('lig') !== on) b.click(); },
    faixaPitch: (id, r) => {
      const b = [...(vistas[id]?.faixaSel?.querySelectorAll('button') || [])].find((x) => Math.abs(Number(x.dataset.r) - r) < 1e-6);
      if (b) b.click(); else decks[id]?.setPitchRange(r);
    },
    curva: (c) => mixer?.setCurva(c),
    jogTela: (id, on) => { vistas[id]?.jog?.classList.toggle('ativo', on); vistas[id]?.jog?.classList.toggle('scratch', on); },
    loopMudou: (id) => decks[id]?.dispatchEvent(new CustomEvent('loop', { detail: {} })),
    piloto: { ativo: () => !!piloto?.ativo, alternar: () => $('b-piloto').click(), pular: () => piloto?.pular() },
  },
  gaveta: {
    abrir: (on = true) => abrirBib(on),
    aberta: () => document.body.classList.contains('bib-aberta'),
    alvo: () => alvoBib,
    deckLivre,
  },
  avisar: avisoControladora,
  mascote: () => mascote,
});
