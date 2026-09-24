/**
 * As falas da controladora, nos três idiomas do Garimpo.
 *
 * Ficam aqui e não no i18n.js pra que a controladora seja uma peça só: tudo
 * que ela diz mora na pasta dela. O idioma é o mesmo que a pessoa escolheu.
 */
import { idioma } from '../ui/i18n.js';

const PT = {
  'botao': 'controladora de DJ',
  'titulo': 'Controladora',
  'semMidi': 'Este navegador não fala com controladoras. Use o <b>Chrome</b> ou o <b>Edge</b> no computador (no Android, o Chrome também serve). Safari e iPhone não têm Web MIDI.',
  'inseguro': 'A controladora só funciona em endereço seguro (https).',
  'explica': 'Plugue a controladora no USB e toque em <b>ligar</b>. O navegador vai pedir licença pra usar dispositivos MIDI — é assim que ele deixa um site falar com ela.',
  'ligar': 'ligar controladora',
  'pedindo': 'pedindo licença ao navegador…',
  'negado': 'O navegador não deixou. Clique no cadeado da barra de endereço, libere <b>dispositivos MIDI</b> e tente de novo.',
  'nenhuma': 'Nenhuma controladora plugada. Pode plugar agora — eu percebo sozinho.',
  'carregando': 'baixando o mapa…',
  'ligada': 'ligada',
  'desconhecida': 'ainda não conheço esta',
  'erroMapa': 'não consegui baixar o mapa ({e})',
  'semSaida': 'sem volta de luz: a saída MIDI dela não abriu',
  'semSysex': 'sem licença de SysEx: ela funciona, mas só descobre onde está cada knob quando você mexe',
  'desligar': 'desligar',
  'fonte': 'Mapas da comunidade <a href="https://mixxx.org" target="_blank" rel="noopener">Mixxx</a> {v}, baixados do repositório deles na hora em que a controladora conecta.',
  'fantasmas': 'Quando o Garimpeiro mexe num knob, o de plástico não se move. Um anel mostra onde está a sua mão, e o som só volta pra ela quando você passar por ali.',
  'obs.mk2': 'o MK2 roda no mapa do modelo anterior — o básico funciona, algum botão novo pode não responder',
  'obs.partymix': 'roda no mapa da Party Mix original — o básico funciona, algum botão novo pode não responder',
  'parecido': 'mapa achado pelo nome',
  'falhas': '{n} aviso(s) do mapa — ver o console',
  'n.ligou': 'Senti sua <b>{nome}</b>! O que você mexer nela, eu sigo.',
  'n.ligou.p': 'Quando eu mexer num knob, o seu não se move sozinho: gira até o anel encontrar o som e ele volta pra sua mão.',
  'n.fantasma': 'Seu <b>{ctl}</b> está num lugar e o som em outro: gira até o anel encontrar.',
  'n.fantasma.p': 'É o soft takeover das controladoras: o knob só pega quando passa pelo valor do som — assim a música não dá pulo.',
  'n.desconhecida': 'Achei a <b>{nome}</b>, mas ainda não conheço essa controladora.',
  'n.desconhecida.p': 'Uso os mapas da comunidade Mixxx, e essa ainda não tem um.',
  'n.saiu': 'A <b>{nome}</b> saiu do USB.',
  'ctl.xf': 'CROSSFADER', 'ctl.master': 'VOLUME GERAL', 'ctl.pitch': 'PITCH {d}', 'ctl.vol': 'VOLUME {d}',
  'ctl.fil': 'FILTRO {d}', 'ctl.grave': 'GRAVE {d}', 'ctl.medio': 'MÉDIO {d}', 'ctl.agudo': 'AGUDO {d}',
};

const EN = {
  'botao': 'DJ controller',
  'titulo': 'Controller',
  'semMidi': 'This browser can’t talk to controllers. Use <b>Chrome</b> or <b>Edge</b> on a computer (Chrome on Android works too). Safari and iPhone have no Web MIDI.',
  'inseguro': 'The controller only works on a secure (https) address.',
  'explica': 'Plug the controller into USB and tap <b>connect</b>. The browser will ask permission to use MIDI devices — that’s how it lets a site talk to it.',
  'ligar': 'connect controller',
  'pedindo': 'asking the browser for permission…',
  'negado': 'The browser said no. Click the padlock in the address bar, allow <b>MIDI devices</b> and try again.',
  'nenhuma': 'No controller plugged in. Plug it in now — I’ll notice.',
  'carregando': 'downloading the mapping…',
  'ligada': 'connected',
  'desconhecida': 'I don’t know this one yet',
  'erroMapa': 'couldn’t download the mapping ({e})',
  'semSaida': 'no light feedback: its MIDI output didn’t open',
  'semSysex': 'no SysEx permission: it works, but only learns where each knob is when you move it',
  'desligar': 'disconnect',
  'fonte': 'Mappings from the <a href="https://mixxx.org" target="_blank" rel="noopener">Mixxx</a> community {v}, downloaded from their repository when the controller connects.',
  'fantasmas': 'When the Garimpeiro turns a knob, the plastic one doesn’t move. A ring shows where your hand is, and the sound only comes back to it when you pass through there.',
  'obs.mk2': 'the MK2 runs on the previous model’s mapping — the basics work, some new button may not respond',
  'obs.partymix': 'runs on the original Party Mix mapping — the basics work, some new button may not respond',
  'parecido': 'mapping found by name',
  'falhas': '{n} warning(s) from the mapping — see the console',
  'n.ligou': 'I can feel your <b>{nome}</b>! Whatever you move on it, I follow.',
  'n.ligou.p': 'When I turn a knob, yours doesn’t move by itself: turn it until the ring meets the sound and it’s back in your hand.',
  'n.fantasma': 'Your <b>{ctl}</b> is in one place and the sound in another: turn it until the ring meets it.',
  'n.fantasma.p': 'That’s controller soft takeover: the knob only grabs when it passes the sound’s value — so the music doesn’t jump.',
  'n.desconhecida': 'Found the <b>{nome}</b>, but I don’t know that controller yet.',
  'n.desconhecida.p': 'I use the Mixxx community mappings, and it doesn’t have one yet.',
  'n.saiu': 'The <b>{nome}</b> was unplugged.',
  'ctl.xf': 'CROSSFADER', 'ctl.master': 'MASTER VOLUME', 'ctl.pitch': 'PITCH {d}', 'ctl.vol': 'VOLUME {d}',
  'ctl.fil': 'FILTER {d}', 'ctl.grave': 'LOW {d}', 'ctl.medio': 'MID {d}', 'ctl.agudo': 'HIGH {d}',
};

