/**
 * Piloto — o professor tocando o set sozinho, pra você ouvir ou acompanhar.
 *
 * Este arquivo é a versão em produto do script com que eu testei o motor. Ele
 * faz exatamente a sequência que rendeu 3 ms de erro de fase nas três
 * transições medidas, e nada além dela:
 *
 *   SYNC → posiciona a entrada num limite de frase antes de um drop →
 *   PLAY → corta o grave de quem entra → ENCAIXAR → crossfade de 8 s →
 *   troca de graves → completa o crossfade → freio de vinil em quem sai →
 *   devolve o grave de quem saiu → carrega a próxima
 *
 * Duas regras de projeto, e as duas existem por um motivo:
 *
 * 1. TUDO passa pelos mesmos métodos que a sua mão usaria. O piloto não tem
 *    atalho privilegiado pro motor. Se ele consegue, você consegue — e o que
 *    ele faz aparece nos mesmos controles, acendendo do mesmo jeito.
 *
 * 2. Ele SOLTA na hora que você encostar. Qualquer gesto seu num controle
 *    desarma o piloto no meio do que ele estiver fazendo, sem reclamar e sem
 *    desfazer. Um piloto que briga pelo volante é pior que nenhum.
 */

import { momentos } from './momentos.js';
import { executar, escolherTecnica, caminharBpm, TECNICAS, ESTILOS } from './tecnicas.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export class Piloto extends EventTarget {
  /**
   * @param {object} dep
   * @param {object} dep.decks    { A, B }
   * @param {object} dep.mixer
   * @param {function} dep.encaixar   alinha a fase (o mesmo que o botão faz)
   * @param {function} dep.sincronizar(id)
   * @param {function} dep.carregar(id, faixa) -> Promise<boolean>
   */
  constructor({ decks, mixer, encaixar, sincronizar, carregar }) {
    super();
    Object.assign(this, { decks, mixer, encaixar, sincronizar, carregar });
    this.ativo = false;
    this.parar = false;
    this.pularAgora = false;
    this.passo = '';
    this.estilo = 'pista';
    this.ultimaTecnica = null;
  }

  /**
   * Pula a espera e faz a transição já.
   *
   * O piloto espera a quebra da faixa no ar pra sair no lugar certo, e essa
   * espera pode passar de um minuto. Quem já ouviu aquela faixa não quer
   * esperar — e não ter como pular era o que fazia o set parecer travado.
   */
  pular() { if (this.ativo) this.pularAgora = true; }

  #diz(passo, extra = {}) {
    this.passo = passo;
    this.dispatchEvent(new CustomEvent('passo', { detail: { passo, ...extra } }));
  }

  /** Você encostou num controle: o piloto sai de cena imediatamente. */
  assumirControle(motivo = 'você assumiu') {
    // `this.parar` também: quem ouve 'parado' chama pararPiloto(), que chama
    // isto de novo — sem esta guarda era recursão infinita (estouro de pilha
    // medido ao apertar ■ parar com o DJ tocando)
    if (!this.ativo || this.parar) return;
    this.parar = true;
    this.#diz('parado', { motivo });
  }

  /**
   * Onde COMEÇAR a faixa que vai entrar.
   *
   * Uma frase inteira (16 tempos) antes do primeiro drop: dá tempo da faixa
   * ganhar corpo por baixo antes de abrir, que é o que faz a transição soar
   * inteira em vez de colada.
   */
  #entrada(deck) {
    const l = momentos(deck);
    const drop = l.find((m) => m.tipo === 'drop' && m.t > 20 && m.t < deck.duration * 0.6);
    const marca = drop || l.find((m) => m.bloco && m.t > 20);
    const frase = (60 / deck.grid.bpm) * 16;
    return Math.max(1, (marca?.t ?? 25) - frase);
  }

  /** Quando SAIR: a próxima quebra da faixa no ar, com folga pra preparar. */
  #saida(deck) {
    const l = momentos(deck);
    const de = deck.displayPosition + 20;
    return l.find((m) => m.tipo === 'quebra' && m.t > de)
        || l.find((m) => m.bloco && m.t > de)
        || null;
  }

  #kill(id, banda, ligado) {
    const canal = this.mixer.canal(id);
    if (canal.eq.morto(banda) !== ligado) canal.setKill(banda, ligado);
  }

  async #dorme(ms, { pulavel = false } = {}) {
    const fim = performance.now() + ms;
    while (performance.now() < fim) {
      if (this.parar) return false;
      if (pulavel && this.pularAgora) return true;      // corta a espera, segue o roteiro
      await espera(Math.min(200, fim - performance.now()));
    }
    return true;
  }

  /**
   * As ações que um roteiro de técnica pode pedir, embrulhadas nos métodos que
   * a mão do usuário usaria. Um adaptador só: se o motor mudar, muda aqui.
   */
  #acoes() {
    const mx = this.mixer, d = this.decks;
    const emitirXf = () => this.dispatchEvent(new CustomEvent('crossfader', { detail: { x: mx.crossfader } }));
    return {
      kill: (id, banda, on) => this.#kill(id, banda, on),
      eq: (id, banda, v) => mx.canal(id).setEq(banda, v),
      filtro: (id, k) => mx.canal(id).setFiltro(k),
      fader: (id, v) => mx.canal(id).setFader(v),
      eco: (id, v) => mx.setEco(id, v),
      ecoDivisao: (id, div) => mx.setEcoTempo(id, d[id].bpmEfetivo, div),
      xf: (x) => { mx.setCrossfader(x); emitirXf(); },
      loop: (id, n) => d[id].loopDeTempos(n),
      semLoop: (id) => d[id].clearLoop(),
      parar: (id) => d[id].pause({ brake: 1.2 }),
      rampa: (alvo, v) => {
        if (alvo === 'xf') { mx.setCrossfader(v); emitirXf(); return; }
        const [tipo, id, banda] = alvo.split(':');
        if (tipo === 'fader') mx.canal(id).setFader(v);
        else if (tipo === 'filtro') mx.canal(id).setFiltro(v);
        else if (tipo === 'eq') mx.canal(id).setEq(banda, v);
        else if (tipo === 'eco') mx.setEco(id, v);
      },
    };
  }

  /**
   * Uma transição completa de `sai` para `entra`, com a técnica escolhida.
   *
   * Antes era sempre a mesma: troca de graves com 8 s de crossfade. Agora a
   * técnica vem da faixa na fila (quem decidiu foi o Jev, ou o escolhedor por
   * estilo, se não houver IA), e a duração é em TEMPOS — a análise de 20.765
   * transições reais (Kim et al., ISMIR 2020) mostra pico a cada 32 tempos.
   */
  async transicao(sai, entra, { faixa = null, anterior = null } = {}) {
    const d = this.decks;
    this.#diz('sincronizando', { deck: entra });
    this.sincronizar(entra);
    if (!await this.#dorme(400)) return false;

    d[entra].seek(this.#entrada(d[entra]));
    d[entra].play();
    this.#diz('entrando', { deck: entra, faixa: d[entra].faixa?.title });
    if (!await this.#dorme(1800)) return false;

    this.encaixar();
    this.#diz('encaixando');
    if (!await this.#dorme(1200)) return false;

    const tecnica = faixa?.tecnica && TECNICAS[faixa.tecnica]
      ? faixa.tecnica
      : escolherTecnica({ saiFaixa: d[sai].faixa, entraFaixa: faixa || d[entra].faixa,
                          anterior, estilo: this.estilo });
    const est = ESTILOS[this.estilo] || ESTILOS.pista;
    const tempos = faixa?.tempos || Math.max(8, Math.round(TECNICAS[tecnica].tempos * est.escala / 4) * 4);
    this.ultimaTecnica = tecnica;
    this.#diz('tecnica', { tecnica: TECNICAS[tecnica].nome, tempos, porque: faixa?.porqueIA || null });

    const ok = await executar(tecnica, {
      m: this.#acoes(), dorme: (ms) => this.#dorme(ms),
      sai, entra, bpm: d[entra].bpmEfetivo, tempos,
      aoPasso: ({ tempo, de }) => this.dispatchEvent(new CustomEvent('progresso', { detail: { tempo, de, tecnica } })),
    });
    if (!ok) return false;

    // arruma a casa: quem saiu volta neutro, pra entrar limpo na próxima vez
    const m = this.#acoes();
    for (const b of ['grave', 'medio', 'agudo']) { this.#kill(sai, b, false); m.eq(sai, b, 0.5); }
    m.filtro(sai, 0); m.eco(sai, 0); m.fader(sai, 1);

    // o andamento volta devagar pro natural da faixa que entrou
    if (est.caminha) {
      this.#diz('bpm caminhando', { deck: entra });
      if (!await caminharBpm(d[entra], { dorme: (ms) => this.#dorme(ms) })) return false;
    }
    return true;
  }

  /** Toca a fila inteira. Volta quando acaba ou quando você assume. */
  async tocar(fila, { segundos = 8 } = {}) {
    if (this.ativo || !fila?.length) return;
    this.ativo = true; this.parar = false;
    const d = this.decks;
    try {
      this.#diz('carregando', { faixa: fila[0].title });
      if (!await this.carregar('A', fila[0])) throw new Error('a primeira faixa não carregou');
      this.dispatchEvent(new CustomEvent('tocou', { detail: { faixa: fila[0] } }));
      d.A.seek(this.#entrada(d.A));
      this.mixer.setCrossfader(0);
      d.A.play();
      this.#diz('no ar', { deck: 'A', faixa: fila[0].title });
      if (!await this.#dorme(1500)) return;

      let noAr = 'A';
      for (let i = 1; i < fila.length && !this.parar; i++) {
        const entra = noAr === 'A' ? 'B' : 'A';
        this.#diz('carregando', { deck: entra, faixa: fila[i].title, resta: fila.length - i });
        if (!await this.carregar(entra, fila[i])) { this.#diz('pulou', { faixa: fila[i].title }); continue; }

        /**
         * Espera chegar perto da quebra da faixa no ar.
         *
         * Esta espera pode ser longa — medi 79 s numa faixa de 307 s — e
         * enquanto ela durava a tela continuava dizendo "carregando", que era
         * mentira: já tinha carregado, ele estava esperando a hora certa. Agora
         * ele diz o que está esperando, e conta os segundos.
         */
        const q = this.#saida(d[noAr]);
        if (q && !this.pularAgora) {
          const ate = performance.now() + Math.min((q.t - d[noAr].displayPosition - 16) * 1000, 120000);
          while (performance.now() < ate && !this.pularAgora) {
            const falta = Math.round((ate - performance.now()) / 1000);
            this.#diz('esperando', { deck: noAr, tipo: q.tipo, seg: falta });
            if (!await this.#dorme(Math.min(2000, ate - performance.now()), { pulavel: true })) return;
          }
        }
        this.pularAgora = false;
        if (!await this.transicao(noAr, entra, { faixa: fila[i], anterior: this.ultimaTecnica })) return;
        this.dispatchEvent(new CustomEvent('tocou', { detail: { faixa: fila[i] } }));
        noAr = entra;
        this.#diz('transição pronta', { noAr, resta: fila.length - i - 1 });
      }
      this.#diz('fim do set');
    } catch (e) {
      this.#diz('erro', { erro: e.message });
    } finally {
      this.ativo = false;
    }
  }
}
