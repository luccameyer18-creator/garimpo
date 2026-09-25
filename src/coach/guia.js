/**
 * O professor — versão determinística, em LISTA ordenada.
 *
 * A primeira versão devolvia um passo só, o "próximo". Quem está aprendendo
 * reclamou do que isso esconde: quando três coisas estão erradas ao mesmo
 * tempo, ver uma só não diz o que é urgente nem o que pode esperar, e o
 * controle aceso não tinha como dizer a qual frase ele pertencia.
 *
 * Então o contrato virou este:
 *
 *   plano(estado) -> [ { id, grav, cor, fala, porque, apontar } ]   // no máx. 3
 *
 * Ordem: mais grave primeiro e, com a mesma gravidade, o mais fácil de mexer
 * antes — porque o que é fácil sai do caminho rápido e limpa a lista. Ajuste
 * que pode estragar o som em andamento (mexer no crossfader, devolver grave)
 * só aparece quando nada mais grave está pendente; é o campo `risco`.
 *
 * Cada item carrega `cor`, e a UI acende os controles de `apontar` NA MESMA COR
 * e com O MESMO NÚMERO do item na lista. É isso que liga a frase ao botão pra
 * quem nunca viu uma controladora.
 *
 * Nada de LLM aqui: isto roda a 60 Hz e precisa estar sempre certo. A camada de
 * IA, quando entrar, preenche `porque` com linguagem melhor e responde
 * perguntas — mas quem ordena a lista continua sendo isto.
 */

import { t } from '../ui/i18n.js';

const TOL_FASE = 0.02;    // erro de fase considerado "encaixado" (em tempos)

/**
 * BPM considerado casado. Era 0.4, e medi que e frouxo demais: 0.4 BPM em 130
 * sao 0.3%, que viram 90 ms de deriva numa transicao de 30 s — audivel como as
 * batidas escorregando justo enquanto as duas tocam juntas. E o SYNC e um
 * botao so, entao nao ha razao pra tolerar diferenca nenhuma.
 */
const TOL_BPM = 0.05;

/** Gravidade → cor. Três níveis, porque mais que três ninguém distingue no susto. */
const COR = { 3: 'urgente', 2: 'agora', 1: 'depois' };

/**
 * Todas as regras, avaliadas de uma vez. Cada uma devolve null (não se aplica)
 * ou o item do plano. `grav` 3 = conserta agora, 2 = é o caminho, 1 = prepare.
 * `facil` 0 = um botão, 2 = precisa de mão. `risco` 1 = pode se ouvir se errar.
 */