const ES = {
  'botao': 'controladora de DJ',
  'titulo': 'Controladora',
  'semMidi': 'Este navegador no habla con controladoras. Usá <b>Chrome</b> o <b>Edge</b> en la computadora (en Android, Chrome también sirve). Safari y iPhone no tienen Web MIDI.',
  'inseguro': 'La controladora solo funciona en una dirección segura (https).',
  'explica': 'Enchufá la controladora al USB y tocá <b>conectar</b>. El navegador va a pedir permiso para usar dispositivos MIDI — así deja que un sitio hable con ella.',
  'ligar': 'conectar controladora',
  'pedindo': 'pidiendo permiso al navegador…',
  'negado': 'El navegador no lo permitió. Hacé clic en el candado de la barra de direcciones, habilitá <b>dispositivos MIDI</b> y probá de nuevo.',
  'nenhuma': 'No hay ninguna controladora enchufada. Podés enchufarla ahora — me doy cuenta solo.',
  'carregando': 'bajando el mapa…',
  'ligada': 'conectada',
  'desconhecida': 'todavía no conozco esta',
  'erroMapa': 'no pude bajar el mapa ({e})',
  'semSaida': 'sin retorno de luz: su salida MIDI no abrió',
  'semSysex': 'sin permiso de SysEx: funciona, pero solo descubre dónde está cada perilla cuando la movés',
  'desligar': 'desconectar',
  'fonte': 'Mapas de la comunidad <a href="https://mixxx.org" target="_blank" rel="noopener">Mixxx</a> {v}, bajados de su repositorio cuando la controladora se conecta.',
  'fantasmas': 'Cuando el Garimpeiro gira una perilla, la de plástico no se mueve. Un anillo muestra dónde está tu mano, y el sonido solo vuelve a ella cuando pasás por ahí.',
  'obs.mk2': 'la MK2 usa el mapa del modelo anterior — lo básico anda, algún botón nuevo puede no responder',
  'obs.partymix': 'usa el mapa de la Party Mix original — lo básico anda, algún botón nuevo puede no responder',
  'parecido': 'mapa encontrado por el nombre',
  'falhas': '{n} aviso(s) del mapa — ver la consola',
  'n.ligou': '¡Siento tu <b>{nome}</b>! Lo que muevas en ella, lo sigo.',
  'n.ligou.p': 'Cuando yo gire una perilla, la tuya no se mueve sola: girala hasta que el anillo encuentre el sonido y vuelve a tu mano.',
  'n.fantasma': 'Tu <b>{ctl}</b> está en un lugar y el sonido en otro: girala hasta que el anillo lo encuentre.',
  'n.fantasma.p': 'Es el soft takeover de las controladoras: la perilla solo agarra cuando pasa por el valor del sonido — así la música no salta.',
  'n.desconhecida': 'Encontré la <b>{nome}</b>, pero todavía no conozco esa controladora.',
  'n.desconhecida.p': 'Uso los mapas de la comunidad Mixxx, y esa todavía no tiene uno.',
  'n.saiu': 'La <b>{nome}</b> se desenchufó.',
  'ctl.xf': 'CROSSFADER', 'ctl.master': 'VOLUMEN GENERAL', 'ctl.pitch': 'PITCH {d}', 'ctl.vol': 'VOLUMEN {d}',
  'ctl.fil': 'FILTRO {d}', 'ctl.grave': 'GRAVES {d}', 'ctl.medio': 'MEDIOS {d}', 'ctl.agudo': 'AGUDOS {d}',
};

const TEXTOS = { pt: PT, en: EN, es: ES };

/** Como o t() do Garimpo: chave faltando cai no português. */
export function tc(chave, vars = null) {
  let s = TEXTOS[idioma()]?.[chave] ?? PT[chave] ?? chave;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

/** O nome, na tela, do controle que um fantasma aponta (ids do index.html). */
export function nomeDoControle(tela) {
  let m;
  if (tela === 'xf' || tela === 'master') return tc('ctl.' + tela);
  if ((m = /^eq-([AB])-(grave|medio|agudo)$/.exec(tela))) return tc('ctl.' + m[2], { d: m[1] });
  if ((m = /^(pitch|vol|fil)-([AB])$/.exec(tela))) return tc('ctl.' + m[1], { d: m[2] });
  return tela;
}
