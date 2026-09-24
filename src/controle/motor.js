/**
 * O motor dos mapeamentos do Mixxx, dentro do Garimpo.
 *
 * O Mixxx tem 142 mapeamentos MIDI de controladoras, escritos e testados por
 * gente que tinha cada uma na mão — a DDJ-FLX4, a Inpulse 200, a Mixtrack Pro
 * FX, a Party Mix. Nenhum de nós tem as 142. Então em vez de escrever mapas no
 * escuro, o Garimpo roda os DELES: este arquivo faz o papel da parte do Mixxx
 * que lê cada mensagem, decide pelo XML o que ela é, chama a função do script,
 * acende os LEDs e faz o scratch.
 *
 * Fidelidade é o ponto. Onde o comportamento do Mixxx 2.5.6 importa, está
 * reproduzido linha a linha, com o arquivo C++ citado:
 *   - a chave de cada mensagem e os 14 bits (midicontroller.cpp)
 *   - rot64, diff, selectknob e companhia (MidiController::computeValue)
 *   - LED aceso quando min ≤ valor ≤ max (midioutputhandler.cpp)
 *   - o scratch com o filtro alfa-beta a 1 ms, freio e spinback
 *     (controllerscriptinterfacelegacy.cpp, util/alphabetafilter.h)
 *   - conexões chamadas DEPOIS do gesto, nunca no meio (Qt::QueuedConnection)
 *
 * O que ele NÃO sabe: o que é "o volume do canal 1". Quem responde é a ponte
 * (ponte.js), que traduz cada controle do Mixxx pra um método do Garimpo — o
 * mesmo que a mão chama. E os scripts rodam numa "sala" à parte (um iframe
 * invisível no navegador, um contexto do vm no teste), porque eles declaram
 * globais como `script`, `Deck`, `Button` e `print`, e nada disso pode vazar
 * pra página.
 */

import { conversoes, apertado } from './comportamento.js';

// ─────────────────────────── MIDI cru ───────────────────────────

const opcode = (s) => (s >= 0xf0 ? s : s & 0xf0);
/** Note on/off, aftertouch, CC e song select: o 1º byte de dados faz parte da chave. */
const doisBytes = (s) => { const o = opcode(s); return o === 0x80 || o === 0x90 || o === 0xa0 || o === 0xb0 || o === 0xf3; };
/** A chave da mensagem, como a MidiKey do Mixxx: pitch bend não usa o 1º byte. */
export const chaveMidi = (status, controle) => ((status & 0xff) << 8) | (doisBytes(status) ? controle & 0xff : 0xff);
const byteStatus = (x) => Math.trunc(Number(x) || 0) & 0xff;
/** Byte de dados: o Web MIDI recusa ≥ 0x80 numa mensagem curta, então prende. */
const byteDado = (x) => Math.max(0, Math.min(127, Math.trunc(Number(x) || 0)));

/**
 * O valor que uma mensagem "normal" leva ao controle (MidiController::computeValue).
 * `anterior` é o valor atual do controle já convertido pra escala MIDI.
 */
function calcular(o, anterior, novo) {
  if (!o.algum) return novo;
  if (o.invert) return 127 - novo;
  if (o.rot64 || o.rot64inv) {
    let d = novo - 64;
    if (d === -1 || d === 1) d /= 16; else d += d > 0 ? -1 : 1;
    const t = o.rot64 ? anterior + d : anterior - d;
    return Math.max(0, Math.min(127, t));
  }
  if (o.rot64fast) return Math.max(0, Math.min(127, anterior + (novo - 64) * 1.5));
  if (o.diff) { if (novo >= 64) novo -= 128; novo = anterior + novo; }
  if (o.selectknob && novo >= 64) novo -= 128;
  if (o.button) novo = novo !== 0 ? 1 : 0;
  if (o.switch) novo = 1;
  if (o.spread64) novo -= 64;
  if (o.hercjog) { if (novo > 64) novo -= 128; novo += anterior; }
  if (o.hercjogfast) { if (novo > 64) novo -= 128; novo = anterior + novo * 3; }
  return novo;
}

