/**
 * Web MIDI: pedir licença, achar as controladoras e perceber quando plugam.
 *
 * Pede SysEx junto, de primeira. As Pioneer (FLX4, 400, 200) usam SysEx pra
 * duas coisas: o "estou vivo" a cada 200 ms e o pedido de "me diga onde estão
 * todos os faders" ao conectar — sem essa segunda, o Garimpo só descobre onde
 * está cada knob quando você mexe nele. Se a pessoa negar o SysEx, tenta sem:
 * a controladora funciona, só perde isso.
 *
 * Desde o Chrome 124, qualquer acesso MIDI pede permissão. Então a primeira
 * conexão nasce de um toque no botão (é o gesto que o navegador exige), e nas
 * visitas seguintes, com a licença já dada, reconecta sozinho.
 */

import { limparNome, naoEControladora } from './catalogo.js';

export const temMidi = () => typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';

/** 'granted' | 'prompt' | 'denied' | '?' — sem abrir diálogo nenhum. */
export async function licenca() {
  try {
    const s = await navigator.permissions.query({ name: 'midi', sysex: true });
    return s.state;
  } catch { return '?'; }
}

/** @returns {Promise<{acesso: MIDIAccess, sysex: boolean}>} */
export async function pedirAcesso() {
  try {
    return { acesso: await navigator.requestMIDIAccess({ sysex: true }), sysex: true };
  } catch (e) {
    // negou o SysEx (ou o navegador não oferece): sem ele ainda dá
    const acesso = await navigator.requestMIDIAccess({ sysex: false });
    return { acesso, sysex: false };
  }
}

/** "MIDIIN2 (DDJ-FLX4)": porta secundária que o Windows cria; a principal já está na lista. */
const SECUNDARIA = /^MIDI(IN|OUT)\d+\s*\(/i;

/**
 * Entradas e saídas viram "aparelhos": a controladora aparece como uma porta de
 * entrada e uma de saída com o mesmo nome, e é pela saída que os LEDs acendem.
 * @returns {{id, nome, entrada, saida}[]}
 */
export function aparelhos(acesso, extras = []) {
  const vivas = (m) => [...m.values()].filter((p) => p.state !== 'disconnected' && !SECUNDARIA.test(p.name || ''));
  const saidas = vivas(acesso.outputs);
  const lista = [];
  const vistos = new Set();
  for (const e of vivas(acesso.inputs)) {
    if (naoEControladora(e.name)) continue;
    const nome = limparNome(e.name);
    // "DDJ-FLX4 MIDI 1" e "DDJ-FLX4 MIDI 2" são a mesma controladora: um motor só
    if (vistos.has(nome)) continue;
    vistos.add(nome);
    const s = saidas.find((o) => o.name === e.name) ||
              saidas.find((o) => limparNome(o.name) === nome) ||
              saidas.find((o) => nome && limparNome(o.name).includes(nome)) || null;
    lista.push({ id: e.id, nome: e.name, entrada: e, saida: s });
  }
  return [...lista, ...extras];
}

/**
 * A controladora virtual (src/dev/controladora.html): uma aba manda os mesmos
 * bytes que a DDJ-FLX4 manda, por um BroadcastChannel, e recebe os LEDs de
 * volta. Pro Garimpo ela é uma controladora como outra qualquer — é assim que
 * dá pra testar tudo sem ter uma.
 */
export function ouvirVirtual(aoAparecer, aoSumir) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const bc = new BroadcastChannel('garimpo-controladora-virtual');
  const vivos = new Map();
  bc.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.t === 'ola' && !vivos.has(m.id)) {
      const entrada = { name: m.nome, id: 'virtual-' + m.id, state: 'connected', onmidimessage: null };
      const saida = { name: m.nome, id: 'virtual-out-' + m.id, state: 'connected',
                      send: (bytes) => bc.postMessage({ t: 'led', id: m.id, bytes: Array.from(bytes) }) };
      const ap = { id: entrada.id, nome: m.nome, entrada, saida, virtual: true };
      vivos.set(m.id, ap);
      bc.postMessage({ t: 'conectou', id: m.id });
      aoAparecer(ap);
    } else if (m.t === 'midi' && vivos.has(m.id)) {
      vivos.get(m.id).entrada.onmidimessage?.({ data: Uint8Array.from(m.bytes), timeStamp: performance.now() });
    } else if (m.t === 'tchau' && vivos.has(m.id)) {
      const ap = vivos.get(m.id);
      vivos.delete(m.id);
      aoSumir(ap);
    }
  };
  bc.postMessage({ t: 'quem' });            // a aba virtual já aberta se apresenta
  return () => bc.close();
}
