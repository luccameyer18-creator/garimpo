/**
 * O professor — versão determinística.
 *
 * Olha o estado real dos decks e do mixer e devolve UMA coisa pra fazer agora.
 * Nada de LLM aqui: isto precisa responder em microssegundos e estar sempre
 * certo. Quando a camada de IA entrar (Fase 9), ela vai preencher o campo
 * `porque` com linguagem natural e responder perguntas — mas quem decide o
 * próximo passo continua sendo isto, porque é rápido e determinístico.
 *
 * Contrato de saída, e é ele que a UI desenha:
 *   { num, fala, porque, apontar:[ids de elementos], cor }
 *
 * `apontar` é o que faz o professor conseguir mostrar em vez de só falar. A UI
 * acende esses elementos. É o mesmo mecanismo que os "controles fantasma" vão
 * usar quando o professor executar ações por conta própria.
 */

const TOL_FASE = 0.02;    // erro de fase considerado "encaixado"
const TOL_BPM = 0.4;      // BPM considerado casado

/**
 * @param {object} e estado
 * @param {object|null} e.A  { temFaixa, tocando, bpm, camelot, grid, pitch }
 * @param {object|null} e.B  idem
 * @param {number} e.crossfader
 * @param {object|null} e.fase  { emTempos, emMs }
 * @param {object} e.eq  { A:{grave,...}, B:{...} } valores 0..1
 * @param {boolean} e.audioOk
 */