const REGRAS = [
  // ── o básico: sem isto nada existe ──
  { id: 'audio', grav: 3, facil: 0, quando: (e) => !e.audioOk && {
      fala: t('p.audio'), porque: t('p.audio.por'), apontar: [] } },

  { id: 'carregar', grav: 3, facil: 0, quando: (e) => e.audioOk && !e.A?.temFaixa && !e.B?.temFaixa && {
      fala: t('p.carregar'), porque: t('p.carregar.por'),
      apontar: [{ id: 'lista', rotulo: t('p.carregar.rot') }] } },

  { id: 'play', grav: 3, facil: 0, quando: (e) => {
      if (!e.audioOk || e.A?.tocando || e.B?.tocando) return null;
      const d = e.A?.temFaixa ? 'A' : e.B?.temFaixa ? 'B' : null;
      return d && { fala: t('p.play', { d }), porque: t('p.play.por'),
        apontar: [{ id: `play-${d}`, rotulo: t('p.play.rot') }] };
    } },

  // ── o som está estourando: antes de qualquer coisa musical ──
  { id: 'limitador', grav: 3, facil: 0, quando: (e) => e.reducao > 5 && {
      fala: t('p.limitador'), porque: t('p.limitador.por', { db: e.reducao.toFixed(0) }),
      apontar: [{ id: 'master', rotulo: t('p.limitador.rot') }] } },

  // ── fim de faixa chegando ──
  { id: 'fim', grav: 3, facil: 1, quando: (e) => {
      for (const d of ['A', 'B']) {
        const k = e[d];
        if (!k?.tocando || !k.restante || k.restante > 25) continue;
        const outro = d === 'A' ? 'B' : 'A';
        return { fala: t('p.fim', { d, s: Math.round(k.restante) }), porque: t('p.fim.por'),
          apontar: e[outro]?.temFaixa ? [{ id: `play-${outro}`, rotulo: t('p.fim.rot', { d: outro }) }]
                                     : [{ id: 'lista', rotulo: t('p.fim.rot2') }] };
      }
      return null;
    } },

  // ── escolher a próxima ──
  { id: 'proxima', grav: 2, facil: 1, quando: (e) => {
      const toca = e.A?.tocando ? 'A' : e.B?.tocando ? 'B' : null;
      if (!toca) return null;
      const outro = toca === 'A' ? 'B' : 'A';
      return !e[outro]?.temFaixa && {
        fala: t('p.proxima', { d: outro }), porque: t('p.proxima.por'),
        apontar: [{ id: 'lista', rotulo: t('p.proxima.rot') }] };
    } },

  // ── casar o andamento ──
  { id: 'sync', grav: 3, facil: 0, quando: (e) => {
      if (!e.A?.temFaixa || !e.B?.temFaixa) return null;
      const toca = e.A?.tocando ? 'A' : e.B?.tocando ? 'B' : null;
      if (!toca) return null;
      const outro = toca === 'A' ? 'B' : 'A';
      const a = e[toca]?.bpmEfetivo, b = e[outro]?.bpmEfetivo;
      return a && b && Math.abs(a - b) > TOL_BPM && {
        fala: t('p.sync', { d: outro }),
        porque: t('p.sync.por', { a: a.toFixed(1), b: b.toFixed(1) }),
        apontar: [{ id: `sync-${outro}`, rotulo: t('p.sync.rot') }] };
    } },

  // ── dar play no que vai entrar ──
  { id: 'play-outro', grav: 2, facil: 0, quando: (e) => {
      const toca = e.A?.tocando ? 'A' : e.B?.tocando ? 'B' : null;
      if (!toca) return null;
      const outro = toca === 'A' ? 'B' : 'A';
      return e[outro]?.temFaixa && !e[outro]?.tocando && {
        fala: t('p.playOutro', { d: outro }), porque: t('p.playOutro.por'),
        apontar: [{ id: `play-${outro}`, rotulo: t('p.playOutro.rot', { d: outro }) }] };
    } },

  // ── cortar o grave de quem entra, ANTES de abrir o fader ──
  { id: 'corta-grave', grav: 3, facil: 0, quando: (e) => {
      if (!e.A?.tocando || !e.B?.tocando) return null;
      const toca = e.crossfader < 0.5 ? 'A' : 'B';
      const entra = toca === 'A' ? 'B' : 'A';
      return (e.eq?.[entra]?.grave ?? 0.5) > 0.08 && {
        fala: t('p.cortaGrave', { d: entra }), porque: t('p.cortaGrave.por'),
        apontar: [{ id: `kill-${entra}-grave`, rotulo: t('p.cortaGrave.rot', { d: entra }) }] };
    } },

  // ── encaixar a fase: agora com botão exato, não só jog ──
  { id: 'fase', facil: 0,
    grav: (e) => (e.ambosAudiveis ? 3 : 2),
    quando: (e) => {
      if (!e.A?.tocando || !e.B?.tocando || !e.fase) return null;
      if (Math.abs(e.fase.emTempos) <= TOL_FASE) return null;
      const ms = Math.abs(e.fase.emMs);
      const lado = t(e.fase.emMs > 0 ? 'p.fase.adiantado' : 'p.fase.atrasado');
      return { fala: t('p.fase', { ms: ms.toFixed(0) }), porque: t('p.fase.por', { lado }),
        apontar: [{ id: 'b-encaixar', rotulo: t('p.fase.rot') },
                  { id: 'fase', rotulo: t('p.fase.rot2') }] };
    } },

  /**
   * Grave cortado e ninguem pra devolver.
   *
   * Faltava, e a falta se ouviu: passei um set inteiro com o grave cortado
   * depois da troca e o professor nao disse nada. Duas causas, as duas
   * corrigidas — `EQ3.get` ignorava o botao de kill (o professor era cego pra
   * ele), e nao existia regra nenhuma pra este caso.
   *
   * A regra so dispara quando o deck cortado e o UNICO no ar: com os dois
   * tocando, grave cortado num deles e a tecnica certa, nao um erro. Sozinho, e
   * so musica sem fundo.
   *
   * Gravidade 3 porque nao ha nada mais audivel que isso, e `facil` 0 porque a
   * correcao e um clique no mesmo botao que cortou.
   */
  { id: 'grave-esquecido', grav: 3, facil: 0, quando: (e) => {
      for (const d of ['A', 'B']) {
        const outro = d === 'A' ? 'B' : 'A';
        const soEle = e[d]?.tocando && !e.ambosAudiveis;
        if (!soEle) continue;
        // o crossfader tem que estar deixando ESTE deck passar
        const passa = d === 'A' ? e.crossfader < 0.88 : e.crossfader > 0.12;
        if (!passa) continue;
        if ((e.eq?.[d]?.grave ?? 0.5) > 0.08) continue;
        return {
          fala: t('p.graveEsquecido', { d }), porque: t('p.graveEsquecido.por'),
          apontar: [{ id: `kill-${d}-grave`, rotulo: t('p.graveEsquecido.rot', { d }) }],
        };
      }
      return null;
    } },

  // ── dois graves abertos ao mesmo tempo ──
  { id: 'graves-juntos', grav: 3, facil: 0, quando: (e) =>
      e.ambosAudiveis && (e.eq?.A?.grave ?? 0.5) > 0.3 && (e.eq?.B?.grave ?? 0.5) > 0.3 && {
        fala: t('p.gravesJuntos'), porque: t('p.gravesJuntos.por'),
        apontar: [{ id: 'kill-B-grave', rotulo: t('p.gravesJuntos.rot') }] } },

  // ── volume desigual entre os decks ──
  /**
   * Volume desigual — medido DEPOIS do fader, e com uma ação que existe.
   *
   * Dois erros juntos faziam o professor pedir "suba o volume" com o volume no
   * máximo: o medidor é pré-fader (então mexer no fader NUNCA mudava a
   * leitura, e o conselho nunca se resolvia), e a regra sempre mandava subir o
   * mais baixo, mesmo que ele já estivesse no topo.
   *
   * Agora compara o que sai de fato (nível × curva do fader, a mesma do
   * mixer), e se o mais baixo já está no máximo, manda BAIXAR o mais alto.
   */
  { id: 'volume', grav: 2, facil: 0, quando: (e) => {
      if (!e.ambosAudiveis || !(e.nivelA > 0.003) || !(e.nivelB > 0.003)) return null;
      const saida = (nv, f) => nv * Math.pow(Math.max(0, Math.min(1, f ?? 1)), 1.6);
      const sA = saida(e.nivelA, e.faderA), sB = saida(e.nivelB, e.faderB);
      if (!(sA > 1e-4) || !(sB > 1e-4)) return null;
      const dif = 20 * Math.log10(sA / sB);
      if (Math.abs(dif) <= 6) return null;
      const baixo = dif > 0 ? 'B' : 'A', alto = dif > 0 ? 'A' : 'B';
      const faderBaixo = baixo === 'A' ? e.faderA : e.faderB;
      const noTopo = (faderBaixo ?? 1) >= 0.97;
      return {
        fala: t(noTopo ? 'p.volume.baixe' : 'p.volume', { alto, baixo, db: Math.abs(dif).toFixed(0) }),
        porque: t('p.volume.por'),
        apontar: noTopo
          ? [{ id: `vol-${alto}`, rotulo: t('p.volume.rotBaixe', { d: alto }) }]
          : [{ id: `vol-${baixo}`, rotulo: t('p.volume.rot', { d: baixo }) }],
      };
    } },

  // ── trazer com o crossfader: mexe no som, então é risco ──
  { id: 'crossfader', grav: 1, facil: 2, risco: 1, quando: (e) => {
      if (!e.A?.tocando || !e.B?.tocando) return null;
      if (e.fase && Math.abs(e.fase.emTempos) > TOL_FASE) return null;  // encaixa antes de abrir
      const entra = e.crossfader < 0.5 ? 'B' : 'A';
      if ((e.eq?.[entra]?.grave ?? 0.5) > 0.08) return null;            // grave cortado antes
      // a que ACABOU de sair (coach/leitura.js sabe) não está entrando: ela
      // continua tocando com o grave cortado do outro lado, e a regra mandava
      // trazer o crossfader de VOLTA pra ela (visto testando a leitura)
      if (e.saiu === entra) return null;
      const noMeio = Math.abs(e.crossfader - 0.5) < 0.12;
      return !noMeio && {
        fala: t('p.crossfader', { lado: t(entra === 'B' ? 'p.crossfader.direita' : 'p.crossfader.esquerda') }),
        porque: t('p.crossfader.por'),
        apontar: [{ id: 'xf', rotulo: t('p.crossfader.rot') }] };
    } },

  // ── a troca de graves: o momento da transição ──
  { id: 'troca', grav: 1, facil: 1, risco: 1, quando: (e) => {
      if (!e.ambosAudiveis || !e.fase || Math.abs(e.fase.emTempos) > TOL_FASE) return null;
      if (Math.abs(e.crossfader - 0.5) >= 0.12) return null;
      const sai = e.crossfader <= 0.5 ? 'A' : 'B';
      const entra = sai === 'A' ? 'B' : 'A';
      return (e.eq?.[entra]?.grave ?? 0.5) < 0.08 && {
        fala: t('p.troca', { sai, entra }), porque: t('p.troca.por'),
        apontar: [{ id: `kill-${sai}-grave`, rotulo: t('p.troca.rot', { d: sai }) },
                  { id: `kill-${entra}-grave`, rotulo: t('p.troca.rot2', { d: entra }) }] };
    } },

  /**
   * Momento de virada chegando.
   *
   * Esta regra existe porque nas transições de teste eu acertava a hora
   * calculando limite de frase na mão, e quem ouviu perguntou como. A resposta
   * era invisível; agora ela fala e aparece na forma de onda (▲ verde entra,
   * ▼ rosa sai). É a regra que mais ensina do conjunto: encaixar batida é
   * técnica, escolher a HORA é música.
   */
  { id: 'momento', grav: 2, facil: 0, quando: (e) => {
      for (const d of ['A', 'B']) {
        const m = e[d]?.momento;
        if (!m || m.seg > 16 || m.tipo === 'frase') continue;
        const outro = d === 'A' ? 'B' : 'A';
        const entra = m.tipo === 'drop';
        return {
          fala: t(entra ? 'p.momento.abre' : 'p.momento.quebra', { n: m.tempos, d }),
          porque: t(entra ? 'p.momento.abre.por' : 'p.momento.quebra.por'),
          apontar: [{ id: entra ? `play-${outro}` : 'xf',
                      rotulo: t(entra ? 'p.momento.abre.rot' : 'p.momento.quebra.rot', { d: outro }) }],
        };
      }
      return null;
    } },

  /**
   * Falhas de audio — medidas em TEMPO PERDIDO, nao em contagem.
   *
   * A versao anterior avisava "houve 8 falhas de audio" e assustava. Fui medir:
   * cada falha e exatamente UM quantum, 2.7 ms, e 8 delas somam 16 ms em dois
   * minutos de musica. Isso nao se ouve. Pior, o numero era cumulativo da
   * sessao, entao depois de meia hora ele avisaria sempre.
   *
   * (Detalhe que a medicao tambem revelou: os dois decks contam SEMPRE o mesmo
   * numero, mesmo com um deles parado, porque o buraco e da thread de audio
   * inteira e nao de um deck. Entao contar por deck e somar contava duas vezes.)
   *
   * O criterio agora e o que se ouve: mais de 40 ms perdidos no ultimo minuto,
   * ou um buraco unico grande. Abaixo disso, silencio.
   */
  { id: 'glitch', grav: 2, facil: 0, quando: (e) => (e.glitchMsPorMin || 0) > 40 && {
      fala: t('p.glitch', { ms: Math.round(e.glitchMsPorMin) }), porque: t('p.glitch.por'),
      apontar: [] } },
];

