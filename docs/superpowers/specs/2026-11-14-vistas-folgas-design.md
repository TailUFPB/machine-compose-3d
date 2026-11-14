# Design: vistas prontas e régua de folga na cena 3D (frente 2 da issue #2)

Repo: `TailUFPB/machine-compose-3d` · base: branch `feat/cena-paineis` (PR #9, aberta, sobre a PR #8) · data: 14/11/2026.
Aprovado pela usuária em 14/11/2026. Plano de implementação executado na branch `feat/vistas-folgas`.

## Intenção e o porquê

A cena mostra se uma peça **não cabe** (região vermelha e "passa N mm", desde a PR #8), mas não mostra **quanto sobra**
quando cabe, e a câmera só tem a posição inicial e a órbita com o mouse. Quem monta quer olhar o PC de frente, de lado
e de cima, e saber, sem conta de cabeça, se a GPU de 285 mm cabe com folga no gabinete que aceita 340 mm (sobram 55 mm),
se o cooler encosta no vidro, se a memória passa sob o cooler.

Itens da issue #2 cobertos: "Mostrar folgas ('placa de vídeo 285 mm, cabe 340 mm, sobram 55 mm') e uma régua" e
"Vistas prontas: frente, lateral, topo".

## O que a usuária decidiu

1. **Vistas prontas na barra da cena:** Livre (a de hoje), Frente, Lateral, Topo.
2. **Seção "Folgas" no painel** ao lado da cena: uma linha por medida, com a peça, o tamanho dela, o limite, quanto
   sobra e um sinal (cabe, justa, não cabe).
3. **Clicar numa folga** leva a câmera à vista que melhor mostra aquela medida e desenha na cena uma **régua**: o
   limite inteiro, o trecho ocupado pela peça e o trecho que sobra, com os números.

## Comportamento

### Vistas
- Botões "Vista: Livre · Frente · Lateral · Topo" (`aria-pressed` no ativo). Eixos da cena (`lib/cena.ts`): X =
  profundidade (frente em −X), Y = altura, Z = largura (placa-mãe em −Z, vidro em +Z).
  - **Frente:** câmera em −X olhando para +X. **Lateral:** em +Z, pelo vidro. **Topo:** em +Y, olhando para baixo.
  - **Livre:** volta à posição inicial (`CAM_INICIAL`) e solta a órbita.
- A câmera anda até a vista com a mesma animação do foco de hoje (`Foco`, ~1,2 s); com movimento reduzido, salta.
- Girar com o mouse depois de escolher uma vista volta o botão para "Livre".
- Abrir peça, conflito, prévia ou passo a passo têm prioridade sobre a vista (o foco deles vence), como hoje.

### Folgas (painel, abaixo da lista da build; some quando há peça aberta)
- Medidas, cada uma só quando as duas peças existem na build:
  - **GPU × gabinete:** `comprimento_mm` da GPU contra `gpu_max_mm` do gabinete (ou `gpu_max_com_radiador_frontal_mm`
    quando há water cooler com radiador na frente).
  - **Cooler a ar × gabinete:** `altura_mm` do cooler contra `cooler_max_mm`.
  - **Memória × cooler a ar:** `altura_mm` da memória contra `ram_altura_max_mm` do cooler.
  - **Fonte × gabinete:** comprimento da fonte (`dimensoes.c`, que na torre fica na largura) contra a largura do
    gabinete (`dimensoes.l`), a mesma regra `par:psu_largura` da PR #8.
- Cada linha: "GPU 240 mm · cabe 392 · sobram 152". O estado acompanha a severidade da revisão (nunca discorda dela):
  - **não cabe**: excesso que a revisão trata como bloqueante; mostra "passa N mm", cor do conflito;
  - **ajuste**: excesso que a revisão trata como atenção, com a dica dela (memória até 10 mm acima da folga do cooler:
    "a ventoinha precisa subir"; GPU além do limite com radiador frontal mas dentro de `gpu_max_mm`: "monte o
    radiador no topo"); cor de aviso;
  - **justa**: cabe com sobra abaixo dos limites que a revisão já usa (GPU < 15 mm, cooler < 5 mm; memória e fonte
    < 5 mm, chamada minha);
  - **cabe** nos demais casos.
- A folga é medida da ficha: um achado ignorado na revisão não muda o número nem o estado.
- Clicar numa linha: a câmera vai para a vista da medida (GPU → Lateral; cooler, memória e fonte → Topo, porque o
  painel da frente é opaco e esconde o cooler), a régua aparece; clicar de novo ou Esc tira a régua e volta à vista
  anterior.
- Quando um conflito tem folga medida para as duas peças, a região vermelha da cena usa o excesso da ficha (o mesmo
  número da régua); se a ficha diz que cabe, a região não diz "passa".
- Na prévia de troca (frente 1), que só existe com peça aberta (a seção Folgas está escondida), o bloco de diferença
  da prévia ganha as folgas que mudam com a troca: "GPU: sobram 152 → passa 10 mm". A régua não aparece na prévia.

### Régua na cena
- Uma linha de cota ao longo do eixo da medida, com marcas nas pontas: o trecho do limite inteiro, o trecho da peça e
  o trecho que sobra (ou que passa, em vermelho), com rótulos em mm no mesmo estilo da medida de conflito
  (`.medida`).
- Âncoras: GPU a partir da traseira (bracket) em direção à frente; cooler e memória a partir da face da placa-mãe em
  +Z; fonte ao longo da largura (Z). A régua usa os números da ficha, não a geometria desenhada.

## Backend

- Novo `backend/app/folgas.py` com uma função pura que recebe as peças da build e devolve a lista de folgas
  (`{id, peca, limite_de, tamanho_mm, limite_mm, sobra_mm, estado, dica}`, estado em `cabe|justa|ajuste|nao_cabe`).
  Os limites de "justa" e a tolerância de "ajuste" viram constantes usadas também por `revisores.py`, para os dois
  nunca divergirem.
- **Limite da GPU numa função só**, usada pela revisão e pelas folgas: com water cooler cujo radiador fica na frente
  (`radiador_posicao` ausente ou "frente"), o limite útil é `gpu_max_com_radiador_frontal_mm`; com radiador no topo,
  `gpu_max_mm`. Hoje `revisores.espaco_fisico` trata todo water cooler como frontal enquanto a cena respeita "topo":
  esta é a única mudança de regra da frente (o achado `espaco:radiador_gpu` deixa de aparecer com radiador no topo).
- `GET /builds/{id}/cena` e `POST /builds/{id}/cena/previa` passam a devolver `folgas` (via `_dados_cena`, da PR #9).

## Restrições

- Os números da régua batem com os da revisão: a mesma peça nunca aparece "cabe" na régua e "não cabe" na revisão.
- Não quebrar os 25 testes de navegador nem o piso de 30 q/s; controles cabem em 390 px.
- Teclado: vistas e linhas de folga alcançáveis por Tab; Esc tira a régua. A descrição textual da cena menciona a
  vista e, com régua, a medida.
- Classes existentes de `globals.css`; CSS novo só para a régua e a lista de folgas.

## Não-objetivos

- Câmera ortográfica (planta técnica) e troca de tipo de câmera.
- Medidas que a ficha não traz (radiador tem só tamanhos suportados, sem milímetros de sobra).
- Régua livre (medir dois pontos quaisquer com o mouse).
- Celular com gestos e fluxo de ar (frentes 3 e 4).

## Anti-objetivos

- Régua dizendo "sobram" enquanto a revisão diz "não cabe" para a mesma peça.
- A vista pronta brigar com a órbita do mouse (câmera puxando de volta enquanto a pessoa gira).

## Chamadas minhas (a revisar)

- O backend calcula as folgas, com os mesmos limites de "justa" da revisão.
- A câmera continua em perspectiva; as vistas só alinham a direção.
- O radiador fica fora das folgas.
- Com radiador na frente, o limite da GPU é `gpu_max_com_radiador_frontal_mm`.
- A frente entra empilhada em `feat/cena-paineis` (PR #9), como a frente 1 entrou na #8.
- A vista de cada medida (GPU → Lateral etc.) e o limite de 5 mm para memória e fonte são escolhas minhas.
- Quarto estado **ajuste** (amarelo) para excesso que a revisão chama de atenção, para a régua nunca discordar dela.
- Radiador no topo: a revisão passa a respeitar `radiador_posicao`, como a cena já faz (única mudança de regra).
- Folgas da prévia aparecem no bloco de diferença da prévia, não na seção Folgas.
- Achado ignorado não muda a folga (é medida da ficha).

## Deixado para quem constrói

- Como desenhar a linha de cota (drei `Line`, já usado em `Peca3D`, ou malhas finas).
- Distância da câmera em cada vista (enquadrar o gabinete inteiro).
