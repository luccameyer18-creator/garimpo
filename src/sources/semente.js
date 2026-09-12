/**
 * O acervo que vem junto com o app — pra quem abre o link não começar vazio.
 *
 * O acervo local (crate.js) vive no IndexedDB do aparelho de quem garimpou.
 * Isso é ótimo pra quem cava, e inútil pra quem recebe o link: cada pessoa
 * abriria o Garimpo com a lista vazia e teria que cavar do zero.
 *
 * Então o repositório carrega um acervo pronto, garimpado uma vez e servido
 * como arquivo estático. Custa zero de servidor — é o mesmo GitHub Pages que
 * serve o app — e há um argumento melhor que o de conveniência: garimpar uma
 * vez e distribuir faz a rede comunitária do Audius levar UMA varredura em vez
 * de uma por pessoa que abre o link.
 *
 * FORMATO: array de arrays, não de objetos. Repetir 11 nomes de campo em 10 mil
 * faixas custa ~1,4 MB só de chaves. Em array posicional são 221 bytes por
 * faixa; o GitHub Pages ainda entrega comprimido por cima disso.
 *
 * A semente NÃO substitui o garimpo: ela é o ponto de partida, e o botão
 * "garimpar mais" continua somando por cima, no aparelho de cada um.
 */

import { guardar, contar } from './crate.js';

/** Ordem dos campos no array posicional. Mudar aqui exige regerar o arquivo. */
export const CAMPOS = ['id', 'title', 'artist', 'handle', 'duration', 'genre',
                       'bpm', 'camelot', 'key', 'pilha', 'artwork'];

const CHAVE_VERSAO = 'garimpo.sementeVersao';

function inflar(linha) {
  const f = { source: 'audius' };
  CAMPOS.forEach((c, i) => { f[c] = linha[i] ?? null; });
  f.isLongMix = f.duration > 600;
  f.playable = true;          // a semente só guarda o que passou no filtro de deck
  return f;
}

/**
 * Carrega a semente no acervo local, se ainda não foi carregada.
 *
 * Só roda uma vez por versão do arquivo: a versão fica no localStorage, então
 * publicar uma semente nova faz todo mundo recebê-la sem apagar o que a pessoa
 * garimpou por conta própria — `guardar` funde por id.
 *
 * Falhar aqui não é erro fatal: sem semente o app funciona como sempre
 * funcionou, buscando na rede. Por isso tudo está dentro de try.
 *
 * @returns {Promise<{carregou:boolean, novas:number, total:number, versao:string|null}>}
 */
export async function carregarSemente({ url = 'assets/acervo.json', aoAndar = () => {} } = {}) {
  try {
    const r = await fetch(url, { cache: 'force-cache' });
    if (!r.ok) return { carregou: false, novas: 0, total: await contar().catch(() => 0), versao: null };
    const j = await r.json();
    const versao = String(j.versao || '');

    let jaTem = null;
    try { jaTem = localStorage.getItem(CHAVE_VERSAO); } catch {}
    if (jaTem === versao) {
      return { carregou: false, novas: 0, total: await contar().catch(() => 0), versao };
    }

    // em lotes: 12 mil faixas numa transação só trava a interface por segundos
    const linhas = j.faixas || [];
    const LOTE = 500;
    let novas = 0;
    for (let i = 0; i < linhas.length; i += LOTE) {
      const bloco = linhas.slice(i, i + LOTE).map(inflar);
      novas += await guardar(bloco, null);
      aoAndar({ feitas: Math.min(i + LOTE, linhas.length), de: linhas.length, novas });
      // devolve o fôlego pro navegador entre lotes
      await new Promise((ok) => setTimeout(ok, 0));
    }
    try { localStorage.setItem(CHAVE_VERSAO, versao); } catch {}
    return { carregou: true, novas, total: await contar().catch(() => 0), versao };
  } catch {
    return { carregou: false, novas: 0, total: await contar().catch(() => 0), versao: null };
  }
}

/** Empacota o acervo atual no formato da semente. Usado pra gerar o arquivo. */
export function empacotar(faixas, { versao = new Date().toISOString().slice(0, 10) } = {}) {
  return {
    versao,
    campos: CAMPOS,
    faixas: faixas
      .filter((f) => f.id && f.bpm && f.camelot)
      .map((f) => CAMPOS.map((c) => (c === 'duration' ? Math.round(f[c] || 0) : (f[c] ?? null)))),
  };
}
