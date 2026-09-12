# Achados medidos

Registro do que foi **medido**, não suposto. Cada item mudou ou confirmou uma
decisão de arquitetura. Data de medição no título de cada seção.

---

## 1. Streaming do Audius: nunca seguir o redirect — 2026-09-11

**O problema.** `GET /v1/tracks/{id}/stream` responde `302` para um validator, que
responde `307` para armazenamento bruto (`*.r2.cloudflarestorage.com`,
`*.s3.*.backblazeb2.com`). **O último hop não manda `access-control-allow-origin`.**
No navegador isso é `TypeError: Failed to fetch`.

| Medição | Resultado |
|---|---|
| Faixas acessíveis pelo caminho do redirect | **9 de 13 (69%)** |
| O validator é sorteado por requisição? | **Não.** 8/8 tentativas idênticas em 3 faixas |
| Outro discovery provider resolve? | Às vezes. `api.audius.co` consertou 1 de 2 |

Retry **não** resolve: o validator é fixo por faixa. O curl engana porque segue
redirect sem fazer checagem de CORS — foi o que me levou a errar no começo.

**A correção.** `GET /v1/tracks/{id}/stream?no_redirect=true` devolve JSON
(`ACAO: *`, 1 hop) com `data` = URL assinada do validator. Buscar **essa URL
direto** mantém você no validator, que serve os bytes ele mesmo.

| Medição em 18 faixas | Resultado |
|---|---|
| `GET` simples | **18/18** → 200 |
| `GET` com `Range` | **18/18** → 206 |
| Preflight `OPTIONS` com `Range` | **18/18** → 204, `allow-headers: range` |

Inclui as 3 faixas que eram 0/8 antes, e até caindo em `v.monophonic.digital`,
que bloqueava pelo caminho do redirect. **100% do catálogo em vez de 69%, e um
hop a menos.** Implementado em `resolveStreamUrl()`.

> Não sei explicar *por que* o validator serve direto mas redireciona quando
> alcançado pela cadeia — provavelmente a assinatura difere. É empírico.

---

## 2. Prefixo híbrido se paga — 2026-09-11

`decodeAudioData` não tem append, então a v1 usa: `Range` dos primeiros 2 MB →
decodifica só isso → toca → baixa o inteiro → troca as lajes.

| Faixa | MB | Prefixo até tocável | Inteiro até tocável | Ganho |
|---|---|---|---|---|
| 277 s | 10.6 | 1654 ms (52 s de áudio) | 2126 ms | **472 ms** |
| 162 s | 6.22 | 2047 ms (52 s de áudio) | 2852 ms | **805 ms** |

Ganho médio **639 ms**, em link de ~1.5 Mbps.

**Atenção ao medir:** a primeira medição deu o contrário (prefixo *mais lento*)
porque a conexão estava fria — o handshake entrou na conta do prefixo e não na do
arquivo inteiro. **Aqueça a conexão antes de comparar**, senão a conclusão inverte.

2 MB ≈ 52 s de áudio nas faixas testadas, muito mais do que os ~2 s que o
download completo leva. A troca acontece com folga.

---

## 3. `decodeAudioData` desanexa o ArrayBuffer de entrada — 2026-09-11

Depois de `await ctx.decodeAudioData(buf)`, `buf.byteLength === 0`. Isso gerou um
"0.00 MB" falso no meu próprio relatório de checagem.

**Consequências reais:** ler `byteLength` **antes** de decodificar; e para guardar
os bytes comprimidos em OPFS (cache), copiar (`buf.slice(0)`) **antes** do decode,
senão o cache recebe um buffer vazio.

---

## 4. Toda a API do signalsmith-stretch é assíncrona — 2026-09-11

O nó é um proxy sobre `postMessage`: cada método é
`(...args) => post(transfer, key, ...args)`. Então `latency()` devolve uma
**Promise**, não um número — sem `await`, o cálculo do instante de handoff dá `NaN`.

Métodos confirmados por introspecção: `configure`, `latency`, `setUpdateInterval`,
`start`, `stop`, `schedule`, `dropBuffers`, `addBuffers`, `when`. Propriedade:
`inputTime`.

**Consequência de projeto:** medir `latency()` **uma vez** no load e guardar em
cache. O handoff keylock↔vinyl não pode esperar um `await` no caminho crítico.

Confirmado também: o WASM vem em base64 no `.mjs` e o worklet é montado num Blob
URL. **Sem buscar `.wasm`, sem shim, sem build.** Risco nº 3 do plano morreu.

---

## 5. Falhas transitórias de rede são frequentes — 2026-09-11

**1 de 3** faixas falhou com `Failed to fetch` *mesmo com 4 tentativas e backoff*.
Também aconteceu em duas outras medições independentes.

**Consequência:** o carregador precisa de retry em **toda** busca de stream (não só
na API de metadata) e de falha **visível** na UI — "não consegui carregar, tentar
de novo" — nunca silenciosa. No modo piloto automático o professor precisa ter
faixa reserva.

---

## 6. Bug em `snapBpm`: dois laços que se desfaziam — 2026-09-11

Achado por teste. A implementação original:

```js
while (bpm < min) bpm *= 2;
while (bpm > max) bpm /= 2;
```

Com janela mais estreita que uma oitava (House = `[112,135]`), o valor 70 dobra pra
140, o segundo laço vê `140 > 135` e divide de volta pra 70. **Devolve valor fora
da janela, sem avisar.** Corrigido enumerando as oitavas e escolhendo: dentro da
janela, a que exige menos dobras; se nenhuma cabe, a que menos extrapola.
Invariante coberta por varredura de **12.838** combinações gênero × BPM.

---

## 7. O painel de navegador do Claude não tem relógio de áudio — 2026-09-11

