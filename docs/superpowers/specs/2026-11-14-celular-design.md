# Design: celular na cena 3D, com qualidade menor e gestos de toque (frente 3 da issue #2)

Repo: `TailUFPB/machine-compose-3d`. Base: branch `feat/vistas-folgas` (PR #12, aberta, sobre #9 e #8). Data: 14/11/2026.
Depois de aprovado, vai para `docs/superpowers/specs/2026-11-14-celular-design.md` (commitado).

## Intenção e o porquê

A cena 3D foi feita e medida num notebook com GPU (60 q/s num Apple M4). No celular, três coisas atrapalham hoje:

- **Peso:** o canvas desenha na densidade cheia da tela (DPR 3 num iPhone dá 9 vezes os pixels de DPR 1). Também
  desenha todos os detalhes finos: pinos, contatos e trilhas (`forma.tipo === "grade"`), mais os contornos (`Edges`
  e as linhas de `contorno` em `Peca3D`). Quando os quadros caem, nada se ajusta.
- **Hover:** o nome da peça (`.etiqueta`) e o destaque sincronizado com o painel dependem de `onPointerOver`, que
  não existe no toque. No celular o primeiro toque já abre a peça, sem mostrar antes o que é.
- **Rolagem presa:** o `OrbitControls` põe `touch-action: none` no canvas. Na tela de 390 px a cena ocupa a largura
  inteira, e a pessoa que arrasta o dedo nela para descer a página gira a câmera.

Item da issue #2 coberto: "Qualidade menor e gestos de toque no celular".

## O que a usuária decidiu

1. **Qualidade automática** com um seletor "Qualidade: Auto · Alta · Leve". O modo Leve usa menos pixels e tira os
   detalhes finos. "Auto" liga o Leve no celular ou quando os quadros caem.
2. **Toque no lugar do hover:** o primeiro toque numa peça mostra o nome e acende a peça, como o hover faz. O
   segundo toque na mesma peça abre o detalhe.
3. **A cena não prende a rolagem:** no toque, 1 dedo rola a página e 2 dedos giram e dão zoom na cena.

## Comportamento

### Qualidade
- Botões "Qualidade: Auto · Alta · Leve" na barra da cena, no mesmo padrão dos botões de vista (`btn pequeno`,
  `aria-pressed`). O padrão é Auto.
- **Alta**: a cena de hoje, com DPR `min(devicePixelRatio, 2)`.
- **Leve**:
  - DPR 1;
  - sem as subpeças `grade` (pinos, contatos, trilhas);
  - sem os contornos de peça (`Edges` e as linhas de `contorno` em `Peca3D`).
  - Continuam: o contorno do gabinete (é o que mostra a caixa vazia), as regiões de conflito, a régua, os cabos e as
    ventoinhas girando.
- **Auto**:
  - começa em Leve quando o ponteiro principal é de toque (`(pointer: coarse)`) e em Alta nos outros casos;
  - se a taxa medida ficar abaixo de 30 q/s por alguns segundos (piso da spec da #8), desce para Leve;
  - não sobe de volta sozinho durante a visita, para não ficar piscando entre os dois.
- A escolha manual (Alta ou Leve) fica guardada no navegador (`localStorage`, com try/catch). Auto é o padrão
  quando não há nada guardado.
- O texto junto ao seletor diz o nível efetivo quando o Auto está ativo, por exemplo "Auto (leve)".
- A descrição textual da cena não muda: a qualidade só afeta o desenho.

### Toque
- Vale só para toque (`pointerType === "touch"`). Mouse e caneta seguem como hoje.
- **Primeiro toque** numa peça: mostra a etiqueta com o nome e acende a peça. Acende também a linha no painel
  "Peças da build" (`onDestaque`), como o hover faz.
- **Segundo toque** na mesma peça: abre o detalhe (`setAberta`), como o clique do mouse.
- **Toque numa peça diferente**: passa o destaque para ela, sem abrir.
- **Toque no vazio** (`onPointerMissed`): apaga o destaque e, se houver peça aberta, fecha como hoje.
- Com a peça aberta, um toque numa subpeça mostra o nome dela, como o hover faz hoje com o mouse. Isso fica dentro
  do mesmo `onClick`: tocar mostra o nome e não fecha a peça.
- No passo a passo o toque não abre a peça, igual ao clique hoje, mas mostra o nome.
- Arrastar com 2 dedos não conta como toque (o R3F não dispara `onClick` quando há arrasto).

### Rolagem e gestos
- No canvas, `touch-action: pan-y`: o navegador rola a página com 1 dedo na vertical.
- No `OrbitControls`: `touches = { ONE: nenhum, TWO: DOLLY_ROTATE }`, ou seja, 2 dedos giram e fazem pinça para
  zoom. O arrasto lateral (pan) sai no toque; mouse continua como hoje.
- Tocar com 2 dedos marca a vista "Livre" (`onStart`), como o mouse faz.
- Em aparelho de toque, uma dica curta embaixo da barra: "Dois dedos giram e aproximam a cena."

## Restrições
- Não quebrar os 35 testes de navegador nem o piso de 30 q/s no notebook (que roda em Alta).
- A cena em 390 px continua sem rolagem horizontal, e os novos botões cabem nessa largura.
- Teclado: o seletor de qualidade é alcançável por Tab. Esc não muda de comportamento.
- Usar as classes existentes de `globals.css`. CSS novo só para a dica de toque, se precisar.
- Sem dependência nova. O drei já traz `PerformanceMonitor`, e as constantes `TOUCH` vêm do `three`.

## Não-objetivos
- Medir em celular de verdade nesta frente. A verificação é por emulação no Playwright: `hasTouch`, `isMobile`,
  viewport 390×844 e CPU mais lenta. Aparelho real fica como limite conhecido.
- Trocar o tipo de material, sombras ou antialias por nível.
- Nível intermediário ou ajuste fino do DPR (só Alta e Leve).
- Gesto de 3 dedos, toque duplo para zoom e toque longo.

## Anti-objetivos
- O Auto alternar entre Alta e Leve sem parar.
- No celular, a pessoa tentar rolar a página e girar a cena sem querer.
- Um toque abrir a peça direto, sem mostrar antes qual é.
- O modo Leve esconder algo que conta para a decisão: conflito, régua ou peça inteira.

### Casos de borda (decididos após a leitura do revisor)
- **Peça aberta no Leve:** a peça aberta volta a mostrar as subpeças `grade` e os contornos dela. É a vista de
  detalhe e é uma peça só, então o custo é pequeno. Assim pinos e contatos continuam tocáveis para ver o nome.
- **Gabinete no Leve:** ele é desenhado por `Peca3D` (`lib/gabinete.ts`). Mantém as linhas de `contorno` dele, que
  mostram a caixa. Perde as subpeças `grade` (filtros, entrada de ar), como as outras peças. O `Edges` de
  `Cena3D.tsx:41` vale só para peça sem modelo e fica como está.
- **Cabos e peças sem modelo** (`Cabo3D`, `Peca`): o primeiro toque mostra o nome. O segundo não faz nada, porque
  hoje eles não abrem.
- **Gabinete no toque:** o primeiro toque mostra o nome, sem acender, como o hover de hoje. O segundo abre, como o
  clique do mouse. Ele já intercepta o clique com o mouse hoje, e o toque não muda isso.
- **Toque e hover:** os eventos `over`/`out` vindos de toque são ignorados, porque o R3F os dispara no toque e
  apaga logo depois. No toque, o nome e o destaque vêm do estado do toque.
- **Testes existentes e o Auto:** no notebook o ponteiro é fino, então o Auto começa em Alta.
  - O Auto só passa a medir depois de uma carência de 3 s após montar a cena.
  - O teste de taxa de quadros fixa Alta pelo `localStorage`. Ele mede o nível mais pesado, que é o que o piso
    protege.
  - A regra de descida é uma função pura testada no vitest. O navegador não força a queda de quadros.

## Chamadas minhas (a revisar)
- O limite do Auto é 30 q/s, o mesmo piso da spec da #8.
- O Auto não volta para Alta sozinho.
- A escolha manual fica guardada no `localStorage`.
- O Leve tira só `grade` e contornos, e mantém ventoinhas girando e os cabos.
- O pan com 2 dedos sai no toque, porque 2 dedos fazem zoom e giro.
- A dica de toque aparece só em aparelho de toque.
- Frente empilhada em `feat/vistas-folgas` (PR #12), como as anteriores.

- Peça aberta mostra o detalhe completo mesmo no Leve. Cabos só mostram o nome ao toque.

## Deixado para quem constrói
- Como medir a taxa no Auto: `PerformanceMonitor` do drei ou contagem própria em `useFrame`.
- Como emular 2 dedos no Playwright: CDP `Input.dispatchTouchEvent`.

