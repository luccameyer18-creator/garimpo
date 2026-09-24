/**
 * Que controladora é essa, e qual mapeamento do Mixxx serve nela.
 *
 * A única pista que o navegador dá é o NOME da porta MIDI ("DDJ-FLX4",
 * "DJControl Inpulse 200", "PIONEER DDJ-SB3"). Então:
 *
 *   1. as populares têm um padrão escrito à mão, conferido contra o nome que
 *      cada uma anuncia — é o caminho de quem tem o que se vende no Brasil;
 *   2. o resto cai numa comparação por palavras contra os 142 mapeamentos
 *      MIDI do Mixxx 2.5.6. Só aceita se TODAS as palavras de modelo baterem
 *      ("VCI-400" não pode virar "VCI-300").
 *
 * Portas que nunca são controladora (o sintetizador do Windows, portas
 * virtuais de roteamento) ficam de fora antes de tudo.
 */

/**
 * As mais vendidas, na ordem em que aparecem na lista. `obs` vira aviso pra
 * quem conectou: modelo novo de uma linha antiga roda no mapa do anterior, e
 * isso tem que ser dito, não escondido.
 */
export const POPULARES = [
  { nome: 'Pioneer DDJ-FLX4', re: /\bDDJ[-\s]?FLX4\b/i, xml: 'Pioneer-DDJ-FLX4.midi.xml' },
  { nome: 'Pioneer DDJ-400', re: /\bDDJ[-\s]?400\b/i, xml: 'Pioneer-DDJ-400.midi.xml' },
  { nome: 'Pioneer DDJ-200', re: /\bDDJ[-\s]?200\b/i, xml: 'Pioneer DDJ-200.midi.xml' },
  { nome: 'Pioneer DDJ-SB3', re: /\bDDJ[-\s]?SB3\b/i, xml: 'Pioneer-DDJ-SB3.midi.xml' },
  { nome: 'Pioneer DDJ-SB2', re: /\bDDJ[-\s]?SB2\b/i, xml: 'Pioneer-DDJ-SB2.midi.xml' },
  { nome: 'Pioneer DDJ-SB', re: /\bDDJ[-\s]?SB\b(?![-\s]?\d)/i, xml: 'Pioneer-DDJ-SB.midi.xml' },
  { nome: 'Pioneer DDJ-SX', re: /\bDDJ[-\s]?SX\b(?![-\s]?\d)/i, xml: 'Pioneer DDJ-SX.midi.xml' },
  { nome: 'Hercules DJControl Inpulse 200', re: /Inpulse\s*200/i, xml: 'Hercules_DJControl_Inpulse_200.midi.xml',
    obs: (porta) => (/MK\s*2/i.test(porta) ? 'ctl.obs.mk2' : null) },
  { nome: 'Hercules DJControl Inpulse 300', re: /Inpulse\s*300/i, xml: 'Hercules_DJControl_Inpulse_300.midi.xml',
    obs: (porta) => (/MK\s*2/i.test(porta) ? 'ctl.obs.mk2' : null) },
  { nome: 'Hercules DJControl Inpulse 500', re: /Inpulse\s*500/i, xml: 'Hercules_DJControl_Inpulse_500.midi.xml' },
  { nome: 'Hercules DJControl Starlight', re: /Starlight/i, xml: 'Hercules DJControl Starlight.midi.xml' },
  { nome: 'Hercules DJControl Compact', re: /DJ\s*Control\s*Compact/i, xml: 'Hercules DJControl Compact.midi.xml' },
  { nome: 'Hercules DJControl MIX', re: /DJ\s*Control\s*MIX\b/i, xml: 'Hercules DJControl MIX.midi.xml' },
  { nome: 'Hercules DJControl Jogvision', re: /Jogvision/i, xml: 'Hercules_DJControl_Jogvision.midi.xml' },
  { nome: 'Numark Mixtrack Pro FX', re: /Mixtrack\s*Pro\s*FX/i, xml: 'Numark Mixtrack Pro FX.midi.xml' },
  { nome: 'Numark Mixtrack Platinum FX', re: /Mixtrack\s*Platinum\s*FX/i, xml: 'Numark Mixtrack Platinum FX.midi.xml' },
  { nome: 'Numark Mixtrack Platinum', re: /Mixtrack\s*Platinum(?!\s*FX)/i, xml: 'Numark Mixtrack Platinum.midi.xml' },
  { nome: 'Numark Mixtrack Pro 3', re: /Mixtrack\s*(Pro\s*)?3\b/i, xml: 'Numark-Mixtrack-3.midi.xml' },
  { nome: 'Numark Party Mix', re: /Party\s*Mix/i, xml: 'Numark-Party-Mix.midi.xml',
    obs: (porta) => (/II|MK\s*2|Live|Pro/i.test(porta) ? 'ctl.obs.partymix' : null) },
  { nome: 'Numark DJ2GO2 Touch', re: /DJ2GO2\s*Touch/i, xml: 'Numark_DJ2GO2_Touch.midi.xml' },
  { nome: 'Numark NS6II', re: /\bNS6\s*II\b/i, xml: 'Numark NS6II.midi.xml' },
  { nome: 'Roland DJ-505', re: /\bDJ[-\s]?505\b/i, xml: 'Roland_DJ-505.midi.xml' },
  { nome: 'Denon MC7000', re: /\bMC\s*7000\b/i, xml: 'Denon-MC7000.midi.xml' },
  { nome: 'Denon MC6000MK2', re: /\bMC\s*6000\s*MK\s*2\b/i, xml: 'Denon-MC6000MK2.midi.xml' },
  { nome: 'Denon MC4000', re: /\bMC\s*4000\b/i, xml: 'Denon MC4000.midi.xml' },
  { nome: 'Reloop Mixage', re: /Mixage/i, xml: 'Reloop-Mixage.midi.xml' },
  { nome: 'Reloop Beatmix 2/4', re: /Beatmix/i, xml: 'Reloop Beatmix 2-4.midi.xml' },
  { nome: 'Behringer CMD Micro', re: /CMD\s*Micro/i, xml: 'Behringer CMD Micro.midi.xml' },
  { nome: 'Korg KAOSS DJ', re: /KAOSS\s*DJ/i, xml: 'Korg-KAOSS-DJ.midi.xml' },
  { nome: 'Allen & Heath Xone:K2', re: /XONE\s*:?\s*K2/i, xml: 'Allen and Heath Xone K2.midi.xml' },
  { nome: 'Traktor Kontrol X1', re: /Kontrol\s*X1/i, xml: 'Traktor Kontrol X1.midi.xml' },
];

