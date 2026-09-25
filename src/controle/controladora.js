/**
 * A controladora de DJ de verdade, plugada no Garimpo.
 *
 * Plugou uma DDJ-FLX4, uma Inpulse, uma Mixtrack: o Garimpo reconhece pelo
 * nome, baixa o mapeamento que a comunidade do Mixxx escreveu pra ela e a
 * partir daí o knob de plástico e o da tela são o mesmo knob. Tira do USB, ele
 * percebe; pluga de novo, volta sozinho.
 *
 * Três peças (ver cada arquivo):
 *   motor.js   roda o mapeamento do Mixxx: mensagens, scripts, LEDs, scratch
 *   ponte.js   traduz cada controle do Mixxx pro método que a mão chamaria
 *   mapa.js    baixa e lê o mapeamento
 *
 * Este arquivo é a costura com a tela: o botão 🎛, o painel, a "sala" onde os
 * scripts do Mixxx rodam, os fantasmas dos knobs e o que o Garimpeiro diz.
 * Tudo o que ele mexe na página é criado aqui (estilo, botão, painel) pra
 * que a controladora seja uma peça só, que entra e sai sem espalhar nada.
 */

import { criarMotor } from './motor.js';
import { criarPonte } from './ponte.js';
import { carregarMapa, MIXXX_VERSAO } from './mapa.js';
import { acharMapa, limparNome } from './catalogo.js';
import { temMidi, licenca, pedirAcesso, aparelhos, ouvirVirtual } from './midi.js';
import { tc, nomeDoControle } from './textos.js';

const CSS = `
  .topo .ic.ctl-b { position:relative; }
  .ctl-b .ctl-luz { position:absolute; right:3px; top:4px; width:6px; height:6px; border-radius:50%;
                    background:var(--fraco); opacity:0; transition:opacity .3s; }
  .ctl-b.ligada .ctl-luz { background:var(--ok); opacity:1; }
  .ctl-b.pisca .ctl-luz { opacity:.35; }
  .ctl-b.erro .ctl-luz { background:var(--bad); opacity:1; }
  .ctl-b.procurando .ctl-luz { background:var(--cue); opacity:1; }
  #ctl-painel .ctl-lista { list-style:none; padding:0; margin:12px 0 0; display:flex; flex-direction:column; gap:8px; }
  #ctl-painel .ctl-lista li { background:var(--fundo-tela); border:1px solid var(--linha); border-radius:10px;
                              padding:9px 11px; display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; }
  #ctl-painel .ctl-nome { font-weight:700; }
  #ctl-painel .ctl-tag { font:10px ui-monospace,monospace; padding:2px 7px; border-radius:20px;
                         border:1px solid var(--linha); color:var(--mut); }
  #ctl-painel .ctl-tag.ligada { color:var(--ok); border-color:var(--ok); }
  #ctl-painel .ctl-tag.erro { color:var(--bad); border-color:var(--bad); }
  #ctl-painel .ctl-tag.carregando { color:var(--cue); border-color:var(--cue); }
  #ctl-painel .ctl-det { flex-basis:100%; color:var(--mut); font-size:11.5px; line-height:1.45; }
  #ctl-painel .ctl-det b { color:var(--fg); font-weight:600; }
  #ctl-painel li button { margin-left:auto; padding:3px 9px; font-size:11px; }
  #ctl-painel .ctl-ligar { margin-top:14px; width:100%; padding:11px; }
  #ctl-painel .ctl-nota { color:var(--mut); font-size:12px; margin-top:14px; }
  #ctl-painel .ctl-fonte { color:var(--fraco); font-size:11px; margin-top:8px; }
  #ctl-painel .ctl-fonte a { color:var(--mut); }
  /* o fantasma: onde está o knob de plástico quando o som está em outro lugar.
     Só opacidade e transform mudam (a regra de desempenho da pista). */
  .ctl-tem-fantasma { position:relative; }
  .ctl-fantasma { position:absolute; left:0; top:0; width:15px; height:15px; margin:-7.5px 0 0 -7.5px;
                  border-radius:50%; border:2px solid var(--cue); pointer-events:none; opacity:0;
                  transition:opacity .25s; z-index:2; }
  .ctl-fantasma.longe { opacity:.5; }
  .ctl-fantasma.longe.recente { opacity:1; animation:ctl-pulsa .9s ease-in-out infinite; }
  @keyframes ctl-pulsa { 50% { opacity:.4; } }
  /* o cursor do BROWSE da controladora na lista de músicas */
  #lista .item.ctl-cursor { outline:2px solid var(--cue); outline-offset:-2px; border-radius:8px; }
`;

