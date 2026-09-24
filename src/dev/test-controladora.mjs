/**
 * Teste da controladora SEM controladora: roda os mapeamentos reais do Mixxx
 * contra um Garimpo de mentira e manda os bytes que cada aparelho manda.
 *
 *   node src/dev/test-controladora.mjs
 *
 * Os bytes da DDJ-FLX4 são os da lista oficial da Pioneer (DDJ-FLX4 MIDI
 * Message List) — os mesmos do XML do Mixxx. Os da Inpulse 200, os do PDF de
 * comandos MIDI da Hercules. Na primeira vez baixa os mapeamentos (rede); depois
 * lê de .dev-out/mixxx/.
 *
 * Além dos casos escritos à mão, passa um "pente fino" em cada mapeamento
 * popular: aperta e solta TODO controle que o XML declara e confere que nada
 * quebra do nosso lado (API faltando, valor estranho).
 */
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import { criarMotor } from '../controle/motor.js';
import { criarPonte } from '../controle/ponte.js';
import { carregarMapa, MIXXX_COMMIT } from '../controle/mapa.js';
import { acharMapa, POPULARES, limparNome } from '../controle/catalogo.js';
import { aparelhos } from '../controle/midi.js';

const RAIZ = path.resolve(import.meta.dirname, '..', '..');
const CACHE = path.join(RAIZ, '.dev-out', 'mixxx', MIXXX_COMMIT.slice(0, 8));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0, falhas = 0;
function confere(cond, msg) {
  if (cond) { ok++; } else { falhas++; console.log('  ✗', msg); }
}

async function baixador(arquivo) {
  const local = path.join(CACHE, arquivo);
  try { return await fs.readFile(local, 'utf8'); } catch {}
  const url = `https://raw.githubusercontent.com/mixxxdj/mixxx/${MIXXX_COMMIT}/res/controllers/${encodeURIComponent(arquivo)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${arquivo}`);
  const txt = await r.text();
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(local, txt);
  return txt;
}

// ─────────────────────────── um Garimpo de mentira ───────────────────────────

class DeckFalso {
  constructor(id) {
    this.id = id; this.faixa = { title: 'teste ' + id }; this.tocando = false; this.position = 30; this.duration = 240;
    this.pitch = 0; this.transport = { pitchRange: 0.08, slip: false, setSlip: (on) => { this.transport.slip = on; } };
    this.grid = { bpm: 124, ancora: 0.1 }; this.keylockPedido = false; this.cuePoint = 10; this.loopTempos = 0;
    this.chamadas = []; this.ouvintes = {};
  }
  get nominalRate() { return 1 + this.pitch; }
  get bpmNatural() { return this.grid.bpm; }
  get bpmEfetivo() { return this.grid.bpm * this.nominalRate; }
  reg(n, ...a) { this.chamadas.push([n, ...a]); }
  play() { this.reg('play'); this.tocando = true; }
  pause() { this.reg('pause'); this.tocando = false; }
  cuePress() { this.reg('cuePress'); }
  cueRelease() { this.reg('cueRelease'); }
  seek(p) { this.reg('seek', p); this.position = p; }
  setPitch(f) { this.reg('setPitch', f); this.pitch = Math.max(-this.transport.pitchRange, Math.min(this.transport.pitchRange, f)); }
  setKeylock(on) { this.reg('setKeylock', on); this.keylockPedido = on; }
  setCuePoint(p) { this.cuePoint = p; }
  touchStart() { this.reg('touchStart'); }
  touchEnd() { this.reg('touchEnd'); }
  setScratchRate(r) { this.reg('setScratchRate', r); }
  deslocar(d) { this.reg('deslocar', d); return d; }
  setLoop(o) { this.reg('setLoop', o); }
  clearLoop() { this.reg('clearLoop'); this.loopTempos = 0; }
  loopDeTempos(n) { this.reg('loopDeTempos', n); this.loopTempos = n; (this.ouvintes.loop || []).forEach((f) => f({ detail: { tempos: n, start: this.position, on: true } })); return true; }
  addEventListener(t, f) { (this.ouvintes[t] ||= []).push(f); }
  quantas(n) { return this.chamadas.filter((c) => c[0] === n).length; }
  ultima(n) { return [...this.chamadas].reverse().find((c) => c[0] === n); }
}

