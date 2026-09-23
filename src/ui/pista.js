/**
 * A pista — o club atrás da cabine.
 *
 * Feixes de luz varrendo, chão de LED em perspectiva, fumaça, e uma galera de
 * bolinhas dançando lá embaixo. Tudo SINCRONIZADO COM A BATIDA DE VERDADE: não
 * é um loop de animação em 120 BPM fingindo acompanhar a música. A cada quadro
 * este módulo lê a fase do deck no ar pela grade de batidas (a mesma que o
 * ENCAIXAR usa, com 0–6 ms de erro medido) e o nível real do master, e escreve
 * duas variáveis CSS:
 *
 *   --pulso    1 exatamente no bumbo, decaindo até 0 antes do próximo
 *   --energia  o quanto de som está saindo agora, suavizado (0..1)
 *   --drop     1 no instante em que a música ABRE, decaindo em ~2 s
 *   --quebra   1 durante a quebra (a música fechou), 0 no resto
 *
 * Drop e quebra vêm dos MESMOS marcadores ▲▼ que aparecem na onda (momentos
 * da faixa), então a pista explode quando a música explode — não por sorteio.
 * Sem marcador, um salto brusco de energia faz as vezes do drop.
 *
 * O mesmo estado vai em `estadoPista`, que a janela da pista (cena.js) lê.
 *
 * Duas camadas: #pista fica ATRÁS dos painéis (o club ao fundo) e #luzes fica
 * NA FRENTE — fachos coloridos cruzando a interface e os reflexos do globo
 * espelhado passando por cima de tudo, como numa cabine de verdade. A da
 * frente é fraca de propósito (10–30%) e não recebe clique: dá o clima sem
 * atrapalhar a leitura. No tema all black ela cai pra menos da metade.
 *
 * Todo o resto é CSS reagindo a essas duas variáveis. Escrever duas variáveis
 * por quadro é barato; a animação pesada (rotação dos feixes, rolagem do chão)
 * roda na GPU. E nada disso toca o áudio: o som mora no AudioWorklet, numa
 * thread à parte — se a interface engasgar, a música não engasga.
 *
 * ACESSIBILIDADE: sem clarão branco. A 128 BPM a batida vem 2,1 vezes por
 * segundo, perto do limite de 3 flashes/s em que luz piscando pode causar
 * crise em pessoas fotossensíveis. O pulso aqui é brilho suave de cor, nunca
 * estrobo. E com `prefers-reduced-motion` a pista fica parada e só respira.
 */