/**
 * O plano: até 3 ajustes, do mais grave ao mais simples.
 *
 * @param {object} e estado completo (decks, mixer, fase, níveis)
 * @returns {Array<{id,grav,cor,fala,porque,apontar}>}
 */
export function plano(e, { max = 3 } = {}) {
  const itens = [];
  for (const r of REGRAS) {
    let v;
    try { v = r.quando(e); } catch { v = null; }
    if (!v) continue;
    const grav = typeof r.grav === 'function' ? r.grav(e) : r.grav;
    itens.push({ id: r.id, grav, facil: r.facil ?? 1, risco: r.risco ?? 0,
      cor: COR[grav] || 'depois', ...v });
  }

  // um ajuste de risco só entra se nada mais grave estiver pendente: mexer no
  // crossfader com a fase errada é exatamente como se estraga a música
  const maiorGrav = itens.reduce((m, i) => Math.max(m, i.grav), 0);
  const vivos = itens.filter((i) => !i.risco || i.grav >= maiorGrav);

  vivos.sort((a, b) => (b.grav - a.grav) || (a.facil - b.facil));
  return vivos.slice(0, max);
}

/** Compatível com a versão de um passo só: o primeiro item do plano. */
export function proximoPasso(e) {
  return plano(e, { max: 1 })[0] || {
    id: 'ok', grav: 1, cor: 'depois', apontar: [],
    fala: t('p.ok'), porque: t('p.ok.por') };
}

