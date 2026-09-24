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
import { executar, escolherTecnica, escolherMovimento, caminharBpm, novidade, TECNICAS, ESTILOS, MOVIMENTOS } from './tecnicas.js';
import { keyCompatible } from '../sources/audius.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
/** Duração de um tempo, em segundos DE FAIXA (a grade é da faixa, não do relógio). */
const per = (deck) => 60 / (deck?.grid?.bpm || 124);

export class Piloto extends EventTarget {
  /**
   * @param {object} dep
   * @param {object} dep.decks    { A, B }
   * @param {object} dep.mixer
   * @param {function} dep.encaixar   alinha a fase (o mesmo que o botão faz)
   * @param {function} dep.sincronizar(id)
   * @param {function} dep.carregar(id, faixa) -> Promise<boolean>
   */
  constructor({ decks, mixer, encaixar, sincronizar, carregar, pads = null }) {
    super();
    Object.assign(this, { decks, mixer, encaixar, sincronizar, carregar, pads });
    // o currículo: quantas vezes cada técnica e gesto já apareceu (entre sets)
    try { this.vistos = JSON.parse(localStorage.getItem('garimpo.dj.vistos')) || {}; } catch { this.vistos = {}; }
    this.ativo = false;
    this.parar = false;
    this.pularAgora = false;
    this.passo = '';
    this.estilo = 'pista';
    this.ultimaTecnica = null;
    // "tocar junto": o DJ conduz, mas o gesto-chave de cada transição é seu
    this.juntos = false;
  }

  /**
   * Troca as PRÓXIMAS do set com ele tocando — a que está no ar continua.
   * É o que acontece quando a pessoa marca outros gêneros no meio do set:
   * antes nada mudava até o set acabar.
   */
  substituirProximas(novas) {
    if (!this.ativo || !this.fila || !novas?.length) return false;
    this.fila.splice(this.indice + 1, Infinity, ...novas);
    return true;
  }

  /**
   * Pula a espera e faz a transição já.
   *
   * O piloto espera a frase de saída da faixa no ar (ver o PLANO), e essa
   * espera pode passar de dois minutos. Quem já ouviu aquela faixa não quer
   * esperar — e não ter como pular era o que fazia o set parecer travado.
   */
  pular() { if (this.ativo) this.pularAgora = true; }

