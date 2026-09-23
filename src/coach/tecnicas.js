/**
 * Repertório de transições — o que o DJ automático sabe fazer.
 *
 * Até aqui ele sabia UM truque: troca de graves com crossfade de 8 segundos,
 * sempre igual. Quem ouviu um set inteiro percebeu: não mexia em filtro, não
 * usava eco nem loop, não variava, e sobrepunha por 8 s até duas músicas de
 * tom brigando. Um DJ de verdade escolhe a técnica pela dupla de músicas.
 *
 * Cada técnica é um ROTEIRO em TEMPOS, não em segundos. Isso importa: 8 s a
 * 126 BPM são 16,8 tempos, ou seja, a transição terminava no meio de um
 * compasso. Em tempos ela sempre fecha na frase, em qualquer andamento.
 *
 * O roteiro é declarativo — uma lista de passos e rampas — e quem executa é
 * `executar()`. Separar assim é o que deixa o Jev entrar depois sem tocar no
 * motor: ele só escolhe QUAL roteiro e com QUE duração; a execução continua
 * sendo código, exata e medida.
 *
 * Todo passo usa os mesmos métodos que a mão do usuário usaria (fader, EQ,
 * filtro, eco, loop, crossfader). Nada de atalho: se o piloto faz, você faz.
 */

/**
 * O que cada técnica é, quando serve, e o roteiro.
 * `tempos` é a duração padrão; o escolhedor pode pedir outra.
 *
 * Passos: { em, faz }            ação num tempo exato
 * Rampas: { de, ate, alvo, v0, v1 }  valor que desliza entre dois tempos
 * Alvos de rampa: 'xf' | 'fader:X' | 'filtro:X' | 'eq:X:banda' | 'eco:X'
 */