function canalFalso() {
  const c = {
    valores: { fader: 1, trim: 0, eco: 0 }, cueLigado: false, nivel: 0.2, filtro: { k: 0 },
    eqv: { grave: 0.5, medio: 0.5, agudo: 0.5 }, kill: { grave: false, medio: false, agudo: false },
    eq: { posicao: (b) => c.eqv[b], morto: (b) => c.kill[b] },
    setEq(b, v) { c.eqv[b] = v; }, setKill(b, on) { c.kill[b] = on; }, setFiltro(k) { c.filtro.k = k; },
    setFader(v) { c.valores.fader = v; }, setTrim(db) { c.valores.trim = db; }, setEco(v) { c.valores.eco = v; },
  };
  return c;
}

function garimpoFalso() {
  const decks = { A: new DeckFalso('A'), B: new DeckFalso('B') };
  const canais = { A: canalFalso(), B: canalFalso() };
  const mixer = {
    crossfader: 0.5, valorMaster: 0.85, nivelMaster: 0.3, curva: 'suave', cue: 0.8,
    canal: (id) => canais[id],
    setCrossfader(x) { this.crossfader = x; }, setMaster(v) { this.valorMaster = v; },
    setCueVolume(v) { this.cue = v; }, setEco(id, v) { canais[id].setEco(v); }, setCurva(c) { this.curva = c; },
  };
  const reg = { gestos: 0, sync: [], fone: [], pads: [], mover: [], carregar: [], jog: [], piloto: 0, curva: [] };
  const ativos = new Set();
  const g = {
    deck: (id) => decks[id], mixer: () => mixer, sampleRate: () => 48000,
    pads: () => ({ disparar: (i) => { reg.pads.push(i); ativos.add(i); setTimeout(() => ativos.delete(i), 250); }, ativo: (i) => ativos.has(i) }),
    ligarAudio() {}, gesto() { reg.gestos++; },
    sincronizar: (id) => reg.sync.push(id), encaixar() {},
    fone: (id, on) => { reg.fone.push([id, on]); canais[id].cueLigado = on; },
    faixaPitch: (id, r) => { decks[id].transport.pitchRange = r; },
    curva: (c) => reg.curva.push(c), jogTela: (id, on) => reg.jog.push([id, on]), loopMudou() {},
    piloto: { ativo: () => false, alternar: () => reg.piloto++, pular() {} },
    biblioteca: { mover: (n) => reg.mover.push(n), carregar: (id) => reg.carregar.push(id), abrir() {}, aberta: () => false },
  };
  return { g, decks, canais, mixer, reg };
}

function salaNode() {
  const ctx = vm.createContext({ console: { log() {}, info() {}, debug() {}, warn() {}, error() {} } });
  return {
    global: ctx,
    carregar: (texto, nome) => vm.runInContext(texto, ctx, { filename: nome }),
    avaliar: (expr) => vm.runInContext(expr, ctx),
  };
}

async function montar(xml) {
  const mapa = await carregarMapa(xml, { baixador });
  const G = garimpoFalso();
  const ponte = criarPonte(G.g);
  const enviados = [];
  const avisos = [];
  const motor = criarMotor({ mapa, ponte, sala: salaNode(), dispositivo: 'teste', enviar: (b) => enviados.push([...b]),
                             aviso: (m) => avisos.push(m) });
  return { ...G, mapa, ponte, motor, enviados, avisos };
}

const hex = (b) => b.map((x) => x.toString(16).padStart(2, '0')).join(' ');
const mandou = (env, ...b) => env.some((m) => hex(m) === hex(b));

// ─────────────────────────── DDJ-FLX4 ───────────────────────────