/** Os 142 mapeamentos MIDI do Mixxx 2.5.6 (res/controllers/*.midi.xml, sem a extensão). */
export const TODOS = ['Akai MPD24', 'Akai-LPD8-RK', 'Allen and Heath Xone K2', 'American Audio RADIUS 2000 CH1',
  'American Audio RADIUS 2000 CH2', 'American Audio VMS2', 'American Audio VMS4', 'ArturiaKeyLab',
  'Behringer BCD2000', 'Behringer BCD3000 Advanced', 'Behringer BCD3000', 'Behringer BCR2000',
  'Behringer CMD MM1', 'Behringer CMD Micro', 'Behringer CMDStudio4a', 'Behringer DDM4000',
  'DJ TechTools MIDI Fighter Spectra', 'DJ TechTools MIDI Fighter Twister', 'DJ-Tech CDJ-101', 'DJ-Tech DJM-101',
  'DJ-Tech Kontrol One', 'DJ-Tech Mix-101', 'DJ-Tech Mixer One', 'DJ-Tech i-Mix Reload', 'DJTechTools MIDI Fighter',
  'Denon DN HS5500', 'Denon DN SC2000', 'Denon MC3000', 'Denon MC4000', 'Denon-MC6000MK2', 'Denon-MC7000',
  'Electrix Tweaker', 'Evolution_Xsession', 'FaderFoxDJ2', 'Gemini CDMP-7000 L audio', 'Gemini CDMP-7000 R audio',
  'Gemini FirstMix', 'Hercules DJ Console 4-Mx', 'Hercules DJ Console Mac Edition', 'Hercules DJ Console Mk2',
  'Hercules DJ Console Mk4', 'Hercules DJ Console RMX 2', 'Hercules DJ Console RMX Advanced', 'Hercules DJ Console RMX',
  'Hercules DJ Control AIR', 'Hercules DJ Control Instinct', 'Hercules DJ Control MP3 e2', 'Hercules DJ Control MP3',
  'Hercules DJ Control Steel', 'Hercules DJControl Compact', 'Hercules DJControl MIX', 'Hercules DJControl Starlight',
  'Hercules P32 DJ', 'Hercules_DJControl_Inpulse_200', 'Hercules_DJControl_Inpulse_300', 'Hercules_DJControl_Inpulse_500',
  'Hercules_DJControl_Jogvision', 'Icon-P1Nano', 'Icon-iControls', 'Intech TEK2', 'Ion Discover DJ', 'Ion-Discover-DJ-Pro',
  'KANE_QuNeo', 'Kontrol Dj KDJ500', 'Korg nanoKONTROL 2', 'Korg nanoKONTROL', 'Korg nanoPAD2', 'Korg-KAOSS-DJ',
  'M-Audio_Xsession_pro', 'MVave-SMC-Mixer', 'MVave-SMK-25-II', 'Midi-Keyboard', 'MidiTech-MidiControl', 'Midi_for_light',
  'MixVibes U-Mix Control 2', 'MixVibes U-Mix Control Pro 2', 'Mixman DM2 (Linux)', 'Mixman DM2 (OS X)',
  'Mixman DM2 (Windows)', 'Novation Dicer', 'Novation Launchpad MK2', 'Novation Launchpad Mini MK3', 'Novation Launchpad',
  'Novation-Launchpad-Mini', 'Numark DJ2Go', 'Numark MIXTRACK', 'Numark Mixtrack 2', 'Numark Mixtrack Platinum FX',
  'Numark Mixtrack Platinum', 'Numark Mixtrack Pro FX', 'Numark Mixtrack Pro', 'Numark N4', 'Numark NS6II', 'Numark NS7',
  'Numark Omni Control', 'Numark Total Control', 'Numark V7', 'Numark iDJ Live II', 'Numark-Mixtrack-3', 'Numark-Party-Mix',
  'Numark-Scratch', 'Numark_DJ2GO2_Touch', 'Pioneer CDJ-2000', 'Pioneer CDJ-350 Ch1', 'Pioneer CDJ-350 Ch2',
  'Pioneer CDJ-850', 'Pioneer DDJ-200', 'Pioneer DDJ-SX', 'Pioneer-DDJ-400', 'Pioneer-DDJ-FLX4', 'Pioneer-DDJ-SB',
  'Pioneer-DDJ-SB2', 'Pioneer-DDJ-SB3', 'Reloop Beatmix 2-4', 'Reloop Beatpad', 'Reloop Digital Jockey 2 Controller Edition',
  'Reloop Jockey 3 ME', 'Reloop Terminal Mix 2-4', 'Reloop-Digital-Jockey-2-IE', 'Reloop-Mixage', 'Roland_DJ-505',
  'Soundless_joyMIDI', 'Stanton SCS.1d', 'Stanton SCS.1m', 'Stanton SCS.3d Alternate', 'Stanton SCS.3d', 'Stanton SCS.3m',
  'Stanton-DJC-4', 'TrakProDJ iPad', 'Traktor Kontrol X1', 'Vestax Spin', 'Vestax Typhoon Enhanced', 'Vestax Typhoon',
  'Vestax VCI-100-3DEX', 'Vestax VCI-100-hile', 'Vestax VCI-100', 'Vestax VCI-100MKII', 'Vestax VCI-300', 'Vestax VCI-400',
  'Wireless DJ App', 'Yaeltex MiniMixxx', 'us428'];

