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
      fala: 'Toque em qualquer lugar da tela para <b>ligar o áudio</b>.',
      porque: 'O navegador só libera som depois que você interage com a página.',
      apontar: [] } },

  { id: 'carregar', grav: 3, facil: 0, quando: (e) => e.audioOk && !e.A?.temFaixa && !e.B?.temFaixa && {
      fala: 'Escolha uma música na lista à direita e mande pro deck <b>A</b>.',
      porque: 'O deck A é o tocador principal. O B recebe a próxima.',
      apontar: [{ id: 'lista', rotulo: 'escolha aqui' }] } },

  { id: 'play', grav: 3, facil: 0, quando: (e) => {
      if (!e.audioOk || e.A?.tocando || e.B?.tocando) return null;
      const d = e.A?.temFaixa ? 'A' : e.B?.temFaixa ? 'B' : null;
      return d && { fala: `Toque em <b>PLAY</b> no deck ${d}.`,
        porque: 'Nada acontece até você dar play.',
        apontar: [{ id: `play-${d}`, rotulo: 'PLAY — começa a tocar' }] };
    } },

  // ── o som está estourando: antes de qualquer coisa musical ──
  { id: 'limitador', grav: 3, facil: 0, quando: (e) => e.reducao > 5 && {
      fala: 'O som está <b>estourando</b>. Baixe o volume geral.',
      porque: `O limitador está segurando ${e.reducao.toFixed(0)} dB pra não distorcer.`,
      apontar: [{ id: 'master', rotulo: 'baixe o volume geral' }] } },

  // ── fim de faixa chegando ──
  { id: 'fim', grav: 3, facil: 1, quando: (e) => {
      for (const d of ['A', 'B']) {
        const k = e[d];
        if (!k?.tocando || !k.restante || k.restante > 25) continue;
        const outro = d === 'A' ? 'B' : 'A';
        return { fala: `O deck ${d} acaba em <b>${Math.round(k.restante)}s</b> — comece a transição agora.`,
          porque: 'Se a faixa acabar sem a outra entrar, o set cai no silêncio.',
          apontar: e[outro]?.temFaixa ? [{ id: `play-${outro}`, rotulo: 'traga o ' + outro }]
                                     : [{ id: 'lista', rotulo: 'escolha a próxima' }] };
      }
      return null;
    } },

  // ── escolher a próxima ──
  { id: 'proxima', grav: 2, facil: 1, quando: (e) => {
      const toca = e.A?.tocando ? 'A' : e.B?.tocando ? 'B' : null;
      if (!toca) return null;
      const outro = toca === 'A' ? 'B' : 'A';
      return !e[outro]?.temFaixa && {
        fala: `Mande a próxima música pro deck <b>${outro}</b>. As <b>verdes</b> combinam.`,
        porque: 'Verde = tom compatível e andamento parecido. Encaixam sem esforço.',
        apontar: [{ id: 'lista', rotulo: 'as verdes combinam' }] };
    } },

  // ── casar o andamento ──
  { id: 'sync', grav: 3, facil: 0, quando: (e) => {
      if (!e.A?.temFaixa || !e.B?.temFaixa) return null;
      const toca = e.A?.tocando ? 'A' : e.B?.tocando ? 'B' : null;
      if (!toca) return null;
      const outro = toca === 'A' ? 'B' : 'A';
      const a = e[toca]?.bpmEfetivo, b = e[outro]?.bpmEfetivo;
      return a && b && Math.abs(a - b) > TOL_BPM && {
        fala: `Toque em <b>SYNC</b> no deck ${outro} — ele casa o andamento sozinho.`,
        porque: `Uma está em ${a.toFixed(1)} e a outra em ${b.toFixed(1)} BPM. Assim as batidas brigam.`,
        apontar: [{ id: `sync-${outro}`, rotulo: 'SYNC — casa o andamento' }] };
    } },

  // ── dar play no que vai entrar ──
  { id: 'play-outro', grav: 2, facil: 0, quando: (e) => {
      const toca = e.A?.tocando ? 'A' : e.B?.tocando ? 'B' : null;
      if (!toca) return null;
      const outro = toca === 'A' ? 'B' : 'A';
      return e[outro]?.temFaixa && !e[outro]?.tocando && {
        fala: `Dê <b>PLAY</b> no deck ${outro}. Ninguém ouve ele ainda.`,
        porque: 'Com o crossfader do outro lado você pode errar à vontade — é assim que se ensaia a entrada.',
        apontar: [{ id: `play-${outro}`, rotulo: 'PLAY do deck ' + outro }] };
    } },

  // ── cortar o grave de quem entra, ANTES de abrir o fader ──
  { id: 'corta-grave', grav: 3, facil: 0, quando: (e) => {
      if (!e.A?.tocando || !e.B?.tocando) return null;
      const toca = e.crossfader < 0.5 ? 'A' : 'B';
      const entra = toca === 'A' ? 'B' : 'A';
      return (e.eq?.[entra]?.grave ?? 0.5) > 0.08 && {
        fala: `<b>Corte o grave</b> do deck ${entra}: o botão <b>×</b> da linha GRAVE.`,
        porque: 'Dois graves juntos viram lama. Corta um e devolve só quando o outro sair.',
        apontar: [{ id: `kill-${entra}-grave`, rotulo: `corta o GRAVE do ${entra}` }] };
    } },

  // ── encaixar a fase: agora com botão exato, não só jog ──
  { id: 'fase', facil: 0,
    grav: (e) => (e.ambosAudiveis ? 3 : 2),
    quando: (e) => {
      if (!e.A?.tocando || !e.B?.tocando || !e.fase) return null;
      if (Math.abs(e.fase.emTempos) <= TOL_FASE) return null;
      const ms = Math.abs(e.fase.emMs);
      const lado = e.fase.emMs > 0 ? 'adiantado' : 'atrasado';
      return { fala: `As batidas estão <b>${ms.toFixed(0)} ms</b> fora. Toque em <b>ENCAIXAR</b>.`,
        porque: `O deck B está ${lado}. O botão desliza a música até cair em cima. ` +
                'No jog, o anel de fora é ajuste fino; o centro é scratch, e aí é fácil errar.',
        apontar: [{ id: 'b-encaixar', rotulo: 'ENCAIXAR — alinha sozinho' },
                  { id: 'fase', rotulo: 'fica verde quando encaixa' }] };
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
          fala: `O <b>grave do deck ${d}</b> está cortado e ele é o único tocando — devolva.`,
          porque: 'Você cortou pra fazer a troca e não devolveu. A música fica sem fundo, ' +
                  'fina, como se tocasse num rádio pequeno.',
          apontar: [{ id: `kill-${d}-grave`, rotulo: `devolve o GRAVE do ${d}` }],
        };
      }
      return null;
    } },

  // ── dois graves abertos ao mesmo tempo ──
  { id: 'graves-juntos', grav: 3, facil: 0, quando: (e) =>
      e.ambosAudiveis && (e.eq?.A?.grave ?? 0.5) > 0.3 && (e.eq?.B?.grave ?? 0.5) > 0.3 && {
        fala: 'Os <b>dois graves</b> estão abertos juntos — é isso que embola o som.',
        porque: 'As duas linhas de baixo somam e o resultado fica sujo e alto demais.',
        apontar: [{ id: 'kill-B-grave', rotulo: 'corte um dos dois' }] } },

  // ── volume desigual entre os decks ──
  { id: 'volume', grav: 2, facil: 0, quando: (e) => {
      if (!e.ambosAudiveis || !(e.nivelA > 0.003) || !(e.nivelB > 0.003)) return null;
      const dif = 20 * Math.log10(e.nivelA / e.nivelB);
      if (Math.abs(dif) <= 6) return null;
      const baixo = dif > 0 ? 'B' : 'A', alto = dif > 0 ? 'A' : 'B';
      return { fala: `O deck ${alto} está <b>${Math.abs(dif).toFixed(0)} dB</b> mais alto. Suba o ${baixo}.`,
        porque: 'Se os volumes não batem, a troca dá um degrau que todo mundo escuta.',
        apontar: [{ id: `vol-${baixo}`, rotulo: `suba o volume do ${baixo}` }] };
    } },

  // ── trazer com o crossfader: mexe no som, então é risco ──
  { id: 'crossfader', grav: 1, facil: 2, risco: 1, quando: (e) => {
      if (!e.A?.tocando || !e.B?.tocando) return null;
      if (e.fase && Math.abs(e.fase.emTempos) > TOL_FASE) return null;  // encaixa antes de abrir
      const entra = e.crossfader < 0.5 ? 'B' : 'A';
      if ((e.eq?.[entra]?.grave ?? 0.5) > 0.08) return null;            // grave cortado antes
      const noMeio = Math.abs(e.crossfader - 0.5) < 0.12;
      return !noMeio && {
        fala: `Traga o <b>crossfader</b> ${entra === 'B' ? 'pra direita' : 'pra esquerda'}, devagar.`,
        porque: 'Os dois vão soar juntos. Com o grave de um cortado, não vira lama.',
        apontar: [{ id: 'xf', rotulo: 'CROSSFADER — devagar' }] };
    } },

  // ── a troca de graves: o momento da transição ──
  { id: 'troca', grav: 1, facil: 1, risco: 1, quando: (e) => {
      if (!e.ambosAudiveis || !e.fase || Math.abs(e.fase.emTempos) > TOL_FASE) return null;
      if (Math.abs(e.crossfader - 0.5) >= 0.12) return null;
      const sai = e.crossfader <= 0.5 ? 'A' : 'B';
      const entra = sai === 'A' ? 'B' : 'A';
      return (e.eq?.[entra]?.grave ?? 0.5) < 0.08 && {
        fala: `Agora a troca: <b>corte o grave do ${sai}</b> e <b>devolva o do ${entra}</b>.`,
        porque: 'Este é o instante da transição. Depois leve o crossfader até o fim e pare o deck que saiu.',
        apontar: [{ id: `kill-${sai}-grave`, rotulo: `corta o grave do ${sai}` },
                  { id: `kill-${entra}-grave`, rotulo: `devolve o grave do ${entra}` }] };
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
          fala: entra
            ? `Em <b>${m.tempos} tempos</b> o deck ${d} <b>abre</b> — é ali que a próxima entra.`
            : `Em <b>${m.tempos} tempos</b> o deck ${d} <b>quebra</b> — é ali que ele sai limpo.`,
          porque: entra
            ? 'A música é feita em blocos de 16 tempos. Entrar quando o bloco abre soa como se as duas fossem uma só.'
            : 'Sair na quebra é sair sem deixar buraco — o ouvido nem percebe que faltou alguém.',
          apontar: [{ id: entra ? `play-${outro}` : 'xf',
                      rotulo: entra ? `prepare o ${outro}` : 'leve o crossfader aqui' }],
        };
      }
      return null;
    } },

  // ── falhas de áudio: informação, não ajuste ──
  { id: 'glitch', grav: 1, facil: 0, quando: (e) => e.glitches > 0 && {
      fala: `Houve <b>${e.glitches} falha(s)</b> de áudio.`,
      porque: 'Se repetir, feche abas pesadas — o navegador está sem folga de CPU.',
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
    fala: 'Está tudo no lugar. Ouça e sinta a música.',
    porque: 'Quando não há nada pra corrigir, o trabalho é escutar.' };
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
