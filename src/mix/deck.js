/**
 * Deck — a fachada que a interface conhece.
 *
 * A UI NUNCA toca no AudioContext, nunca agenda nada e nunca calcula posição.
 * Ela pede coisas ao Deck e escuta eventos. Isso é o que vai permitir, mais pra
 * frente, o professor ser apenas mais um cliente desta mesma API — sem caminho
 * privilegiado, e com os controles fantasma saindo de graça.
 *
 * Eventos: loading · loaded · error · playing · rate · keylock · position ·
 *          analysis · glitch
 */

import { Transport } from '../audio/transport.js';
import { resolveStreamUrl, urlAquecida } from '../sources/audius.js';
import { urlDoStream, tomarAquecida, comecar as comecarHearthis } from '../sources/hearthis.js';
import { analisar } from '../analysis/analyze.js';

/**
 * Picos min/max por bin, pra desenhar forma de onda sem guardar o PCM — e a
 * energia de cada BANDA (grave, médio, agudo), pra onda colorida por
 * frequência, como a de uma CDJ.
 *
 * As bandas saem de dois passa-baixas de 2 polos (200 Hz e 2,5 kHz) sobre o
 * mono: grave = abaixo de 200, médio = entre um e outro, agudo = o resto.
 * Filtro simples de propósito: é pra COLORIR, não pra medir; custa ~100 ms
 * por música, uma vez. `ref*` é o percentil 98 de cada banda na faixa — a
 * onda normaliza por ele, então uma faixa sem grave nenhum não pinta azul só
 * porque o grave dela é "o maior que ela tem".
 */
