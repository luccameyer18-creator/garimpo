/**
 * Como cada controle do Mixxx converte MIDI, "parâmetro" e valor.
 *
 * Três espaços, e confundir dois deles é o erro mais comum de quem porta um
 * mapeamento:
 *
 *   MIDI        0..127 — o que a controladora manda (ou 0..127,99 em 14 bits)
 *   parâmetro   0..1   — a POSIÇÃO do knob. É o que o Garimpo guarda: o EQ em
 *                        0,5 é o meio, o fader em 1 é o topo
 *   valor       o que o motor do Mixxx usa: o crossfader vai de −1 a 1, o
 *               ganho do EQ de 0 a 4 (1 = 0 dB), o volume numa curva de áudio
 *
 * As fórmulas são as do Mixxx 2.5.6 (src/control/controlbehavior.cpp), linha a
 * linha onde importa — em especial o "64 vale exatamente 0,5": o MIDI de 7 bits
 * não tem meio (0..127), e todo fabricante manda 64 no centro do knob. Sem esse
 * remendo o EQ "no meio" da controladora sairia 0,504 e cortaria um tico.
 *
 * Descritores (o que a ponte devolve em `comportamento(grupo, chave)`):
 *   { tipo:'pot', min, max, padrao }                  linear
 *   { tipo:'audio', minDb, maxDb, neutro, padrao }    curva de áudio
 *   { tipo:'toggle' | 'push' | 'janela', padrao }     botões
 *   { tipo:'num', padrao }                            número solto (MIDI/127)
 *   { tipo:'encoder', padrao }                        relativo (MIDI cru)
 */

const db2ratio = (db) => Math.pow(10, db / 20);
const ratio2db = (r) => 20 * Math.log10(r);
const prender = (x, a, b) => Math.max(a, Math.min(b, x));

/** Potenciômetro linear, com o remendo do 64. */
function pot(min, max) {
  const faixa = max - min;
  return {
    midiParaParametro: (m) => (m > 64 ? (m - 1) / 126 : m / 128),
    parametroParaValor: (p) => min + p * faixa,
    valorParaParametro: (v) => (faixa === 0 ? 0 : (prender(v, min, max) - min) / faixa),
    valorParaMidi(v) {
      const p = this.valorParaParametro(v);
      return p > 0.5 ? p * 126 + 1 : p * 128;
    },
  };
}

/**
 * Curva de áudio (ControlAudioTaperPotBehavior): abaixo do neutro, dB com um
 * "sobreposto" linear que leva o mínimo a silêncio de verdade; acima, dB puro.
 * É a curva do volume do canal (−20..0 dB, neutro no topo), do ganho (−12..+12,
 * neutro no meio) e dos knobs de EQ.
 */
function audio(minDb, maxDb, neutro) {
  const offset = db2ratio(minDb);
  const correcao = Math.ceil(neutro * 127) - neutro * 127;
  const maxValor = db2ratio(maxDb);
  const b = {
    midiParaParametro(m) {
      if (neutro !== 0 && neutro !== 1) {
        if ((m - correcao) / 127 < neutro) return m / (127 + correcao / neutro);
        return (m - correcao / neutro) / (127 - correcao / neutro);
      }
      return m / 127;
    },
    parametroParaValor(p) {
      if (p <= 0) return 0;
      if (p < neutro) {
        if (minDb === 0) return p / neutro;
        const db = (p * minDb) / (neutro * -1) + minDb;
        return (db2ratio(db) - offset) / (1 - offset);
      }
      if (p === neutro) return 1;
      if (p < 1) return db2ratio(((p - neutro) * maxDb) / (1 - neutro));
      return maxValor;
    },
    valorParaParametro(v) {
      if (v <= 0) return 0;
      if (v < 1) {
        if (minDb === 0) return v * neutro;
        const sobre = offset * (1 - v);
        return ((ratio2db(v + sobre) - minDb) / minDb) * neutro * -1;
      }
      if (v === 1) return neutro;
      if (v < maxValor) return (ratio2db(v) / maxDb) * (1 - neutro) + neutro;
      return 1;
    },
    valorParaMidi(v) {
      const p = b.valorParaParametro(v);
      let m = p * 127;
      if (neutro !== 0 && neutro !== 1) m += p < neutro ? (correcao * p) / neutro : (correcao * (1 - p)) / neutro;
      return m;
    },
  };
  return b;
}

const numerico = {
  midiParaParametro: (m) => m / 127,
  parametroParaValor: (p) => p,
  valorParaParametro: (v) => v,
  valorParaMidi: (v) => v * 127,
};

const encoder = {
  midiParaParametro: (m) => m,
  parametroParaValor: (p) => p,
  valorParaParametro: (v) => v,
  valorParaMidi: (v) => v,
};

const cache = new WeakMap();

/**
 * As conversões de um descritor. Guardadas por descritor: a mesma tabela é
 * consultada a cada mensagem do jog, centenas de vezes por segundo.
 */
export function conversoes(d) {
  if (!d) return numerico;
  let c = cache.get(d);
  if (c) return c;
  if (d.tipo === 'pot') c = pot(d.min, d.max);
  else if (d.tipo === 'audio') c = audio(d.minDb, d.maxDb, d.neutro);
  else if (d.tipo === 'encoder') c = encoder;
  else c = numerico;
  cache.set(d, c);
  return c;
}

/** Botão: apertado a menos que seja note-off ou valor zero (a regra do Mixxx). */
export const apertado = (opcode, midi) => !(opcode === 0x80 || midi === 0);

export const ehBotao = (d) => d?.tipo === 'toggle' || d?.tipo === 'push' || d?.tipo === 'janela';
export const ehContinuo = (d) => d?.tipo === 'pot' || d?.tipo === 'audio';