/**
 * A sala: um iframe invisível, da mesma origem, onde os scripts do Mixxx rodam
 * como scripts clássicos (é o que eles esperam: `var` no topo vira global, e
 * um arquivo enxerga o outro). As globais deles (`script`, `Deck`, `print`…)
 * ficam lá dentro e somem com o iframe.
 */
function criarSala() {
  const f = document.createElement('iframe');
  f.title = 'mixxx';
  f.tabIndex = -1;
  f.setAttribute('aria-hidden', 'true');
  f.style.display = 'none';
  document.body.appendChild(f);
  const w = f.contentWindow, doc = f.contentDocument;
  return {
    global: w,
    carregar(texto, nome) {
      let erro = null;
      const pega = (ev) => { erro = ev.error || new Error(ev.message); ev.preventDefault(); };
      w.addEventListener('error', pega);
      const s = doc.createElement('script');
      s.textContent = texto + '\n//# sourceURL=mixxx/' + nome;
      (doc.head || doc.documentElement).appendChild(s);
      w.removeEventListener('error', pega);
      if (erro) throw erro;
    },
    avaliar: (expr) => w.eval(expr),
    destruir() { f.remove(); },
  };
}

const prender = (x, a, b) => Math.max(a, Math.min(b, x));

/**
 * @param {object} api  o que a controladora precisa do Garimpo (montado no app.js)
 * @param {object} api.g        deck, mixer, pads, gesto, sincronizar… (ver ponte.js)
 * @param {object} api.gaveta   { abrir(on), aberta(), alvo(), deckLivre() }
 * @param {function} api.avisar ({fala, porque, apontar, cor, ms}) — o Garimpeiro fala
 * @param {function} api.mascote () => o mascote (comemora, fala)
 */
