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
      apontar: ['lista'] };
  }

  // ── 2. carregado mas parado, e nada tocando ──
  if (!algumTocando) {
    const id = A?.temFaixa ? 'A' : 'B';
    return { num: '2', cor: 'verde',
      fala: `Agora toque em <b>PLAY</b> no deck ${id}.`,
      porque: 'Nada vai acontecer até você dar play. Pode subir o volume geral também.',
      apontar: [`play-${id}`] };
  }

  const tocando = tocandoA ? 'A' : 'B';
  const outro = tocando === 'A' ? 'B' : 'A';
  const oOutro = tocando === 'A' ? B : A;

  // ── 3. tocando, mas o outro deck está vazio ──
  if (!oOutro?.temFaixa) {
    return { num: '3', cor: 'verde',
      fala: `Escolha a próxima música e mande pro deck <b>${outro}</b>. As <b>verdes</b> combinam.`,
      porque: 'Verde = mesmo tom e andamento parecido. São as que encaixam sem esforço.',
      apontar: ['lista'] };
  }

  // ── 4. os dois têm faixa: casar o andamento ──
  const bpmT = e[tocando]?.bpmEfetivo, bpmO = oOutro?.bpmEfetivo;
  if (bpmT && bpmO && Math.abs(bpmT - bpmO) > TOL_BPM) {
    return { num: '4', cor: 'verde',
      fala: `Toque em <b>SYNC</b> no deck ${outro} para casar o andamento.`,
      porque: `Uma está em ${bpmT.toFixed(1)} e a outra em ${bpmO.toFixed(1)} BPM. Assim as batidas brigam.`,
      apontar: [`sync-${outro}`] };
  }

  // ── 5. andamento casado, o outro ainda parado ──
  if (!oOutro.tocando) {
    return { num: '5', cor: 'verde',
      fala: `Andamento casado. Dê <b>PLAY</b> no deck ${outro} — pode deixar o volume dele baixo.`,
      porque: 'Com o crossfader pra um lado só, ninguém ouve o outro deck ainda. Você pode errar à vontade.',
      apontar: [`play-${outro}`] };
  }

  // ── 6. os dois tocando: encaixar a fase ──
  if (e.fase && Math.abs(e.fase.emTempos) > TOL_FASE) {
    const lado = e.fase.emTempos > 0 ? 'B está adiantado' : 'B está atrasado';
    const puxe = e.fase.emTempos > 0 ? 'para trás' : 'para frente';
    return { num: '6', cor: 'verde',
      fala: `Arraste o <b>jog</b> do deck B ${puxe} até o medidor ficar <b>verde</b>.`,
      porque: `${lado} em ${Math.abs(e.fase.emMs).toFixed(0)} ms. Mesmo BPM igual, as batidas podem cair fora.`,
      apontar: ['jog-B', 'fase'] };
  }

  // ── 7. encaixado: preparar a troca de graves ──
  const graveEntrando = e.eq?.[outro]?.grave ?? 0.5;
  if (graveEntrando > 0.08) {
    return { num: '7', cor: 'azul',
      fala: `Encaixou. Agora <b>corte o grave</b> do deck ${outro} antes de trazê-lo.`,
      porque: 'Dois graves tocando juntos viram lama. Corta um, e só devolve quando o outro sair.',
      apontar: [`kill-${outro}-grave`] };
  }

  // ── 8. trazer com o crossfader ──
  const noMeio = Math.abs(e.crossfader - 0.5) < 0.12;
  if (!noMeio) {
    const paraOnde = outro === 'B' ? 'para a direita' : 'para a esquerda';
    return { num: '8', cor: 'azul',
      fala: `Traga o <b>crossfader</b> ${paraOnde}, devagar.`,
      porque: 'Os dois vão soar juntos. Como o grave de um está cortado, não vira lama.',
      apontar: ['xf'] };
  }

  // ── 9. a troca ──
  return { num: '9', cor: 'azul',
    fala: `Agora a troca: <b>corte o grave do ${tocando}</b> e devolva o do ${outro}.`,
    porque: 'Este é o momento da transição. Depois é só levar o crossfader até o fim e parar o deck que saiu.',
    apontar: [`kill-${tocando}-grave`, `kill-${outro}-grave`] };
}