/** Nunca é controladora: sintetizador do sistema, roteamento, portas de serviço. */
const NAO_E = /GS Wavetable|Microsoft|MIDI Through|Midi Through|IAC Driver|loopMIDI|LoopBe|rtpMIDI|Network Session|MIDI 2\.0 (Service|Loop|Virtual)|Virtual (Raw )?MIDI|Bluetooth LE MIDI Service|WavetableSynth|Session \d+/i;

/** Palavras que não identificam modelo: a marca e o genérico. */
const GENERICAS = new Set(['pioneer', 'hercules', 'numark', 'reloop', 'denon', 'roland', 'behringer', 'korg', 'akai',
  'american', 'audio', 'dj', 'djcontrol', 'control', 'controller', 'midi', 'mixxx', 'ch1', 'ch2', 'the', 'and', 'native',
  'instruments', 'ni', 'port', 'in', 'out', 'usb', 'edition', 'linux', 'os', 'x', 'windows', 'tech', 'djtechtools', 'techtools',
  'stanton', 'vestax', 'gemini', 'ion', 'icon', 'novation', 'mixvibes', 'allen', 'heath', 'evolution', 'm', 'traktor']);

const palavras = (s) => s.toLowerCase().replace(/[()[\]{}:,._/]+/g, ' ').split(/[\s-]+/).filter(Boolean);

/** Tira o que o sistema acrescenta ao nome: "2- ", " MIDI 1", "[0]", "(Port 1)". */
export function limparNome(porta) {
  return String(porta || '')
    .replace(/^\d+\s*-\s*/, '')
    .replace(/\s*\[\d+\]\s*$/, '')
    .replace(/\s*\((port|porta)?\s*\d+\)\s*$/i, '')
    .replace(/\s+MIDI(\s*\d+)?\s*$/i, '')
    .trim();
}

export const naoEControladora = (porta) => NAO_E.test(String(porta || ''));

/**
 * Acha o mapeamento pra um nome de porta.
 * @returns {{nome:string, xml:string, obs:string|null, jeito:'popular'|'parecido'}|null}
 */
export function acharMapa(porta) {
  const nome = limparNome(porta);
  if (!nome || naoEControladora(porta)) return null;
  for (const p of POPULARES) {
    if (p.re.test(nome)) return { nome: p.nome, xml: p.xml, obs: p.obs?.(nome) || null, jeito: 'popular' };
  }
  const tem = new Set(palavras(nome).flatMap((w) => [w, w.replace(/-/g, '')]));
  const junto = palavras(nome).join('');
  let melhor = null;
  for (const m of TODOS) {
    const modelo = palavras(m).filter((w) => !GENERICAS.has(w));
    if (!modelo.length) continue;
    // toda palavra de modelo tem que estar na porta (solta ou colada: "SCS.3d" / "scs3d")
    if (!modelo.every((w) => tem.has(w) || junto.includes(w))) continue;
    const peso = modelo.join('').length;
    if (!melhor || peso > melhor.peso) melhor = { nome: m.replace(/[_-]/g, ' '), xml: m + '.midi.xml', peso };
  }
  return melhor ? { nome: melhor.nome, xml: melhor.xml, obs: null, jeito: 'parecido' } : null;
}
