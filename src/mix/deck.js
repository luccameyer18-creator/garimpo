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

/** Picos min/max por bin, pra desenhar forma de onda sem guardar o PCM. */
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
  return { min, max, rms, binsPorSegundo };
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
    this.estado = 'vazio';      // vazio | carregando | pronto | erro
    this.erro = null;
    this.progresso = 0;
    this._abort = null;
    this.passos = [];
    this._t0 = 0;
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
  get bpmEfetivo() { return this.faixa?.bpm ? this.faixa.bpm * this.nominalRate : null; }

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
  async carregarArquivo(file) {
    return this.#carregar(
      { source: 'local', title: file.name.replace(/\.[^.]+$/, ''), artist: 'arquivo local', file },
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

  async #carregar(faixa, buscar) {
    this._abort?.abort();
    const ac = new AbortController();
    this._abort = ac;

    this.faixa = faixa;
    this.picos = null;
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

      // troca pelo arquivo inteiro quando ele chegar, sem interromper o som
      if (res.completo) {
        res.completo.then(async (todo) => {
          if (ac.signal.aborted) return;
          const cheio = await this.ctx.decodeAudioData(todo);
          if (ac.signal.aborted) return;
          const posAntes = this.transport.position;
          const tocava = this.transport.playing;
          await this.transport.load(cheio);
          this.picos = calcularPicos(cheio);
          this.transport.seek(posAntes);
          if (tocava) { this.transport.playing = false; this.transport.play(); }
          this.parcial = false;
          this.dispatchEvent(new CustomEvent('loaded', {
            detail: { faixa, duration: cheio.duration, parcial: false, trocado: true },
          }));
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

  // ─────────────────────────── controles ───────────────────────────

  play() { this.transport.play(); }
  pause(opts) { this.transport.pause(opts); }
  alternar() { this.tocando ? this.pause() : this.play(); }
  seek(pos) { this.transport.seek(pos); }
  setPitch(f) { this.transport.setPitch(f); }
  setPitchRange(r) { this.transport.setPitchRange(r); }
  setKeylock(on) { this.transport.setKeylock(on); }
  setCuePoint(p) { this.transport.setCuePoint(p); }
  cuePress() { this.transport.cuePress(); }
  cueRelease() { this.transport.cueRelease(); }
  touchStart() { this.transport.touchStart(); }
  setScratchRate(r) { this.transport.setScratchRate(r); }
  touchEnd() { this.transport.touchEnd(); }
  setLoop(o) { this.transport.setLoop(o); }
  clearLoop() { this.transport.clearLoop(); }
  get cuePoint() { return this.transport?.cuePoint ?? 0; }
}
