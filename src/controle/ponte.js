/**
 * A ponte: cada controle do Mixxx vira um método do Garimpo.
 *
 * Os mapeamentos falam a língua do Mixxx — `[Channel1] play`, `[Master]
 * crossfader`, `[EqualizerRack1_[Channel2]_Effect1] parameter1`. Aqui cada
 * frase dessas vira a MESMA chamada que a mão faz na tela (a regra do piloto:
 * não existe atalho privilegiado). O que o Garimpo não tem — quatro decks,
 * efeitos em cadeia, a árvore de playlists — fica guardado e devolvido, pra que
 * o script siga funcionando e só aquele pedaço fique inerte.
 *
 * E aqui mora o "não fisicamente": o Garimpeiro mexe no EQ e o knob de
 * plástico não se move. Sem cuidado, o primeiro toque na controladora faria o
 * som pular pra onde o knob está. A regra é o soft takeover do Mixxx
 * (softtakeover.cpp: 3/128 de distância, 50 ms), mas valendo pra TODO controle
 * contínuo, porque no Garimpo quem mais mexe no mixer é o DJ automático — e
 * também quando a controladora conecta no meio de um set, com os faders
 * parados onde a pessoa deixou. Enquanto o knob não "pega", o que ele manda
 * vira só um fantasma na tela: é onde a sua mão está, e girar até lá pega.
 */

import { conversoes } from './comportamento.js';

const LIMIAR = 3 / 128;
const JANELA_MS = 50;
const ratio2db = (r) => 20 * Math.log10(r);
const prender = (x, a, b) => Math.max(a, Math.min(b, x));

const D = {
  xf: { tipo: 'pot', min: -1, max: 1, padrao: 0 },
  rate: { tipo: 'pot', min: -1, max: 1, padrao: 0 },
  pot01: { tipo: 'pot', min: 0, max: 1, padrao: 0 },
  meio: { tipo: 'pot', min: 0, max: 1, padrao: 0.5 },
  cheio: { tipo: 'pot', min: 0, max: 1, padrao: 1 },
  bipolar: { tipo: 'pot', min: -1, max: 1, padrao: 0 },
  volume: { tipo: 'audio', minDb: -20, maxDb: 0, neutro: 1, padrao: 1 },
  pregain: { tipo: 'audio', minDb: -12, maxDb: 12, neutro: 0.5, padrao: 1 },
  ganho: { tipo: 'audio', minDb: -14, maxDb: 14, neutro: 0.5, padrao: 1 },
  eq: { tipo: 'audio', minDb: -12, maxDb: ratio2db(4), neutro: 0.5, padrao: 1 },
  toggle: { tipo: 'toggle', padrao: 0 },
  toggle1: { tipo: 'toggle', padrao: 1 },
  push: { tipo: 'push', padrao: 0 },
  janela: { tipo: 'janela', padrao: 0 },
  num: { tipo: 'num', padrao: 0 },
  enc: { tipo: 'encoder', padrao: 0 },
};

/** Botões de apertar e soltar (ControlPushButton sem modo). */
const PUSH = /(_activate|_clear|_set|_goto|_gotoandplay|_gotoandstop|_gotoandloop|_forward|_backward|_up|_down|_up_small|_down_small|_stutter|_set_default|_set_zero|_set_one|_toggle)$|^(back|fwd|start|end|start_play|start_stop|eject|reverse|reverseroll|cue_default|cue_play|cue_set|cue_simple|cue_cdj|beatsync|beatsync_tempo|beatsync_phase|loop_in|loop_out|loop_halve|loop_double|reloop_toggle|reloop_exit|reloop_andstop|beatloop_activate|beatloop_toggle|beatlooproll_activate|next_effect|prev_effect|next_chain|prev_chain|skip_next|fade_now|GoToItem|MoveUp|MoveDown|MoveLeft|MoveRight|MoveFocusForward|MoveFocusBackward|SelectNextTrack|SelectPrevTrack|SelectNextPlaylist|SelectPrevPlaylist|ToggleSelectedSidebarItem|LoadSelectedIntoFirstStopped|LoadSelectedTrack|LoadSelectedTrackAndPlay|bpm_tap|tempo_tap|sync_key|reset_key|pitch_up|pitch_down|play_stutter|clear|beats_translate_curpos|beats_translate_earlier|beats_translate_later|beats_translate_match_alignment|shift_cues_earlier|shift_cues_later)$/;
const TOGGLE = /^(pfl|keylock|quantize|slip_enabled|sync_enabled|mute|repeat|headSplit|talkover|passthrough|show_\w+|group_\[.+\]_enable|sync_leader|sync_master)$/;

/** Paleta de hot cue do Mixxx (as 8 primeiras cores padrão). */
const CORES_HOTCUE = [0xc50a08, 0x32be44, 0x0044ff, 0xf8d200, 0x42d4f4, 0xaf00cc, 0xfca6d7, 0xf2f2ff];

// ─────────────────────────── grupos ───────────────────────────

const DECK = { 1: 'A', 2: 'B' };
const cacheGrupo = new Map();
function lerGrupo(g) {
  let r = cacheGrupo.get(g);
  if (r) return r;
  let m;
  if ((m = /^\[Channel(\d+)\]$/.exec(g))) r = { t: 'deck', id: DECK[m[1]] || null };
  else if ((m = /^\[EqualizerRack1_\[Channel(\d+)\]_Effect1\]$/.exec(g))) r = { t: 'eq', id: DECK[m[1]] || null };
  else if ((m = /^\[QuickEffectRack1_\[Channel(\d+)\]\]$/.exec(g))) r = { t: 'filtro', id: DECK[m[1]] || null };
  else if ((m = /^\[Sampler(\d+)\]$/.exec(g))) r = { t: 'sampler', i: Number(m[1]) - 1 };
  else if ((m = /^\[EffectRack1_EffectUnit(\d+)\]$/.exec(g))) r = { t: 'fx', u: Number(m[1]) };
  else if ((m = /^\[EffectRack1_EffectUnit(\d+)_Effect(\d+)\]$/.exec(g))) r = { t: 'fxSlot', u: Number(m[1]), e: Number(m[2]) };
  else if (/^\[(Master|Main|Mixer)\]$/.test(g)) r = { t: 'master' };
  else if (g === '[Mixer Profile]') r = { t: 'perfil' };
  else if (g === '[Library]' || g === '[Playlist]') r = { t: 'lib' };
  else if (g === '[AutoDJ]') r = { t: 'autodj' };
  else if (g === '[App]') r = { t: 'app' };
  else if (g === '[Skin]') r = { t: 'skin' };
  else r = { t: 'outro' };
  cacheGrupo.set(g, r);
  return r;
}
const BANDA = { parameter1: 'grave', parameter2: 'medio', parameter3: 'agudo',
                button_parameter1: 'grave', button_parameter2: 'medio', button_parameter3: 'agudo' };

