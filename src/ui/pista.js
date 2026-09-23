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
:root { --pulso:0; --energia:0; --vel:.47s; }
#pista { position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden; }

/* a cabine também sente a batida: o deck no ar brilha no bumbo */
.deck.no-ar { box-shadow: 0 0 calc(4px + var(--pulso) * 26px) rgba(76,201,240,calc(.15 + var(--pulso) * .45)),
                          inset 0 0 0 1px rgba(76,201,240,calc(.2 + var(--pulso) * .4)); }
.deck[data-d="B"].no-ar { box-shadow: 0 0 calc(4px + var(--pulso) * 26px) rgba(255,179,71,calc(.15 + var(--pulso) * .45)),
                                      inset 0 0 0 1px rgba(255,179,71,calc(.2 + var(--pulso) * .4)); }
body > *:not(#pista) { position:relative; z-index:1; }

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
  opacity: calc(.10 + var(--pulso) * .30 + var(--energia) * .20);
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

@keyframes pista-varre { from { transform: rotate(-24deg) } to { transform: rotate(24deg) } }
@keyframes pista-rola  { from { background-position: 0 0 } to { background-position: 0 64px } }
@keyframes pista-deriva { from { transform: translate(-3%, -2%) scale(1) } to { transform: translate(3%, 2%) scale(1.08) } }

@media (prefers-reduced-motion: reduce) {
  #pista .feixe, #pista .chao, #pista .fumaca { animation:none !important; }
  #pista .pessoa { transform:none !important; }
}
`;

const CORES = ['#ff4ecd', '#4cc9f0', '#ffb347', '#2ee6a8', '#c77dff'];

/**
 * @param {object} dep
 * @param {function} dep.deckNoAr  devolve o Deck que está soando mais, ou null
 * @param {function} dep.nivel     nível do master agora, 0..1
 */
export function montarPista({ deckNoAr, nivel }) {
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

  function quadro() {
    requestAnimationFrame(quadro);
    const d = deckNoAr();
    let pulso = 0;
    if (d?.tocando && d.grid?.bpm && !reduzido) {
      // fase no tempo pela GRADE: 0 exatamente no bumbo
      const per = 60 / d.grid.bpm;
      const f = (((d.displayPosition - d.grid.ancora) / per) % 1 + 1) % 1;
      pulso = Math.exp(-f * 5);            // pico no bumbo, decaindo rápido
      const bpm = Math.round(d.bpmEfetivo || d.grid.bpm);
      if (bpm !== bpmAntes) { bpmAntes = bpm; raiz.style.setProperty('--vel', (60 / bpm).toFixed(3) + 's'); }
    }
    // energia suavizada: sobe rápido, desce devagar — como um VU
    const n = Math.min(1, (nivel() || 0) * 3.2);
    energia += (n > energia ? 0.25 : 0.03) * (n - energia);
    raiz.style.setProperty('--pulso', pulso.toFixed(3));
    raiz.style.setProperty('--energia', energia.toFixed(3));

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
