/**
 * A pista — o club em volta da cabine.
 *
 * Duas camadas: #pista fica ATRÁS dos painéis (fumaça colorida e canhões de
 * luz ao fundo) e #luzes fica NA FRENTE — fachos cruzando a interface, os
 * reflexos do globo espelhado passando por cima de tudo e o globo pendurado no
 * topo. A da frente é fraca de propósito e não recebe clique: dá o clima sem
 * atrapalhar a leitura. No tema all black ela cai pra menos da metade.
 *
 * SINCRONIZADO COM A BATIDA DE VERDADE: a cada quadro este módulo lê a fase do
 * deck no ar pela grade de batidas (a mesma que o ENCAIXAR usa) e o nível real
 * do master. Drop e quebra vêm dos mesmos marcadores ▲▼ da onda; sem marcador,
 * um salto brusco de energia faz as vezes do drop. O estado vai em
 * `estadoPista`, que a janela da pista (cena.js) também lê.
 *
 * DESEMPENHO — a regra que manda neste arquivo. A primeira versão escrevia
 * quatro variáveis CSS no :root a cada quadro. Variável no :root é herdada
 * pela página INTEIRA: 60 vezes por segundo o navegador recalculava o estilo
 * de todos os elementos e repintava toda sombra que dependia da batida, com
 * desfoque de vidro nos painéis por cima. Travava tudo. Agora:
 *
 *   - por quadro, só se escreve `opacity` direto em 5 camadas, e só quando
 *     muda de verdade. Opacidade e transform a placa de vídeo compõe sem
 *     repintar nada
 *   - todo movimento (varrer, girar, andar) é animação CSS de `transform`,
 *     que roda fora da thread principal
 *   - nada de filter, blur, mix-blend-mode, sombra pulsante ou
 *     background-position animado em camada grande
 *
 * ACESSIBILIDADE: sem clarão, sem estrobo — a variação de brilho é suave e
 * parcial. Com `prefers-reduced-motion` tudo fica parado.
 */