  #diz(passo, extra = {}) {
    this.passo = passo;
    this.dispatchEvent(new CustomEvent('passo', { detail: { passo, ...extra } }));
  }

  /** Narração pra quem está aprendendo: o que fez, por quê, e em qual controle. */
  #narra(diz, { porque = null, vars = {}, mostra = [], vez = false, acertou = null } = {}) {
    this.dispatchEvent(new CustomEvent('narra', { detail: { diz, porque, vars, mostra, vez, acertou } }));
  }

  /** Você encostou num controle: o piloto sai de cena imediatamente. */
  assumirControle(motivo = 'você assumiu') {
    // tocando junto, mexer nos controles é o combinado — não é tomar o volante
    if (this.juntos && motivo === 'você assumiu') return;
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

  /**
   * O PLANO DE SAÍDA: em que frase da faixa no ar a próxima assume.
   *
   * Antes ele saía na primeira quebra depois de 20 s — cada faixa tocava um
   * minuto e pouco, muitas vezes sem chegar no drop principal. Agora a faixa
   * vive: house e techno tocam até a SAÍDA (a última quebra, onde o outro
   * começa, com pelo menos `uso` da faixa tocada); estilos de emenda rápida
   * (baile, turntablista) saem na primeira quebra depois do meio.
   *
   * `impactoT` é o limite de frase em que a técnica dá o golpe (a troca de
   * graves, o corte). A transição começa `impacto` tempos antes e termina
   * dentro da faixa. Com `cedo` (o ⏭), vale a primeira frase que der.
   */
  #planoSaida(S, { tempos, impacto, cedo = false, em = 'quebra' }) {
    const l = momentos(S);
    if (!l.length || !S.grid?.bpm) return null;
    const p = per(S), pos = S.displayPosition;
    const cabe = l.filter((m) => m.t - impacto * p > pos + 4 * (S.nominalRate || 1)
                              && m.t + (tempos - impacto) * p <= S.duration - 0.3);
    if (!cabe.length) return null;
    if (cedo) return { impactoT: cabe[0].t, inicioT: cabe[0].t - impacto * p, tipo: cabe[0].tipo };
    const est = ESTILOS[this.estilo] || ESTILOS.pista;
    const tarde = cabe.filter((m) => m.t >= S.duration * (est.uso ?? 0.66));
    const pote = tarde.length ? tarde : cabe;
    const ordem = (est.uso ?? 0.66) >= 0.6 ? [...pote].reverse() : pote;   // vive até o fim / sai cedo
    const m = ordem.find((x) => x.tipo === em) || ordem.find((x) => x.bloco) || ordem[0];
    return { impactoT: m.t, inicioT: m.t - impacto * p, tipo: m.tipo };
  }

  /**
   * O PLANO DE ENTRADA: de onde a próxima começa pra que o DROP dela caia
   * exatamente no golpe da técnica, no 1 da frase da que sai. É o "drop
   * swap" de cabine: a troca de graves não é num ponto qualquer, é a que
   * entra explodindo onde a que sai abre espaço. Sem drop achado, entra pela
   * introdução, alinhada de 16 em 16 tempos.
   */
  #planoEntrada(E, impacto) {
    const p = per(E), l = momentos(E);
    const drop = l.find((m) => m.tipo === 'drop' && m.t > 16 * p && m.t < E.duration * 0.6);
    const alvo = drop?.t ?? l.find((m) => m.bloco && m.t >= 32 * p)?.t ?? ((E.grid?.ancora || 0) + 32 * p);
    let ini = alvo - impacto * p;
    while (ini < 0) ini += 16 * p;
    return { inicioE: ini, comDrop: !!drop && ini === drop.t - impacto * p };
  }

  /**
   * VIDA NA FAIXA enquanto espera: se um drop ou uma quebra da faixa no ar
   * está chegando (e não colide com a transição), às vezes faz um gesto
   * curto em cima dele — ver MOVIMENTOS. Um por frase no máximo, e o sorteio
   * do estilo decide se faz. Devolve false se o usuário assumiu.
   */
  async #viver(id, limiteT) {
    const D = this.decks[id];
    if (!D?.grid?.bpm) return true;
    const p = per(D), pos = D.displayPosition;
    this.vividos ||= new Set();
    const m = momentos(D).find((x) => (x.tipo === 'drop' || x.tipo === 'quebra') && !this.vividos.has(id + x.t)
                                  && x.t > pos && x.t < limiteT - 8 * p);
    if (!m) return true;
    const faltaSeg = (m.t - pos) / (D.nominalRate || 1);
    if (faltaSeg > 14) return true;                       // ainda longe: decide mais perto
    this.vividos.add(id + m.t);
    // com moderação: 2 gestos por faixa no máximo — repetido em toda frase,
    // o truque vira tique (os guias de técnica avisam, e soa robótico igual)
    const chave = id + ':' + (D.faixa?.id || D.faixa?.title);
    this.gestos ||= {};
    // tocando JUNTO é aula: mais gestos por faixa (3) e mais chance de cada um
    if ((this.gestos[chave] || 0) >= (this.juntos ? 3 : 2)) return true;
    const mov = escolherMovimento({ tipo: m.tipo, estilo: this.estilo, anterior: this.ultimoMovimento,
                                    vistos: this.vistos, extra: this.juntos ? 0.25 : 0 });
    if (mov) { this.gestos[chave] = (this.gestos[chave] || 0) + 1; this.#viu(mov); }
    if (!mov) return true;
    const inicio = m.t - MOVIMENTOS[mov].alvo * p;
    if (inicio < pos + 0.5 * p) return true;              // já passou do começo do gesto
    this.ultimoMovimento = mov;
    // o som do drop depende do estilo: buzina no baile, impacto no festival
    const som = { baile: 'buzina', turntablista: 'rewind', festival: 'impacto' }[this.estilo] || 'palmas';
    return executar(mov, {
      m: this.#acoes(), dorme: (ms) => this.#dorme(ms), deck: id, bpm: D.bpmEfetivo, param: { som },
      relogio: () => (D.displayPosition - inicio) / p,
      aoFalar: (x) => this.#narra(x.diz, x), aluno: this.juntos, ler: this.#ler(),
    });
  }

  #ler() {
    return {
      morto: (id, b) => this.mixer.canal(id).eq.morto(b),
      fader: (id) => this.mixer.canal(id).valores.fader,
      xf: () => this.mixer.crossfader,
    };
  }

  /**
   * Espera a faixa `id` chegar em `ateT` (segundos de faixa), vivendo a faixa
   * no caminho. `pulavel`: o ⏭ interrompe e devolve 'pulou'.
   */
  async #esperarAte(id, ateT, { tipo = 'frase', antes = 0, pulavel = true } = {}) {
    const D = this.decks[id];
    while (!this.parar) {
      const falta = (ateT - D.displayPosition) / (D.nominalRate || 1) - antes;
      if (falta <= 0.05) return 'chegou';
      if (pulavel && this.pularAgora) return 'pulou';
      this.#diz('esperando', { deck: id, tipo, seg: Math.round(falta) });
      if (!await this.#viver(id, ateT)) return 'parou';
      const f2 = (ateT - D.displayPosition) / (D.nominalRate || 1) - antes;
      if (!await this.#dorme(Math.max(20, Math.min(1000, f2 * 1000)), { pulavel })) return 'parou';
    }
    return 'parou';
  }

  /** Conta mais uma aula dada de `nome` (técnica ou gesto) e guarda. */
  #viu(nome) {
    this.vistos[nome] = (this.vistos[nome] || 0) + 1;
    try { localStorage.setItem('garimpo.dj.vistos', JSON.stringify(this.vistos)); } catch {}
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
      pad: (nome) => this.pads?.dispararNome?.(nome),
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
    const S = d[sai], E = d[entra];

    // a técnica vem ANTES do plano: é ela que diz quantos tempos e onde é o golpe
    /**
     * Quem escolhe: o Jev, quando está seguro (60%+). Na dúvida, as chances
     * dele entram como peso junto com o CURRÍCULO — entre as técnicas que ele
     * acha que servem, a que você viu menos. Sem Jev, o estilo e o currículo.
     */
    const probs = faixa?.probsIA || null;
    let tecnica;
    if (faixa?.tecnica && TECNICAS[faixa.tecnica] && (!probs || (probs[faixa.tecnica] ?? 1) >= 0.6)) {
      tecnica = faixa.tecnica;
    } else if (probs && faixa?.tecnica && faixa.harmonicamenteOk !== false) {
      // (tom que briga não reabre: ali a política já forçou eco/corte)
      const pesos = {};
      for (const [k, pr] of Object.entries(probs)) {
        if (TECNICAS[k] && pr >= 0.08 && k !== anterior) pesos[k] = pr * novidade(this.vistos[k]);
      }
      const soma = Object.values(pesos).reduce((a, b) => a + b, 0);
      let r = Math.random() * soma;
      tecnica = Object.keys(pesos).find((k) => (r -= pesos[k]) <= 0) || faixa.tecnica;
    } else {
      tecnica = escolherTecnica({ saiFaixa: S.faixa, entraFaixa: faixa || E.faixa,
                                  anterior, estilo: this.estilo, vistos: this.vistos });
    }
    this.#viu(tecnica);
    const est = ESTILOS[this.estilo] || ESTILOS.pista;
    /**
     * A duração em ESCALAS INTEIRAS do roteiro (¼, ½, ¾, 1, 1½, 2). Com uma
     * escala qualquer (0,625) os passos caíam fora do tempo e o golpe saía um
     * tempo antes do drop — medido na simulação. Assim duração, golpe e cada
     * passo ficam em tempos inteiros, e o golpe cai no 1 da frase.
     */
    const base = TECNICAS[tecnica].tempos;
    const pedida = (faixa?.tempos || base * est.escala) / base;
    const ESCALAS = [0.25, 0.5, 0.75, 1, 1.5, 2].filter((e) => base * e >= 8);
    let escala = ESCALAS.reduce((a, b) => (Math.abs(b - pedida) < Math.abs(a - pedida) ? b : a));
    let tempos = base * escala;
    let impacto = (TECNICAS[tecnica].impacto ?? base / 2) * escala;

    // o andamento da que está no ar ainda pode estar voltando pro natural
    // (ver caminharBpm, que agora corre em paralelo): o SYNC espera ele assentar
    if (this.caminhando) { await this.caminhando; this.caminhando = null; }
    if (this.parar) return false;

    // SYNC com a que entra PARADA: casa o andamento sem ninguém ouvir
    this.#diz('sincronizando', { deck: entra });
    this.sincronizar(entra);
    this.#narra('n.sync', { porque: 'n.sync.p', vars: { e: entra, s: sai }, mostra: [`sync-${entra}`] });
    if (!await this.#dorme(400)) return false;

    /**
     * O PLANO. Com grade nas duas faixas, tudo é marcado na MÚSICA: a frase
     * de saída da que toca, a posição de entrada da próxima (o drop dela cai
     * no golpe) e o relógio da técnica lido da posição da que entra. Sem
     * grade (análise falhou), cai no jeito antigo, pelo relógio.
     */
    let relogio = null;
    let plano = null;
    if (S.grid?.bpm && E.grid?.bpm) {
      // não coube a duração pedida no que resta da faixa? encurta (mesma
      // técnica, escala menor) em vez de cair no jeito sem frase
      for (const e of [escala, ...ESCALAS.filter((x) => x < escala).reverse()]) {
        plano = this.#planoSaida(S, { tempos: base * e, impacto: (TECNICAS[tecnica].impacto ?? base / 2) * e,
                                      cedo: this.pularAgora, em: TECNICAS[tecnica].saidaEm || 'quebra' });
        if (plano) { escala = e; tempos = base * e; impacto = (TECNICAS[tecnica].impacto ?? base / 2) * e; break; }
      }
    }
    if (plano) {
      const pe = this.#planoEntrada(E, impacto);
      this.#narra('n.plano', { porque: pe.comDrop ? 'n.plano.pDrop' : 'n.plano.p',
        vars: { s: sai, e: entra, t: TECNICAS[tecnica].nome,
                m: Math.floor(plano.impactoT / 60) + ':' + String(Math.floor(plano.impactoT % 60)).padStart(2, '0') } });
      // espera a hora, vivendo a faixa; o ⏭ replaneja pra primeira frase que der
      const lead = () => Math.min(2.5, pe.inicioE / (E.nominalRate || 1));
      let r = await this.#esperarAte(sai, plano.inicioT, { tipo: plano.tipo, antes: lead() });
      if (r === 'parou') return false;
      if (r === 'pulou') {
        this.pularAgora = false;
        plano = this.#planoSaida(S, { tempos, impacto, cedo: true }) || plano;
        r = await this.#esperarAte(sai, plano.inicioT, { tipo: plano.tipo, antes: lead(), pulavel: false });
        if (r === 'parou') return false;
      }
      this.pularAgora = false;
      // começa a próxima de um jeito que ela chegue em inicioE junto com a
      // que sai chegando em inicioT — calado: o crossfader ainda é da outra
      const w = (plano.inicioT - S.displayPosition) / (S.nominalRate || 1);
      E.seek(Math.max(0, pe.inicioE - w * (E.nominalRate || 1)));
      E.play();
      this.#diz('entrando', { deck: entra, faixa: E.faixa?.title });
      // o resto de fase (abaixo de um tempo) é acertado EM PARALELO: esperar
      // por ele atrasava o 1º passo meio tempo quando a próxima começa do zero
      setTimeout(() => { if (!this.parar) this.encaixar(entra); }, 350);
      this.#diz('encaixando');
      this.#narra('n.encaixar', { porque: 'n.encaixar.p', vars: { e: entra }, mostra: ['b-encaixar', 'fase'] });
      relogio = () => (E.displayPosition - pe.inicioE) / per(E);
    } else {
      this.pularAgora = false;
      E.seek(this.#entrada(E));
      E.play();
      this.#diz('entrando', { deck: entra, faixa: E.faixa?.title });
      if (!await this.#dorme(1800)) return false;
      this.encaixar(entra);
      this.#diz('encaixando');
      this.#narra('n.encaixar', { porque: 'n.encaixar.p', vars: { e: entra }, mostra: ['b-encaixar', 'fase'] });
      if (!await this.#dorme(1200)) return false;
    }

    this.ultimaTecnica = tecnica;
    this.#diz('tecnica', { tecnica: TECNICAS[tecnica].nome, tempos, porque: faixa?.porqueIA || null });
    /**
     * O PORQUÊ da técnica, com os fatos DESTA dupla de músicas: os tons casam
     * ou brigam, quanto o andamento difere — e o que a técnica resolve. "Jev
     * 95%" não explicava nada; isto explica.
     */
    const fa = d[sai].faixa, fb = faixa || d[entra].faixa;
    const tomOk = fa?.camelot && fb?.camelot
      ? keyCompatible({ camelot: fa.camelot }, { camelot: fb.camelot }).ok : null;
    const dif = fa?.bpm && fb?.bpm ? Math.abs((fb.bpm / fa.bpm - 1) * 100).toFixed(1) : '?';
    this.#narra('n.tecnica', {
      porque: tomOk === false ? 'n.tecnica.pBriga' : tomOk ? 'n.tecnica.pOk' : 'n.tecnica.p',
      vars: {
        t: TECNICAS[tecnica].nome, n: tempos, est: est.nome, q: TECNICAS[tecnica].quando,
        a: fa?.camelot || '?', b: fb?.camelot || '?', d: dif,
        ia: faixa?.porqueIA ? ` (${faixa.porqueIA})` : '',
      },
    });

    const ok = await executar(tecnica, {
      m: this.#acoes(), dorme: (ms) => this.#dorme(ms),
      sai, entra, bpm: d[entra].bpmEfetivo, tempos, relogio,
      aoPasso: ({ tempo, de }) => this.dispatchEvent(new CustomEvent('progresso', { detail: { tempo, de, tecnica } })),
      aoFalar: (x) => this.#narra(x.diz, x),
      aluno: this.juntos,
      ler: this.#ler(),
    });
    if (!ok) return false;

    // arruma a casa: quem saiu volta neutro, pra entrar limpo na próxima vez
    const m = this.#acoes();
    for (const b of ['grave', 'medio', 'agudo']) { this.#kill(sai, b, false); m.eq(sai, b, 0.5); }
    // e quem ENTROU fica com as três bandas abertas — é ele que toca sozinho
    // agora. Sem isto, um gesto trocado no modo junto deixava o deck no ar sem
    // grave até o fim da música
    for (const b of ['grave', 'medio', 'agudo']) this.#kill(entra, b, false);
    m.filtro(sai, 0); m.eco(sai, 0); m.fader(sai, 1);

    // o andamento volta devagar pro natural da faixa que entrou — sempre:
    // cada faixa termina no andamento DELA (ver caminharBpm). EM PARALELO:
    // esperar os 32–64 tempos antes de planejar a próxima comia o fim da
    // faixa, e a mistura longa não cabia mais (medido na simulação)
    this.#diz('bpm caminhando', { deck: entra });
    this.#narra('n.caminha', { porque: 'n.caminha.p', vars: { e: entra }, mostra: [`pitch-${entra}`] });
    const passosBpm = this.estilo === 'hipnotico' ? 64 : 32;   // hipnótico volta mais devagar
    this.caminhando = caminharBpm(d[entra], { dorme: (ms) => this.#dorme(ms), tempos: passosBpm });
    return true;
  }

  /**
   * O FIM DO SET: a última faixa toca até a última frase inteira, e aí o
   * fechamento (filtro, eco, volume descendo, freio). Antes o set "acabava"
   * quando a fila acabava — a última música seguia sozinha e parava seca.
   */
  async #fechar(id) {
    const D = this.decks[id];
    if (this.caminhando) { await this.caminhando; this.caminhando = null; }
    if (!D?.grid?.bpm) return true;
    const p = per(D);
    this.#narra('n.ultima', { porque: 'n.ultima.p', vars: { d: id } });
    const ultimas = momentos(D).filter((m) => m.t + 16 * p <= D.duration - 0.2 && m.t > D.displayPosition + 4);
    const alvo = ultimas.length ? ultimas[ultimas.length - 1].t : null;
    if (alvo == null) return true;
    const r = await this.#esperarAte(id, alvo, { tipo: 'frase', antes: 0.2 });
    if (r === 'parou') return false;
    this.pularAgora = false;
    // relógio de parede de propósito: começou no 1 da frase, e o freio no fim
    // PARA a faixa — um relógio lido da posição dela pararia junto
    return executar('final', {
      m: this.#acoes(), dorme: (ms) => this.#dorme(ms), deck: id, bpm: D.bpmEfetivo,
      aoFalar: (x) => this.#narra(x.diz, x), aluno: this.juntos, ler: this.#ler(),
    });
  }

  /** Toca a fila inteira. Volta quando acaba ou quando você assume. */
  async tocar(fila, { segundos = 8 } = {}) {
    if (this.ativo || !fila?.length) return;
    this.ativo = true; this.parar = false;
    this.fila = fila; this.indice = 0;
    const d = this.decks;
    try {
      this.#diz('carregando', { faixa: fila[0].title });
      if (!await this.carregar('A', fila[0])) throw new Error('a primeira faixa não carregou');
      this.dispatchEvent(new CustomEvent('tocou', { detail: { faixa: fila[0] } }));
      // a PRIMEIRA do set começa do começo: é a introdução que abre a noite
      d.A.seek(0);
      this.mixer.setCrossfader(0);
      d.A.play();
      this.#diz('no ar', { deck: 'A', faixa: fila[0].title });
      if (!await this.#dorme(1500)) return;

      let noAr = 'A';
      for (let i = 1; i < fila.length && !this.parar; i++) {
        this.indice = i - 1;               // a que está no ar (ver substituirProximas)
        const entra = noAr === 'A' ? 'B' : 'A';
        this.#diz('carregando', { deck: entra, faixa: fila[i].title, resta: fila.length - i });
        if (!await this.carregar(entra, fila[i])) { this.#diz('pulou', { faixa: fila[i].title }); continue; }

        // a espera pela hora certa mora dentro da transição (ver o PLANO lá):
        // ela diz o que está esperando, conta os segundos e vive a faixa
        if (!await this.transicao(noAr, entra, { faixa: fila[i], anterior: this.ultimaTecnica })) return;
        this.dispatchEvent(new CustomEvent('tocou', { detail: { faixa: fila[i] } }));
        noAr = entra;
        this.#diz('transição pronta', { noAr, resta: fila.length - i - 1 });
      }
      if (!this.parar && !await this.#fechar(noAr)) return;
      this.#diz('fim do set');
    } catch (e) {
      this.#diz('erro', { erro: e.message });
    } finally {
      this.ativo = false;
    }
  }
}