// ─────────────────────────── scratch ───────────────────────────

/** O filtro alfa-beta do Mixxx (util/alphabetafilter.h), passo de 1 ms. */
class AlfaBeta {
  constructor() { this.pronto = false; this.dt = 0; this.x = 0; this.v = 0; this.a = 0; this.b = 0; }
  init(dt, v, a = 1 / 512, b = 1 / 512 / 1024) { Object.assign(this, { pronto: true, dt, x: 0, v, a, b }); }
  observar(dx) {
    if (!this.pronto) return;
    const px = this.x + this.v * this.dt, r = dx - px;
    this.x = px + r * this.a;
    this.v = this.v + (r * this.b) / this.dt;
    this.x -= dx;
  }
}

const TAXA_FIM_FREIO = 0.01;

// ─────────────────────────── cores ───────────────────────────

/**
 * ColorMapper do Mixxx: a controladora tem uma paleta curta (16, 64 cores) e o
 * hot cue tem uma cor RGB qualquer; acha a mais parecida. Distância "redmean",
 * que pesa o vermelho e o azul pelo brilho — perto do que o olho acha parecido.
 */
export class ColorMapper {
  constructor(cores) {
    this.cores = Object.entries(cores || {}).map(([k, v]) => ({ rgb: Number(k), v }));
    if (!this.cores.length) throw new Error('ColorMapper sem cores');
    this.memo = new Map();
  }
  #perto(codigo) {
    const c = Number(codigo) & 0xffffff;
    if (this.memo.has(c)) return this.memo.get(c);
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    let melhor = this.cores[0], dm = Infinity;
    for (const x of this.cores) {
      const r2 = (x.rgb >> 16) & 255, g2 = (x.rgb >> 8) & 255, b2 = x.rgb & 255;
      const rm = (r + r2) / 2, dr = r - r2, dg = g - g2, db = b - b2;
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < dm) { dm = d; melhor = x; }
    }
    this.memo.set(c, melhor);
    return melhor;
  }
  getNearestColor(codigo) {
    const c = this.#perto(codigo).rgb;
    return { red: (c >> 16) & 255, green: (c >> 8) & 255, blue: c & 255 };
  }
  getValueForNearestColor(codigo) { return this.#perto(codigo).v; }
}

// ─────────────────────────── o motor ───────────────────────────

/**
 * @param {object} op
 * @param {object} op.mapa     o mapeamento lido (mapa.js): scripts, controles, saídas, ajustes
 * @param {object} op.ponte    { ler, escrever, comportamento, ignorarProximo }
 * @param {function} op.enviar (bytes:number[]) => void — pra controladora
 * @param {object} op.sala     { global, carregar(texto, nome), avaliar(expr) }
 * @param {string} op.dispositivo  nome da porta (vai pro init do script)
 * @param {function} op.agora  relógio em ms
 */