const CSS = `
:root { --pulso:0; --energia:0; --vel:.47s; --drop:0; --quebra:0; }
#pista { position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden; }

/* a cabine também sente a batida: o deck no ar brilha no bumbo */
.deck.no-ar { box-shadow: 0 0 calc(4px + var(--pulso) * 26px) rgba(76,201,240,calc(.15 + var(--pulso) * .45)),
                          inset 0 0 0 1px rgba(76,201,240,calc(.2 + var(--pulso) * .4)); }
.deck[data-d="B"].no-ar { box-shadow: 0 0 calc(4px + var(--pulso) * 26px) rgba(255,179,71,calc(.15 + var(--pulso) * .45)),
                                      inset 0 0 0 1px rgba(255,179,71,calc(.2 + var(--pulso) * .4)); }
/* a porta (fixa, por cima de tudo) e os diálogos ficam fora desta regra */
body > *:not(#pista):not(#porta):not(#luzes):not(dialog) { position:relative; z-index:1; }

/* fumaça: manchas de cor bem desfocadas, que respiram com a energia */
#pista .fumaca { position:absolute; inset:-20%; filter:blur(60px);
  background:
    radial-gradient(30% 25% at 20% 30%, rgba(255,78,205,.28), transparent 70%),
    radial-gradient(35% 28% at 80% 25%, rgba(76,201,240,.26), transparent 70%),
    radial-gradient(40% 30% at 50% 80%, rgba(199,125,255,.22), transparent 70%);
  opacity: calc(.35 + var(--energia) * .5);
  animation: pista-deriva 26s ease-in-out infinite alternate; }

/* feixes: quatro canhões de luz presos no teto, varrendo */
#pista .feixe { position:absolute; top:-10%; width:34vmax; height:130vh;
  transform-origin:50% 0; mix-blend-mode:screen;
  opacity: calc((.10 + var(--pulso) * .30 + var(--energia) * .20 + var(--drop) * .35) * (1 - var(--quebra) * .75));
  transition: opacity .6s;
  clip-path: polygon(46% 0, 54% 0, 100% 100%, 0 100%);
  filter: blur(2px); }
#pista .feixe.f1 { left:4%;  background:linear-gradient(180deg, rgba(255,78,205,.9), transparent 85%);
                   animation: pista-varre 7.1s ease-in-out infinite alternate; }
#pista .feixe.f2 { left:28%; background:linear-gradient(180deg, rgba(76,201,240,.9), transparent 85%);
                   animation: pista-varre 5.3s ease-in-out infinite alternate-reverse; }
#pista .feixe.f3 { left:52%; background:linear-gradient(180deg, rgba(255,179,71,.85), transparent 85%);
                   animation: pista-varre 6.4s ease-in-out infinite alternate; }
#pista .feixe.f4 { left:76%; background:linear-gradient(180deg, rgba(46,230,168,.85), transparent 85%);
                   animation: pista-varre 8.2s ease-in-out infinite alternate-reverse; }

/* chão de LED em perspectiva, rolando na velocidade do andamento */
#pista .chao { position:absolute; left:-50%; right:-50%; bottom:-2%; height:42vh;
  transform: perspective(420px) rotateX(62deg); transform-origin:50% 100%;
  background-image:
    linear-gradient(rgba(76,201,240,.55) 2px, transparent 2px),
    linear-gradient(90deg, rgba(255,78,205,.45) 2px, transparent 2px);
  background-size: 64px 64px;
  -webkit-mask: linear-gradient(to top, #000 10%, transparent 95%);
          mask: linear-gradient(to top, #000 10%, transparent 95%);
  opacity: calc(.18 + var(--pulso) * .35);
  animation: pista-rola calc(var(--vel) * 4) linear infinite; }

/* a galera: bolinhas dançando no bumbo */
#pista .galera { position:absolute; left:0; right:0; bottom:0; height:12vh;
  display:flex; justify-content:space-around; align-items:flex-end; padding:0 2vw; }
#pista .pessoa { width:clamp(14px, 2.2vw, 30px); aspect-ratio:1; border-radius:50%;
  margin-bottom:-2px; opacity:0; transition:opacity .8s;
  background: radial-gradient(circle at 35% 30%, var(--cor-p), rgba(0,0,0,.6) 80%);
  box-shadow: 0 0 calc(6px + var(--pulso) * 14px) var(--cor-p);
  transform: translateY(calc(var(--pulso) * var(--salto) * -1px)) scaleY(calc(1 - var(--pulso) * .12)); }
#pista .pessoa.ativa { opacity:.85; }

/* ── luzes NA FRENTE da interface ── */
#luzes { position:fixed; inset:0; z-index:40; pointer-events:none; overflow:hidden; --luz:1; }
:root[data-tema="black"] #luzes { --luz:.42; }
:root[data-tema="black"] #pista { opacity:.45; }
#luzes .facho { position:absolute; top:-8%; width:46vmax; height:150vh; transform-origin:50% 0;
  clip-path: polygon(47% 0, 53% 0, 100% 100%, 0 100%);
  -webkit-mask: linear-gradient(180deg, #000 0%, rgba(0,0,0,.55) 50%, transparent 92%);
          mask: linear-gradient(180deg, #000 0%, rgba(0,0,0,.55) 50%, transparent 92%);
  opacity: calc(var(--luz) * (.07 + var(--pulso) * .07 + var(--energia) * .09 + var(--drop) * .22) * (1 - var(--quebra) * .7));
  will-change: transform; }
#luzes .l1 { left:-18%; background:linear-gradient(90deg, transparent 8%, #ff4ecd 50%, transparent 92%);
             animation: luz-varre calc(var(--vel) * 16) ease-in-out infinite alternate; }
#luzes .l2 { left:18%;  background:linear-gradient(90deg, transparent 8%, #4cc9f0 50%, transparent 92%);
             animation: luz-varre calc(var(--vel) * 12) ease-in-out infinite alternate-reverse; }
#luzes .l3 { left:48%;  background:linear-gradient(90deg, transparent 8%, #c77dff 50%, transparent 92%);
             animation: luz-varre calc(var(--vel) * 20) ease-in-out infinite alternate; }
#luzes .l4 { right:-18%; background:linear-gradient(90deg, transparent 8%, #ffb347 50%, transparent 92%);
             animation: luz-varre calc(var(--vel) * 24) ease-in-out infinite alternate-reverse; }
:root[data-tema="black"] #luzes .l1 { background:linear-gradient(90deg, transparent 8%, #8e2a70 50%, transparent 92%); }
:root[data-tema="black"] #luzes .l2 { background:linear-gradient(90deg, transparent 8%, #1f6f8c 50%, transparent 92%); }
:root[data-tema="black"] #luzes .l3 { background:linear-gradient(90deg, transparent 8%, #5b3d85 50%, transparent 92%); }
:root[data-tema="black"] #luzes .l4 { background:linear-gradient(90deg, transparent 8%, #8c6124 50%, transparent 92%); }

/* reflexos do globo: pontinhos de luz andando pela tela inteira. É a camada
   que anda (transform, na GPU), não o fundo — por isso ela é mais larga que a
   tela exatamente um ladrilho, e o laço fecha sem salto */
#luzes .reflexos { position:absolute; top:0; bottom:0; left:0; width:calc(100% + 260px);
  background-image:
    radial-gradient(circle, rgba(255,255,255,.95) 0 1.6px, transparent 2.8px),
    radial-gradient(circle, rgba(76,201,240,.9) 0 1.3px, transparent 2.5px),
    radial-gradient(circle, rgba(255,78,205,.9) 0 1.5px, transparent 2.6px),
    radial-gradient(circle, rgba(255,179,71,.85) 0 1.2px, transparent 2.4px);
  background-size: 260px 190px;
  background-position: 0 0, 92px 71px, 171px 29px, 43px 133px;
  opacity: calc(var(--luz) * (.20 + var(--pulso) * .22 + var(--drop) * .3) * (1 - var(--quebra) * .35));
  animation: luz-gira 15s linear infinite; will-change: transform; }
#luzes .reflexos.r2 { width:calc(100% + 370px); background-size:370px 262px;
  background-position: 31px 52px, 204px 171px, 297px 88px, 118px 224px;
  animation: luz-gira2 23s linear infinite; }

/* o globo espelhado, pendurado no meio do topo */
#luzes .globo { position:absolute; left:50%; top:0; transform:translateX(-50%);
  display:flex; flex-direction:column; align-items:center; }
#luzes .fio { width:1px; height:5px; background:rgba(255,255,255,.4); }
#luzes .bola { width:30px; height:30px; border-radius:50%;
  background:
    radial-gradient(circle at 34% 28%, rgba(255,255,255,.95) 0 7%, transparent 24%),
    linear-gradient(90deg, rgba(10,6,20,.55) 1px, transparent 1px) 0 0 / 5px 5px,
    linear-gradient(0deg, rgba(10,6,20,.55) 1px, transparent 1px) 0 0 / 5px 5px,
    conic-gradient(from 0deg, #cfc8e6, #7b7298, #f2eefc, #5e5680, #bdb4d8, #6f6790, #cfc8e6);
  box-shadow: 0 0 calc(8px + var(--pulso) * 16px) rgba(255,255,255,calc(.18 + var(--pulso) * .3)),
              0 0 26px rgba(199,125,255,calc(.25 * var(--luz)));
  animation: globo-gira 1.4s linear infinite; }
:root[data-tema="black"] #luzes .bola { filter:brightness(.7) saturate(.6); }

@keyframes luz-gira  { to { transform: translateX(-260px) } }
@keyframes luz-gira2 { to { transform: translateX(-370px) } }
@keyframes globo-gira { to { background-position: 0 0, 5px 0, 0 0, 0 0; } }
@keyframes luz-varre { from { transform: rotate(-32deg) } to { transform: rotate(32deg) } }
@media (max-width:700px) { #luzes .globo { display:none; } }

@keyframes pista-varre { from { transform: rotate(-24deg) } to { transform: rotate(24deg) } }
@keyframes pista-rola  { from { background-position: 0 0 } to { background-position: 0 64px } }
@keyframes pista-deriva { from { transform: translate(-3%, -2%) scale(1) } to { transform: translate(3%, 2%) scale(1.08) } }

@media (prefers-reduced-motion: reduce) {
  #pista .feixe, #pista .chao, #pista .fumaca { animation:none !important; }
  #pista .pessoa { transform:none !important; }
  #luzes .facho, #luzes .reflexos, #luzes .bola { animation:none !important; }
}
`;