export const TECNICAS = {
  graves: {
    nome: 'troca de graves',
    quando: 'músicas parecidas, tom compatível — a transição clássica',
    tempos: 32,
    roteiro: ({ sai, entra, xfSai, xfEntra }) => ({
      passos: [
        { em: 0,  faz: (m) => m.kill(entra, 'grave', true) },
        { em: 16, faz: (m) => { m.kill(sai, 'grave', true); m.kill(entra, 'grave', false); } },
        { em: 30, faz: (m) => m.parar(sai) },
      ],
      rampas: [
        { de: 0,  ate: 16, alvo: 'xf', v0: xfSai, v1: 0.5 },
        { de: 16, ate: 28, alvo: 'xf', v0: 0.5,   v1: xfEntra },
      ],
    }),
  },

  filtro: {
    nome: 'varredura de filtro',
    quando: 'mudança de energia ou de gênero — o filtro esconde a costura',
    tempos: 32,
    roteiro: ({ sai, entra, xfSai, xfEntra }) => ({
      passos: [
        // quem entra começa abafado (passa-baixa) e sem grave
        { em: 0,  faz: (m) => { m.kill(entra, 'grave', true); m.filtro(entra, -0.75); } },
        { em: 16, faz: (m) => { m.kill(sai, 'grave', true); m.kill(entra, 'grave', false); } },
        { em: 30, faz: (m) => { m.parar(sai); m.filtro(sai, 0); m.filtro(entra, 0); } },
      ],
      rampas: [
        { de: 0,  ate: 16, alvo: 'xf', v0: xfSai, v1: 0.5 },
        { de: 0,  ate: 16, alvo: `filtro:${entra}`, v0: -0.75, v1: 0 },   // abre
        { de: 8,  ate: 26, alvo: `filtro:${sai}`,   v0: 0,     v1: 0.8 },  // afina e some
        { de: 20, ate: 28, alvo: 'xf', v0: 0.5,   v1: xfEntra },
      ],
    }),
  },

  eco: {
    nome: 'echo out',
    quando: 'tons que brigam, ou saída rápida — quase sem sobreposição',
    tempos: 16,
    roteiro: ({ sai, entra, xfEntra }) => ({
      passos: [
        { em: 0,  faz: (m) => m.ecoDivisao(sai, 0.5) },
        // no tempo 8: fecha o fader de quem sai (o eco é pós-fader e segue
        // soando), e a outra entra inteira, de uma vez, no 1 do compasso
        { em: 8,  faz: (m) => { m.fader(sai, 0); m.xf(xfEntra); m.kill(entra, 'grave', false); } },
        { em: 14, faz: (m) => { m.eco(sai, 0); m.parar(sai); m.fader(sai, 1); } },
      ],
      rampas: [
        { de: 0, ate: 8, alvo: `eco:${sai}`, v0: 0, v1: 0.75 },
      ],
    }),
  },

  loop: {
    nome: 'loop que fecha',
    quando: 'quando a música que sai está acabando ou tem voz — o loop segura e cria tensão',
    tempos: 24,
    roteiro: ({ sai, entra, xfSai, xfEntra }) => ({
      passos: [
        { em: 0,  faz: (m) => { m.loop(sai, 8); m.kill(entra, 'grave', true); } },
        { em: 16, faz: (m) => m.loop(sai, 4) },
        { em: 20, faz: (m) => m.loop(sai, 2) },
        { em: 22, faz: (m) => m.loop(sai, 1) },
        // o corte: cai no 1, grave troca de lado, e o loop morre junto
        { em: 24, faz: (m) => {
          m.xf(xfEntra); m.kill(entra, 'grave', false); m.kill(sai, 'grave', true);
          m.semLoop(sai); m.parar(sai);
        } },
      ],
      rampas: [
        { de: 0, ate: 16, alvo: 'xf', v0: xfSai, v1: 0.5 },
        { de: 16, ate: 24, alvo: `filtro:${sai}`, v0: 0, v1: 0.5 },
      ],
      depois: (m) => m.filtro(sai, 0),
    }),
  },

  corte: {
    nome: 'corte seco',
    quando: 'pular de gênero ou de energia sem pedir licença — tensão e bate no 1',
    tempos: 8,
    roteiro: ({ sai, entra, xfEntra }) => ({
      passos: [
        { em: 8, faz: (m) => {
          m.xf(xfEntra); m.kill(entra, 'grave', false);
          m.parar(sai); m.filtro(sai, 0);
        } },
      ],
      rampas: [
        { de: 0, ate: 8, alvo: `filtro:${sai}`, v0: 0, v1: 0.6 },   // afina, sobe a tensão
      ],
    }),
  },

  blend: {
    nome: 'mistura longa de EQ',
    quando: 'mesmo tom e mesmo andamento — dá pra deixar as duas conversarem',
    tempos: 64,
    roteiro: ({ sai, entra, xfSai, xfEntra }) => ({
      passos: [
        { em: 0,  faz: (m) => { m.kill(entra, 'grave', true); m.eq(entra, 'medio', 0.2); m.eq(entra, 'agudo', 0.3); } },
        { em: 32, faz: (m) => { m.kill(sai, 'grave', true); m.kill(entra, 'grave', false); } },
        { em: 62, faz: (m) => { m.parar(sai); for (const d of [sai, entra]) for (const b of ['medio', 'agudo']) m.eq(d, b, 0.5); } },
      ],
      rampas: [
        { de: 0,  ate: 16, alvo: 'xf', v0: xfSai, v1: 0.5 },
        { de: 16, ate: 32, alvo: `eq:${entra}:agudo`, v0: 0.3, v1: 0.5 },
        { de: 16, ate: 32, alvo: `eq:${sai}:agudo`,   v0: 0.5, v1: 0.3 },
        { de: 32, ate: 48, alvo: `eq:${entra}:medio`, v0: 0.2, v1: 0.5 },
        { de: 32, ate: 48, alvo: `eq:${sai}:medio`,   v0: 0.5, v1: 0.2 },
        { de: 48, ate: 60, alvo: 'xf', v0: 0.5, v1: xfEntra },
      ],
    }),
  },
};

/**
 * ESTILOS — o jeito de tocar de cada escola de DJ.
 *
 * Um estilo não é uma técnica nova: é QUAIS técnicas ele prefere, com que peso,
 * com que duração, e como trata o andamento. As escolas são descritas pelo que
 * elas fazem na cabine e não por nome de pessoa — atribuir técnica específica
 * a um DJ real seria inventar como ele toca; a escola dá pra descrever com
 * precisão.
 *
 * `pesos`  chance relativa de cada técnica (as regras de ofício vêm antes: tom
 *          que briga continua forçando eco ou corte em qualquer estilo)
 * `escala` multiplica a duração padrão das técnicas (0.5 = metade do tempo)
 * `caminha` se o BPM volta pro natural da faixa depois da transição
 */