/**
 * O que o autoajuste pode consertar sozinho, e como.
 *
 * Separado de `plano` de propósito: o autoajuste só age no que é objetivamente
 * mensurável e inaudível de corrigir — andamento e fase. Cortar grave, abrir
 * crossfader e escolher a próxima música são decisões musicais, e essas
 * continuam suas mesmo com o autoajuste ligado.
 *
 * Devolve a lista de ações, que quem chama executa no motor.
 *
 * @param {object} e estado, igual ao de plano()
 * @param {string} deck qual deck tem o autoajuste ligado
 */
export function autoajuste(e, deck) {
  const acoes = [];
  const outro = deck === 'A' ? 'B' : 'A';
  if (!e[deck]?.tocando || !e[outro]?.tocando) return acoes;

  const meu = e[deck]?.bpmEfetivo, dele = e[outro]?.bpmEfetivo;
  if (meu && dele && Math.abs(meu - dele) > TOL_BPM) {
    acoes.push({ o: 'sync', deck, porque: `casando ${meu.toFixed(1)} com ${dele.toFixed(1)} BPM` });
    return acoes;   // sincronizar primeiro; a fase se mede depois de o BPM casar
  }

  if (e.fase && Math.abs(e.fase.emTempos) > 0.006) {
    // o sinal de erroDeFase é B-relativo; quem corrige é sempre o deck do botão
    const ms = deck === 'B' ? -e.fase.emMs : e.fase.emMs;
    acoes.push({ o: 'deslocar', deck, ms, porque: `${Math.abs(ms).toFixed(0)} ms de fase` });
  }
  return acoes;
}