const CORES = ['#ff4ecd', '#4cc9f0', '#ffb347', '#2ee6a8', '#c77dff'];

/** O estado da pista a cada quadro. Só leitura pra quem não é este módulo. */
export const estadoPista = {
  pulso: 0, energia: 0, bpm: 0, tocando: false,
  batida: 0,          // tempos desde a âncora da grade (fracionário)
  drop: -1e9,         // performance.now() do último drop
  dropV: 0,           // 1 no drop, decaindo
  quebra: false,
  reduzido: false,
};

/**
 * @param {object} dep
 * @param {function} dep.deckNoAr  devolve o Deck que está soando mais, ou null
 * @param {function} dep.nivel     nível do master agora, 0..1
 * @param {function} [dep.momentos] (id) => marcadores da faixa no deck
 */
export function montarPista({ deckNoAr, nivel, momentos = () => [] }) {
  if (document.getElementById('pista')) return;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  const el = document.createElement('div');
  el.id = 'pista';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="fumaca"></div>' +
    '<div class="feixe f1"></div><div class="feixe f2"></div><div class="feixe f3"></div><div class="feixe f4"></div>' +
    '<div class="chao"></div><div class="galera"></div>';
  document.body.prepend(el);

  const luzes = document.createElement('div');
  luzes.id = 'luzes';
  luzes.setAttribute('aria-hidden', 'true');
  luzes.innerHTML = '<div class="reflexos"></div><div class="reflexos r2"></div>' +
    '<div class="facho l1"></div><div class="facho l2"></div><div class="facho l3"></div><div class="facho l4"></div>' +
    '<div class="globo"><i class="fio"></i><div class="bola"></div></div>';
  document.body.appendChild(luzes);

  // a galera: cada pessoa com cor e altura de pulo próprias, pra não parecer
  // um exército marchando
  const galera = el.querySelector('.galera');
  const pessoas = [];
  for (let i = 0; i < 22; i++) {
    const p = document.createElement('div');
    p.className = 'pessoa';
    p.style.setProperty('--cor-p', CORES[i % CORES.length]);
    p.style.setProperty('--salto', String(8 + Math.round(Math.random() * 16)));
    galera.appendChild(p);
    pessoas.push(p);
  }
  // embaralha a ordem em que as pessoas chegam na pista
  const chegada = pessoas.map((_, i) => i).sort(() => Math.random() - 0.5);

  let energia = 0, bpmAntes = 0, quantasAntes = -1, deckAntes = null;
  const raiz = document.documentElement;
  const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const E = estadoPista;
  E.reduzido = reduzido;
  let posAntes = 0, idAntes = null, lento = 0, quebraAte = -1, quebraAntes = null;

  const marcarDrop = () => {
    E.drop = performance.now();
    E.quebra = false; quebraAte = -1;
  };

  function quadro() {
    requestAnimationFrame(quadro);
    const d = deckNoAr();
    let pulso = 0;
    if (d?.tocando && d.grid?.bpm) {
      // fase no tempo pela GRADE: 0 exatamente no bumbo
      const per = 60 / d.grid.bpm;
      E.batida = (d.displayPosition - d.grid.ancora) / per;
      const f = ((E.batida % 1) + 1) % 1;
      if (!reduzido) pulso = Math.exp(-f * 5);            // pico no bumbo, decaindo rápido
      const bpm = Math.round(d.bpmEfetivo || d.grid.bpm);
      if (bpm !== bpmAntes) { bpmAntes = bpm; raiz.style.setProperty('--vel', (60 / bpm).toFixed(3) + 's'); }
    }
    // energia suavizada: sobe rápido, desce devagar — como um VU
    const n = Math.min(1, (nivel() || 0) * 3.2);
    energia += (n > energia ? 0.25 : 0.03) * (n - energia);
    raiz.style.setProperty('--pulso', pulso.toFixed(3));
    raiz.style.setProperty('--energia', energia.toFixed(3));

    // drop e quebra: o deck no ar passou por cima de um marcador neste quadro?
    // (salto grande de posição = seek ou troca de faixa, não conta)
    const pos = d?.displayPosition ?? 0;
    if (d?.tocando && d.id === idAntes && pos > posAntes && pos - posAntes < 0.5) {
      for (const m of momentos(d.id) || []) {
        if (m.t <= posAntes || m.t > pos) continue;
        if (m.tipo === 'drop') marcarDrop();
        else if (m.tipo === 'quebra') { E.quebra = true; quebraAte = E.batida + 32; }
      }
    }
    posAntes = pos; idAntes = d?.tocando ? d.id : null;
    // sem marcador: energia subindo de repente também é drop
    lento += 0.012 * (energia - lento);
    if (energia - lento > 0.28 && energia > 0.55 && performance.now() - E.drop > 8000) marcarDrop();
    if (E.quebra && (E.batida > quebraAte || !d?.tocando)) E.quebra = false;

    E.dropV = reduzido ? 0 : Math.exp(-(performance.now() - E.drop) / 900);
    raiz.style.setProperty('--drop', E.dropV.toFixed(3));
    if (E.quebra !== quebraAntes) { quebraAntes = E.quebra; raiz.style.setProperty('--quebra', E.quebra ? '1' : '0'); }
    E.pulso = pulso; E.energia = energia; E.tocando = !!d?.tocando;
    E.bpm = d?.tocando ? (d.bpmEfetivo || d.grid?.bpm || 0) : 0;

    // marca qual deck está no ar, pra ele brilhar no bumbo
    const id = d?.tocando ? d.id : null;
    if (id !== deckAntes) {
      deckAntes = id;
      for (const x of document.querySelectorAll('.deck')) x.classList.toggle('no-ar', x.dataset.d === id);
    }

    // mais energia, mais gente dançando — a pista enche com o som
    const quantas = d?.tocando ? Math.round(4 + energia * 18) : 0;
    if (quantas !== quantasAntes) {
      quantasAntes = quantas;
      chegada.forEach((idx, k) => pessoas[idx].classList.toggle('ativa', k < quantas));
    }
  }
  requestAnimationFrame(quadro);
}