export function calcularPicos(buffer, binsPorSegundo = 100) {
  const canais = Math.min(2, buffer.numberOfChannels);
  const total = Math.max(1, Math.floor(buffer.duration * binsPorSegundo));
  const porBin = Math.floor(buffer.length / total);
  const min = new Float32Array(total);
  const max = new Float32Array(total);
  const rms = new Float32Array(total);

  for (let b = 0; b < total; b++) {
    const ini = b * porBin;
    const fim = Math.min(ini + porBin, buffer.length);
    let lo = 0, hi = 0, soma = 0, n = 0;
    for (let c = 0; c < canais; c++) {
      const d = buffer.getChannelData(c);
      for (let i = ini; i < fim; i++) {
        const v = d[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        soma += v * v; n++;
      }
    }
    min[b] = lo; max[b] = hi; rms[b] = Math.sqrt(soma / Math.max(n, 1));
  }

  // bandas, sobre o mono
  const esq = buffer.getChannelData(0), dir = canais > 1 ? buffer.getChannelData(1) : esq;
  const coef = (fc) => 1 - Math.exp(-2 * Math.PI * fc / buffer.sampleRate);
  const kG = coef(200), kM = coef(2500);
  const grave = new Float32Array(total), medio = new Float32Array(total), agudo = new Float32Array(total);
  let g1 = 0, g2 = 0, m1 = 0, m2 = 0;
  for (let b = 0; b < total; b++) {
    const ini = b * porBin, fim = Math.min(ini + porBin, buffer.length);
    let sg = 0, sm = 0, sa = 0;
    for (let i = ini; i < fim; i++) {
      const x = (esq[i] + dir[i]) * 0.5;
      g1 += kG * (x - g1); g2 += kG * (g1 - g2);
      m1 += kM * (x - m1); m2 += kM * (m1 - m2);
      const md = m2 - g2, ag = x - m2;
      sg += g2 * g2; sm += md * md; sa += ag * ag;
    }
    const nn = Math.max(1, fim - ini);
    grave[b] = Math.sqrt(sg / nn); medio[b] = Math.sqrt(sm / nn); agudo[b] = Math.sqrt(sa / nn);
  }
  const p98 = (arr) => {
    const c = Float32Array.from(arr).sort();
    return c[Math.floor(c.length * 0.98)] || 1e-6;
  };
  return { min, max, rms, grave, medio, agudo,
           refG: p98(grave), refM: p98(medio), refA: p98(agudo), binsPorSegundo };
}

export class Deck extends EventTarget {
  constructor(id, ctx, { destination }) {
    super();
    this.id = id;
    this.ctx = ctx;
    this.destination = destination;
    this.transport = null;
    this.faixa = null;
    this.picos = null;
    this.onset = null;
    this.loopTempos = 0;
    this.estado = 'vazio';      // vazio | carregando | pronto | erro
    this.erro = null;
    this.progresso = 0;
    this._abort = null;
    this.passos = [];
    this._t0 = 0;
    this.analise = null;
    this.grid = null;
  }

  async init() {
    this.transport = await Transport.create(this.ctx, { destination: this.destination });
    for (const ev of ['playing', 'rate', 'keylock', 'glitch', 'keylockFalhou']) {
      this.transport.addEventListener(ev, (e) =>
        this.dispatchEvent(new CustomEvent(ev, { detail: e.detail })));
    }
    return this;
  }

  get temKeylock() { return !!this.transport?.stretch; }
  get tocando() { return !!this.transport?.playing; }
  get position() { return this.transport?.position ?? 0; }
  get displayPosition() { return this.transport?.displayPosition ?? 0; }
  get duration() { return this.transport?.duration ?? 0; }
  get pitch() { return this.transport?.pitch ?? 0; }
  get nominalRate() { return this.transport?.nominalRate ?? 1; }
  get keylockAtivo() { return !!this.transport?.keylockAtivo; }
  get keylockPedido() { return !!this.transport?.keylockPedido; }

  /**
   * A faixa está INTEIRA e ANALISADA — o único "pronto" que vale pra tocar
   * uma transição automática.
   *
   * Existia uma checagem espalhada (parcial, picos, onset, grade, cobertura do
   * envelope) repetida em três lugares, e cada lugar esquecia um pedaço. Um
   * getter só, e todo mundo pergunta a mesma coisa.
   */
  get pronta() {
    return this.estado !== 'erro' && !this.parcial && this.analiseCompleta && !!this.grid?.bpm;
  }
  /**
   * O andamento NATURAL da faixa: o que a análise mediu na grade de batidas,
   * e só na falta dela o do Audius. O do Audius é detectado por máquina e
   * arredondado (100 onde a música tem 101,6): sincronizar por ele deixava as
   * batidas escorregando, e o SYNC "não acertava o BPM da música".
   */
  get bpmNatural() { return this.grid?.bpm || this.faixa?.bpm || null; }
  get bpmEfetivo() { const b = this.bpmNatural; return b ? b * this.nominalRate : null; }

  /** Rastro de passos: sem console no celular, e a unica forma de saber onde travou. */
  #passo(nome, detalhe) {
    this.passos.push({ nome, detalhe, ms: Math.round(performance.now() - this._t0) });
    this.dispatchEvent(new CustomEvent('passo', { detail: { nome, detalhe, passos: this.passos } }));
  }

  #estado(e, extra = {}) {
    this.estado = e;
    this.dispatchEvent(new CustomEvent('loading', { detail: { estado: e, ...extra } }));
  }

  // ─────────────────────────── carga ───────────────────────────

  /** Arquivo local: File do input ou do drag-and-drop. */
  async carregarArquivo(file, dados = {}) {
    return this.#carregar(
      { source: 'local', title: file.name.replace(/\.[^.]+$/, ''), artist: 'arquivo local', ...dados, file },
      async () => file.arrayBuffer()
    );
  }

  /**
   * Faixa do Audius. Resolve a URL pelo caminho no_redirect (o único que
   * sobrevive a CORS — ver ACHADOS.md item 1) e busca o prefixo primeiro:
   * 2 MB rendem ~52 s de áudio e deixam o deck tocável ~640 ms antes.
   */
  async carregarAudius(faixa) {
    return this.#carregar(faixa, async (sinal, aoProgredir) => {
      // Usa a URL ja aquecida no hover, se houver: economiza o resolve (723 ms)
      // e o DNS+TLS do validator (~1.8 s com conexao fria).
      //
      // MAS: no celular nao existe hover. O pointerenter dispara junto com o
      // toque, e o clique logo em seguida reaproveita a MESMA promessa. Se o
      // aquecimento falhou, o clique herdava a falha sem nunca tentar de novo.
      // Por isso o fallback explicito aqui.
      let url;
      try {
        const quente = urlAquecida(faixa.id);
        url = quente ? await quente : await resolveStreamUrl(faixa.id, { signal: sinal });
      } catch (e) {
        if (sinal.aborted) throw e;
        url = await resolveStreamUrl(faixa.id, { signal: sinal });
      }
      this.#passo('url resolvida', new URL(url).host);
      const PREFIXO = 2 << 20;

      const r = await fetch(url, { headers: { Range: `bytes=0-${PREFIXO - 1}` }, signal: sinal });
      if (!r.ok && r.status !== 206) throw new Error(`stream respondeu ${r.status}`);
      this.#passo('resposta do stream', r.status + (r.redirected ? ' (redirecionou)' : ''));
      const prefixo = await r.arrayBuffer();
      this.#passo('bytes baixados', (prefixo.byteLength / 1048576).toFixed(2) + ' MB');
      const parcial = r.status === 206;
      aoProgredir?.(parcial ? 0.3 : 1);

      if (!parcial) return prefixo;          // servidor ignorou Range: já é tudo

      // devolve o prefixo pra tocar já, e o resto numa promessa
      const completo = (async () => {
        const rr = await fetch(url, { signal: sinal });
        return rr.arrayBuffer();
      })();
      return { prefixo, completo };
    });
  }

  /**
   * Faixa do hearthis. Mesmo efeito do caminho do Audius — toca com o começo
   * e troca pelo arquivo inteiro quando ele chega —, mas baixando em pedaços
   * paralelos, porque o servidor deles limita cada conexão (236 KB/s medidos).
   * O como está em hearthis.comecar().
   */
  async carregarHearthis(faixa) {
    return this.#carregar(faixa, async (sinal, aoProgredir) => {
      // o começo baixado no hover, se houver: poupa a primeira resposta lenta
      let ini = null;
      const quente = tomarAquecida(faixa);
      if (quente) {
        sinal.addEventListener('abort', () => quente.ac.abort(), { once: true });
        try { ini = await quente.promessa; } catch { ini = null; }
      }
      this.#passo('url', new URL(urlDoStream(faixa)).host + (ini ? ' (aquecida)' : ''));
      if (!ini) ini = await comecarHearthis(faixa, { signal: sinal });
      this.#passo('bytes baixados', `${(ini.prefixo.byteLength / 1048576).toFixed(2)} MB em ${ini.modo}`);
      if (ini.inteiro) return ini.prefixo;   // arquivo menor que o prefixo: já é tudo
      aoProgredir?.(0.3);
      return { prefixo: ini.prefixo, completo: ini.resto(sinal) };
    });
  }

  async #carregar(faixa, buscar) {
    this._abort?.abort();
    const ac = new AbortController();
    this._abort = ac;

    this.faixa = faixa;
    this.picos = null;
    /**
     * Zera TUDO que descreve a faixa anterior, na hora — não só os picos.
     *
     * Grade, envelope e `parcial` ficavam com os valores da faixa velha até a
     * nova terminar de carregar. Quem perguntava "o deck está pronto?" logo
     * depois de pedir a faixa ouvia SIM, com os dados da faixa errada. O piloto
     * seguia, começava a transição com a nova carregando só o prefixo de 52 s,
     * e ela parava exatamente nos 52 s. Medido: deck parado em 52,3 s numa
     * faixa de 160 s.
     */
    this.grid = null;
    this.onset = null;
    this.parcial = true;
    this.analiseCompleta = false;
    this.erro = null;
    this.progresso = 0;
    this.passos = [];
    this._t0 = performance.now();
    this.#passo('inicio', faixa.source || 'local');
    this.#estado('carregando', { faixa });

    try {
      const res = await buscar(ac.signal, (p) => {
        this.progresso = p;
        this.dispatchEvent(new CustomEvent('loading', { detail: { estado: 'carregando', progresso: p, faixa } }));
      });
      if (ac.signal.aborted) return;

      const primeiro = res.prefixo ?? res;
      // byteLength ANTES do decode: decodeAudioData desanexa o ArrayBuffer
      const bytes = primeiro.byteLength;
      const buf = await this.ctx.decodeAudioData(primeiro.slice(0));
      if (ac.signal.aborted) return;
      this.#passo('decodificado', buf.duration.toFixed(1) + ' s');

      await this.transport.load(buf);
      this.picos = calcularPicos(buf);
      this.estado = 'pronto';
      this.parcial = !!res.completo;
      this.dispatchEvent(new CustomEvent('loaded', {
        detail: { faixa, duration: buf.duration, parcial: this.parcial, bytes },
      }));

      // Analise em segundo plano: NUNCA bloqueia o play. A faixa fica tocavel
      // primeiro e o grid chega depois — esperar a analise pra soltar o som
      // seria trocar 2 s de espera por nada.
      this.#analisar(buf, faixa, ac).then(() => {
        // sem prefixo (arquivo pequeno), esta ja e a analise da faixa inteira
        if (!ac.signal.aborted && !this.parcial) this.analiseCompleta = true;
      });

      // troca pelo arquivo inteiro quando ele chegar, sem interromper o som
      if (res.completo) {
        res.completo.then(async (todo) => {
          if (ac.signal.aborted) return;
          const cheio = await this.ctx.decodeAudioData(todo);
          if (ac.signal.aborted) return;
          const posAntes = this.transport.position;
          const tocava = this.transport.playing;
          await this.transport.load(cheio);
          // RESTAURA A POSICAO ANTES de calcular picos, nao depois.
          // calcularPicos varre 200 s de PCM e leva dezenas de ms; com ele no
          // meio, existia uma janela em que transport.duration ja era a nova e
          // a posicao ainda nao tinha voltado — um seek do usuario (ou um hot
          // cue) nessa fresta era apagado pelo seek(posAntes) logo depois.
          // Peguei isso no meu proprio teste: o deck ignorou um seek pra 68 s e
          // comecou do zero.
          this.transport.seek(posAntes);
          if (tocava) { this.transport.playing = false; this.transport.play(); }
          this.parcial = false;
          this.picos = calcularPicos(cheio);
          this.dispatchEvent(new CustomEvent('loaded', {
            detail: { faixa, duration: cheio.duration, parcial: false, trocado: true },
          }));

          /**
           * RE-ANALISA no arquivo inteiro.
           *
           * Faltava, e o preco era alto: a grade de batida e o envelope de
           * ataque saiam dos primeiros 52 s — o prefixo que o deck carrega pra
           * tocar rapido. Ou seja, a musica toda era julgada pela INTRODUCAO,
           * que e justamente onde a batida costuma nao estar definida.
           *
           * Peguei isso medindo fase no meio da faixa: o envelope tinha 4909
           * quadros (52 s) numa faixa de 201 s, e a medicao simplesmente nao
           * tinha dado pra ler. Custa uma passada de worker em segundo plano.
           */
          this.#analisar(cheio, faixa, ac).then(() => {
            if (!ac.signal.aborted) this.analiseCompleta = true;
          });
        }).catch((e) => {
          if (!ac.signal.aborted) console.warn('[deck] troca pelo completo falhou:', e.message);
        });
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      this.estado = 'erro';
      this.erro = e.message;
      // falha de rede no Audius é frequente (1 em 3 mesmo com retry): a UI
      // precisa mostrar e oferecer nova tentativa, nunca falhar em silêncio
      this.#passo('FALHOU', e.message);
      this.dispatchEvent(new CustomEvent('error', { detail: { erro: e.message, faixa, passos: this.passos } }));
    }
  }

  /**
   * Detecta BPM, ancora do grid e tom. Em faixa do Audius o BPM ja vem do
   * metadata, entao passamos como conhecido: a analise serve pra achar a
   * ANCORA (que o metadata nao da e o SYNC precisa) e pra confirmar, nao pra
   * discordar.
   */
  async #analisar(buf, faixa, ac) {
    try {
      const r = await analisar(buf, { genero: faixa.genre, bpmConhecido: faixa.bpm || null });
      if (ac.signal.aborted) return;
      this.analise = r;
      // RECONCILIACAO DE OITAVA.
      // O BPM do Audius e detectado por maquina (is_custom_bpm = 0 em 100/100
      // da amostra) e erra oitava com frequencia — vi techno marcado como 64.9
      // e house como 234. Antes eu dava prioridade cega ao metadata, e o "BPM
      // efetivo" saia dobrado em faixa nenhuma.
      //
      // Regra: se a analise local discorda por um FATOR DE 2 (ou 1/2), a
      // analise ganha — ela varreu 70-190 e arredondou com a janela do genero,
      // enquanto o metadata nao passou por nenhum dos dois. Discordancia
      // pequena (afinacao) mantem o metadata, que costuma ser mais preciso.
      if (r.bpm) {
        if (!faixa.bpm) {
          faixa.bpm = r.bpm;
        } else {
          const razao = faixa.bpm / r.bpm;
          const ehOitava = Math.abs(razao - 2) < 0.12 || Math.abs(razao - 0.5) < 0.06;
          if (ehOitava) {
            this.#passo('bpm corrigido', `metadata dizia ${faixa.bpm}, analise diz ${r.bpm}`);
            faixa.bpmMetadata = faixa.bpm;
            faixa.bpm = r.bpm;
          }
        }
      }
      if (!faixa.camelot && r.camelot) { faixa.camelot = r.camelot; faixa.key = r.tom; }
      // guarda o ganho medido NA FAIXA tambem: o canal ja recebeu, mas sem isto
      // quem le a faixa depois (fila, diagnostico, log) ve `trimDb: undefined`
      if (typeof r.trimDb === 'number') { faixa.trimDb = r.trimDb; faixa.volumeDb = r.volumeDb; }
      this.grid = r.bpm ? { bpm: r.bpm, ancora: r.ancora } : null;
      // envelope de ataque em ~86 Hz: e com ele que se mede fase de verdade
      this.onset = r.onset ? { v: r.onset, taxa: r.taxaOnset } : null;
      this.#passo('analisado', `${r.bpm} BPM, ${r.camelot}, ancora ${r.ancora}s`);
      this.dispatchEvent(new CustomEvent('analysis', { detail: { faixa, ...r } }));
    } catch (e) {
      if (!ac.signal.aborted) console.warn('[deck] analise falhou:', e.message);
    }
  }

  // ─────────────────────────── controles ───────────────────────────

  // sem faixa não há o que tocar: PLAY num deck vazio deixava ele "tocando" e a
  // pista, o mascote e o professor achavam que havia música
  play() { if (this.faixa) this.transport.play(); }
  pause(opts) { this.transport.pause(opts); }
  alternar() { this.tocando ? this.pause() : this.play(); }
  seek(pos) { this.transport.seek(pos); }
  setPitch(f) { this.transport.setPitch(f); }
  setPitchRange(r) { this.transport.setPitchRange(r); }
  setKeylock(on) { this.transport.setKeylock(on); }
  setCuePoint(p) { this.transport.setCuePoint(p); }
  cuePress() { this.transport.cuePress(); }
  cueRelease() { this.transport.cueRelease(); }
  deslocar(delta, o) { return this.transport.deslocar(delta, o); }
  touchStart() { this.transport.touchStart(); }
  setScratchRate(r) { this.transport.setScratchRate(r); }
  touchEnd() { this.transport.touchEnd(); }
  setLoop(o) { this.transport.setLoop(o); }
  clearLoop() { this.loopTempos = 0; this.transport.clearLoop(); }

  /**
   * Loop de N TEMPOS a partir da próxima batida.
   *
   * O transporte fala em segundos, mas ninguém pede "um loop de 1,846 s" — se
   * pede 4 tempos. A conversão exige a grade, e o começo tem que cair EM CIMA
   * de uma batida: um loop que começa no meio do tempo transforma a música em
   * outra coisa a cada volta.
   *
   * Começa na próxima batida e não na atual porque a atual já passou: emendar
   * no passado obrigaria a saltar pra trás, e salto se ouve.
   *
   * @param {number} tempos 1, 2, 4, 8, 16, 32…
   * @returns {boolean} false se a faixa não tem grade
   */
  loopDeTempos(tempos) {
    const g = this.grid;
    if (!g?.bpm || !tempos) return false;
    const periodo = 60 / g.bpm;
    const pos = this.position;
    const n = Math.ceil((pos - g.ancora) / periodo + 0.02);   // próxima batida
    const start = g.ancora + n * periodo;
    this.loopTempos = tempos;
    this.transport.setLoop({ start, end: start + tempos * periodo, on: true });
    this.dispatchEvent(new CustomEvent('loop', { detail: { tempos, start, on: true } }));
    return true;
  }

  /** Dobra ou divide o loop em curso, ancorado no mesmo começo. */
  loopDobrar(fator) {
    if (!this.loopTempos) return false;
    const novo = Math.max(1, Math.min(32, this.loopTempos * fator));
    return this.loopDeTempos(novo);
  }
  get cuePoint() { return this.transport?.cuePoint ?? 0; }
}