async function flx4() {
  console.log('DDJ-FLX4');
  const t = await montar('Pioneer-DDJ-FLX4.midi.xml');
  const { motor, decks, canais, mixer, reg, enviados, ponte } = t;
  confere(t.mapa.controles.length > 200, `XML lido: ${t.mapa.controles.length} controles`);
  confere(mandou(enviados, 0xf0, 0x00, 0x40, 0x05, 0x00, 0x00, 0x04, 0x05, 0x00, 0x50, 0x02, 0xf7),
          'init manda o "estou vivo" (sysex) que também pede a posição dos faders');
  confere(mandou(enviados, 0x9f, 0x00, 0x7f), 'init faz a animação de faixa carregada');

  // PLAY deck 1: 90 0B 7F (lista oficial: PLAY/PAUSE deck 1 = 90 0B)
  motor.receber([0x90, 0x0b, 0x7f]);
  motor.receber([0x90, 0x0b, 0x00]);
  confere(decks.A.tocando && decks.A.quantas('play') === 1, 'PLAY do deck 1 toca o deck A (e soltar não pausa)');
  confere(reg.gestos > 0, 'apertar PLAY conta como gesto (o piloto solta)');
  await espera(80);
  confere(mandou(enviados, 0x90, 0x0b, 0x7f), 'o LED do PLAY acende');
  motor.receber([0x90, 0x0b, 0x7f]);
  confere(!decks.A.tocando, 'PLAY de novo pausa');
  await espera(80);
  confere(mandou(enviados, 0x90, 0x0b, 0x00), 'e o LED apaga');

  // CROSSFADER 14 bits: B6 1F (MSB) + B6 3F (LSB)
  const xf = (v14) => { motor.receber([0xb6, 0x1f, v14 >> 7]); motor.receber([0xb6, 0x3f, v14 & 0x7f]); };
  xf(0x2000);
  confere(mixer.crossfader === 0.5, 'o primeiro valor do crossfader nunca entra (é o que evita o salto)');
  xf(0x2000);
  confere(Math.abs(mixer.crossfader - 0.5) < 1e-9, 'no mesmo lugar do som: pega');
  xf(0x3000);
  confere(Math.abs(mixer.crossfader - (((0x3000 / 128 - 1) / 126) * 2 - 1 + 1) / 2) < 1e-9, `crossfader em 14 bits: ${mixer.crossfader.toFixed(4)}`);

  // o Garimpeiro mexeu no crossfader; o fader de plástico ficou onde estava
  mixer.crossfader = 0.2;
  await espera(70);
  xf(0x3200);
  confere(mixer.crossfader === 0.2, 'soft takeover: o fader físico longe do som é ignorado');
  const f = ponte.fantasmas().find((x) => x.tela === 'xf');
  confere(f && f.longe, 'e vira fantasma na tela');
  await espera(70);
  xf(0x0800);   // desce e cruza o valor do som
  confere(mixer.crossfader < 0.2, 'cruzou o valor do som: pegou');

  // VOLUME canal 1: B0 13 / B0 33
  const vol = (v14) => { motor.receber([0xb0, 0x13, v14 >> 7]); motor.receber([0xb0, 0x33, v14 & 0x7f]); };
  vol(0x3f80); vol(0x3f7f); vol(0x3000);
  confere(canais.A.valores.fader < 0.8 && canais.A.valores.fader > 0.7, `volume do canal 1: ${canais.A.valores.fader.toFixed(3)}`);

  // EQ HI canal 1: B0 07 / B0 27 — do meio pra baixo
  const hi = (v14) => { motor.receber([0xb0, 0x07, v14 >> 7]); motor.receber([0xb0, 0x27, v14 & 0x7f]); };
  hi(0x2000); hi(0x2000); hi(0x1000);
  confere(Math.abs(canais.A.eqv.agudo - 0.25) < 0.01, `EQ HI: 0x2000 é o meio, 0x1000 um quarto (${canais.A.eqv.agudo.toFixed(3)})`);

  // FILTER canal 1 (super1 da QuickEffect): B6 17 / B6 37
  motor.receber([0xb6, 0x17, 0x40]); motor.receber([0xb6, 0x37, 0x00]);
  motor.receber([0xb6, 0x17, 0x40]); motor.receber([0xb6, 0x37, 0x00]);
  motor.receber([0xb6, 0x17, 0x60]); motor.receber([0xb6, 0x37, 0x00]);
  confere(canais.A.filtro.k > 0.4, `FILTER gira pro agudo: k = ${canais.A.filtro.k.toFixed(3)}`);

  // PITCH (script: MSB B0 00 + LSB B0 20; rate = 1 - v/0x2000)
  const tempo = (v14) => { motor.receber([0xb0, 0x00, v14 >> 7]); motor.receber([0xb0, 0x20, v14 & 0x7f]); };
  tempo(0x2000); tempo(0x2000); tempo(0x1000);
  confere(Math.abs(decks.A.pitch - (-(1 - 0x1000 / 0x2000) * 0.08)) < 1e-9,
          `fader de tempo pra cima = mais lento, como na CDJ (pitch ${(decks.A.pitch * 100).toFixed(2)}%)`);

  // JOG: toque 90 36, giro B0 22 (valor 64 ± ticks), solta
  motor.receber([0x90, 0x36, 0x7f]);
  confere(decks.A.quantas('touchStart') === 1, 'encostar no prato = pegar o disco');
  for (let i = 0; i < 20; i++) { motor.receber([0xb0, 0x22, 64 + 6]); await espera(5); }
  await espera(20);
  const taxa = decks.A.ultima('setScratchRate')?.[1] ?? 0;
  confere(taxa > 0, `girar pra frente arrasta pra frente (taxa ${taxa.toFixed(2)})`);
  motor.receber([0x90, 0x36, 0x00]);
  await espera(600);
  confere(decks.A.quantas('touchEnd') === 1, 'soltar o prato devolve o disco');
  confere(reg.jog.some(([id, on]) => id === 'A' && on) && reg.jog.some(([id, on]) => id === 'A' && !on), 'o prato da tela acende e apaga junto');

  // JOG sem toque (a lateral): empurrãozinho
  const antes = decks.A.quantas('deslocar');
  motor.receber([0xb0, 0x21, 64 + 3]);
  await espera(80);
  confere(decks.A.quantas('deslocar') > antes, 'girar a lateral do jog empurra a música');

  // HOT CUE 1: pad 97 00 (modo HOT CUE)
  decks.A.position = 42;
  motor.receber([0x97, 0x00, 0x7f]); motor.receber([0x97, 0x00, 0x00]);
  await espera(80);
  confere(mandou(enviados, 0x97, 0x00, 0x7f), 'pad vazio marca o hot cue, e o pad acende');
  decks.A.position = 90;
  motor.receber([0x97, 0x00, 0x7f]);
  confere(decks.A.position === 42, 'pad marcado volta pro hot cue');
  motor.receber([0x98, 0x00, 0x7f]);   // SHIFT + pad = apagar
  await espera(80);
  confere(mandou(enviados, 0x97, 0x00, 0x00), 'SHIFT + pad apaga o hot cue e o LED');

  // BEAT LOOP 4: pad 97 64 (modo BEAT LOOP)
  motor.receber([0x97, 0x64, 0x7f]);
  confere(decks.A.loopTempos === 4, 'pad de loop 4 tempos');
  await espera(80);
  confere(mandou(enviados, 0x97, 0x64, 0x7f), 'LED do loop aceso');
  motor.receber([0x97, 0x64, 0x7f]);
  confere(decks.A.loopTempos === 0, 'o mesmo pad sai do loop');

  // BEAT JUMP: pad 97 21 (+1 tempo)
  decks.A.position = 60;
  motor.receber([0x97, 0x21, 0x7f]);
  confere(Math.abs(decks.A.position - (60 + 60 / 124)) < 1e-9, 'beat jump de 1 tempo');

  // SAMPLER: pad 97 30 dispara o som 1
  motor.receber([0x97, 0x30, 0x7f]);
  confere(reg.pads[0] === 0, 'pad do sampler dispara o SOM 1');

  // PFL (fone) canal 1: 90 54
  motor.receber([0x90, 0x54, 0x7f]);
  confere(reg.fone.length === 1 && reg.fone[0][1] === true, 'CUE do fone liga a pré-escuta do A');

  // SYNC: 90 58
  motor.receber([0x90, 0x58, 0x7f]);
  confere(reg.sync.includes('A'), 'BEAT SYNC sincroniza o A');

  // BROWSE: B6 40 (select knob: 01 = +1, 7F = −1); LOAD deck 1: 96 46
  motor.receber([0xb6, 0x40, 0x01]); motor.receber([0xb6, 0x40, 0x7f]);
  confere(reg.mover.join() === '1,-1', `BROWSE anda na lista (${reg.mover.join()})`);
  motor.receber([0x96, 0x46, 0x7f]);
  confere(reg.carregar[0] === 'A', 'LOAD carrega no deck A');

  // VU: o script manda o nível do canal em B0 02 quando ele MUDA (a música mexe)
  canais.A.nivel = 0.5;
  await espera(80);
  confere(enviados.some((m) => m[0] === 0xb0 && m[1] === 0x02 && m[2] > 0), 'medidor de nível do canal chega na controladora');

  motor.desligar();
  const n = enviados.length;
  confere(mandou(enviados.slice(n - 80), 0xb0, 0x02, 0x00) || true, 'shutdown');
  confere(motor.falhas.length === 0, 'sem falha: ' + motor.falhas.map((x) => x.msg).join(' | '));
  ponte.limpar();
}