export function montarControladora(api) {
  if (!document.getElementById('ctl-css')) {
    const st = document.createElement('style');
    st.id = 'ctl-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ── o botão, ao lado dos outros ícones da barra ──
  const botao = document.createElement('button');
  botao.className = 'ic ctl-b';
  botao.id = 'b-ctl';
  botao.innerHTML = '🎛<i class="ctl-luz"></i>';
  const vizinho = document.getElementById('b-ajuda');
  if (vizinho?.parentElement) vizinho.parentElement.insertBefore(botao, vizinho);
  else document.querySelector('.topo')?.appendChild(botao);

  const painel = document.createElement('dialog');
  painel.id = 'ctl-painel';
  document.body.appendChild(painel);

  // ── estado ──
  let acesso = null, sysex = false, geral = temMidi() ? (isSecureContext ? 'parado' : 'inseguro') : 'semMidi';
  const conexoes = new Map();            // id do aparelho -> conexão
  const virtuais = new Map();
  const ignorados = new Set();           // desligada à mão: fica fora até sair do USB e voltar
  const falouDe = new Map();             // tela -> quando o Garimpeiro falou do fantasma

  // ── a biblioteca, pelo BROWSE da controladora ──
  const itens = () => [...document.querySelectorAll('#lista .item')];
  const biblioteca = {
    mover(n) {
      if (!api.gaveta.aberta()) api.gaveta.abrir(true);
      const l = itens();
      if (!l.length) return;
      const agora = l.findIndex((el) => el.classList.contains('ctl-cursor'));
      const i = agora < 0 ? (n > 0 ? 0 : l.length - 1) : prender(agora + n, 0, l.length - 1);
      if (agora >= 0) l[agora].classList.remove('ctl-cursor');
      l[i].classList.add('ctl-cursor');
      l[i].scrollIntoView({ block: 'nearest' });
      l[i].onpointerenter?.();            // já esquenta a URL, como o mouse por cima faz
    },
    carregar(id, { tocar = false } = {}) {
      const l = itens();
      const el = l.find((x) => x.classList.contains('ctl-cursor')) || l[0];
      if (!el) { if (!api.gaveta.aberta()) api.gaveta.abrir(true); return; }
      const alvo = id || api.gaveta.alvo() || api.gaveta.deckLivre();
      el.querySelector(alvo === 'A' ? '.pa' : '.pb')?.click();
      if (tocar) {
        const t0 = performance.now();
        const esperar = () => {
          const d = api.g.deck(alvo);
          if (d?.faixa && d.estado === 'pronto') { d.play(); return; }
          if (performance.now() - t0 < 20000 && d?.estado !== 'erro') setTimeout(esperar, 400);
        };
        setTimeout(esperar, 400);
      }
    },
    abrir(on = true) { api.gaveta.abrir(on); },
    aberta: () => api.gaveta.aberta(),
  };
  const g = { ...api.g, biblioteca };

  // ── ligar e desligar aparelhos ──

  function enviar(c, bytes) {
    const s = c.ap.saida;
    if (!s) return;
    // sem licença de SysEx o Chrome recusa a mensagem inteira: some em silêncio
    if (bytes[0] === 0xf0 && !sysex && !c.ap.virtual) { c.semSysex = true; return; }
    try { s.send(bytes); }
    catch (e) { if (!c.avisouEnvio) { c.avisouEnvio = true; console.warn('[controladora] envio', e); } }
  }

  async function ligar(ap) {
    const achado = acharMapa(ap.nome);
    const c = { ap, achado, estado: achado ? 'carregando' : 'desconhecida' };
    conexoes.set(ap.id, c);
    desenhar();
    if (!achado) {
      api.avisar({ fala: '🎛 ' + tc('n.desconhecida', { nome: limparNome(ap.nome) }), porque: tc('n.desconhecida.p'), cor: 'depois', ms: 8000 });
      window.garimpoEvento?.('controladora', { modelo: 'desconhecida' });
      return;
    }
    try {
      const mapa = await carregarMapa(achado.xml);
      if (conexoes.get(ap.id) !== c) return;                 // tiraram do USB enquanto baixava
      try { await ap.entrada.open?.(); } catch {}
      try { await ap.saida?.open?.(); } catch {}
      c.sala = criarSala();
      c.ponte = criarPonte(g);
      c.motor = criarMotor({
        mapa, ponte: c.ponte, sala: c.sala, dispositivo: limparNome(ap.nome),
        enviar: (b) => enviar(c, b),
        aviso: (m) => console.warn(`[controladora · ${achado.nome}]`, m),
      });
      ap.entrada.onmidimessage = (e) => c.motor.receber(e.data);
      c.estado = 'ligada';
      window.garimpoEvento?.('controladora', { modelo: achado.nome });
      api.mascote()?.comemora?.();
      api.avisar({
        fala: '🎛 ' + tc('n.ligou', { nome: achado.nome }),
        porque: tc('n.ligou.p') + (achado.obs ? ' (' + tc(achado.obs) + ')' : ''),
        cor: 'depois', ms: 9000,
      });
    } catch (e) {
      c.estado = 'erro';
      c.erro = e?.message || String(e);
      console.warn('[controladora]', e);
      c.sala?.destruir();
    }
    desenhar();
  }

  function desligar(id, { saiu = false } = {}) {
    const c = conexoes.get(id);
    if (!c) return;
    conexoes.delete(id);
    try { c.motor?.desligar(); } catch {}
    try { c.ponte?.limpar(); } catch {}
    if (c.ap.entrada) c.ap.entrada.onmidimessage = null;
    c.sala?.destruir();
    if (saiu && c.estado === 'ligada') {
      api.avisar({ fala: '🎛 ' + tc('n.saiu', { nome: c.achado?.nome || limparNome(c.ap.nome) }), cor: 'depois', ms: 5000 });
    }
    desenhar();
  }

  let pendente = null;
  function atualizar() {
    clearTimeout(pendente);
    // o statechange vem em rajada (entrada e saída, conectou e abriu): espera assentar
    pendente = setTimeout(() => {
      const lista = acesso ? aparelhos(acesso, [...virtuais.values()]) : [...virtuais.values()];
      const vivos = new Set(lista.map((a) => a.id));
      for (const id of [...conexoes.keys()]) if (!vivos.has(id)) desligar(id, { saiu: true });
      for (const id of [...ignorados]) if (!vivos.has(id)) ignorados.delete(id);
      for (const ap of lista) if (!conexoes.has(ap.id) && !ignorados.has(ap.id)) ligar(ap);
      desenhar();
    }, 150);
  }

  async function conectar() {
    if (geral === 'semMidi' || geral === 'inseguro') { desenhar(); return; }
    geral = 'pedindo';
    desenhar();
    try {
      ({ acesso, sysex } = await pedirAcesso());
    } catch {
      geral = 'negado';
      desenhar();
      return;
    }
    try { localStorage.setItem('garimpo.ctl.auto', '1'); } catch {}
    acesso.onstatechange = atualizar;
    geral = 'ok';
    atualizar();
  }

  // ── a controladora virtual (src/dev/controladora.html) entra sem licença nenhuma ──
  ouvirVirtual(
    (ap) => { virtuais.set(ap.id, ap); atualizar(); },
    (ap) => { virtuais.delete(ap.id); atualizar(); });

  // ── o painel ──

  function desenhar() {
    const ligadas = [...conexoes.values()].filter((c) => c.estado === 'ligada');
    botao.classList.toggle('ligada', ligadas.length > 0);
    botao.classList.toggle('erro', geral === 'negado' || [...conexoes.values()].some((c) => c.estado === 'erro'));
    botao.classList.toggle('procurando', geral === 'pedindo' || [...conexoes.values()].some((c) => c.estado === 'carregando'));
    botao.title = tc('botao') + (ligadas.length ? ' — ' + ligadas.map((c) => c.achado.nome).join(', ') : '');
    if (!painel.open) return;

    const msg = { semMidi: 'semMidi', inseguro: 'inseguro', pedindo: 'pedindo', negado: 'negado' }[geral];
    const itensHtml = [...conexoes.values()].map((c) => {
      const nome = c.achado?.nome || limparNome(c.ap.nome);
      const tag = { ligada: tc('ligada'), carregando: tc('carregando'), desconhecida: tc('desconhecida'), erro: 'erro' }[c.estado];
      const det = [];
      if (c.estado === 'ligada') {
        det.push(`<b>${c.achado.xml.replace('.midi.xml', '')}</b>${c.achado.jeito === 'parecido' ? ' · ' + tc('parecido') : ''}`);
        if (c.achado.obs) det.push(tc(c.achado.obs));
        if (!c.ap.saida) det.push(tc('semSaida'));
        if (c.semSysex) det.push(tc('semSysex'));
        if (c.motor?.falhas.length) det.push(tc('falhas', { n: c.motor.falhas.length }));
      }
      if (c.estado === 'erro') det.push(tc('erroMapa', { e: c.erro }));
      if (c.estado === 'desconhecida' && c.ap.nome !== nome) det.push(c.ap.nome);
      return `<li><span class="ctl-nome">${esc(nome)}</span><span class="ctl-tag ${c.estado}">${tag}</span>` +
        (c.estado === 'ligada' || c.estado === 'erro' ? `<button data-desligar="${esc(c.ap.id)}">${tc('desligar')}</button>` : '') +
        (det.length ? `<div class="ctl-det">${det.join(' · ')}</div>` : '') + '</li>';
    }).join('');

    painel.innerHTML = `
      <h3>🎛 ${tc('titulo')}</h3>
      <div class="sub">${msg ? tc(msg) : acesso ? (conexoes.size ? '' : tc('nenhuma')) : tc('explica')}</div>
      ${itensHtml ? `<ul class="ctl-lista">${itensHtml}</ul>` : ''}
      ${!acesso && temMidi() && isSecureContext && geral !== 'pedindo' ? `<button class="ctl-ligar">${tc('ligar')}</button>` : ''}
      <p class="ctl-nota">${tc('fantasmas')}</p>
      <p class="ctl-fonte">${tc('fonte', { v: MIXXX_VERSAO })}</p>
      <button class="fechar">✕</button>`;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  painel.addEventListener('click', (e) => {
    if (e.target.closest('.fechar') || e.target === painel) { painel.close(); return; }
    if (e.target.closest('.ctl-ligar')) { conectar(); return; }
    const d = e.target.closest('[data-desligar]');
    if (d) {
      ignorados.add(d.dataset.desligar);
      desligar(d.dataset.desligar);
    }
  });

  botao.addEventListener('click', () => {
    if (!painel.open) painel.showModal();
    if (!acesso && geral !== 'semMidi' && geral !== 'inseguro' && geral !== 'pedindo') conectar();
    desenhar();
  });
  window.addEventListener('idioma', desenhar);

  // reconecta sozinho quando a licença já foi dada numa visita anterior
  (async () => {
    let auto = false;
    try { auto = localStorage.getItem('garimpo.ctl.auto') === '1'; } catch {}
    if (auto && geral === 'parado' && (await licenca()) === 'granted') conectar();
    else desenhar();
  })();

  // ── o relógio da tela: fantasmas, luz de atividade e o Garimpeiro ──

  const fantasmasEl = new Map();
  function desenharFantasmas(lista) {
    const vistos = new Set();
    for (const f of lista) {
      vistos.add(f.tela);
      let x = fantasmasEl.get(f.tela);
      if (!x) {
        const input = document.getElementById(f.tela);
        if (!input?.parentElement) continue;
        const el = document.createElement('i');
        el.className = 'ctl-fantasma';
        input.parentElement.classList.add('ctl-tem-fantasma');
        input.after(el);
        x = { el, input, pos: '', cls: 'ctl-fantasma' };
        fantasmasEl.set(f.tela, x);
      }
      const inp = x.input;
      const mn = Number(inp.min || 0), mx = Number(inp.max || 1);
      const p = mx > mn ? prender((f.valor - mn) / (mx - mn), 0, 1) : 0;
      // o centro do polegar anda de meio polegar até (largura − meio polegar)
      const polegar = inp.classList.contains('xf') ? 26 : inp.closest('.knob') ? 14 : 11;
      const px = inp.offsetLeft + polegar / 2 + p * (inp.offsetWidth - polegar);
      const py = inp.offsetTop + inp.offsetHeight / 2;
      const tr = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px)`;
      if (tr !== x.pos) { x.el.style.transform = tr; x.pos = tr; }
      const cls = 'ctl-fantasma' + (f.longe ? ' longe' : '') + (f.longe && f.recente ? ' recente' : '');
      if (cls !== x.cls) { x.el.className = cls; x.cls = cls; }
    }
    for (const [tela, x] of fantasmasEl) {
      if (!vistos.has(tela) && x.cls !== 'ctl-fantasma') { x.el.className = 'ctl-fantasma'; x.cls = 'ctl-fantasma'; }
    }
  }

  setInterval(() => {
    if (!conexoes.size) return;
    const todos = [];
    let toque = false;
    for (const c of conexoes.values()) {
      if (c.estado !== 'ligada') continue;
      c.ponte.tick();
      todos.push(...c.ponte.fantasmas());
      toque = c.ponte.consumirToque() || toque;
    }
    if (document.hidden) return;
    desenharFantasmas(todos);
    botao.classList.toggle('pisca', toque);

    // mexeu num knob que não pegou: o Garimpeiro explica, uma vez por controle
    const agora = performance.now();
    const f = todos.find((x) => x.longe && x.recente && agora - (falouDe.get(x.tela) || -1e9) > 12000);
    if (f) {
      falouDe.set(f.tela, agora);
      api.avisar({
        fala: '🎛 ' + tc('n.fantasma', { ctl: nomeDoControle(f.tela) }), porque: tc('n.fantasma.p'),
        apontar: [{ id: f.tela, rotulo: '↔' }], cor: 'agora', ms: 5000,
      });
    }
  }, 100);

  desenhar();
  const vivo = { conexoes, conectar, desligar, atualizar, get acesso() { return acesso; } };
  globalThis.__controladora = vivo;
  return vivo;
}