export function proximoPasso(e) {
  if (!e.audioOk) {
    return { num: '1', cor: 'verde',
      fala: 'Toque em qualquer lugar da tela para <b>ligar o áudio</b>.',
      porque: 'O navegador só deixa tocar som depois que você interage com a página.',
      apontar: [] };
  }

  const A = e.A, B = e.B;
  const tocandoA = A?.tocando, tocandoB = B?.tocando;
  const algumTocando = tocandoA || tocandoB;

  // ── 1. nada carregado ──
  if (!A?.temFaixa && !B?.temFaixa) {
    return { num: '1', cor: 'verde',
      fala: 'Escolha uma música na lista à direita e toque em <b>A</b>.',
      porque: 'O deck A é o seu tocador principal. O B vai receber a próxima música.',
      apontar: [{ id: 'lista', rotulo: 'escolha aqui' }] };
  }

  // ── 2. carregado mas parado, e nada tocando ──
  if (!algumTocando) {
    const id = A?.temFaixa ? 'A' : 'B';
    return { num: '2', cor: 'verde',
      fala: `Agora toque em <b>PLAY</b> no deck ${id}.`,
      porque: 'Nada vai acontecer até você dar play. Pode subir o volume geral também.',
      apontar: [{ id: `play-${id}`, rotulo: 'PLAY — começa a tocar' }] };
  }

  const tocando = tocandoA ? 'A' : 'B';
  const outro = tocando === 'A' ? 'B' : 'A';
  const oOutro = tocando === 'A' ? B : A;

  // ── 3. tocando, mas o outro deck está vazio ──
  if (!oOutro?.temFaixa) {
    return { num: '3', cor: 'verde',
      fala: `Escolha a próxima música e mande pro deck <b>${outro}</b>. As <b>verdes</b> combinam.`,
      porque: 'Verde = mesmo tom e andamento parecido. São as que encaixam sem esforço.',
      apontar: [{ id: 'lista', rotulo: 'as verdes combinam' }] };
  }

  // ── 4. os dois têm faixa: casar o andamento ──
  const bpmT = e[tocando]?.bpmEfetivo, bpmO = oOutro?.bpmEfetivo;
  if (bpmT && bpmO && Math.abs(bpmT - bpmO) > TOL_BPM) {
    return { num: '4', cor: 'verde',
      fala: `Toque em <b>SYNC</b> no deck ${outro} — ele casa o andamento sozinho.`,
      porque: `Uma está em ${bpmT.toFixed(1)} e a outra em ${bpmO.toFixed(1)} BPM. Assim as batidas brigam.`,
      apontar: [{ id: `sync-${outro}`, rotulo: 'SYNC — casa o andamento' }] };
  }

  // ── 5. andamento casado, o outro ainda parado ──
  if (!oOutro.tocando) {
    return { num: '5', cor: 'verde',
      fala: `Andamento casado. Dê <b>PLAY</b> no deck ${outro} — pode deixar o volume dele baixo.`,
      porque: 'Com o crossfader pra um lado só, ninguém ouve o outro deck ainda. Você pode errar à vontade.',
      apontar: [{ id: `play-${outro}`, rotulo: 'PLAY do deck ' + outro }] };
  }

  // ── 6. os dois tocando: encaixar a fase ──
  if (e.fase && Math.abs(e.fase.emTempos) > TOL_FASE) {
    const lado = e.fase.emTempos > 0 ? 'B está adiantado' : 'B está atrasado';
    const puxe = e.fase.emTempos > 0 ? 'para trás' : 'para frente';
    return { num: '6', cor: 'verde',
      fala: `Arraste o <b>jog</b> — o disco grande do deck B — ${puxe}, até o medidor ficar <b>verde</b>.`,
      porque: `${lado} em ${Math.abs(e.fase.emMs).toFixed(0)} ms. Mesmo BPM igual, as batidas podem cair fora.`,
      apontar: [{ id: 'jog-B', rotulo: 'JOG — arraste este disco' },
                { id: 'fase', rotulo: 'fica verde quando encaixa' }] };
  }

  // ── 7. encaixado: preparar a troca de graves ──
  const graveEntrando = e.eq?.[outro]?.grave ?? 0.5;
  if (graveEntrando > 0.08) {
    return { num: '7', cor: 'azul',
      fala: `Encaixou! Agora <b>corte o grave</b> do deck ${outro}: é o botão <b>×</b> da linha GRAVE, no mixer do meio.`,
      porque: 'Dois graves tocando juntos viram lama. Corta um, e só devolve quando o outro sair.',
      apontar: [{ id: `kill-${outro}-grave`, rotulo: 'corta o GRAVE do ' + outro }] };
  }

  // ── 8. trazer com o crossfader ──
  const noMeio = Math.abs(e.crossfader - 0.5) < 0.12;
  if (!noMeio) {
    const paraOnde = outro === 'B' ? 'para a direita' : 'para a esquerda';
    return { num: '8', cor: 'azul',
      fala: `Traga o <b>crossfader</b> ${paraOnde}, devagar. É a barra larga embaixo do mixer.`,
      porque: 'Os dois vão soar juntos. Como o grave de um está cortado, não vira lama.',
      apontar: [{ id: 'xf', rotulo: 'CROSSFADER — arraste devagar' }] };
  }

  // ── 9. a troca ──
  return { num: '9', cor: 'azul',
    fala: `Agora a troca: <b>corte o grave do ${tocando}</b> e devolva o do ${outro}.`,
    porque: 'Este é o momento da transição. Depois é só levar o crossfader até o fim e parar o deck que saiu.',
    apontar: [{ id: `kill-${tocando}-grave`, rotulo: 'corta o grave do ' + tocando },
              { id: `kill-${outro}-grave`, rotulo: 'devolve o grave do ' + outro }] };
}

/**
 * Avisos ao vivo — o professor acompanhando a música tocar.
 *
 * Canal separado do passo a passo, e de propósito: o passo responde "o que eu
 * faço agora pra mixar", o aviso responde "o que está acontecendo com o som
 * neste instante". Quem está no meio de uma faixa não está executando passo
 * nenhum, e mesmo assim precisa de alguém olhando.
 *
 * Cada aviso tem gravidade e freio próprio: repetir a mesma frase a cada 200 ms
 * transforma o professor em chateação e ninguém mais lê.
 *
 * Devolve no máximo 2, ordenados por gravidade — mais que isso ninguém absorve
 * no meio de uma mixagem.
 */
const ultimoAviso = new Map();