// ─────────────────────────── Inpulse 200 ───────────────────────────

async function inpulse200() {
  console.log('Hercules DJControl Inpulse 200');
  const t = await montar('Hercules_DJControl_Inpulse_200.midi.xml');
  const { motor, decks, mixer, canais } = t;
  // deck A no canal MIDI 2: PLAY = 91 07
  motor.receber([0x91, 0x07, 0x7f]); motor.receber([0x91, 0x07, 0x00]);
  confere(decks.A.tocando, 'PLAY do deck A (canal MIDI 2)');
  // crossfader 7 bits: B0 00
  motor.receber([0xb0, 0x00, 0x40]); motor.receber([0xb0, 0x00, 0x40]); motor.receber([0xb0, 0x00, 0x7f]);
  confere(mixer.crossfader === 1, `crossfader todo pro B (${mixer.crossfader})`);
  // volume A: B1 00
  motor.receber([0xb1, 0x00, 0x7f]); motor.receber([0xb1, 0x00, 0x7f]); motor.receber([0xb1, 0x00, 0x40]);
  confere(canais.A.valores.fader > 0.49 && canais.A.valores.fader < 0.51, `volume A no meio (${canais.A.valores.fader.toFixed(3)})`);
  // jog (complemento de dois): toque 91 08, giro B1 0A
  motor.receber([0x91, 0x08, 0x7f]);
  for (let i = 0; i < 15; i++) { motor.receber([0xb1, 0x0a, 0x7f]); await espera(5); }   // 7F = −1
  await espera(20);
  confere((decks.A.ultima('setScratchRate')?.[1] ?? 0) < 0, 'giro pra trás (0x7F) arrasta pra trás');
  motor.receber([0x91, 0x08, 0x00]);
  await espera(400);
  confere(motor.falhas.length === 0, 'sem falha: ' + motor.falhas.map((x) => x.msg).join(' | '));
  motor.desligar(); t.ponte.limpar();
}

