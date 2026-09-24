/**
 * Os mapeamentos do Mixxx: de onde vêm e como se leem.
 *
 * VÊM do repositório do Mixxx, na hora em que a controladora é plugada — o
 * Garimpo não guarda cópia nenhuma. Os mapeamentos são GPL; baixar da fonte e
 * rodar no navegador de quem plugou é usar, não redistribuir. E vêm FIXADOS
 * num commit (o da versão 2.5.6), não num ramo: um mapeamento que mudasse
 * sozinho amanhã mudaria a controladora de alguém no meio de um set.
 *
 * Por que raw.githubusercontent e não o jsDelivr: o jsDelivr recusa repositório
 * acima de 50 MB, e o do Mixxx passa — só serve o que já estava no cache dele
 * (medido: 4 dos 27 scripts populares voltaram 403). O raw responde com CORS
 * aberto; o jsDelivr fica de reserva.
 *
 * O arquivo baixado vai pro Cache Storage: a URL tem o commit, então nunca
 * envelhece, e a segunda vez que a controladora conecta não depende de rede.
 *
 * SE LEEM com expressões regulares, não com DOMParser: o XML do Mixxx é simples
 * e o mesmo leitor roda no navegador e no teste do Node, que não tem DOM.
 */

export const MIXXX_COMMIT = '3ebac449e7e5fe2a0186596657696e87ce8b0e56';   // tag 2.5.6
export const MIXXX_VERSAO = '2.5.6';
const FONTES = [
  `https://raw.githubusercontent.com/mixxxdj/mixxx/${MIXXX_COMMIT}/res/controllers/`,
  `https://cdn.jsdelivr.net/gh/mixxxdj/mixxx@${MIXXX_COMMIT}/res/controllers/`,
];
/** O Mixxx carrega este antes de qualquer mapeamento (REQUIRED_SCRIPT_FILE). */
const OBRIGATORIO = 'common-controller-scripts.js';

// ─────────────────────────── leitura do XML ───────────────────────────

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texto = (s) => (s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : ENTIDADES[e.toLowerCase()] ?? m)
  .trim();