`ctx.state === 'running'` mas `currentTime` e `currentFrame` ficam em **0** para
sempre, e `outputLatency` é 0. Logo `process()` do AudioWorklet nunca é chamado.

Provado que **não é bug do worklet**: a mensagem `ping` — que chama `report()`
direto do handler em vez de dentro do `process()` — respondeu normalmente
(`seq: 1`). Porta viva, processor vivo, relógio parado.

**Consequência:** as checagens 1, 3 e 4 (áudio audível, latência real, bench de
CPU) **têm que ser rodadas no Chrome de verdade**. Decode, rede e CORS podem ser
verificados no painel.

---

## 8. Metadata do Audius: o que dá e o que não dá — 2026-09-11

Amostras de 30 e 100 faixas:

| Campo | Cobertura | Observação |
|---|---|---|
| `bpm` | **100%** | `is_custom_bpm` = 0 em 100/100 → sempre detectado por máquina |
| `musical_key` | **100%** | texto: "G minor", "A flat minor" |
| `isrc` | **1–12%** | casamento com Spotify tem que ser fuzzy; ISRC só confirma |
| `license` | 36% | 35% dizem "All rights reserved" **e tocam** — não é portão |
| duração 60–600 s | 63–81% | o resto são sets de DJ de 60 min |
| `is_streamable` | 100% | portão real |

BPM errado visto na prática: techno marcado como **64.9** (erro de meio-tempo).
Daí as janelas por gênero e os botões ×2 / ÷2 na UI.

---

## 9. Dirigir o Chrome do usuário: dois obstáculos distintos — 2026-09-11

Perdi tempo com um diagnóstico errado, então vale registrar os dois separados.

**(a) Escala de coordenadas — real, mas não era a causa.** O screenshot reporta
frame `1568 × 675` enquanto o viewport CSS é `1280 × 495` (`devicePixelRatio`
1.5). Razão **0,8163**. Provado: passei frame `(417, 263)` e a página recebeu CSS
`(340, 215)`, exatamente o alvo. Para clicar em CSS `(x, y)`, passar
`(x, y) × frameWidth / innerWidth` — medir o fator na página, não fixar.

**(b) Permissão por site — a causa de verdade.** Em `developer.spotify.com` os
cliques chegam com `isTrusted: true` (concedem ativação de usuário). Em
`http://127.0.0.1:8080`, **nenhum evento chega** — nem no `document`, com
listener em fase de captura. Silencioso, sem erro.

**Como diagnosticar isso em 2 chamadas**, em vez de supor: instalar
`addEventListener('click', ..., true)` no `window`, mandar o clique, ler o que
chegou. Diz de uma vez se o evento chegou, onde chegou, e se é confiável.

**Consequência:** o harness automático é o `gate.html` rodando no painel interno
com `OfflineAudioContext` — sem placa de som, sem clique, sem permissão. O Chrome
do usuário fica só para escuta real.

---

## 10. Correção do item 1: `no_redirect` não é 100% — 2026-09-12

Eu escrevi "100% do catálogo" com base numa amostra de 18/18. **Exagerei.** Em
uso real o console mostrou `Failed to fetch` por CORS: a URL que o
`no_redirect=true` devolve **às vezes ainda redireciona** para
`*.r2.cloudflarestorage.com`, que não manda `access-control-allow-origin`.

| Medição | Resultado |
|---|---|
| Resolves que entregam URL utilizável | **3 de 5** numa amostra, **4–5 de 6** noutra |
| O tamanho do `Range` importa? | **Não.** 2 B, 64 KB e 2 MB falham igual |
| O host varia entre resolves da MESMA faixa? | **Sim** — e é isso que salva |

Essa é a diferença crucial em relação ao item 1: no caminho do **redirect** o
validator era **fixo por faixa** (8/8 idênticos), então retry não adiantava. No
caminho do **`no_redirect`** ele é **sorteado a cada chamada**.

**A correção:** `resolveStreamUrl()` gasta 2 bytes verificando antes de
devolver, e resolve de novo se falhar. Com 4 tentativas passa de 99%. Depois
disso: **6/6** no teste ao vivo, incluindo hosts que falhavam isolados.

**A lição:** amostra de 18 sem variação temporal não prova "100%". O que
detectou isto foi o console do navegador em uso real, não o meu teste.

---

## 11. "Existe no DOM" não é "o usuário vê" — 2026-09-12

Entreguei uma versão em que os botões PLAY, CUE, SYNC e KEY LOCK **tinham
sumido da tela**, e eu tinha "verificado". Verifiquei com `querySelector` se
eles existiam — e existiam. Estavam cortados pelo `overflow:hidden` do deck.

**Elemento cortado continua no DOM, responde a `querySelector`, tem
`className`, e é invisível.** Checar existência não é checar entrega.

A causa raiz era de layout: eu tinha dado altura **fixa** à forma de onda e
`flex:1` ao bloco de controles. Quando a coluna apertava, quem era espremido
eram os botões. O certo é o inverso — controle tem altura fixa e inviolável,
a onda absorve a sobra.

E um segundo, que só apareceu ao medir: `.palco` era um grid sem
`grid-template-rows`, então criava uma linha de altura automática e cada
coluna crescia até o conteúdo. A página ficava com **1738 px num viewport de
768**, o oposto de "cabe numa tela". `grid-template-rows: minmax(0,1fr)`
obriga os filhos a caber.

**A ferramenta:** `src/dev/inspecionar.js` mede posição e tamanho reais e
acusa o que o DOM esconde — tamanho zero, corte pela borda, cobertura por
outro elemento, alvo de toque pequeno demais, e página que rola quando não
deveria. Roda sobre 44 controles.

Depois da correção, em 1366×768 e em 1280×700: zero problemas, página com a
altura exata do viewport.