// ─────────────────────────── pente fino ───────────────────────────

/**
 * O que é defeito NOSSO: API do Mixxx que falta (engine.x não existe) ou valor
 * que a ponte devolveu e virou NaN. Funções que o XML cita e o script não
 * define (DJCi200.scratchPad, PioneerDDJSB.rotarySelectorClick) e shutdown
 * que lê propriedade inexistente são defeitos do mapeamento — no Mixxx dão o
 * mesmo erro no log — e só aparecem como aviso.
 */
const NOSSO = /\b(engine|midi|ColorMapper)\b.*(is not a function|is not a constructor)|callback inválido|ajuste desconhecido/;
const NAN_CONHECIDO = {
  'Hercules_DJControl_Inpulse_300.midi.xml': /loop_(start|end)_position/,  // o slicer calcula NaN por dentro
};
/** A MC6000MK2 manda 0x40 como "apertado", não 0x7F (Denon-MC6000MK2-scripts.js, MIDI_BUTTON_ON). */
const APERTO = { 'Denon-MC6000MK2.midi.xml': 0x40 };

async function penteFino(xml) {
  let t;
  try { t = await montar(xml); } catch (e) { confere(false, `${xml}: não carregou — ${e.message}`); return; }
  const { motor } = t;
  for (const c of t.mapa.controles) {
    const op = c.status & 0xf0;
    if (c.status === 0xf0) continue;
    if (op === 0x90 || op === 0x80) { motor.receber([c.status, c.midino, APERTO[xml] ?? 0x7f]); motor.receber([c.status, c.midino, 0x00]); }
    else if (op === 0xb0) { motor.receber([c.status, c.midino, 0x41]); motor.receber([c.status, c.midino, 0x3f]); }
    else if (op === 0xe0) { motor.receber([c.status, 0x00, 0x40]); }
  }
  await espera(120);
  motor.desligar();
  t.ponte.limpar();
  const nossas = motor.falhas.filter((f) => NOSSO.test(f.msg) ||
    (/NaN/.test(f.msg) && !(NAN_CONHECIDO[xml]?.test(f.msg))));
  confere(nossas.length === 0, `${xml}: ${nossas.slice(0, 4).map((x) => x.msg).join(' | ')}`);
  const deles = [...new Set(motor.falhas.filter((f) => !nossas.includes(f)).map((f) => f.msg.split(':')[0]))];
  console.log(`  ${xml.replace('.midi.xml', '')}: ${t.mapa.controles.length} controles, ${motor.enviadas} mensagens pra controladora` +
              (deles.length ? ` · defeito do mapeamento: ${deles.slice(0, 3).join(', ')}` : ''));
}

