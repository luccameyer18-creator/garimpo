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
 * Passos: { em, faz, diz?, porque?, mostra? }  ação num tempo exato
 *   `diz`/`porque` são chaves de tradução da NARRAÇÃO: o que o DJ acabou de
 *   fazer e por quê. `mostra` são os controles que ele mexeu ({s} = deck que
 *   sai, {e} = deck que entra). É assim que o piloto ENSINA: a frase aparece
 *   na barra do professor e o controle acende, no instante em que acontece.
 *   Passo só com `diz` (sem `faz`) narra o começo de uma rampa.
 *   `aluno` marca o GESTO-CHAVE da técnica. No modo "tocar junto" o DJ não faz
 *   esse passo: pede pra você 8 tempos antes (`pede`, acendendo `mostra`),
 *   confere com `feito(ler)` se você fez e em que tempo, e só faz ele mesmo se
 *   você não fizer até 1 tempo depois. Os gestos são idempotentes (cortar um
 *   grave já cortado não muda nada), então rodar `faz` depois é seguro.
 * Rampas: { de, ate, alvo, v0, v1 }  valor que desliza entre dois tempos
 * Alvos de rampa: 'xf' | 'fader:X' | 'filtro:X' | 'eq:X:banda' | 'eco:X'
 */
export const TECNICAS = {
  graves: {
    nome: 'troca de graves',
    quando: 'músicas parecidas, tom compatível — a transição clássica',
    tempos: 32,
    impacto: 16,
    roteiro: ({ sai, entra, xfSai, xfEntra }) => ({
      passos: [
        { em: 0,  faz: (m) => m.kill(entra, 'grave', true),
          diz: 'n.graves.0', porque: 'n.graves.0p', mostra: ['kill-{e}-grave', 'xf'] },
        { em: 16, faz: (m) => { m.kill(sai, 'grave', true); m.kill(entra, 'grave', false); },
          diz: 'n.graves.16', porque: 'n.graves.16p', mostra: ['kill-{s}-grave', 'kill-{e}-grave'],
          aluno: { pede: 'n.aluno.graves', porque: 'n.aluno.graves.p', mostra: ['kill-{s}-grave', 'kill-{e}-grave'],
                  feito: (ler) => ler.morto(sai, 'grave') && !ler.morto(entra, 'grave') } },
        { em: 30, faz: (m) => m.parar(sai), diz: 'n.fim' },
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
    impacto: 16,
    roteiro: ({ sai, entra, xfSai, xfEntra }) => ({
      passos: [
        // quem entra começa abafado (passa-baixa) e sem grave
        { em: 0,  faz: (m) => { m.kill(entra, 'grave', true); m.filtro(entra, -0.75); },
          diz: 'n.filtro.0', porque: 'n.filtro.0p', mostra: ['fil-{e}', 'kill-{e}-grave'] },
        { em: 8, diz: 'n.filtro.8', porque: 'n.filtro.8p', mostra: ['fil-{s}'] },
        { em: 16, faz: (m) => { m.kill(sai, 'grave', true); m.kill(entra, 'grave', false); },
          diz: 'n.graves.16', porque: 'n.graves.16p', mostra: ['kill-{s}-grave', 'kill-{e}-grave'],
          aluno: { pede: 'n.aluno.graves', porque: 'n.aluno.graves.p', mostra: ['kill-{s}-grave', 'kill-{e}-grave'],
                  feito: (ler) => ler.morto(sai, 'grave') && !ler.morto(entra, 'grave') } },
        { em: 30, faz: (m) => { m.parar(sai); m.filtro(sai, 0); m.filtro(entra, 0); }, diz: 'n.fim' },
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
    impacto: 8,
    roteiro: ({ sai, entra, xfEntra }) => ({
      passos: [
        { em: 0,  faz: (m) => m.ecoDivisao(sai, 0.5),
          diz: 'n.eco.0', porque: 'n.eco.0p', mostra: ['eco-{s}'] },
        // no tempo 8: fecha o fader de quem sai (o eco é pós-fader e segue
        // soando), e a outra entra inteira, de uma vez, no 1 do compasso
        { em: 8,  faz: (m) => { m.fader(sai, 0); m.xf(xfEntra); m.kill(entra, 'grave', false); },
          diz: 'n.eco.8', porque: 'n.eco.8p', mostra: ['vol-{s}', 'xf'],
          aluno: { pede: 'n.aluno.eco', porque: 'n.aluno.eco.p', mostra: ['vol-{s}'],
                   feito: (ler) => ler.fader(sai) < 0.15 } },
        { em: 14, faz: (m) => { m.eco(sai, 0); m.parar(sai); m.fader(sai, 1); }, diz: 'n.fim' },
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
    impacto: 24,
    roteiro: ({ sai, entra, xfSai, xfEntra }) => ({
      passos: [
        { em: 0,  faz: (m) => { m.loop(sai, 8); m.kill(entra, 'grave', true); },
          diz: 'n.loop.0', porque: 'n.loop.0p', mostra: ['kill-{e}-grave', 'xf'] },
        { em: 16, faz: (m) => m.loop(sai, 4), diz: 'n.loop.16', porque: 'n.loop.16p', mostra: ['fil-{s}'] },
        { em: 20, faz: (m) => m.loop(sai, 2) },
        { em: 22, faz: (m) => m.loop(sai, 1) },
        // o corte: cai no 1, grave troca de lado, e o loop morre junto
        { em: 24, faz: (m) => {
          m.xf(xfEntra); m.kill(entra, 'grave', false); m.kill(sai, 'grave', true);
          m.semLoop(sai); m.parar(sai);
        }, diz: 'n.loop.24', porque: 'n.loop.24p', mostra: ['xf', 'kill-{e}-grave'],
          aluno: { pede: 'n.aluno.corte', porque: 'n.aluno.corte.p', mostra: ['xf'],
                   feito: (ler) => Math.abs(ler.xf() - xfEntra) < 0.15 } },
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
    impacto: 8,
    roteiro: ({ sai, entra, xfEntra }) => ({
      passos: [
        { em: 0, diz: 'n.corte.0', porque: 'n.corte.0p', mostra: ['fil-{s}'] },
        { em: 8, faz: (m) => {
          m.xf(xfEntra); m.kill(entra, 'grave', false);
          m.parar(sai); m.filtro(sai, 0);
        }, diz: 'n.corte.8', porque: 'n.corte.8p', mostra: ['xf'],
          aluno: { pede: 'n.aluno.corte', porque: 'n.aluno.corte.p', mostra: ['xf'],
                   feito: (ler) => Math.abs(ler.xf() - xfEntra) < 0.15 } },
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
    impacto: 32,
    roteiro: ({ sai, entra, xfSai, xfEntra }) => ({
      passos: [
        { em: 0,  faz: (m) => { m.kill(entra, 'grave', true); m.eq(entra, 'medio', 0.2); m.eq(entra, 'agudo', 0.3); },
          diz: 'n.blend.0', porque: 'n.blend.0p', mostra: ['kill-{e}-grave', 'eq-{e}-medio', 'eq-{e}-agudo'] },
        { em: 16, diz: 'n.blend.16', porque: 'n.blend.16p', mostra: ['eq-{e}-agudo', 'eq-{s}-agudo'] },
        { em: 32, faz: (m) => { m.kill(sai, 'grave', true); m.kill(entra, 'grave', false); },
          diz: 'n.blend.32', porque: 'n.graves.16p', mostra: ['kill-{s}-grave', 'kill-{e}-grave', 'eq-{e}-medio'],
          aluno: { pede: 'n.aluno.graves', porque: 'n.aluno.graves.p', mostra: ['kill-{s}-grave', 'kill-{e}-grave'],
                  feito: (ler) => ler.morto(sai, 'grave') && !ler.morto(entra, 'grave') } },
        { em: 62, faz: (m) => { m.parar(sai); for (const d of [sai, entra]) for (const b of ['medio', 'agudo']) m.eq(d, b, 0.5); },
          diz: 'n.fim' },
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
 * MOVIMENTOS — o que um DJ faz ENTRE as transições.
 *
 * O piloto antigo ficava parado de uma troca à outra: minutos sem encostar em
 * nada, e isso é metade do "robótico". Na cabine, o DJ vive a faixa que está
 * no ar: tira o grave um tempo antes do drop pra ele cair mais forte, sobe o
 * filtro na virada, joga um eco no fim da frase. São gestos curtos, sempre
 * em cima de um momento da música (nunca num ponto qualquer), e raros — um
 * por frase no máximo, e só quando a faixa pede.
 *
 * Mesmo formato das técnicas, com UM deck (`d`). O tempo `alvo` do roteiro é
 * o momento da música (o 1 do drop ou da quebra); o roteiro começa antes.
 */
export const MOVIMENTOS = {
  provoca: {
    nome: 'grave que some antes do drop',
    momento: 'drop', tempos: 12, alvo: 12,
    roteiro: ({ d }) => ({
      passos: [
        { em: 11, faz: (m) => m.kill(d, 'grave', true),
          diz: 'n.vida.provoca', porque: 'n.vida.provoca.p', mostra: ['kill-{d}-grave'],
          aluno: { pede: 'n.aluno.provoca', porque: 'n.vida.provoca.p', mostra: ['kill-{d}-grave'],
                   feito: (ler) => ler.morto(d, 'grave') } },
        { em: 12, faz: (m) => m.kill(d, 'grave', false) },
      ],
      rampas: [],
      depois: (m) => m.kill(d, 'grave', false),
    }),
  },
  subida: {
    nome: 'filtro subindo na virada',
    momento: 'drop', tempos: 16, alvo: 16,
    roteiro: ({ d }) => ({
      passos: [
        { em: 8, diz: 'n.vida.subida', porque: 'n.vida.subida.p', mostra: ['fil-{d}'] },
        // solta no 1: o drop cai com o som inteiro de volta
        { em: 16, faz: (m) => m.filtro(d, 0) },
      ],
      rampas: [{ de: 8, ate: 15.75, alvo: 'filtro:{d}', v0: 0, v1: 0.45, curva: 'entra' }],
      depois: (m) => m.filtro(d, 0),
    }),
  },
  ecoFrase: {
    nome: 'eco no fim da frase',
    momento: 'quebra', tempos: 16, alvo: 16,
    roteiro: ({ d }) => ({
      passos: [
        { em: 14, faz: (m) => m.ecoDivisao(d, 0.75) },
        { em: 15, faz: (m) => m.eco(d, 0.55),
          diz: 'n.vida.eco', porque: 'n.vida.eco.p', mostra: ['eco-{d}'] },
        { em: 16, faz: (m) => m.eco(d, 0) },
      ],
      rampas: [],
      depois: (m) => m.eco(d, 0),
    }),
  },
  /**
   * O FIM DO SET. A última faixa não para no meio: toca até a última frase,
   * o filtro vai afinando, o eco abre, o volume desce e o prato freia — a
   * pista ouve que acabou, em vez de ouvir o som sumir.
   */
  final: {
    nome: 'fechamento do set',
    momento: 'fim', tempos: 16, alvo: 16,
    roteiro: ({ d }) => ({
      passos: [
        { em: 0, diz: 'n.vida.final', porque: 'n.vida.final.p', mostra: ['fil-{d}'] },
        { em: 8, faz: (m) => { m.ecoDivisao(d, 0.5); },
          diz: 'n.vida.final8', porque: 'n.vida.final8.p', mostra: ['eco-{d}', 'vol-{d}'],
          aluno: { pede: 'n.aluno.final', porque: 'n.vida.final8.p', mostra: ['vol-{d}'],
                   feito: (ler) => ler.fader(d) < 0.5 } },
        { em: 15.5, faz: (m) => m.parar(d) },
      ],
      rampas: [
        { de: 0, ate: 12, alvo: 'filtro:{d}', v0: 0, v1: 0.5, curva: 'entra' },
        { de: 8, ate: 12, alvo: 'eco:{d}', v0: 0, v1: 0.7 },
        { de: 9, ate: 15.5, alvo: 'fader:{d}', v0: 1, v1: 0, curva: 'sai' },
      ],
      depois: (m) => { m.filtro(d, 0); m.eco(d, 0); m.fader(d, 1); },
    }),
  },
  respiro: {
    nome: 'agudo respirando na quebra',
    momento: 'quebra', tempos: 24, alvo: 16,
    roteiro: ({ d }) => ({
      passos: [
        { em: 16, diz: 'n.vida.respiro', porque: 'n.vida.respiro.p', mostra: ['eq-{d}-agudo'] },
      ],
      rampas: [
        { de: 16, ate: 20, alvo: 'eq:{d}:agudo', v0: 0.5, v1: 0.32 },
        { de: 20, ate: 24, alvo: 'eq:{d}:agudo', v0: 0.32, v1: 0.5 },
      ],
      depois: (m) => m.eq(d, 'agudo', 0.5),
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
 */
export const ESTILOS = {
  hipnotico: {
    nome: 'hipnótico',
    escola: 'techno de Berlim e Detroit',
    como: 'misturas longas de EQ, quase nunca corta, deixa as duas faixas conversarem por minutos',
    pesos: { blend: 5, graves: 3, filtro: 1, loop: 0.5, eco: 0.3, corte: 0 },
    escala: 1.5,
    uso: 0.72,
    vida: { respiro: 2, subida: 1, provoca: 0.5, ecoFrase: 0.3 }, chanceVida: 0.35,
  },
  pista: {
    nome: 'pista house',
    escola: 'house de Chicago e Nova York',
    como: 'troca de graves na frase, filtro pra subir a energia, um loop de vez em quando',
    pesos: { graves: 4, filtro: 3, loop: 1.5, blend: 1.5, eco: 0.5, corte: 0.3 },
    escala: 1,
    uso: 0.66,
    vida: { provoca: 3, subida: 2, ecoFrase: 1, respiro: 1 }, chanceVida: 0.5,
  },
  disco: {
    nome: 'disco edit',
    escola: 'disco e nu-disco',
    como: 'filtro quente abrindo devagar, loops de groove, entradas longas e macias',
    pesos: { filtro: 4, loop: 2.5, blend: 2, graves: 2, eco: 0.5, corte: 0.2 },
    escala: 1.25,
    uso: 0.66,
    vida: { subida: 3, respiro: 2, provoca: 1, ecoFrase: 1 }, chanceVida: 0.5,
  },
  turntablista: {
    nome: 'turntablista',
    escola: 'hip-hop de toca-discos',
    como: 'cortes secos, echo out, loops curtos — troca rápido e no tempo certo',
    pesos: { corte: 4, eco: 3, loop: 2.5, graves: 1, filtro: 0.5, blend: 0 },
    escala: 0.5,
    uso: 0.45,
    vida: { ecoFrase: 3, provoca: 2, subida: 0.5, respiro: 0 }, chanceVida: 0.6,
  },
  baile: {
    nome: 'baile',
    escola: 'funk brasileiro e open format',
    como: 'emenda rápida, corte no drop, pula de gênero sem pedir licença',
    pesos: { corte: 3.5, eco: 2.5, loop: 2, filtro: 1.5, graves: 1, blend: 0 },
    escala: 0.6,
    uso: 0.5,
    vida: { provoca: 3, ecoFrase: 2, subida: 1, respiro: 0 }, chanceVida: 0.6,
  },
  festival: {
    nome: 'festival',
    escola: 'palco grande de EDM',
    como: 'loop que fecha criando tensão, filtro subindo, e explode no drop',
    pesos: { loop: 4, filtro: 3, corte: 2.5, graves: 1, eco: 1, blend: 0 },
    escala: 0.8,
    uso: 0.58,
    vida: { subida: 3, provoca: 3, ecoFrase: 1.5, respiro: 0.5 }, chanceVida: 0.7,
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
 * Um movimento pra este momento da faixa, pelo gosto do estilo — ou nenhum.
 * `tipo` é o do momento que vem ('drop' ou 'quebra'); `anterior` evita repetir.
 */
export function escolherMovimento({ tipo, estilo = 'pista', anterior = null }) {
  const est = ESTILOS[estilo] || ESTILOS.pista;
  if (Math.random() > (est.chanceVida ?? 0.5)) return null;
  const pesos = {};
  for (const [k, p] of Object.entries(est.vida || {})) {
    if (MOVIMENTOS[k]?.momento === tipo && k !== anterior) pesos[k] = p;
  }
  if (!Object.keys(pesos).length) return null;
  return sortear(pesos);
}

/**
 * Curvas de rampa. Mão de DJ não é régua: o fader sai devagar, acelera no
 * meio e assenta no fim ('suave', smoothstep). O filtro de subida demora a
 * pegar e corre no final, como a tensão ('entra'). 'linear' fica pra quem
 * pedir.
 */
const CURVAS = {
  suave: (k) => k * k * (3 - 2 * k),
  entra: (k) => k * k,
  sai: (k) => 1 - (1 - k) * (1 - k),
  linear: (k) => k,
};

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
export async function executar(nomeTecnica, { m, dorme, sai, entra, deck = null, bpm, tempos = null,
                                              aoPasso = () => {}, aoFalar = () => {}, aluno = false,
                                              ler = null, relogio = null }) {
  // um movimento de vida (um deck só) ou uma técnica de transição (dois)
  const tec = MOVIMENTOS[nomeTecnica] || TECNICAS[nomeTecnica] || TECNICAS.graves;
  const total = tempos || tec.tempos;
  // o escolhedor pode pedir versão mais curta ou longa; movimento não escala
  const escala = MOVIMENTOS[nomeTecnica] ? 1 : total / tec.tempos;
  const msPorTempo = 60000 / (bpm || 124);
  const xfSai = sai === 'A' ? 0 : 1, xfEntra = 1 - xfSai;
  const r = tec.roteiro({ sai, entra, xfSai, xfEntra, d: deck });

  // no modo junto, o gesto-chave é seu até o 1 dele; não fez, eu faço NO 1 —
  // esperar mais um tempo pela sua mão deixava a troca atrasada na pista
  const junto = aluno && !!ler;
  const passos = r.passos.map((p) => ({ ...p, em: p.em * escala, alvo: p.em * escala }))
    .sort((a, b) => a.alvo - b.alvo);
  const vars = { s: sai, e: entra, d: deck };
  const troca = (id) => id.replace('{s}', sai).replace('{e}', entra).replace('{d}', deck);
  const pedidos = junto ? passos.filter((p) => p.aluno) : [];
  const rampas = r.rampas.map((p) => ({ ...p, alvo: troca(p.alvo), de: p.de * escala, ate: p.ate * escala }));
  const fim = total;

  /**
   * O RELÓGIO É A MÚSICA. Contar em performance.now() fazia o roteiro andar
   * pelo relógio da máquina: começava num instante qualquer, e a troca de
   * graves do "tempo 16" caía onde caísse — no meio do compasso. Com
   * `relogio` (tempos desde o começo, lidos da POSIÇÃO de uma faixa), o
   * tempo 16 é o 16 da música; um engasgo da aba não desalinha nada. Tempo
   * negativo é pré-roll: ainda não começou, mas o pedido do modo junto já
   * pode sair 8 tempos antes.
   */
  const t0 = performance.now();
  const agora = relogio || (() => (performance.now() - t0) / msPorTempo);
  let proximo = 0;
  aoPasso({ tecnica: tec.nome, tempo: 0, de: fim });

  while (true) {
    const tempo = agora();

    // modo junto: pede o gesto 8 tempos antes e confere se você fez
    for (const p of pedidos) {
      if (!p.pediu && tempo >= Math.max(0, p.em - 8)) {
        p.pediu = true;
        aoFalar({ diz: p.aluno.pede, porque: p.aluno.porque, vars, mostra: p.aluno.mostra.map(troca), vez: true });
      }
      if (p.pediu && !p.fez && tempo <= p.alvo) {
        let ok = false;
        try { ok = p.aluno.feito(ler); } catch {}
        if (ok) {
          p.fez = true;
          const erro = tempo - p.em;
          aoFalar({ diz: erro < -0.6 ? 'n.aluno.cedo' : erro > 0.6 ? 'n.aluno.tarde' : 'n.aluno.boa',
                    porque: 'n.aluno.boa.p', vars: { ...vars, d: Math.abs(erro).toFixed(1) }, mostra: [],
                    acertou: Math.abs(erro) <= 0.6 });
        }
      }
    }

    // passos cujo tempo chegou
    while (proximo < passos.length && passos[proximo].alvo <= tempo) {
      const p = passos[proximo];
      try { p.faz?.(m); } catch { /* um passo ruim não derruba a transição */ }
      if (junto && p.aluno) {
        // você fez: o elogio já saiu. Não fez: eu faço, e digo que fiz
        if (!p.fez) aoFalar({ diz: 'n.aluno.eufiz', porque: p.porque || null, vars, mostra: (p.mostra || []).map(troca) });
      } else if (p.diz) {
        aoFalar({ diz: p.diz, porque: p.porque || null, vars, mostra: (p.mostra || []).map(troca) });
      }
      proximo++;
    }
    // rampas em curso
    for (const rp of rampas) {
      if (tempo < rp.de || tempo > rp.ate + 0.25) continue;
      const k = Math.max(0, Math.min(1, (tempo - rp.de) / Math.max(0.001, rp.ate - rp.de)));
      const c = (CURVAS[rp.curva] || CURVAS.suave)(k);
      m.rampa(rp.alvo, rp.v0 + (rp.v1 - rp.v0) * c);
    }

    if (tempo >= fim && proximo >= passos.length) break;
    aoPasso({ tecnica: tec.nome, tempo: Math.max(0, Math.floor(tempo)), de: fim });
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
  // volta SEMPRE — antes só até 6% e só em 3 estilos, e o set ia acumulando
  // desvio: cada faixa nova sincronizava com a anterior já esticada
  if (Math.abs(inicio - alvo) < 0.002) return true;
  const bpm = deck.bpmEfetivo || 124;
  const passos = 32;
  const msPasso = (tempos * 60000 / bpm) / passos;
  for (let i = 1; i <= passos; i++) {
    deck.setPitch(inicio + (alvo - inicio) * CURVAS.suave(i / passos));
    if (!await dorme(msPasso)) return false;
  }
  return true;
}
