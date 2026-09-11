/**
 * Configuração do Garimpo.
 *
 * O Client ID do Spotify NÃO é segredo. No fluxo Authorization Code + PKCE ele
 * é público por construção: vai no código do navegador de qualquer app, e a
 * segurança vem do code_verifier gerado por sessão, não de esconder o id.
 * Por isso ele fica versionado aqui. O que NUNCA pode entrar neste repo é
 * client_secret (que o PKCE dispensa) ou chave de API da Anthropic — o hook de
 * pre-commit bloqueia esses.
 */

export const SPOTIFY = {
  clientId: 'ffe8a525668e4f3fae0889422757c591',

  /**
   * A Spotify exige que o redirect_uri bata CARACTERE POR CARACTERE com um dos
   * cadastrados no app. Barra a mais no fim já quebra. E desde abril de 2025
   * "localhost" é rejeitado: tem que ser o IP literal 127.0.0.1.
   */
  redirectUris: {
    'http://127.0.0.1:8080': 'http://127.0.0.1:8080/callback.html',
    'https://luccameyer18-creator.github.io': 'https://luccameyer18-creator.github.io/garimpo/callback.html',
  },

  /**
   * Escopos mínimos. Só leitura, só do próprio usuário.
   * Nada de playback: o áudio do Spotify não entra no grafo (DRM + §III.7).
   */
  scopes: [
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-library-read',
  ],

  authUrl: 'https://accounts.spotify.com/authorize',
  tokenUrl: 'https://accounts.spotify.com/api/token',
  apiBase: 'https://api.spotify.com/v1',
};

/** Resolve o redirect_uri desta origem. Lança se a origem não estiver cadastrada. */
export function redirectUri(origin = location.origin) {
  const uri = SPOTIFY.redirectUris[origin];
  if (!uri) {
    throw new Error(
      `origem "${origin}" não cadastrada no app do Spotify. ` +
      `Cadastradas: ${Object.keys(SPOTIFY.redirectUris).join(', ')}`
    );
  }
  return uri;
}

export const AUDIUS = {
  appName: 'garimpo',
  deckMinSec: 60,
  deckMaxSec: 600,
};

export const AUDIO = {
  /** O padrão do signalsmith é 120 ms, o que dá 240 ms de lookahead no handoff. */
  keylockBlockMs: 40,
  /** Janela de qualidade do signalsmith: fora dela o keylock é desligado. */
  keylockMin: 0.70,
  keylockMax: 1.45,
  /** Constante de tempo do suavizador de taxa, contra ruído de zíper no jog. */
  rateTau: 0.004,
  /** Desvio de taxa aceitável numa correção de fase antes de virar audível. */
  syncMaxDeviation: 0.06,
};