export function avisos(e, agora = Date.now()) {
  const fora = [];
  const por = (id, seg, grav, texto, apontar = []) => {
    if ((agora - (ultimoAviso.get(id) || 0)) < seg * 1000) return;
    ultimoAviso.set(id, agora);
    fora.push({ id, grav, texto, apontar });
  };

  // ── fim de faixa se aproximando ──
  for (const d of ['A', 'B']) {
    const dk = e[d];
    if (!dk?.tocando || !dk.restante) continue;
    if (dk.restante < 20) {
      por(`fim-${d}`, 12, 3, `O deck ${d} acaba em ${Math.round(dk.restante)}s — a transição tem que começar AGORA.`);
    } else if (dk.restante < 45) {
      por(`fim-${d}`, 25, 2, `Faltam ${Math.round(dk.restante)}s no deck ${d}. Já dá pra preparar a próxima.`);
    }
  }

  // ── clipping / limitador trabalhando ──
  if (e.reducao > 6) {
    por('limitador', 10, 3,
      `O som está estourando: o limitador está segurando ${e.reducao.toFixed(0)} dB. Baixe o volume geral.`,
      [{ id: 'master', rotulo: 'baixe aqui' }]);
  } else if (e.reducao > 2) {
    por('limitador-leve', 20, 1, `O limitador começou a trabalhar (${e.reducao.toFixed(1)} dB). Está no limite.`);
  }

  // ── desequilíbrio de volume entre os decks ──
  if (e.A?.tocando && e.B?.tocando && e.nivelA > 0.003 && e.nivelB > 0.003) {
    const dif = 20 * Math.log10(e.nivelA / e.nivelB);
    if (Math.abs(dif) > 6) {
      const alto = dif > 0 ? 'A' : 'B', baixo = dif > 0 ? 'B' : 'A';
      por('volume', 18, 2,
        `O deck ${alto} está ${Math.abs(dif).toFixed(0)} dB mais alto que o ${baixo} — a troca vai dar um degrau.`,
        [{ id: `vol-${baixo}`, rotulo: `suba o ${baixo}` }]);
    }
  }

  // ── dois graves abertos ao mesmo tempo ──
  if (e.A?.tocando && e.B?.tocando && e.ambosAudiveis &&
      (e.eq?.A?.grave ?? 0.5) > 0.3 && (e.eq?.B?.grave ?? 0.5) > 0.3) {
    por('graves', 14, 3,
      'Os dois graves estão abertos juntos — é isso que deixa o som embolado. Corte um deles.',
      [{ id: 'kill-B-grave', rotulo: 'corte um' }]);
  }

  // ── fase descolando ──
  if (e.fase && e.ambosAudiveis) {
    const err = Math.abs(e.fase.emMs);
    if (err > 45) {
      por('fase', 8, 3, `As batidas descolaram ${err.toFixed(0)} ms. Empurre o jog do B.`,
        [{ id: 'jog-B', rotulo: 'empurre aqui' }]);
    } else if (err > 18) {
      por('fase-leve', 14, 1, `Fase escorregando: ${err.toFixed(0)} ms. Dá pra corrigir no jog.`);
    }
  }

  // ── falhas de áudio ──
  if (e.glitches > 0) {
    por('glitch', 45, 2,
      `Houve ${e.glitches} falha(s) de áudio. Se repetir, feche abas pesadas — o navegador está sem folga.`);
  }

  // ── keylock caiu ──
  for (const d of ['A', 'B']) {
    if (e[d]?.keylockPedido && !e[d]?.keylockAtivo && e[d]?.motivoKeylock) {
      por(`keylock-${d}`, 30, 1, `Keylock do ${d}: ${e[d].motivoKeylock}.`);
    }
  }

  // ── elogio: reconhecer o acerto também ensina ──
  if (e.fase && e.ambosAudiveis && Math.abs(e.fase.emTempos) < 0.012 && e.crossfader > 0.25 && e.crossfader < 0.75) {
    por('bom', 30, 0, 'Encaixe travado e os dois no ar. É exatamente assim.');
  }

  return fora.sort((a, b) => b.grav - a.grav).slice(0, 2);
}