/**
 * @param {object} g  o que a ponte precisa do Garimpo (ver montarControladora)
 */
export function criarPonte(g, { relogio = () => performance.now() } = {}) {
  const guardado = new Map();            // controles sem par no Garimpo: o valor que o script deixou
  const k = (grupo, chave) => grupo + '\u0000' + chave;
  const guardar = (grupo, chave, v) => guardado.set(k(grupo, chave), v);
  const guardadoOu = (grupo, chave, padrao) => (guardado.has(k(grupo, chave)) ? guardado.get(k(grupo, chave)) : padrao);

  const dk = (id) => (id ? g.deck(id) : null);
  const cn = (id) => (id ? g.mixer()?.canal(id) : null);
  const sr = () => g.sampleRate() || 48000;
  const piscar = (ms) => (Math.floor(relogio() / ms) % 2 ? 1 : 0);

  // ── estado que o Garimpo não tem e o Mixxx sim ──
  const est = {
    A: { cue: false, sync: 0, syncT: 0, slip: 0, scratch: 0, scratch2: 0, jog: 0, hot: new Map(), faixa: null,
         loopIn: null, manual: null, ultimoLoop: null, rolando: null },
    B: { cue: false, sync: 0, syncT: 0, slip: 0, scratch: 0, scratch2: 0, jog: 0, hot: new Map(), faixa: null,
         loopIn: null, manual: null, ultimoLoop: null, rolando: null },
  };
  const segurando = new Map();            // botões que repetem enquanto apertados (back, fwd, nudge)
  let ecoFx = { A: null, B: null };

  // ─────────────── soft takeover ───────────────

  const tomadas = new Map();              // id -> { t, prev, hw, ultimoToque }
  function aceitar(id, novo, atual) {
    let s = tomadas.get(id);
    if (!s) { s = { t: 0, prev: 0, hw: null, toque: 0 }; tomadas.set(id, s); }
    const agora = relogio();
    let ignora = false;
    if (s.t === 0) {
      ignora = true;           // o primeiro valor nunca entra: é o que evita o salto
      s.t = 1;
    } else if (agora - s.t > JANELA_MS) {
      const dif = atual - novo, difAnt = atual - s.prev;
      if (((difAnt < 0 && dif < 0) || (difAnt > 0 && dif > 0)) &&
          Math.abs(dif) > LIMIAR && Math.abs(difAnt) > LIMIAR) ignora = true;
    }
    if (!ignora) s.t = agora;
    s.prev = novo;
    s.hw = novo;
    s.toque = agora;
    return !ignora;
  }

  // ─────────────── ações do Garimpo ───────────────

  const temFaixa = (id) => !!dk(id)?.faixa;
  function tocar(id) { const d = dk(id); if (d?.faixa && !d.tocando) { g.ligarAudio?.(); d.play(); } }
  function parar(id) { const d = dk(id); if (d?.tocando) d.pause(); }
  function irPara(id, pos) { const d = dk(id); if (d?.faixa) d.seek(prender(pos, 0, d.duration || 0)); }
  const periodo = (id) => { const b = dk(id)?.grid?.bpm || dk(id)?.bpmNatural; return b ? 60 / b : null; };

  function loopAtivo(id) { return !!(dk(id)?.loopTempos || est[id].manual); }
  function sairLoop(id) {
    const d = dk(id);
    if (!d) return;
    d.clearLoop();
    est[id].manual = null;
    g.loopMudou?.(id);
  }
  function loopDeTempos(id, n) {
    const d = dk(id);
    if (!d?.faixa || !n) return;
    est[id].manual = null;
    if (d.loopDeTempos(n)) g.loopMudou?.(id);
  }
  function loopManual(id, start, end) {
    const d = dk(id);
    if (!d?.faixa || !(end > start)) return;
    d.loopTempos = 0;
    d.setLoop({ start, end, on: true });
    est[id].manual = { start, end };
    est[id].ultimoLoop = { start, end, tempos: 0 };
    g.loopMudou?.(id);
  }
  function reloop(id, { parado = false } = {}) {
    const u = est[id].ultimoLoop;
    const d = dk(id);
    if (!u || !d?.faixa) return;
    if (u.tempos) { d.loopTempos = u.tempos; d.setLoop({ start: u.start, end: u.end, on: true }); est[id].manual = null; }
    else loopManual(id, u.start, u.end);
    if (parado || d.position > u.end || d.position < u.start - 0.02) irPara(id, u.start);
    if (parado) parar(id);
    g.loopMudou?.(id);
  }
  function escalarLoop(id, f) {
    const d = dk(id);
    if (!d?.faixa || !(f > 0)) return;
    if (d.loopTempos) loopDeTempos(id, prender(d.loopTempos * f, 1 / 32, 64));
    else if (est[id].manual) { const m = est[id].manual; loopManual(id, m.start, m.start + (m.end - m.start) * f); }
  }
  function pularTempos(id, n) {
    const p = periodo(id), d = dk(id);
    if (!p || !d?.faixa || !n) return;
    irPara(id, d.position + n * p);
  }

  function hotcue(id, x, acao) {
    const d = dk(id);
    if (!d?.faixa) return;
    const h = est[id].hot;
    if (acao === 'limpar') { h.delete(x); return; }
    if (acao === 'marcar' || (acao === 'usar' && !h.has(x))) {
      // com grade, o hot cue cai na batida mais próxima, como o quantize do Mixxx
      let pos = d.position;
      const p = periodo(id), anc = d.grid?.ancora ?? 0;
      if (p && guardadoOu(`[Channel${id === 'A' ? 1 : 2}]`, 'quantize', 0)) pos = anc + Math.round((pos - anc) / p) * p;
      h.set(x, Math.max(0, pos));
      return;
    }
    irPara(id, h.get(x));
    if (acao === 'tocar') tocar(id);
    if (acao === 'parar') parar(id);
  }

  /** Repete `passo` enquanto o botão está apertado; soltar para. */
  function segurar(chave, apertou, passo, intervalo = 60) {
    clearInterval(segurando.get(chave));
    segurando.delete(chave);
    if (!apertou) return;
    passo();
    segurando.set(chave, setInterval(passo, intervalo));
  }

  /**
   * O jog sem o toque: o Mixxx soma os ticks e aplica como um empurrão de taxa
   * (RateControl::getJogFactor). O deslocar do Garimpo faz o mesmo, mas cada
   * chamada recomeça a janela — então os ticks juntam por 40 ms e saem de uma vez.
   */
  let laçoJog = null;
  function empurrar(id, v) {
    est[id].jog += v;
    if (laçoJog) return;
    laçoJog = setInterval(() => {
      let algum = false;
      for (const x of ['A', 'B']) {
        const acum = est[x].jog;
        if (!acum) continue;
        est[x].jog = 0;
        algum = true;
        const d = dk(x);
        if (!d?.faixa) continue;
        d.deslocar(acum * (d.tocando ? 0.0012 : 0.006), { emSeg: 0.04 });
      }
      if (!algum) { clearInterval(laçoJog); laçoJog = null; }
    }, 40);
  }

  function nivelVu(rms) {
    if (!(rms > 0)) return 0;
    return prender((ratio2db(rms) + 50) / 50, 0, 1);
  }

  // ── efeitos: a unidade 1 do Mixxx vira o ECO dos canais que ela pega ──
  function refazerEco() {
    const m = g.mixer();
    if (!m) return;
    for (const [id, n] of [['A', 1], ['B', 2]]) {
      let v = 0;
      for (const u of [1, 2, 3, 4]) {
        const G = `[EffectRack1_EffectUnit${u}]`;
        if (!guardadoOu(G, 'enabled', 1) || !guardadoOu(G, `group_[Channel${n}]_enable`, 0)) continue;
        const algumSlot = [1, 2, 3].some((e) => guardadoOu(`[EffectRack1_EffectUnit${u}_Effect${e}]`, 'enabled', 0));
        if (!algumSlot) continue;
        v = Math.max(v, prender(guardadoOu(G, 'mix', 1), 0, 1));
      }
      if (ecoFx[id] === v) continue;
      ecoFx[id] = v;
      m.setEco(id, v);
    }
  }

  // ─────────────── a tabela ───────────────

  const cache = new Map();

  /** Controle ligado a um knob da tela: soft takeover e fantasma. */
  const continuo = (b) => ({ ...b, cont: true, gesto: true });

  function montar(grupo, chave) {
    const gr = lerGrupo(grupo);
    const guardadoB = (d) => ({
      d, ler: () => guardadoOu(grupo, chave, d?.padrao ?? 0), escrever: (v) => guardar(grupo, chave, v),
    });

    // ── deck ──
    if (gr.t === 'deck') {
      const id = gr.id;
      if (!id) {
        // decks 3 e 4 não existem no Garimpo, mas os scripts de 4 decks fazem
        // conta com eles: devolver 0 pra faixa de pitch vira divisão por zero
        const d = PUSH.test(chave) ? D.push : TOGGLE.test(chave) ? D.toggle : D.num;
        const padrao = { rateRange: 0.08, rate_dir: -1, rate_ratio: 1, beatloop_size: 4, beatjump_size: 4,
                         track_samplerate: sr(), local_bpm: 120, bpm: 120, file_bpm: 120 }[chave];
        return { d, ler: () => guardadoOu(grupo, chave, padrao ?? d.padrao), escrever: (v) => guardar(grupo, chave, v) };
      }
      const e = est[id];
      const n = id === 'A' ? 1 : 2;
      const push = (fn) => ({ d: D.push, gesto: true, ler: () => guardadoOu(grupo, chave, 0),
                              escrever: (v) => { guardar(grupo, chave, v); fn(v > 0, v); } });
      let m;
      switch (chave) {
        case 'play': case 'play_latched':
          return { d: D.toggle, gesto: true, ler: () => (dk(id)?.tocando ? 1 : 0), escrever: (v) => (v ? tocar(id) : parar(id)) };
        case 'play_indicator':
          return { d: D.num, ler: () => (dk(id)?.tocando ? 1 : 0), escrever() {} };
        case 'cue_default': case 'cue_cdj': case 'cue_simple':
          return push((ap) => {
            const d = dk(id);
            if (!d?.faixa) return;
            if (ap) { e.cue = true; g.ligarAudio?.(); d.cuePress(); } else if (e.cue) { e.cue = false; d.cueRelease(); }
          });
        case 'cue_indicator':
          return { d: D.num, escrever() {}, ler() {
            const d = dk(id);
            if (!d?.faixa) return 0;
            if (e.cue) return 1;
            if (d.tocando) return 0;
            return Math.abs(d.position - d.cuePoint) < 0.05 ? 1 : piscar(500);
          } };
        case 'cue_gotoandplay': case 'cue_play': case 'play_stutter':
          return push((ap) => { if (ap) { irPara(id, dk(id)?.cuePoint ?? 0); tocar(id); } });
        case 'cue_gotoandstop':
          return push((ap) => { if (ap) { parar(id); irPara(id, dk(id)?.cuePoint ?? 0); } });
        case 'cue_goto':
          return push((ap) => { if (ap) irPara(id, dk(id)?.cuePoint ?? 0); });
        case 'cue_set':
          return push((ap) => { const d = dk(id); if (ap && d?.faixa) d.setCuePoint(d.position); });
        case 'cue_point':
          return { d: D.num, ler: () => (temFaixa(id) ? dk(id).cuePoint * sr() * 2 : -1), escrever() {} };
        case 'start_play':
          return push((ap) => { if (ap) { irPara(id, 0); tocar(id); } });
        case 'start_stop':
          return push((ap) => { if (ap) { parar(id); irPara(id, 0); } });
        case 'start':
          return push((ap) => { if (ap) irPara(id, 0); });
        case 'end':
          return push((ap) => { if (ap) irPara(id, (dk(id)?.duration || 0) - 0.5); });
        case 'back': case 'fwd':
          return push((ap) => segurar(id + chave, ap, () => {
            const d = dk(id);
            if (d?.faixa) irPara(id, d.position + (chave === 'fwd' ? 0.35 : -0.35));
          }));
        case 'volume':
          return continuo({ d: D.volume, tela: `vol-${id}`, telaDe: (p) => p, id: `${id}:vol`,
            param: () => cn(id)?.valores.fader ?? 1,
            ler() { return conversoes(D.volume).parametroParaValor(cn(id)?.valores.fader ?? 1); },
            escrever(v) { cn(id)?.setFader(prender(conversoes(D.volume).valorParaParametro(v), 0, 1)); } });
        case 'pregain':
          return continuo({ d: D.pregain, id: `${id}:trim`,
            param: () => conversoes(D.pregain).valorParaParametro(Math.pow(10, (cn(id)?.valores.trim ?? 0) / 20)),
            ler: () => Math.pow(10, (cn(id)?.valores.trim ?? 0) / 20),
            escrever(v) { cn(id)?.setTrim(prender(v > 0 ? ratio2db(v) : -24, -24, 12)); } });
        case 'pfl':
          return { d: D.toggle, gesto: true, ler: () => (cn(id)?.cueLigado ? 1 : 0), escrever: (v) => g.fone?.(id, !!v) };
        case 'rate':
          return continuo({ d: D.rate, tela: `pitch-${id}`, telaDe: (p) => p * 2 - 1, id: `${id}:rate`,
            param() { const d = dk(id), r = d?.transport?.pitchRange; return r ? (-d.pitch / r + 1) / 2 : 0.5; },
            ler() { const d = dk(id), r = d?.transport?.pitchRange; return r ? -d.pitch / r : 0; },
            escrever(v) { const d = dk(id), r = d?.transport?.pitchRange; if (r) d.setPitch(-prender(v, -1, 1) * r); } });
        case 'rateRange':
          return { d: D.num, ler: () => dk(id)?.transport?.pitchRange ?? 0.08, escrever: (v) => g.faixaPitch?.(id, v) };
        case 'rate_dir':
          return { d: D.num, ler: () => -1, escrever() {} };
        case 'rate_ratio':
          return { d: D.num, ler: () => dk(id)?.nominalRate ?? 1, escrever() {} };
        case 'rate_set_default': case 'rate_set_zero':
          return push((ap) => { if (ap) dk(id)?.setPitch(0); });
        case 'rate_perm_up': case 'rate_perm_down': case 'rate_perm_up_small': case 'rate_perm_down_small':
          return push((ap) => {
            const d = dk(id);
            if (!ap || !d) return;
            const passo = (chave.endsWith('small') ? 0.001 : 0.01) * (chave.includes('_up') ? 1 : -1);
            d.setPitch(d.pitch + passo);
          });
        case 'rate_temp_up': case 'rate_temp_down': case 'rate_temp_up_small': case 'rate_temp_down_small': {
          // empurrãozinho enquanto segura, como os botões de milissegundo da tela
          let nPassos = 0;
          return push((ap) => {
            if (ap) nPassos = 0;
            segurar(id + chave, ap, () => {
              const d = dk(id);
              if (!d?.faixa) return;
              const ms = Math.min(20, 5 + nPassos++ * 1.5) * (chave.endsWith('small') ? 0.5 : 1);
              d.deslocar((chave.includes('_up') ? 1 : -1) * ms / 1000, { emSeg: 0.25 });
            }, 110);
          });
        }
        case 'keylock':
          return { d: D.toggle, gesto: true, ler: () => (dk(id)?.keylockPedido ? 1 : 0), escrever: (v) => dk(id)?.setKeylock(!!v) };
        case 'sync_enabled':
          return { d: D.toggle, gesto: true,
            ler: () => (e.sync && relogio() - e.syncT < 1800 ? 1 : 0),
            escrever(v) { if (v) { g.sincronizar?.(id); e.sync = 1; e.syncT = relogio(); } else e.sync = 0; } };
        case 'beatsync': case 'beatsync_tempo':
          return push((ap) => { if (ap) { g.sincronizar?.(id); e.sync = 1; e.syncT = relogio(); } });
        case 'beatsync_phase':
          return push((ap) => { if (ap) g.encaixar?.(id); });
        case 'slip_enabled':
          return { d: D.toggle, gesto: true, ler: () => e.slip, escrever(v) { e.slip = v ? 1 : 0; dk(id)?.transport?.setSlip(!!v); } };
        case 'scratch2_enable':
          return { d: D.num, gesto: true, ler: () => e.scratch, escrever(v) {
            const d = dk(id);
            const on = v ? 1 : 0;
            if (on === e.scratch) return;
            e.scratch = on;
            if (!d) return;
            if (on) d.touchStart(); else d.touchEnd();
            g.jogTela?.(id, !!on);
          } };
        case 'scratch2':
          return { d: D.num, gesto: true, ler: () => e.scratch2, escrever(v) { e.scratch2 = v; if (e.scratch) dk(id)?.setScratchRate(v); } };
        case 'jog':
          return { d: D.num, gesto: true, ler: () => 0, escrever: (v) => { if (v) empurrar(id, v); } };
        case 'wheel':
          return { d: D.num, gesto: true, ler: () => 0, escrever: (v) => { if (v) empurrar(id, v * 4); } };
        case 'loop_enabled':
          return { d: D.toggle, gesto: true, ler: () => (loopAtivo(id) ? 1 : 0), escrever: (v) => (v ? reloop(id) : sairLoop(id)) };
        case 'reloop_toggle': case 'reloop_exit':
          return push((ap) => { if (ap) (loopAtivo(id) ? sairLoop(id) : reloop(id)); });
        case 'reloop_andstop':
          return push((ap) => { if (ap) reloop(id, { parado: true }); });
        case 'loop_in':
          return push((ap) => { const d = dk(id); if (ap && d?.faixa) e.loopIn = d.position; });
        case 'loop_out':
          return push((ap) => {
            const d = dk(id);
            if (!ap || !d?.faixa) return;
            const ini = e.loopIn ?? (est[id].manual?.start ?? null);
            if (ini != null && d.position > ini + 0.02) loopManual(id, ini, d.position);
          });
        case 'loop_halve': return push((ap) => { if (ap) escalarLoop(id, 0.5); });
        case 'loop_double': return push((ap) => { if (ap) escalarLoop(id, 2); });
        case 'loop_scale':
          return { d: D.num, gesto: true, ler: () => 1, escrever: (v) => escalarLoop(id, v) };
        case 'loop_move':
          return { d: D.num, gesto: true, ler: () => 0, escrever(v) {
            const p = periodo(id), m = est[id].manual, d = dk(id);
            if (!p || !v || !d) return;
            if (m) loopManual(id, m.start + v * p, m.end + v * p);
            else if (d.loopTempos && e.ultimoLoop) {
              const u = e.ultimoLoop;
              loopManual(id, u.start + v * p, u.end + v * p);
            }
          } };
        case 'loop_start_position': case 'loop_end_position':
          return { d: D.num, gesto: true, ler() {
            const m = est[id].manual || (dk(id)?.loopTempos ? e.ultimoLoop : null);
            if (!m) return -1;
            return (chave === 'loop_start_position' ? m.start : m.end) * sr() * 2;
          }, escrever(v) {
            const m = est[id].manual || (dk(id)?.loopTempos ? e.ultimoLoop : null);
            if (!m || !(v >= 0)) return;
            const s = v / sr() / 2;
            if (chave === 'loop_start_position') loopManual(id, s, m.end); else loopManual(id, m.start, s);
          } };
        case 'beatloop_size':
          return { d: D.num, ler: () => guardadoOu(grupo, chave, 4), escrever: (v) => guardar(grupo, chave, v) };
        case 'beatloop_activate':
          return push((ap) => { if (ap) loopDeTempos(id, guardadoOu(grupo, 'beatloop_size', 4)); });
        case 'beatloop_toggle':
          return push((ap) => {
            if (!ap) return;
            const n2 = guardadoOu(grupo, 'beatloop_size', 4);
            if (dk(id)?.loopTempos === n2) sairLoop(id); else loopDeTempos(id, n2);
          });
        case 'beatlooproll_activate':
          return push((ap) => rolar(id, ap, guardadoOu(grupo, 'beatloop_size', 4)));
        case 'beatjump_size':
          return { d: D.num, ler: () => guardadoOu(grupo, chave, 4), escrever: (v) => guardar(grupo, chave, v) };
        case 'beatjump':
          return { d: D.num, gesto: true, ler: () => 0, escrever: (v) => pularTempos(id, v) };
        case 'beatjump_forward': case 'beatjump_backward':
          return push((ap) => { if (ap) pularTempos(id, (chave.endsWith('forward') ? 1 : -1) * guardadoOu(grupo, 'beatjump_size', 4)); });
        case 'track_loaded':
          return { d: D.num, ler: () => (temFaixa(id) ? 1 : 0), escrever() {} };
        case 'duration':
          return { d: D.num, ler: () => dk(id)?.duration || 0, escrever() {} };
        case 'track_samples':
          return { d: D.num, ler: () => (dk(id)?.duration || 0) * sr() * 2, escrever() {} };
        case 'track_samplerate':
          return { d: D.num, ler: () => sr(), escrever() {} };
        case 'playposition': case 'visual_playposition':
          return { d: D.num, gesto: true, ler() { const d = dk(id); return d?.duration ? d.position / d.duration : 0; },
            escrever(v) { const d = dk(id); if (d?.duration) irPara(id, v * d.duration); } };
        case 'end_of_track':
          return { d: D.num, ler() { const d = dk(id); return d?.tocando && d.duration && d.duration - d.position < 30 ? 1 : 0; }, escrever() {} };
        case 'bpm': case 'visual_bpm':
          return { d: D.num, ler: () => dk(id)?.bpmEfetivo || 0, escrever() {} };
        case 'file_bpm': case 'local_bpm':
          // em amostras da FAIXA (não do relógio): é o andamento sem o pitch
          return { d: D.num, ler: () => dk(id)?.bpmNatural || 0, escrever() {} };
        case 'beat_closest': case 'beat_next': case 'beat_prev':
          return { d: D.num, escrever() {}, ler() {
            const d = dk(id), p = periodo(id);
            if (!d?.faixa || !p) return -1;
            const anc = d.grid?.ancora ?? 0, n = (d.position - anc) / p;
            const b = chave === 'beat_next' ? Math.ceil(n) : chave === 'beat_prev' ? Math.floor(n) : Math.round(n);
            return Math.max(0, anc + b * p) * sr() * 2;
          } };
        case 'time_elapsed':
          return { d: D.num, ler: () => dk(id)?.position || 0, escrever() {} };
        case 'time_remaining':
          return { d: D.num, ler: () => Math.max(0, (dk(id)?.duration || 0) - (dk(id)?.position || 0)), escrever() {} };
        case 'beat_active': case 'beat_distance':
          return { d: D.num, escrever() {}, ler() {
            const d = dk(id), p = periodo(id);
            if (!d?.faixa || !p) return 0;
            const fase = (((d.position - (d.grid?.ancora ?? 0)) / p) % 1 + 1) % 1;
            return chave === 'beat_distance' ? fase : (d.tocando && fase < 0.2 ? 1 : 0);
          } };
        case 'vu_meter': case 'VuMeter': case 'vu_meter_left': case 'vu_meter_right': case 'VuMeterL': case 'VuMeterR':
          return { d: D.num, ler: () => nivelVu(cn(id)?.nivel), escrever() {} };
        case 'peak_indicator': case 'PeakIndicator': case 'peak_indicator_left': case 'peak_indicator_right':
          return { d: D.num, ler: () => ((cn(id)?.nivel ?? 0) > 0.63 ? 1 : 0), escrever() {} };
        case 'LoadSelectedTrack':
          return { d: D.push, ler: () => 0, escrever: (v) => { if (v > 0) g.biblioteca?.carregar(id); } };
        case 'LoadSelectedTrackAndPlay':
          return { d: D.push, ler: () => 0, escrever: (v) => { if (v > 0) g.biblioteca?.carregar(id, { tocar: true }); } };
      }
      if ((m = /^hotcue_(\d+)_(\w+)$/.exec(chave))) {
        const x = Number(m[1]), acao = m[2];
        const leituras = {
          enabled: () => (e.hot.has(x) ? 1 : 0),
          status: () => (e.hot.has(x) ? 1 : 0),
          type: () => (e.hot.has(x) ? 1 : 0),
          position: () => (e.hot.has(x) ? e.hot.get(x) * sr() * 2 : -1),
          color: () => CORES_HOTCUE[(x - 1) % CORES_HOTCUE.length],
        };
        if (leituras[acao]) return { d: D.num, ler: leituras[acao], escrever() {} };
        const acoes = { activate: 'usar', activatecue: 'usar', set: 'marcar', setcue: 'marcar', clear: 'limpar',
                        goto: 'ir', gotoandplay: 'tocar', gotoandstop: 'parar', gotoandloop: 'ir', cue_loop: 'ir' };
        if (acoes[acao]) return push((ap) => { if (ap) hotcue(id, x, acoes[acao]); });
      }
      if ((m = /^beatloop_([\d.]+)_(activate|toggle|enabled)$/.exec(chave))) {
        const n2 = Number(m[1]);
        if (m[2] === 'enabled') return { d: D.num, ler: () => (dk(id)?.loopTempos === n2 ? 1 : 0), escrever() {} };
        return push((ap) => {
          if (!ap) return;
          if (m[2] === 'toggle' && dk(id)?.loopTempos === n2) sairLoop(id); else loopDeTempos(id, n2);
        });
      }
      if ((m = /^beatlooproll_([\d.]+)_activate$/.exec(chave))) {
        const n2 = Number(m[1]);
        return push((ap) => rolar(id, ap, n2));
      }
      if ((m = /^beatjump_([\d.]+)_(forward|backward)$/.exec(chave))) {
        const n2 = Number(m[1]) * (m[2] === 'forward' ? 1 : -1);
        return push((ap) => { if (ap) pularTempos(id, n2); });
      }
      return guardadoB(PUSH.test(chave) ? D.push : TOGGLE.test(chave) ? D.toggle : chave === 'quantize' ? D.toggle : D.num);
    }

    // ── EQ ──
    if (gr.t === 'eq') {
      const id = gr.id, banda = BANDA[chave];
      if (id && banda && chave.startsWith('parameter')) {
        return continuo({ d: D.eq, tela: `eq-${id}-${banda}`, telaDe: (p) => p, id: `${id}:eq:${banda}`,
          param: () => cn(id)?.eq.posicao(banda) ?? 0.5,
          ler: () => conversoes(D.eq).parametroParaValor(cn(id)?.eq.posicao(banda) ?? 0.5),
          escrever(v) { cn(id)?.setEq(banda, prender(conversoes(D.eq).valorParaParametro(v), 0, 1)); } });
      }
      if (id && banda) {
        return { d: D.janela, gesto: true, ler: () => (cn(id)?.eq.morto(banda) ? 1 : 0),
                 escrever: (v) => cn(id)?.setKill(banda, !!v) };
      }
      return guardadoB(chave === 'enabled' ? D.toggle1 : D.num);
    }

    // ── filtro (o super1 da QuickEffect é o knob FILTER da controladora) ──
    if (gr.t === 'filtro') {
      const id = gr.id;
      if (id && chave === 'super1') {
        return continuo({ d: D.meio, tela: `fil-${id}`, telaDe: (p) => p * 2 - 1, id: `${id}:fil`,
          param: () => ((cn(id)?.filtro?.k ?? 0) + 1) / 2,
          ler: () => ((cn(id)?.filtro?.k ?? 0) + 1) / 2,
          escrever(v) {
            guardar(grupo, 'super1', v);
            if (guardadoOu(grupo, 'enabled', 1)) cn(id)?.setFiltro(prender(v * 2 - 1, -1, 1));
          } });
      }
      if (id && chave === 'enabled') {
        return { d: D.toggle1, gesto: true, ler: () => guardadoOu(grupo, 'enabled', 1), escrever(v) {
          guardar(grupo, 'enabled', v ? 1 : 0);
          cn(id)?.setFiltro(v ? prender(guardadoOu(grupo, 'super1', 0.5) * 2 - 1, -1, 1) : 0);
        } };
      }
      return guardadoB(D.num);
    }

    // ── pads (samplers do Mixxx = os 8 SONS do Garimpo) ──
    if (gr.t === 'sampler') {
      const i = gr.i, existe = i >= 0 && i < 8;
      const ativo = () => (existe && g.pads()?.ativo?.(i) ? 1 : 0);
      const disparar = () => { if (existe) { g.ligarAudio?.(); g.pads()?.disparar(i); } };
      switch (chave) {
        case 'track_loaded': return { d: D.num, ler: () => (existe ? 1 : 0), escrever() {} };
        case 'play': case 'play_indicator': case 'play_latched':
          return { d: D.toggle, gesto: true, ler: ativo, escrever: (v) => { if (v ? !ativo() : ativo()) disparar(); } };
        case 'cue_gotoandplay': case 'start_play': case 'cue_play': case 'start': case 'cue_default': case 'hotcue_1_activate':
          return { d: D.push, gesto: true, ler: () => 0, escrever: (v) => { if (v > 0) disparar(); } };
        case 'stop': case 'cue_gotoandstop': case 'eject': case 'start_stop':
          return { d: D.push, gesto: true, ler: () => 0, escrever: (v) => { if (v > 0 && ativo()) disparar(); } };
        case 'duration': return { d: D.num, ler: () => (existe ? 1 : 0), escrever() {} };
        case 'track_samples': return { d: D.num, ler: () => (existe ? sr() * 2 : 0), escrever() {} };
      }
      return guardadoB(PUSH.test(chave) ? D.push : TOGGLE.test(chave) ? D.toggle : D.num);
    }

    // ── master ──
    if (gr.t === 'master') {
      switch (chave) {
        case 'crossfader':
          return continuo({ d: D.xf, tela: 'xf', telaDe: (p) => p, id: 'xf',
            param: () => g.mixer()?.crossfader ?? 0.5,
            ler: () => (g.mixer()?.crossfader ?? 0.5) * 2 - 1,
            escrever(v) { g.mixer()?.setCrossfader(prender((v + 1) / 2, 0, 1)); } });
        case 'gain': case 'volume': {
          // o VOLUME do Garimpo mora em 0..1 com 0,85 de padrão; o gain do Mixxx
          // tem o neutro no meio. Neutro com neutro, o resto em linha reta.
          const deParam = (p) => (p <= 0.5 ? (p / 0.5) * 0.85 : 0.85 + ((p - 0.5) / 0.5) * 0.15);
          const paraParam = (x) => (x <= 0.85 ? (x / 0.85) * 0.5 : 0.5 + ((x - 0.85) / 0.15) * 0.5);
          return continuo({ d: D.ganho, tela: 'master', telaDe: deParam, id: 'master',
            param: () => paraParam(g.mixer()?.valorMaster ?? 0.85),
            ler: () => conversoes(D.ganho).parametroParaValor(paraParam(g.mixer()?.valorMaster ?? 0.85)),
            escrever(v) { g.mixer()?.setMaster(prender(deParam(conversoes(D.ganho).valorParaParametro(v)), 0, 1)); } });
        }
        case 'headGain': {
          const deParam = (p) => (p <= 0.5 ? (p / 0.5) * 0.8 : 0.8 + ((p - 0.5) / 0.5) * 0.7);
          return continuo({ d: D.ganho, id: 'fone',
            param: () => guardadoOu(grupo, '_foneParam', 0.5),
            ler: () => conversoes(D.ganho).parametroParaValor(guardadoOu(grupo, '_foneParam', 0.5)),
            escrever(v) {
              const p = conversoes(D.ganho).valorParaParametro(v);
              guardar(grupo, '_foneParam', p);
              g.mixer()?.setCueVolume(deParam(p));
            } });
        }
        case 'headMix': case 'balance': return guardadoB(D.bipolar);
        case 'VuMeter': case 'VuMeterL': case 'VuMeterR': case 'vu_meter': case 'vu_meter_left': case 'vu_meter_right':
          return { d: D.num, ler: () => nivelVu(g.mixer()?.nivelMaster), escrever() {} };
        case 'PeakIndicator': case 'PeakIndicatorL': case 'PeakIndicatorR': case 'peak_indicator': case 'peak_indicator_left': case 'peak_indicator_right':
          return { d: D.num, ler: () => ((g.mixer()?.nivelMaster ?? 0) > 0.63 ? 1 : 0), escrever() {} };
        case 'num_decks': return { d: D.num, ler: () => 2, escrever() {} };
        case 'num_samplers': return { d: D.num, ler: () => guardadoOu('[App]', 'num_samplers', 8), escrever: (v) => guardar('[App]', 'num_samplers', v) };
        case 'num_preview_decks': return { d: D.num, ler: () => 1, escrever() {} };
        case 'samplerate': return { d: D.num, ler: sr, escrever() {} };
      }
      return guardadoB(TOGGLE.test(chave) ? D.toggle : PUSH.test(chave) ? D.push : D.num);
    }

    // ── curva do crossfader ──
    if (gr.t === 'perfil') {
      return { d: D.num, ler: () => guardadoOu(grupo, chave, chave === 'xFaderCurve' ? 1 : 0), escrever(v) {
        guardar(grupo, chave, v);
        const modo = guardadoOu(grupo, 'xFaderMode', 0), curva = guardadoOu(grupo, 'xFaderCurve', 1);
        g.curva?.(modo === 0 && curva >= 1.5 ? 'dura' : 'suave');
      } };
    }

    // ── efeitos ──
    if (gr.t === 'fx' || gr.t === 'fxSlot') {
      const d = gr.t === 'fx'
        ? ({ enabled: D.toggle1, mix: D.cheio, super1: D.meio }[chave] || (/^group_\[.+\]_enable$/.test(chave) ? D.toggle : PUSH.test(chave) ? D.push : chave.startsWith('show') ? D.toggle : D.num))
        : ({ enabled: D.janela, meta: D.meio, loaded: D.num, effect_selector: D.enc, next_effect: D.push, prev_effect: D.push }[chave] ||
           (/^parameter\d+$/.test(chave) ? D.meio : /^button_parameter\d+$/.test(chave) ? D.janela : D.num));
      const mexeEco = chave === 'enabled' || chave === 'mix' || /^group_\[.+\]_enable$/.test(chave);
      return { d, gesto: mexeEco,
        ler: () => (gr.t === 'fxSlot' && chave === 'loaded' ? 1 : guardadoOu(grupo, chave, d.padrao ?? 0)),
        escrever(v) { guardar(grupo, chave, v); if (mexeEco) refazerEco(); } };
    }

    // ── biblioteca: o BROWSE e o LOAD andam na lista do Garimpo ──
    if (gr.t === 'lib') {
      const mover = (n) => g.biblioteca?.mover(n);
      switch (chave) {
        case 'MoveVertical': case 'SelectTrackKnob':
          return { d: D.enc, ler: () => 0, escrever: (v) => { if (v) mover(Math.round(v)); } };
        case 'ScrollVertical':
          return { d: D.enc, ler: () => 0, escrever: (v) => { if (v) mover(Math.round(v) * 8); } };
        case 'MoveUp': case 'SelectPrevTrack': return { d: D.push, ler: () => 0, escrever: (v) => { if (v > 0) mover(-1); } };
        case 'MoveDown': case 'SelectNextTrack': return { d: D.push, ler: () => 0, escrever: (v) => { if (v > 0) mover(1); } };
        case 'GoToItem': case 'LoadSelectedIntoFirstStopped':
          return { d: D.push, ler: () => 0, escrever: (v) => { if (v > 0) g.biblioteca?.carregar(null); } };
        case 'MoveFocus': case 'MoveFocusForward': case 'MoveFocusBackward':
          return { d: D.push, ler: () => 0, escrever: (v) => { if (v) g.biblioteca?.abrir(); } };
      }
      return guardadoB(PUSH.test(chave) ? D.push : D.num);
    }
    if (gr.t === 'skin' && chave === 'show_maximized_library') {
      return { d: D.toggle, ler: () => (g.biblioteca?.aberta() ? 1 : 0), escrever: (v) => g.biblioteca?.abrir(!!v) };
    }

    // ── AutoDJ do Mixxx = o piloto do Garimpo ──
    if (gr.t === 'autodj') {
      switch (chave) {
        case 'enabled':
          return { d: D.toggle, ler: () => (g.piloto?.ativo() ? 1 : 0), escrever: (v) => { if (!!v !== !!g.piloto?.ativo()) g.piloto?.alternar(); } };
        case 'skip_next': case 'fade_now':
          return { d: D.push, ler: () => 0, escrever: (v) => { if (v > 0) g.piloto?.pular(); } };
      }
      return guardadoB(PUSH.test(chave) ? D.push : D.num);
    }

    // ── o aplicativo ──
    if (gr.t === 'app') {
      switch (chave) {
        case 'num_decks': return { d: D.num, ler: () => 2, escrever() {} };
        case 'num_samplers': return { d: D.num, ler: () => guardadoOu('[App]', 'num_samplers', 8), escrever: (v) => guardar('[App]', 'num_samplers', v) };
        case 'num_preview_decks': return { d: D.num, ler: () => 1, escrever() {} };
        case 'samplerate': return { d: D.num, ler: sr, escrever() {} };
        case 'indicator_250ms': return { d: D.num, ler: () => piscar(250), escrever() {} };
        case 'indicator_500ms': return { d: D.num, ler: () => piscar(500), escrever() {} };
      }
    }

    return guardadoB(PUSH.test(chave) ? D.push : TOGGLE.test(chave) ? D.toggle : D.num);
  }

  /** Loop que rola: segura com slip e, ao soltar, a música continua onde estaria. */
  function rolar(id, ap, n) {
    const d = dk(id);
    if (!d?.faixa) return;
    if (ap) {
      est[id].rolando = n;
      d.transport?.setSlip(true);
      loopDeTempos(id, n);
    } else if (est[id].rolando === n) {
      est[id].rolando = null;
      sairLoop(id);
      d.transport?.setSlip(!!est[id].slip);
    }
  }

  function binding(grupo, chave) {
    const kk = k(grupo, chave);
    let b = cache.get(kk);
    if (!b) { b = montar(grupo, chave); cache.set(kk, b); }
    return b;
  }

  // ─────────────── o que o motor chama ───────────────

  function ler(grupo, chave) {
    try { return Number(binding(grupo, chave).ler()) || 0; } catch { return 0; }
  }

  function escrever(grupo, chave, valor, { humano = false } = {}) {
    const b = binding(grupo, chave);
    if (humano) mexeu = true;
    if (b.cont && humano) {
      // o knob ainda não "pegou": fica só o fantasma, o som não pula
      if (!aceitar(b.id, conversoes(b.d).valorParaParametro(valor), b.param())) return;
    }
    if (humano && b.gesto) g.gesto?.();
    try { b.escrever(valor); } catch (e) { console.warn('[controladora] ponte', grupo, chave, e); }
  }

  function comportamento(grupo, chave) { return binding(grupo, chave).d; }

  function ignorarProximo(grupo, chave) {
    const b = binding(grupo, chave);
    if (b.cont) { const s = tomadas.get(b.id); if (s) s.t = 0; }
  }

  // loops que o deck fez sozinho (a tela, o piloto) viram o "último loop" do reloop
  const ouvindo = new WeakSet();
  let mexeu = false;

  /**
   * Chamado pela controladora a cada ~100 ms: percebe faixa nova (limpa hot
   * cues e loops guardados) e devolve os fantasmas.
   */
  function tick() {
    for (const id of ['A', 'B']) {
      const d = dk(id);
      if (!d) continue;
      if (!ouvindo.has(d)) {
        ouvindo.add(d);
        d.addEventListener('loop', (ev) => {
          const { tempos, start } = ev.detail || {};
          const p = periodo(id);
          if (tempos && p) est[id].ultimoLoop = { start, end: start + tempos * p, tempos };
        });
      }
      if (d.faixa !== est[id].faixa) {
        est[id].faixa = d.faixa;
        est[id].hot.clear();
        est[id].loopIn = null; est[id].manual = null; est[id].ultimoLoop = null;
      }
    }
  }

  /**
   * Os knobs que estão num lugar enquanto o som está em outro.
   * @returns {{tela:string, valor:number, longe:boolean, recente:boolean}[]}
   */
  function fantasmas() {
    const r = [];
    const agora = relogio();
    for (const [, b] of cache) {
      if (!b.cont || !b.tela) continue;
      const s = tomadas.get(b.id);
      if (!s || s.hw == null) continue;
      let atual;
      try { atual = b.param(); } catch { continue; }
      const longe = Math.abs(s.hw - atual) > LIMIAR * 1.5;
      r.push({ tela: b.tela, valor: b.telaDe(s.hw), longe, recente: agora - s.toque < 1500 });
    }
    return r;
  }

  function limpar() {
    for (const [, h] of segurando) clearInterval(h);
    segurando.clear();
    clearInterval(laçoJog); laçoJog = null;
    for (const id of ['A', 'B']) {
      if (est[id].scratch) { try { dk(id)?.touchEnd(); } catch {} est[id].scratch = 0; g.jogTela?.(id, false); }
      if (est[id].cue) { est[id].cue = false; try { dk(id)?.cueRelease(); } catch {} }
    }
    tomadas.clear();
  }

  return {
    ler, escrever, comportamento, ignorarProximo, tick, fantasmas, limpar,
    /** Houve toque na controladora desde a última pergunta (pra dizer "ela está viva"). */
    consumirToque() { const m = mexeu; mexeu = false; return m; },
  };
}