export function criarMotor({ mapa, ponte, enviar, sala, dispositivo = '', agora = () => performance.now(),
                             aviso = (m) => console.warn('[controladora]', m) }) {
  let desligado = false;
  /** Enquanto uma mensagem da controladora está sendo tratada: tudo que acontece é gesto da pessoa. */
  let emEntrada = false;
  const falhas = [];
  const falhou = (onde, e) => {
    const msg = `${onde}: ${e?.message || e}`;
    if (falhas.length < 60) falhas.push({ t: Math.round(agora()), msg });
    aviso(msg);
  };

  const k = (g, c) => g + '\u0000' + c;
  const partes = (kk) => kk.split('\u0000');

  // ── entradas: a tabela do XML, por chave de mensagem ──
  const entradas = new Map();
  const somar = (kk, x) => { const l = entradas.get(kk); if (l) l.push(x); else entradas.set(kk, [x]); };
  for (const c of mapa.controles) somar(chaveMidi(c.status, c.midino), c);
  /** MSB/LSB esperando o par (m_fourteen_bit_queued_mappings). */
  let fila14 = [];

  // ── saídas: LEDs do XML ──
  const saidas = new Map();
  for (const s of mapa.saidas) {
    const kk = k(s.grupo, s.chave);
    const l = saidas.get(kk) || [];
    l.push({ ...s, ultimo: -1 });
    saidas.set(kk, l);
  }

  // ── conexões (engine.makeConnection) ──
  const conexoes = new Map();          // kk -> [conexão]
  const ultimos = new Map();           // kk -> último valor visto
  const forcados = new Set();          // kk que um set pediu pra avisar
  let nConexao = 0;

  // ─────────────── ler e escrever, pela ponte ───────────────

  const ler = (g, c) => {
    const v = Number(ponte.ler(String(g), String(c)));
    return Number.isFinite(v) ? v : 0;
  };

  function escrever(g, c, v, extra = {}) {
    g = String(g); c = String(c);
    v = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
    if (Number.isNaN(v)) { falhou(`setValue(${g}, ${c})`, 'NaN'); return; }
    ponte.escrever(g, c, v, { humano: emEntrada || !!extra.humano });
    avisar(k(g, c));
  }

  /** Pede pra chamar as conexões e o LED desse controle logo depois (fila, como no Qt). */
  function avisar(kk) {
    if (!conexoes.has(kk) && !saidas.has(kk)) return;
    forcados.add(kk);
    agendar();
  }

  // macrotarefa sem o mínimo de 4 ms do setTimeout aninhado
  let agendado = false;
  const canal = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
  if (canal) canal.port1.onmessage = () => descarregar();
  function agendar() {
    if (agendado || desligado) return;
    agendado = true;
    if (canal) canal.port2.postMessage(0); else setTimeout(descarregar, 0);
  }

  function descarregar() {
    agendado = false;
    if (desligado) return;
    const lista = [...forcados];
    forcados.clear();
    for (const kk of lista) {
      const [g, c] = partes(kk);
      const v = ler(g, c);
      ultimos.set(kk, v);
      chamarConexoes(kk, v);
      atualizarSaidas(kk, v);
    }
  }

  function chamarConexoes(kk, v) {
    const l = conexoes.get(kk);
    if (!l) return;
    for (const cx of [...l]) {
      if (!cx.ligada) continue;
      try { cx.fn(v, cx.grupo, cx.chave); } catch (e) { falhou(`conexão ${cx.grupo} ${cx.chave}`, e); }
    }
  }

  function atualizarSaidas(kk, v) {
    const l = saidas.get(kk);
    if (!l) return;
    for (const s of l) {
      const b3 = v >= s.min && v <= s.max ? s.on : s.off;
      if (b3 === s.ultimo) continue;                      // sem mensagem redundante
      if (b3 !== 0xff) { enviarCurta(s.status, s.midino, b3); s.ultimo = b3; }
    }
  }

  /** O relógio das conexões: o que mudou por fora (o Garimpeiro, a tela, a música) chega aos LEDs. */
  function varrer() {
    if (desligado) return;
    const vistos = new Set([...conexoes.keys(), ...saidas.keys()]);
    for (const kk of vistos) {
      const [g, c] = partes(kk);
      const v = ler(g, c);
      if (ultimos.get(kk) === v) continue;
      ultimos.set(kk, v);
      chamarConexoes(kk, v);
      atualizarSaidas(kk, v);
    }
  }

  // ─────────────── saída MIDI ───────────────

  let enviadas = 0;
  function enviarCurta(s, a, b) {
    if (desligado) return;
    enviadas++;
    try { enviar([byteStatus(s), byteDado(a), byteDado(b)]); } catch (e) { falhou('envio', e); }
  }

  // ─────────────── timers ───────────────

  const timers = new Map();
  let nTimer = 0;

  // ─────────────── scratch, freio e spinback ───────────────

  const scratch = new Map();
  const sc = (deck) => {
    let s = scratch.get(deck);
    if (!s) {
      s = { ativo: false, dx: 0, acum: 0, ultimoMov: 0, rampa: false, rampaPara: 0, fatorRampa: 0,
            freio: false, spinback: false, softStart: false, filtro: new AlfaBeta(), t: 0 };
      scratch.set(deck, s);
    }
    return s;
  };
  const grupoDoDeck = (deck) => `[Channel${deck}]`;
  const tocando = (g) => ler(g, 'play') > 0;
  const taxaDoDeck = (g) => ler(g, 'rate_ratio') * (ler(g, 'reverse') === 1 ? -1 : 1);
  const escScratch = (g, c, v) => escrever(g, c, v, { humano: true });
  let laçoScratch = null;

  function ligarScratch() {
    if (laçoScratch || desligado) return;
    laçoScratch = setInterval(rodarScratch, 4);
  }

  /**
   * O Mixxx roda o filtro a cada 1 ms; o navegador não dá timer de 1 ms. Então
   * cada volta processa os milissegundos que passaram, espalhando os ticks do
   * jog igualmente entre eles — é supor movimento uniforme no intervalo, o que
   * a própria mão faz num intervalo de 4 ms.
   */
  function rodarScratch() {
    const t = agora();
    let algum = false;
    for (const [deck, s] of scratch) {
      if (!s.ativo) continue;
      algum = true;
      let n = Math.round(t - s.t);
      if (n <= 0) continue;
      n = Math.min(n, 60);            // aba em segundo plano: não recupera segundos de uma vez
      s.t = t;
      const g = grupoDoDeck(deck);
      const porPasso = s.acum / n;
      s.acum = 0;
      let v = s.filtro.v, acabou = false;
      for (let i = 0; i < n && !acabou; i++) {
        if (s.rampa && !s.softStart && t - s.ultimoMov >= 1) s.filtro.observar(s.rampaPara * s.fatorRampa);
        else if (s.softStart) s.filtro.observar(s.rampaPara * 0.001);
        else s.filtro.observar(s.dx * porPasso);
        v = s.filtro.v;
        acabou = (s.rampa && Math.abs(s.rampaPara - v) <= 0.00001) ||
          (s.freio && v < s.rampaPara) ||
          ((s.spinback || s.softStart) && v > s.rampaPara);
      }
      try {
        escScratch(g, 'scratch2', v);
        acabou ||= ((s.freio || s.softStart) && !tocando(g)) || !(ler(g, 'track_loaded') > 0);
        if (acabou) {
          s.rampa = false;
          if (s.freio || s.spinback) { escScratch(g, 'scratch2', 0); escScratch(g, 'play', 0); }
          escScratch(g, 'scratch2_enable', 0);
          s.ativo = false; s.dx = 0; s.freio = false; s.spinback = false; s.softStart = false;
        }
      } catch (e) { falhou('scratch', e); s.ativo = false; }
    }
    if (!algum) { clearInterval(laçoScratch); laçoScratch = null; }
  }

  // ─────────────── a API que os scripts enxergam ───────────────

  const deckNum = (d) => Math.max(1, Math.min(16, Math.trunc(Number(d)) || 1));

  function conectar(g, c, fn) {
    g = String(g); c = String(c);
    if (typeof fn !== 'function') { falhou(`makeConnection(${g}, ${c})`, 'callback inválido'); return undefined; }
    const kk = k(g, c);
    const cx = {
      id: `c${++nConexao}`, grupo: g, chave: c, fn, ligada: true,
      get isConnected() { return this.ligada; },
      disconnect() {
        const l = conexoes.get(kk);
        const i = l ? l.indexOf(cx) : -1;
        if (i < 0) return false;
        l.splice(i, 1);
        if (!l.length) conexoes.delete(kk);
        cx.ligada = false;
        return true;
      },
      trigger() { if (!cx.ligada) return; const v = ler(g, c); setTimeout(() => { if (cx.ligada && !desligado) { try { fn(v, g, c); } catch (e) { falhou(`trigger ${g} ${c}`, e); } } }, 0); },
    };
    const l = conexoes.get(kk);
    if (l) l.push(cx); else conexoes.set(kk, [cx]);
    if (!ultimos.has(kk)) ultimos.set(kk, ler(g, c));
    return cx;
  }

  const engine = {
    getValue: (g, c) => ler(g, c),
    setValue: (g, c, v) => escrever(g, c, v),
    getParameter(g, c) {
      const d = ponte.comportamento(String(g), String(c));
      return conversoes(d).valorParaParametro(ler(g, c));
    },
    setParameter(g, c, p) {
      p = Number(p);
      if (Number.isNaN(p)) { falhou(`setParameter(${g}, ${c})`, 'NaN'); return; }
      const d = ponte.comportamento(String(g), String(c));
      escrever(g, c, conversoes(d).parametroParaValor(p));
    },
    getParameterForValue(g, c, v) {
      return conversoes(ponte.comportamento(String(g), String(c))).valorParaParametro(Number(v));
    },
    getDefaultValue: (g, c) => ponte.comportamento(String(g), String(c))?.padrao ?? 0,
    getDefaultParameter(g, c) {
      const d = ponte.comportamento(String(g), String(c));
      return conversoes(d).valorParaParametro(d?.padrao ?? 0);
    },
    reset(g, c) { escrever(g, c, ponte.comportamento(String(g), String(c))?.padrao ?? 0); },
    makeConnection: conectar,
    makeUnbufferedConnection: conectar,
    /** O jeito antigo (e cheio de manias) de conectar — os mapas velhos ainda usam. */
    connectControl(g, c, cb, desfazer = false) {
      g = String(g); c = String(c);
      const kk = k(g, c);
      if (cb && typeof cb === 'object' && typeof cb.disconnect === 'function') { cb.disconnect(); return false; }
      let fn = cb;
      if (typeof cb === 'string') {
        try { fn = sala.avaliar(cb); } catch (e) { falhou(`connectControl(${g}, ${c})`, e); return false; }
        if (typeof fn !== 'function') { falhou(`connectControl(${g}, ${c})`, 'callback não é função'); return false; }
        if (!desfazer && conexoes.get(kk)?.length) return conexoes.get(kk)[0];
      }
      if (desfazer) {
        for (const cx of [...(conexoes.get(kk) || [])]) if (cx.fn === fn) cx.disconnect();
        return true;
      }
      return conectar(g, c, fn);
    },
    trigger(g, c) { const kk = k(String(g), String(c)); if (conexoes.has(kk)) { forcados.add(kk); agendar(); } },
    log: (m) => console.log(m),
    beginTimer(ms, cb, unico = false) {
      if (typeof cb === 'string') {
        try { cb = sala.avaliar(`()=>${cb}`); } catch (e) { falhou('beginTimer', e); return 0; }
      }
      if (typeof cb !== 'function') { falhou('beginTimer', 'callback inválido'); return 0; }
      ms = Math.max(20, Number(ms) || 20);
      const id = ++nTimer;
      const rodar = () => {
        if (desligado) return;
        if (unico) timers.delete(id);
        try { cb(); } catch (e) { falhou('timer', e); }
      };
      timers.set(id, unico ? { h: setTimeout(rodar, ms), unico } : { h: setInterval(rodar, ms), unico });
      return id;
    },
    stopTimer(id) {
      const t = timers.get(id);
      if (!t) return;
      if (t.unico) clearTimeout(t.h); else clearInterval(t.h);
      timers.delete(id);
    },
    scratchEnable(deck, intervalos, rpm, alpha, beta, rampa = true) {
      deck = deckNum(deck);
      const porSeg = (Number(rpm) * Number(intervalos)) / 60;
      if (!porSeg) { falhou('scratchEnable', 'rpm ou intervalos inválidos'); return; }
      const s = sc(deck), g = grupoDoDeck(deck);
      s.dx = 1 / porSeg; s.acum = 0; s.rampa = false; s.fatorRampa = 0.001; s.freio = false;
      let v0 = 0;
      if (rampa) {
        if (ler(g, 'scratch2_enable') === 1) v0 = ler(g, 'scratch2');
        else if (tocando(g)) v0 = taxaDoDeck(g);
      }
      if (alpha && beta) s.filtro.init(0.001, v0, Number(alpha), Number(beta));
      else s.filtro.init(0.001, v0);
      s.ativo = true; s.t = agora(); s.ultimoMov = s.t;
      escScratch(g, 'scratch2_enable', 1);
      ligarScratch();
    },
    scratchTick(deck, intervalo) {
      const s = sc(deckNum(deck));
      s.ultimoMov = agora();
      s.acum += Number(intervalo) || 0;
    },
    scratchDisable(deck, rampa = true) {
      deck = deckNum(deck);
      const s = sc(deck), g = grupoDoDeck(deck);
      s.rampaPara = 0;
      if (!rampa) escScratch(g, 'scratch2_enable', 0);
      else if (tocando(g)) s.rampaPara = taxaDoDeck(g);
      s.ultimoMov = agora();
      s.rampa = true;
      if (s.ativo) ligarScratch();
    },
    isScratching: (deck) => ler(grupoDoDeck(deckNum(deck)), 'scratch2_enable') > 0,
    brake(deck, ativar, fator = 1, taxa = 1) {
      deck = deckNum(deck);
      const s = sc(deck), g = grupoDoDeck(deck);
      escScratch(g, 'scratch2_enable', ativar ? 1 : 0);
      if (!ativar) { s.freio = false; s.spinback = false; s.ativo = false; return; }
      let v0;
      if (taxa < -TAXA_FIM_FREIO) { s.spinback = true; s.freio = false; s.rampaPara = -TAXA_FIM_FREIO; v0 = taxa; }
      else if (taxa > TAXA_FIM_FREIO) {
        if (s.spinback || s.freio) return;
        s.freio = true; s.spinback = false; s.rampaPara = TAXA_FIM_FREIO;
        v0 = taxaDoDeck(g);
        if (s.softStart) { s.softStart = false; v0 = s.filtro.v; }
      } else {
        s.freio = false; s.spinback = false; s.ativo = false;
        escScratch(g, 'play', 0);
        return;
      }
      escScratch(g, 'scratch2', v0);
      if (fator > 1) fator = (fator - 1) / 10 + 1;
      s.filtro.init(0.001, v0, 1 / 512, (1 / 512 / 1024) * fator);
      s.rampa = true; s.ativo = true; s.t = agora();
      ligarScratch();
    },
    spinback(deck, ativar, fator = 1, taxa = -10) { engine.brake(deck, ativar, -fator, taxa); },
    softStart(deck, ativar, fator = 1) {
      deck = deckNum(deck);
      const s = sc(deck), g = grupoDoDeck(deck);
      s.ativo = false;
      escScratch(g, 'scratch2_enable', ativar ? 1 : 0);
      s.softStart = !!ativar;
      if (!ativar) return;
      let v0 = 0;
      s.rampaPara = taxaDoDeck(g);
      if (s.freio || s.spinback) { s.freio = false; s.spinback = false; v0 = s.filtro.v; }
      escScratch(g, 'play', 1);
      escScratch(g, 'scratch2', v0);
      if (fator > 1) fator = (fator - 1) / 10 + 1;
      s.filtro.init(0.001, v0, 1 / 512, (1 / 512 / 1024) * fator);
      s.rampa = true; s.ativo = true; s.t = agora();
      ligarScratch();
    },
    // o soft takeover do Garimpo vale pra TODO controle contínuo (ver ponte.js);
    // ligar/desligar por script não muda nada, mas "ignorar o próximo" sim
    softTakeover() {},
    softTakeoverIgnoreNextValue(g, c) { ponte.ignorarProximo?.(String(g), String(c)); },
    getSetting(nome) {
      if (nome in (mapa.ajustes || {})) return mapa.ajustes[nome];
      falhou('getSetting', `ajuste desconhecido: ${nome}`);
      return undefined;
    },
  };

  const midi = {
    sendShortMsg: (s, a, b) => enviarCurta(s, a, b),
    sendSysexMsg(dados, tamanho) {
      if (desligado || !dados) return;
      let bytes = Array.from(dados, (x) => Number(x) & 0xff);
      if (tamanho > 0) bytes = bytes.slice(0, tamanho);
      enviadas++;
      try { enviar(bytes); } catch (e) { falhou('sysex', e); }
    },
    send(dados) { midi.sendSysexMsg(dados); },
    makeInputHandler(status, controle, fn) {
      status = Number(status); controle = Number(controle);
      if (typeof fn !== 'function') { falhou('makeInputHandler', 'callback inválido'); return undefined; }
      if (status < 0x80 || controle > 0x7f) { falhou('makeInputHandler', `status ${status} / controle ${controle}`); return undefined; }
      const kk = chaveMidi(status, controle);
      if ((entradas.get(kk) || []).some((m) => m.opcoes?.script && m.chave)) {
        aviso(`makeInputHandler ignorado: já existe ligação no XML pra ${status}/${controle}`);
        return undefined;
      }
      const h = { fn, anonimo: true };
      somar(kk, h);
      return {
        get isConnected() { return (entradas.get(kk) || []).includes(h); },
        disconnect() {
          const l = entradas.get(kk);
          const i = l ? l.indexOf(h) : -1;
          if (i < 0) return false;
          l.splice(i, 1);
          return true;
        },
      };
    },
  };

  // ─────────────── entrada ───────────────

  const funcoes = new Map();
  /** A função de uma <key> de script-binding, como o wrapFunctionCode do Mixxx. */
  function funcaoDe(chave) {
    if (funcoes.has(chave)) return funcoes.get(chave);
    let f = null;
    try { f = sala.avaliar(`(function (a1,a2,a3,a4,a5) { (${chave})(a1,a2,a3,a4,a5); })`); }
    catch (e) { falhou(`script ${chave}`, e); }
    funcoes.set(chave, typeof f === 'function' ? f : null);
    return funcoes.get(chave);
  }

  function processar(m, status, controle, valor) {
    const canal = status & 0x0f;
    let op = opcode(status);

    if (m.anonimo) {
      try { m.fn(canal, controle, valor, status); } catch (e) { falhou('handler', e); }
      return;
    }
    if (m.opcoes.script) {
      const f = funcaoDe(m.chave);
      if (f) { try { f(canal, controle, valor, status, m.grupo); } catch (e) { falhou(m.chave, e); } }
      return;
    }

    const d = ponte.comportamento(m.grupo, m.chave);
    const conv = conversoes(d);
    let novo = valor;
    const catorze = m.opcoes.msb || m.opcoes.lsb;
    if (!catorze && fila14.length) fila14 = [];      // o par de 14 bits não veio: descarta
    if (catorze) {
      const i = fila14.findIndex((q) => q.m.grupo === m.grupo && q.m.chave === m.chave);
      if (i < 0) { fila14.push({ m, valor }); return; }
      const q = fila14[i];
      fila14.splice(i, 1);
      if ((q.m.opcoes.msb && m.opcoes.msb) || (q.m.opcoes.lsb && m.opcoes.lsb)) return;   // MSB/LSB trocados: ignora os dois
      const inteiro = m.opcoes.msb ? (valor << 7) | q.valor : (q.valor << 7) | valor;
      // /128 e não /129: 0x2000 cai exatamente em 64, o meio (ver o comentário do rryan no Mixxx)
      novo = Math.min(inteiro / 128, 127);
    } else if (op === 0xe0) {
      novo = Math.min(((valor << 7) | controle) / 128, 127);
    } else {
      novo = calcular(m.opcoes, conv.valorParaMidi(ler(m.grupo, m.chave)), valor);
    }
    if (m.opcoes.button || m.opcoes.switch) op = 0x90;

    if (d?.tipo === 'toggle') {
      if (apertado(op, novo)) escrever(m.grupo, m.chave, ler(m.grupo, m.chave) ? 0 : 1);
    } else if (d?.tipo === 'janela') {
      janela(m.grupo, m.chave, apertado(op, novo));
    } else if (d?.tipo === 'push') {
      escrever(m.grupo, m.chave, apertado(op, novo) ? 1 : 0);
    } else {
      escrever(m.grupo, m.chave, conv.parametroParaValor(conv.midiParaParametro(novo)));
    }
  }

  /** Botão "vidro elétrico" (POWERWINDOW): toque liga e fica; segurar e soltar desliga. */
  const janelas = new Map();
  function janela(g, c, ap) {
    const kk = k(g, c);
    if (ap) {
      escrever(g, c, ler(g, c) ? 0 : 1);
      janelas.set(kk, agora());
    } else if (agora() - (janelas.get(kk) ?? 0) >= 300) {
      escrever(g, c, 0);
    }
  }

  function receberSysex(bytes) {
    if (!entradas.get(chaveMidi(0xf0, 0xff))?.some((m) => m.opcoes?.script)) return;
    const dados = Uint8Array.from(bytes);
    for (const p of prefixos) {
      const o = objeto(p);
      if (typeof o?.incomingData !== 'function') continue;
      try { o.incomingData(dados, dados.length); } catch (e) { falhou(`${p}.incomingData`, e); }
    }
  }

  /**
   * Uma mensagem da controladora.
   * @param {ArrayLike<number>} bytes
   */
  function receber(bytes) {
    if (desligado || !bytes?.length) return;
    const status = bytes[0];
    if (status === 0xf0) return receberSysex(bytes);
    if (status >= 0xf8) return;                     // relógio e active sensing: ruído (o Mixxx também ignora)
    const controle = bytes[1] ?? 0, valor = bytes[2] ?? 0;
    const lista = entradas.get(chaveMidi(status, controle));
    if (!lista) return;
    const antes = emEntrada;
    emEntrada = true;
    try { for (const m of [...lista]) processar(m, status, controle, valor); }
    finally { emEntrada = antes; }
  }

  // ─────────────── carga dos scripts e init ───────────────

  const g = sala.global;
  g.engine = engine;
  g.midi = midi;
  g.ColorMapper = ColorMapper;

  const prefixos = [];
  const objeto = (p) => {
    let o = g[p];
    if (o == null) { try { o = sala.avaliar(p); } catch { o = null; } }
    return o;
  };

  for (const s of mapa.scripts) {
    try { sala.carregar(s.texto, s.arquivo); }
    catch (e) { falhou(`carregar ${s.arquivo}`, e); throw new Error(`o script ${s.arquivo} do mapeamento não carregou: ${e?.message || e}`); }
    if (s.prefixo) prefixos.push(s.prefixo);
  }

  for (const p of prefixos) {
    const o = objeto(p);
    if (typeof o?.init !== 'function') { aviso(`${p} não tem init()`); continue; }
    try { o.init(dispositivo, false); } catch (e) { falhou(`${p}.init`, e); }
  }

  // o estado inicial de todos os LEDs, como o updateAllOutputs depois do init
  for (const [kk] of saidas) {
    const [gr, c] = partes(kk);
    const v = ler(gr, c);
    ultimos.set(kk, v);
    atualizarSaidas(kk, v);
  }
  const relogio = setInterval(varrer, 33);

  return {
    receber,
    get falhas() { return falhas; },
    get enviadas() { return enviadas; },
    get scratchAtivo() { return [...scratch.values()].some((s) => s.ativo); },
    /** Desliga como o Mixxx: shutdown() de cada script (apaga os LEDs), e para tudo. */
    desligar() {
      if (desligado) return;
      for (const p of prefixos) {
        const o = objeto(p);
        if (typeof o?.shutdown === 'function') { try { o.shutdown(); } catch (e) { falhou(`${p}.shutdown`, e); } }
      }
      desligado = true;
      clearInterval(relogio);
      clearInterval(laçoScratch);
      for (const [, t] of timers) { if (t.unico) clearTimeout(t.h); else clearInterval(t.h); }
      timers.clear();
      for (const [deck, s] of scratch) {
        if (s.ativo) { try { ponte.escrever(grupoDoDeck(deck), 'scratch2_enable', 0, { humano: false }); } catch {} }
      }
      if (canal) canal.port1.onmessage = null;
    },
  };
}