function blocos(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  return [...xml.matchAll(re)].map((m) => m[1]);
}
function campo(bloco, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(bloco);
  return m ? texto(m[1]) : null;
}
const atributo = (tag, nome) => {
  const m = new RegExp(`\\b${nome}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? texto(m[2] ?? m[3]) : null;
};

/** Número como o QString::toInt(base 0): 0x.. hexa, 0.. octal, senão decimal. */
function inteiro(s) {
  s = (s ?? '').trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  if (/^0[0-7]+$/.test(s)) return parseInt(s, 8);
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  return NaN;
}

const OPCOES = {
  invert: 'invert', rot64: 'rot64', rot64inv: 'rot64inv', rot64fast: 'rot64fast', diff: 'diff',
  button: 'button', switch: 'switch', hercjog: 'hercjog', hercjogfast: 'hercjogfast', spread64: 'spread64',
  selectknob: 'selectknob', 'soft-takeover': 'soft', 'script-binding': 'script',
  'fourteen-bit-msb': 'msb', 'fourteen-bit-lsb': 'lsb',
};

/**
 * Lê um .midi.xml do Mixxx (LegacyMidiControllerMappingFileHandler).
 * @returns {{nome, autor, descricao, arquivos:{arquivo,prefixo}[], controles, saidas, ajustes}}
 */
export function lerXml(xml) {
  xml = xml.replace(/<!--[\s\S]*?-->/g, '');
  const info = blocos(xml, 'info')[0] || '';
  const controlador = /<controller\b[^>]*>([\s\S]*)<\/controller>/i.exec(xml)?.[1] || xml;

  const arquivos = [...(blocos(controlador, 'scriptfiles')[0] || '').matchAll(/<file\b([^>]*)\/?>/gi)]
    .map((m) => ({ arquivo: atributo(m[1], 'filename'), prefixo: atributo(m[1], 'functionprefix') || '' }))
    .filter((a) => a.arquivo);

  const controles = [];
  for (const b of blocos(blocos(controlador, 'controls')[0] || '', 'control')) {
    const status = inteiro(campo(b, 'status')), midino = inteiro(campo(b, 'midino'));
    const opcoes = { algum: false };
    const ops = /<options\b[^>]*>([\s\S]*?)<\/options>/i.exec(b)?.[1] || '';
    for (const m of ops.matchAll(/<([\w-]+)\b[^>]*\/?>/g)) {
      const o = OPCOES[m[1].toLowerCase()];
      if (!o) continue;
      opcoes[o] = true;
      // "normal" não é opção; soft/script/14 bits não passam pelo computeValue
      if (!['soft', 'script', 'msb', 'lsb'].includes(o)) opcoes.algum = true;
    }
    controles.push({
      status: Number.isNaN(status) ? 0 : status & 0xff,
      midino: Number.isNaN(midino) ? 0 : midino & 0xff,
      grupo: campo(b, 'group') ?? '', chave: campo(b, 'key') ?? '', opcoes,
    });
  }

  const saidas = [];
  for (const b of blocos(blocos(controlador, 'outputs')[0] || '', 'output')) {
    const num = (t, padrao) => { const v = Number(campo(b, t)); return campo(b, t) != null && campo(b, t) !== '' && Number.isFinite(v) ? v : padrao; };
    const byte = (t, padrao) => { const v = inteiro(campo(b, t)); return Number.isNaN(v) ? padrao : v & 0xff; };
    saidas.push({
      grupo: campo(b, 'group') ?? '', chave: campo(b, 'key') ?? '',
      status: byte('status', 0), midino: byte('midino', 0),
      on: byte('on', 0x7f), off: byte('off', 0x00),
      min: num('minimum', 0), max: num('maximum', 1),
    });
  }

  // <settings>: cada <option variable=… type=… default=…> vira engine.getSetting
  const ajustes = {};
  for (const m of xml.matchAll(/<option\b([^>]*?)(\/>|>([\s\S]*?)<\/option>)/gi)) {
    const nome = atributo(m[1], 'variable');
    if (!nome) continue;
    const tipo = (atributo(m[1], 'type') || '').toLowerCase();
    const padrao = atributo(m[1], 'default');
    if (tipo === 'boolean') ajustes[nome] = padrao === 'true';
    else if (tipo === 'integer' || tipo === 'real') ajustes[nome] = Number(padrao ?? 0);
    else if (tipo === 'enum') {
      const valores = [...(m[3] || '').matchAll(/<value\b([^>]*)>([\s\S]*?)<\/value>/gi)];
      const escolhido = valores.find((v) => /default\s*=\s*"true"/i.test(v[1])) || valores[0];
      ajustes[nome] = escolhido ? texto(escolhido[2]) : '';
    } else ajustes[nome] = padrao ?? '';
  }

  return {
    nome: campo(info, 'name') || '', autor: campo(info, 'author') || '',
    descricao: campo(info, 'description') || '',
    arquivos, controles, saidas, ajustes,
  };
}

// ─────────────────────────── download ───────────────────────────

const CACHE = 'garimpo-mixxx-' + MIXXX_COMMIT.slice(0, 8);

async function comPrazo(url, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: 'force-cache' });
    if (!r.ok) throw new Error(`${r.status} em ${url}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

/** Um arquivo de res/controllers, do cache ou da rede (fonte principal, depois a reserva). */
export async function baixar(arquivo, { baixador = null } = {}) {
  if (baixador) return baixador(arquivo);
  const caminho = encodeURIComponent(arquivo);
  let cx = null;
  try { cx = typeof caches !== 'undefined' ? await caches.open(CACHE) : null; } catch { cx = null; }
  if (cx) {
    for (const f of FONTES) {
      const r = await cx.match(f + caminho).catch(() => null);
      if (r) return r.text();
    }
  }
  let erro = null;
  for (const f of FONTES) {
    try {
      const txt = await comPrazo(f + caminho, 12000);
      if (cx) cx.put(f + caminho, new Response(txt, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })).catch(() => {});
      return txt;
    } catch (e) { erro = e; }
  }
  throw new Error(`não consegui baixar ${arquivo} do Mixxx (${erro?.message || erro})`);
}

/**
 * O mapeamento inteiro, pronto pro motor: o XML lido e os scripts na ordem em
 * que o Mixxx avalia (o obrigatório primeiro, sem repetir se o XML também pedir).
 */
export async function carregarMapa(arquivoXml, op = {}) {
  const lido = lerXml(await baixar(arquivoXml, op));
  const nomes = [OBRIGATORIO, ...lido.arquivos.map((a) => a.arquivo).filter((a) => a !== OBRIGATORIO)];
  const textos = await Promise.all(nomes.map((n) => baixar(n, op)));
  const prefixo = (n) => lido.arquivos.find((a) => a.arquivo === n)?.prefixo || '';
  return {
    ...lido,
    arquivoXml,
    scripts: nomes.map((n, i) => ({ arquivo: n, prefixo: prefixo(n), texto: textos[i] })),
  };
}