export const ESTILOS = {
  hipnotico: {
    nome: 'hipnótico',
    escola: 'techno de Berlim e Detroit',
    como: 'misturas longas de EQ, quase nunca corta, deixa as duas faixas conversarem por minutos',
    pesos: { blend: 5, graves: 3, filtro: 1, loop: 0.5, eco: 0.3, corte: 0 },
    escala: 1.5, caminha: false,
  },
  pista: {
    nome: 'pista house',
    escola: 'house de Chicago e Nova York',
    como: 'troca de graves na frase, filtro pra subir a energia, um loop de vez em quando',
    pesos: { graves: 4, filtro: 3, loop: 1.5, blend: 1.5, eco: 0.5, corte: 0.3 },
    escala: 1, caminha: true,
  },
  disco: {
    nome: 'disco edit',
    escola: 'disco e nu-disco',
    como: 'filtro quente abrindo devagar, loops de groove, entradas longas e macias',
    pesos: { filtro: 4, loop: 2.5, blend: 2, graves: 2, eco: 0.5, corte: 0.2 },
    escala: 1.25, caminha: true,
  },
  turntablista: {
    nome: 'turntablista',
    escola: 'hip-hop de toca-discos',
    como: 'cortes secos, echo out, loops curtos — troca rápido e no tempo certo',
    pesos: { corte: 4, eco: 3, loop: 2.5, graves: 1, filtro: 0.5, blend: 0 },
    escala: 0.5, caminha: false,
  },
  baile: {
    nome: 'baile',
    escola: 'funk brasileiro e open format',
    como: 'emenda rápida, corte no drop, pula de gênero sem pedir licença',
    pesos: { corte: 3.5, eco: 2.5, loop: 2, filtro: 1.5, graves: 1, blend: 0 },
    escala: 0.6, caminha: false,
  },
  festival: {
    nome: 'festival',
    escola: 'palco grande de EDM',
    como: 'loop que fecha criando tensão, filtro subindo, e explode no drop',
    pesos: { loop: 4, filtro: 3, corte: 2.5, graves: 1, eco: 1, blend: 0 },
    escala: 0.8, caminha: true,
  },
};

/** Escolha ponderada: sorteia uma técnica pelos pesos do estilo. */
function sortear(pesos, evitar = null) {
  const lista = Object.entries(pesos).filter(([k, p]) => p > 0 && k !== evitar);
  const soma = lista.reduce((s, [, p]) => s + p, 0);
  let r = Math.random() * soma;
  for (const [k, p] of lista) { r -= p; if (r <= 0) return k; }
  return lista[0]?.[0] || 'graves';
}

/**
 * Escolhedor sem IA — o reserva, e o ponto exato onde o Jev entra.
 *
 * Regras de ofício, não de gosto:
 *
 * - TOM QUE BRIGA não pode se sobrepor por muito tempo. Era o pior defeito do
 *   piloto antigo: 8 s de duas tonalidades incompatíveis tocando juntas. Aqui
 *   isso vira eco ou corte, que sobrepõem quase nada.
 * - MESMO TOM e MESMO ANDAMENTO pedem mistura longa: é quando dá.
 * - SALTO DE ANDAMENTO ou de gênero pede filtro, que disfarça a costura.
 * - No resto, varia — duas trocas de graves seguidas soam como um script.
 */
export function escolherTecnica({ saiFaixa, entraFaixa, anterior = null, estilo = 'pista' }) {
  const est = ESTILOS[estilo] || ESTILOS.pista;
  const harmonia = entraFaixa?.harmonicamenteOk !== false && (entraFaixa?.nivel ?? 0) < 2;
  const bpmS = saiFaixa?.bpm, bpmE = entraFaixa?.bpm;
  const saltoBpm = bpmS && bpmE ? Math.abs(bpmE / bpmS - 1) : 0;
  const mudaGenero = saiFaixa?.pilha && entraFaixa?.pilha && saiFaixa.pilha !== entraFaixa.pilha;

  // regra de ofício vale em qualquer estilo: tom que briga não se sobrepõe
  if (!harmonia) return est.pesos.corte > est.pesos.eco || saltoBpm > 0.03 ? 'corte' : 'eco';

  // nas outras situações, o estilo decide, mas a situação empurra os pesos
  const pesos = { ...est.pesos };
  if (saiFaixa?.camelot === entraFaixa?.camelot && saltoBpm < 0.01 && !mudaGenero) pesos.blend *= 2.5;
  if (saltoBpm > 0.03 || mudaGenero) { pesos.filtro *= 2; pesos.corte *= 1.5; pesos.blend *= 0.2; }
  // repetir a mesma técnica seguida soa como script
  return sortear(pesos, anterior);
}