const CSS = `
#pista, #luzes { position:fixed; inset:0; pointer-events:none; overflow:hidden; contain:strict; }
#pista { z-index:0; }
#luzes { z-index:40; }
/* a porta (fixa, por cima de tudo) e os diálogos ficam fora desta regra */
body > *:not(#pista):not(#porta):not(#luzes):not(dialog) { position:relative; z-index:1; }

/* o deck no ar ganha um contorno aceso — fixo, sem pulsar (sombra que pulsa
   repinta o deck inteiro a cada quadro) */
.deck.no-ar { box-shadow: 0 0 18px rgba(76,201,240,.28), inset 0 0 0 1px rgba(76,201,240,.45); }
.deck[data-d="B"].no-ar { box-shadow: 0 0 18px rgba(255,179,71,.28), inset 0 0 0 1px rgba(255,179,71,.45); }

/* ── ATRÁS: fumaça e canhões ── */
#pista .fumaca { position:absolute; inset:-15%; will-change:transform, opacity;
  background:
    radial-gradient(30% 25% at 20% 30%, rgba(255,78,205,.22), transparent 70%),
    radial-gradient(35% 28% at 80% 25%, rgba(76,201,240,.20), transparent 70%),
    radial-gradient(40% 30% at 50% 80%, rgba(199,125,255,.18), transparent 70%);
  animation: pista-deriva 26s ease-in-out infinite alternate; }
#pista .canhoes { position:absolute; inset:0; will-change:opacity; }
/* o facho é um cone de conic-gradient: bordas macias sem clip-path nem blur */
#pista .feixe, #luzes .facho { position:absolute; top:-10%; width:120vmax; height:140vh; margin-left:-60vmax;
  transform-origin:50% 0; will-change:transform; }
#pista .feixe { opacity:.55; }
#pista .f1 { left:6%;  background:conic-gradient(from 174deg at 50% 0, transparent, rgba(255,78,205,.55) 6deg, transparent 12deg);
             animation: pista-varre 7.1s ease-in-out infinite alternate; }
#pista .f2 { left:36%; background:conic-gradient(from 174deg at 50% 0, transparent, rgba(76,201,240,.55) 6deg, transparent 12deg);
             animation: pista-varre 5.3s ease-in-out infinite alternate-reverse; }
#pista .f3 { left:64%; background:conic-gradient(from 174deg at 50% 0, transparent, rgba(255,179,71,.5) 6deg, transparent 12deg);
             animation: pista-varre 6.4s ease-in-out infinite alternate; }
#pista .f4 { left:94%; background:conic-gradient(from 174deg at 50% 0, transparent, rgba(46,230,168,.5) 6deg, transparent 12deg);
             animation: pista-varre 8.2s ease-in-out infinite alternate-reverse; }

/* ── NA FRENTE: fachos, reflexos do globo e o globo ── */
#luzes .fachos, #luzes .espelho { position:absolute; inset:0; will-change:opacity; }
#luzes .l1 { left:-4%;  background:conic-gradient(from 175deg at 50% 0, transparent, rgba(255,78,205,.8) 5deg, transparent 10deg);
             animation: luz-varre 11s ease-in-out infinite alternate; }
#luzes .l2 { left:30%;  background:conic-gradient(from 175deg at 50% 0, transparent, rgba(76,201,240,.8) 5deg, transparent 10deg);
             animation: luz-varre 8.5s ease-in-out infinite alternate-reverse; }
#luzes .l3 { left:70%;  background:conic-gradient(from 175deg at 50% 0, transparent, rgba(199,125,255,.8) 5deg, transparent 10deg);
             animation: luz-varre 13s ease-in-out infinite alternate; }
#luzes .l4 { left:104%; background:conic-gradient(from 175deg at 50% 0, transparent, rgba(255,179,71,.8) 5deg, transparent 10deg);
             animation: luz-varre 15s ease-in-out infinite alternate-reverse; }
:root[data-tema="black"] #pista { opacity:.45; }
:root[data-tema="black"] #luzes .l1 { background:conic-gradient(from 175deg at 50% 0, transparent, rgba(142,42,112,.8) 5deg, transparent 10deg); }
:root[data-tema="black"] #luzes .l2 { background:conic-gradient(from 175deg at 50% 0, transparent, rgba(31,111,140,.8) 5deg, transparent 10deg); }
:root[data-tema="black"] #luzes .l3 { background:conic-gradient(from 175deg at 50% 0, transparent, rgba(91,61,133,.8) 5deg, transparent 10deg); }
:root[data-tema="black"] #luzes .l4 { background:conic-gradient(from 175deg at 50% 0, transparent, rgba(140,97,36,.8) 5deg, transparent 10deg); }

/* reflexos do globo: pontinhos de luz andando pela tela inteira. É a camada
   que anda (transform), não o fundo — por isso ela é mais larga que a tela
   exatamente um ladrilho, e o laço fecha sem salto */
#luzes .reflexos { position:absolute; top:0; bottom:0; left:0; width:calc(100% + 260px); will-change:transform;
  background-image:
    radial-gradient(circle, rgba(255,255,255,.95) 0 1.6px, transparent 2.8px),
    radial-gradient(circle, rgba(76,201,240,.9) 0 1.3px, transparent 2.5px),
    radial-gradient(circle, rgba(255,78,205,.9) 0 1.5px, transparent 2.6px),
    radial-gradient(circle, rgba(255,179,71,.85) 0 1.2px, transparent 2.4px);
  background-size: 260px 190px;
  background-position: 0 0, 92px 71px, 171px 29px, 43px 133px;
  animation: luz-gira 15s linear infinite; }
#luzes .reflexos.r2 { width:calc(100% + 370px); background-size:370px 262px; opacity:.7;
  background-position: 31px 52px, 204px 171px, 297px 88px, 118px 224px;
  animation: luz-gira2 23s linear infinite; }

/* o globo espelhado, pendurado no meio do topo. Ele GIRA de verdade: a faixa
   de facetas por dentro anda de lado (transform), a bola só recorta */
#luzes .globo { position:absolute; left:50%; top:0; transform:translateX(-50%);
  display:flex; flex-direction:column; align-items:center; }
#luzes .fio { width:1px; height:5px; background:rgba(255,255,255,.4); }
#luzes .bola { width:30px; height:30px; border-radius:50%; overflow:hidden; position:relative;
  background:radial-gradient(circle at 50% 50%, #cfc8e6, #5e5680 75%);
  box-shadow: 0 0 14px rgba(255,255,255,.3), 0 0 26px rgba(199,125,255,.3); }
#luzes .facetas { position:absolute; top:0; left:0; width:60px; height:30px; will-change:transform;
  background:
    linear-gradient(90deg, rgba(10,6,20,.55) 1px, transparent 1px) 0 0 / 5px 5px,
    linear-gradient(0deg, rgba(10,6,20,.55) 1px, transparent 1px) 0 0 / 5px 5px,
    linear-gradient(90deg, #f2eefc, #7b7298 20%, #e6e0f6 40%, #6f6790 60%, #f2eefc 80%, #7b7298);
  animation: globo-gira 2.4s linear infinite; }
#luzes .bola::after { content:""; position:absolute; inset:0; border-radius:50%;
  background:radial-gradient(circle at 34% 28%, rgba(255,255,255,.9) 0 8%, transparent 26%),
             radial-gradient(circle at 50% 50%, transparent 55%, rgba(20,12,40,.55)); }
:root[data-tema="black"] #luzes .globo { opacity:.6; }

@keyframes luz-gira  { to { transform: translateX(-260px) } }
@keyframes luz-gira2 { to { transform: translateX(-370px) } }
@keyframes globo-gira { to { transform: translateX(-30px) } }
@keyframes luz-varre { from { transform: rotate(-30deg) } to { transform: rotate(30deg) } }
@keyframes pista-varre { from { transform: rotate(-24deg) } to { transform: rotate(24deg) } }
@keyframes pista-deriva { from { transform: translate(-3%, -2%) scale(1) } to { transform: translate(3%, 2%) scale(1.08) } }
@media (max-width:700px) { #luzes .globo { display:none; } }

@media (prefers-reduced-motion: reduce) {
  #pista *, #luzes * { animation:none !important; }
}
`;

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
  el.innerHTML = '<div class="fumaca"></div><div class="canhoes">' +
    '<div class="feixe f1"></div><div class="feixe f2"></div><div class="feixe f3"></div><div class="feixe f4"></div></div>';
  document.body.prepend(el);

  const luzes = document.createElement('div');
  luzes.id = 'luzes';
  luzes.setAttribute('aria-hidden', 'true');
  luzes.innerHTML = '<div class="espelho"><div class="reflexos"></div><div class="reflexos r2"></div></div>' +
    '<div class="fachos"><div class="facho l1"></div><div class="facho l2"></div><div class="facho l3"></div><div class="facho l4"></div></div>' +
    '<div class="globo"><i class="fio"></i><div class="bola"><div class="facetas"></div></div></div>';
  document.body.appendChild(luzes);

  /**
   * As únicas escritas por quadro: a opacidade de 4 camadas, e só quando ela
   * muda pelo menos 1%. Nada mais é tocado no DOM enquanto a música toca.
   */
  const camadas = {
    fumaca: el.querySelector('.fumaca'),
    canhoes: el.querySelector('.canhoes'),
    fachos: luzes.querySelector('.fachos'),
    espelho: luzes.querySelector('.espelho'),
  };
  const antes = {};
  const opac = (nome, v) => {
    const r = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
    if (antes[nome] === r) return;
    antes[nome] = r;
    camadas[nome].style.opacity = String(r);
  };

  let energia = 0, deckAntes = null;
  const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const E = estadoPista;
  E.reduzido = reduzido;
  let posAntes = 0, idAntes = null, lento = 0, quebraAte = -1;

  const marcarDrop = () => {
    E.drop = performance.now();
    E.quebra = false; quebraAte = -1;
  };

  function quadro() {
    requestAnimationFrame(quadro);
    if (document.hidden) return;
    const d = deckNoAr();
    let pulso = 0;
    if (d?.tocando && d.grid?.bpm) {
      // fase no tempo pela GRADE: 0 exatamente no bumbo
      const per = 60 / d.grid.bpm;
      E.batida = (d.displayPosition - d.grid.ancora) / per;
      const f = ((E.batida % 1) + 1) % 1;
      if (!reduzido) pulso = Math.exp(-f * 5);            // pico no bumbo, decaindo rápido
    }
    // energia suavizada: sobe rápido, desce devagar — como um VU
    const n = Math.min(1, (nivel() || 0) * 3.2);
    energia += (n > energia ? 0.25 : 0.03) * (n - energia);

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
    E.pulso = pulso; E.energia = energia; E.tocando = !!d?.tocando;
    E.bpm = d?.tocando ? (d.bpmEfetivo || d.grid?.bpm || 0) : 0;

    const q = E.quebra ? 1 : 0;
    opac('fumaca', 0.35 + energia * 0.5);
    opac('canhoes', (0.25 + pulso * 0.35 + energia * 0.3 + E.dropV * 0.4) * (1 - q * 0.7));
    opac('fachos', (0.07 + pulso * 0.06 + energia * 0.08 + E.dropV * 0.2) * (1 - q * 0.7));
    opac('espelho', (0.20 + pulso * 0.2 + E.dropV * 0.3) * (1 - q * 0.35));

    // marca qual deck está no ar (só quando troca)
    const id = d?.tocando ? d.id : null;
    if (id !== deckAntes) {
      deckAntes = id;
      for (const x of document.querySelectorAll('.deck')) x.classList.toggle('no-ar', x.dataset.d === id);
    }
  }
  requestAnimationFrame(quadro);
}