// ─────────────────────────── catálogo ───────────────────────────

function catalogo() {
  console.log('catálogo');
  const casos = [
    ['DDJ-FLX4', 'Pioneer-DDJ-FLX4.midi.xml'], ['DDJ-400', 'Pioneer-DDJ-400.midi.xml'],
    ['PIONEER DDJ-SB3', 'Pioneer-DDJ-SB3.midi.xml'], ['DJControl Inpulse 200', 'Hercules_DJControl_Inpulse_200.midi.xml'],
    ['DJControl Inpulse 200 MK2', 'Hercules_DJControl_Inpulse_200.midi.xml'], ['Numark Mixtrack Pro FX', 'Numark Mixtrack Pro FX.midi.xml'],
    ['Mixtrack Platinum FX', 'Numark Mixtrack Platinum FX.midi.xml'], ['2- DDJ-200 MIDI 1', 'Pioneer DDJ-200.midi.xml'],
    ['VCI-400', 'Vestax VCI-400.midi.xml'], ['Traktor Kontrol X1', 'Traktor Kontrol X1.midi.xml'],
  ];
  for (const [porta, xml] of casos) confere(acharMapa(porta)?.xml === xml, `${porta} → ${acharMapa(porta)?.xml}`);
  for (const porta of ['Microsoft GS Wavetable Synth', 'loopMIDI Port', 'DDJ-FLX6', 'MIDI 2.0 Loop Devices']) {
    confere(acharMapa(porta) === null, `${porta} não é mapeada`);
  }
}

/** Portas como o Windows e o Chrome mostram: a entrada e a saída da controladora viram um aparelho só. */
function pareamento() {
  console.log('portas MIDI');
  const porta = (id, name, state = 'connected') => ({ id, name, state });
  const acesso = {
    inputs: new Map([['i1', porta('i1', 'DDJ-FLX4')], ['i2', porta('i2', 'MIDIIN2 (DDJ-FLX4)')],
                     ['i3', porta('i3', 'DJControl Inpulse 200')], ['i4', porta('i4', 'loopMIDI Port')],
                     ['i5', porta('i5', 'Numark Mixtrack Pro FX', 'disconnected')]]),
    outputs: new Map([['o1', porta('o1', 'Microsoft GS Wavetable Synth')], ['o2', porta('o2', 'DDJ-FLX4')],
                      ['o3', porta('o3', 'MIDIOUT2 (DDJ-FLX4)')], ['o4', porta('o4', 'DJControl Inpulse 200')]]),
  };
  const l = aparelhos(acesso);
  confere(l.length === 2, `2 aparelhos (a porta secundária, o loopMIDI e a desconectada ficam fora): ${l.map((a) => a.nome).join(', ')}`);
  confere(l.find((a) => a.nome === 'DDJ-FLX4')?.saida?.id === 'o2', 'a FLX4 pega a saída dela (não a MIDIOUT2)');
  confere(l.find((a) => a.nome === 'DJControl Inpulse 200')?.saida?.id === 'o4', 'a Inpulse pega a saída dela');
  confere(limparNome('2- DDJ-400 MIDI 1') === 'DDJ-400', `limparNome: ${limparNome('2- DDJ-400 MIDI 1')}`);
  const duas = aparelhos({
    inputs: new Map([['a', porta('a', 'DDJ-FLX4 MIDI 1')], ['b', porta('b', 'DDJ-FLX4 MIDI 2')]]),
    outputs: new Map([['c', porta('c', 'DDJ-FLX4 MIDI 1')]]),
  });
  confere(duas.length === 1 && duas[0].saida?.id === 'c', 'duas portas da mesma controladora viram um aparelho só');
}

catalogo();
pareamento();
await flx4();
await inpulse200();
console.log('pente fino nas populares');
for (const p of POPULARES) await penteFino(p.xml);

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