/**
 * Executa um roteiro.
 *
 * Converte tempos em milissegundos pelo BPM EFETIVO de quem entra (já
 * sincronizado), e atualiza as rampas a ~40 Hz — rápido o bastante pra
 * filtro e crossfader soarem contínuos, devagar o bastante pra não disputar a
 * thread com o áudio.
 *
 * @param {object} m   ações do mixer/decks (ver `acoes()` no piloto)
 * @param {function} dorme  espera interrompível; devolve false se o usuário assumiu
 * @returns {Promise<boolean>} false se foi interrompido
 */
export async function executar(nomeTecnica, { m, dorme, sai, entra, bpm, tempos = null, aoPasso = () => {} }) {
  const tec = TECNICAS[nomeTecnica] || TECNICAS.graves;
  const total = tempos || tec.tempos;
  const escala = total / tec.tempos;   // o escolhedor pode pedir versão mais curta ou longa
  const msPorTempo = 60000 / (bpm || 124);
  const xfSai = sai === 'A' ? 0 : 1, xfEntra = 1 - xfSai;
  const r = tec.roteiro({ sai, entra, xfSai, xfEntra });

  const passos = r.passos.map((p) => ({ ...p, em: p.em * escala })).sort((a, b) => a.em - b.em);
  const rampas = r.rampas.map((p) => ({ ...p, de: p.de * escala, ate: p.ate * escala }));
  const fim = total;

  const t0 = performance.now();
  let proximo = 0;
  aoPasso({ tecnica: tec.nome, tempo: 0, de: fim });

  while (true) {
    const tempo = (performance.now() - t0) / msPorTempo;

    // passos cujo tempo chegou
    while (proximo < passos.length && passos[proximo].em <= tempo) {
      try { passos[proximo].faz(m); } catch { /* um passo ruim não derruba a transição */ }
      proximo++;
    }
    // rampas em curso
    for (const rp of rampas) {
      if (tempo < rp.de || tempo > rp.ate + 0.25) continue;
      const k = Math.max(0, Math.min(1, (tempo - rp.de) / Math.max(0.001, rp.ate - rp.de)));
      m.rampa(rp.alvo, rp.v0 + (rp.v1 - rp.v0) * k);
    }

    if (tempo >= fim && proximo >= passos.length) break;
    aoPasso({ tecnica: tec.nome, tempo: Math.floor(tempo), de: fim });
    if (!await dorme(25)) return false;
  }
  try { r.depois?.(m); } catch {}
  return true;
}

/**
 * Depois da transição, o andamento CAMINHA de volta pro natural da música que
 * entrou, em vez de ficar preso no andamento da anterior pra sempre.
 *
 * Era o "BPM só ajusta de um modo ruim": o SYNC puxava a faixa nova pro
 * andamento da velha num salto, e ela ficava assim até o fim — um set de 1 h
 * terminava no andamento da primeira faixa. Agora, com a transição feita e a
 * faixa velha fora, o pitch volta ao zero em 32 tempos, devagar demais pro
 * ouvido perceber o degrau.
 *
 * Só volta se o natural estiver perto (até 6%): além disso, voltar mudaria o
 * clima do set, e aí é decisão musical, não correção.
 */
export async function caminharBpm(deck, { dorme, tempos = 32 }) {
  const alvo = 0;
  const inicio = deck.pitch || 0;
  if (Math.abs(inicio - alvo) < 0.002 || Math.abs(inicio) > 0.06) return true;
  const bpm = deck.bpmEfetivo || 124;
  const passos = 32;
  const msPasso = (tempos * 60000 / bpm) / passos;
  for (let i = 1; i <= passos; i++) {
    deck.setPitch(inicio + (alvo - inicio) * (i / passos));
    if (!await dorme(msPasso)) return false;
  }
  return true;
}
