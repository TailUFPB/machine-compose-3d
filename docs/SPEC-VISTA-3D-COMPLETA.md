# Spec: vista 3D completa do PC

Continuação do trabalho descrito em [PECAS-3D.md](PECAS-3D.md). Estado de partida: gabinete, placa-mãe, CPU, cooler a
ar, memória, GPU, SSD M.2 e fonte são peças procedurais com vista explodida; há cabos de energia e o cabo do fan da
CPU; as peças se encaixam por âncoras.

## Problem Statement

Quem monta uma build quer ver o PC como ele vai ficar de verdade e entender, olhando, por que uma peça cabe ou não
cabe. Hoje a cena 3D já mostra peças reconhecíveis, mas ainda engana em pontos importantes:

- Uma build com water cooler ou com disco SATA mostra essas peças como caixas lisas no meio de peças detalhadas.
- Muita coisa aparece como "(estimado)" porque a ficha não traz o dado: número de fans, backplate, portas, posições de
  fan do gabinete. O usuário não sabe se o que vê é o produto ou um chute.
- Um conflito físico (GPU longa demais, cooler alto demais) só pinta a peça de vermelho. Não mostra onde ela bate.
- Só dá para abrir uma peça por vez. Não existe uma vista da build inteira explodida.
- O passo a passo faz as peças deslizarem para o lugar, sem mostrar o encaixe (trava, alavanca, cabo).
- Faltam cabos (fans do gabinete, painel frontal, SATA) e os cabos existentes não têm plugue.
- A fonte está desenhada e checada com os 150 mm no sentido da profundidade, que não é como ela fica numa torre.
- Ninguém mediu se a cena continua fluida com tudo isso.

## Solution

A cena passa a mostrar toda peça da build como modelo procedural, com as medidas vindas da norma ou da ficha do
fabricante sempre que existirem, e marcadas como estimadas quando não existirem. O usuário pode explodir a build
inteira, ver a região exata de um conflito físico, seguir um passo a passo que mostra cada encaixe e ver todos os cabos
ligados. A fonte fica na orientação real, e a checagem de espaço usa a mesma orientação. A cena tem um piso de
desempenho medido e protegido por teste.

## User Stories

### Peças que faltam

1. Como usuário com water cooler na build, quero ver o bloco sobre a CPU, o radiador com seus fans e as duas mangueiras,
   para entender onde cada parte fica no gabinete.
2. Como usuário, quero que o radiador tenha o comprimento da ficha (240, 280, 360 mm), para ver se ele ocupa a frente
   ou o topo.
3. Como usuário, quero abrir o water cooler em vista explodida e ver bomba, placa fria, aletas do radiador e fans, para
   entender como ele funciona.
4. Como usuário com SSD SATA, quero vê-lo como um disco de 2,5 polegadas numa baia, para não confundir com um M.2.
5. Como usuário com HD, quero vê-lo como um disco de 3,5 polegadas numa baia, com suas medidas da norma.
6. Como usuário, quero ver as baias de disco do gabinete, para saber onde os discos entram.
7. Como usuário, quero abrir um disco em vista explodida e ver carcaça, placa e conectores SATA com seus pinos.

### Detalhe das peças existentes

8. Como usuário, quero ver na GPU a aba superior do bracket presa ao gabinete, para entender como a placa é fixada.
9. Como usuário, quero ver os heatpipes da GPU saindo da base e entrando nas aletas, para entender o caminho do calor.
10. Como usuário, quero que o shroud da GPU tenha chanfros e volume, para que pareça uma placa real e não uma chapa.
11. Como usuário, quero ver na placa-mãe as portas traseiras de verdade (USB, vídeo, rede, áudio), para conferir o que
    ela oferece.
12. Como usuário, quero ver o dissipador sobre o M.2 quando a placa tiver um, para saber que o SSD fica coberto.
13. Como usuário, quero ver capacitores e chips menores na placa-mãe, para que ela não pareça vazia entre os slots.
14. Como usuário, quero ver os standoffs entre a placa-mãe e a bandeja, para entender como ela é presa.
15. Como usuário, quero ver as tampas de slot removidas onde a GPU entra, para entender quantos slots ela ocupa.
16. Como usuário, quero ver filtros de poeira e a entrada de ar do painel frontal, para avaliar o fluxo de ar.
17. Como usuário, quero ver a fonte na orientação real dentro do gabinete, para que a build pareça montada de verdade.

### Dados da ficha

18. Como usuário, quero que o número de fans da GPU e do cooler venha da ficha do fabricante, para confiar no que vejo.
19. Como usuário, quero que o tamanho dos fans venha da ficha, para que a peça tenha a proporção certa.
20. Como usuário, quero que a presença de backplate venha da ficha.
21. Como usuário, quero que a lista de saídas de vídeo da GPU venha da ficha, para ver as portas certas no bracket.
22. Como usuário, quero que as portas traseiras e os slots da placa-mãe venham da ficha.
23. Como usuário, quero que as posições de fan e de radiador do gabinete venham da ficha.
24. Como usuário, quero saber se a lateral do gabinete é de vidro ou de chapa.
25. Como usuário, quero ver, ao passar o mouse, se uma subpeça vem da norma, da ficha ou é estimada.
26. Como usuário, quero abrir a fonte de um dado da ficha (a página do fabricante), para conferir.
27. Como usuário, quero que um dado que a ficha não traz continue estimado e marcado, nunca apresentado como real.
28. Como usuário sem chave de busca configurada, quero que a cena funcione igual com os dados do seed.
29. Como mantenedor, quero que nenhum dado geométrico extraído entre no catálogo sem URL de origem, como já acontece
    com preço.
30. Como mantenedor, quero que um valor extraído fora de uma faixa plausível seja descartado, para que um erro de
    extração não deforme a peça.

### Cabos

31. Como usuário, quero ver o cabo de cada fan do gabinete até a placa-mãe.
32. Como usuário, quero ver os cabos do painel frontal (botão, USB, áudio) até os conectores de pinos.
33. Como usuário com disco SATA, quero ver o cabo de dados até a placa-mãe e o de energia até a fonte.
34. Como usuário com water cooler, quero ver os cabos da bomba e dos fans do radiador.
35. Como usuário, quero ver um plugue na ponta de cada cabo, do formato do conector em que ele entra.
36. Como usuário, quero que nenhum cabo atravesse uma peça.
37. Como usuário, quero passar o mouse num cabo e ver o que ele liga.

### Vista explodida da build inteira

38. Como usuário, quero um controle que exploda a build inteira, com cada peça saindo na direção em que é instalada.
39. Como usuário, quero que os cabos acompanhem as peças na explosão ou sumam de forma clara, sem ficar soltos no ar.
40. Como usuário, quero clicar numa peça da build explodida para abrir só ela.
41. Como usuário, quero voltar da build explodida para a montada com uma animação que desfaz a ordem.
42. Como usuário com movimento reduzido ativado, quero que a explosão aconteça sem animação.

### Conflitos na geometria

43. Como usuário, quero ver destacada a região exata onde uma peça bate em outra ou na parede do gabinete.
44. Como usuário, quero ver a medida do excesso (por exemplo, "passa 22 mm"), para saber quanto falta.
45. Como usuário, quero que o conflito mostrado na cena seja o mesmo achado da revisão, com o mesmo texto.
46. Como usuário, quero clicar num conflito da lista e a câmera ir até a região dele.
47. Como usuário, quero que um conflito que não é físico (soquete, tipo de memória) continue marcado na peça, sem
    inventar uma região.

### Passo a passo com encaixe

48. Como usuário, quero ver a alavanca do soquete abrir e fechar no passo da CPU.
49. Como usuário, quero ver as travas dos slots de memória abrirem e fecharem no passo da memória.
50. Como usuário, quero ver a trava do slot PCIe e o parafuso do bracket no passo da GPU.
51. Como usuário, quero ver cada cabo ser ligado no passo correspondente.
52. Como usuário, quero avançar e voltar passos e a cena refletir exatamente o estado daquele passo.
53. Como usuário, quero que a câmera enquadre a peça do passo atual.

### Fluidez e acesso

54. Como usuário num notebook comum, quero que a cena gire sem travar com a build completa.
55. Como usuário de teclado, quero abrir e fechar qualquer vista explodida sem mouse.
56. Como usuário de leitor de tela, quero uma descrição textual do que a cena mostra e dos conflitos.
57. Como usuário em tela pequena, quero que os controles da cena continuem usáveis.

### Mantenedor

58. Como mantenedor, quero adicionar uma peça nova escrevendo só um gerador, sem tocar no renderizador.
59. Como mantenedor, quero que toda peça nova passe pelos mesmos testes de envelope e de não atravessamento.
60. Como mantenedor, quero que a checagem de espaço do backend e o desenho usem a mesma orientação da fonte.

## Implementation Decisions

- **Contrato de peça mantido.** Toda peça nova é um gerador puro que recebe a ficha e devolve um modelo (envelope,
  subpeças, itens estimados, âncoras). O renderizador e a vista explodida continuam únicos.
- **Peças em mais de um lugar.** O water cooler tem duas partes rígidas (bloco e radiador) ligadas por mangueiras. O
  modelo de cena passa a aceitar uma peça da build que ocupa mais de uma posição; as mangueiras usam o mesmo desenho
  de tubo dos cabos, com raio maior.
- **Âncoras novas.** Gabinete expõe âncoras de baia de disco, de posições de fan e de radiador (frente e topo).
  Placa-mãe expõe âncoras dos conectores de fan, do painel frontal e das portas SATA. Discos expõem as dos conectores
  de dados e de energia.
- **Formas novas no renderizador.** Entram duas: perfil extrudado (para chanfros e volumes do shroud e do painel
  frontal) e tubo com curva (para heatpipes dobrados e mangueiras). Nenhuma outra forma é adicionada sem necessidade
  comprovada por uma peça.
- **Cabos.** As rotas continuam derivadas dos conectores já posicionados. Cada cabo ganha plugue nas duas pontas, com
  o formato lido do conector de destino. Os cabos novos seguem a regra existente: correm por trás da bandeja ou sob a
  cobertura da fonte e só entram no envelope de uma peça na chegada ao próprio conector.
- **Fonte na orientação real.** Os 150 mm passam para a largura do gabinete e a profundidade da ficha passa para o
  sentido da profundidade. A regra de espaço físico do backend é ajustada para a mesma orientação, na mesma mudança.
- **Campos novos de ficha.** GPU: número e tamanho de fans, backplate, lista de saídas. Cooler: número e tamanho de
  fans, heatpipes; para water cooler, tamanho e posição do radiador. Placa-mãe: lista de portas traseiras, slots PCIe
  e M.2 com posição, dissipador de M.2. Gabinete: posições de fan e de radiador, tipo de lateral, baias de disco.
  Armazenamento: formato (M.2, 2,5", 3,5"). Todos opcionais: campo ausente cai na estimativa já existente.
- **Origem por campo.** Cada campo geométrico extraído carrega a URL da ficha e a data da coleta. A resposta da rota
  da cena passa a informar, por campo, se o valor é da ficha (com URL) ou ausente. A regra de ouro de preço vale aqui:
  sem URL, o valor não é gravado.
- **Extração da ficha (caminho misto).** Reusa a busca e a extração já usadas para preço. Extrai apenas campos que
  fichas costumam publicar (fans, dimensões, portas, posições de fan do gabinete). Layout interno (chips, VRM,
  trilhas) nunca é extraído e continua estimado. Cada campo tem uma faixa plausível; valor fora da faixa é descartado
  e registrado. Sem chave de busca ou sem LLM, a extração não roda e o seed é usado como está.
- **Conflito na geometria.** O backend continua sendo a fonte dos achados físicos. O frontend calcula a região do
  conflito cruzando os envelopes das peças envolvidas (ou a peça com a parede do gabinete) e desenha essa região e a
  medida do excesso. Se o cálculo geométrico e o achado discordarem, vale o achado e a divergência é registrada.
- **Build explodida.** Cada peça ganha um deslocamento de instalação (a direção em que ela sai do lugar). A explosão da
  build aplica esse deslocamento a todas as peças, escalonado pela ordem inversa dos passos de montagem. A explosão de
  uma peça continua existindo e pode ser aberta a partir da build explodida.
- **Passo a passo com encaixe.** Subpeças móveis (alavanca do soquete, travas dos slots, parafusos) ganham um estado
  aberto e um fechado no modelo. Cada passo declara quais ficam abertas enquanto a peça entra e fecha ao final. Os
  cabos aparecem no passo em que são ligados. O estado da cena é função só do passo e do progresso, sem memória entre
  passos.
- **Desempenho.** Antes de adicionar peças, mede-se a cena atual. Piso: 30 quadros por segundo com a build completa
  num perfil de notebook comum. Se o piso não for atingido, as subpeças estáticas de cada peça são fundidas em uma
  malha por tom, mantendo malhas separadas só para o que se move.
- **Acesso.** Todo controle da cena é alcançável por teclado. A cena tem uma descrição textual gerada a partir das
  peças e dos conflitos. Movimento reduzido desliga animações e a rotação dos fans, como hoje.
- **Sem autoria de assistente.** Commits, PRs e documentos deste trabalho não levam linha de coautoria nem assinatura
  de ferramenta.

## Testing Decisions

Um bom teste aqui verifica o que sai, não como é feito: dada uma ficha, que geometria aparece; dada uma build, onde
cada peça fica e por onde cada cabo passa; dada uma interação, o que o usuário vê. Não se testa nome de função interna
nem estrutura de componente.

- **Geradores e montagem da cena (frontend, teste unitário).** É o ponto principal e já existe. Para cada peça nova ou
  alterada, com fichas dos extremos do catálogo:
  - toda subpeça cabe no envelope da ficha;
  - nenhuma subpeça atravessa outra, fora os contatos de projeto declarados no teste;
  - contagens seguem a ficha e a origem de cada subpeça está certa;
  - âncoras de duas peças coincidem quando encaixadas;
  - nenhum cabo atravessa uma peça fora da chegada ao próprio conector;
  - a build explodida não deixa duas peças sobrepostas;
  - o estado do passo a passo é o mesmo ao avançar e ao voltar para um passo.
  Os testes existentes de GPU, placa-mãe, memória, CPU, cooler, SSD, fonte, gabinete e cabos são o modelo.
- **Rota da cena (backend, teste de API).** Já existe. Cobre os campos novos da ficha, a origem por campo, o descarte
  de valor fora da faixa, o comportamento sem chave de busca e a regra de espaço com a fonte na orientação nova. Os
  testes de preço e de regras físicas são o modelo, incluindo o uso de resposta de busca gravada.
- **Cena no navegador (novo).** Único ponto de teste novo, pedido para cobrir o que os dois anteriores não veem. Um
  teste automatizado abre a cena de uma build fixa e verifica:
  - a cena carrega sem erro no console;
  - abrir e fechar a vista explodida de uma peça e da build inteira funciona por clique e por teclado;
  - clicar num conflito leva a câmera até a região e mostra a medida;
  - o passo a passo avança e volta;
  - a taxa de quadros fica acima do piso com a build completa.
  Roda contra a API com o seed, sem rede externa.

## Out of Scope

- Modelos 3D por SKU (malhas baixadas ou geradas a partir de foto).
- Layout real de chips, VRM e trilhas de cada modelo: continua um arranjo típico, marcado como estimado.
- Materiais realistas, texturas, logotipos e iluminação RGB animada.
- Simulação de fluxo de ar ou de temperatura.
- Gabinetes fora do formato torre (horizontais, abertos, de duas câmaras).
- Water cooler customizado (tubos rígidos, reservatório).
- Placas de expansão além da GPU.
- Mudanças em preço, FPS e no agente selecionador.

## Further Notes

- Ordem sugerida: medir desempenho; campos novos de ficha e origem por campo; fonte na orientação real; water cooler,
  discos e cabos que faltam; build explodida e conflito na geometria; extração da ficha; detalhe fino e passo a passo
  com encaixe.
- A extração de ficha é a parte com mais incerteza: páginas de fabricante são inconsistentes e parte das peças vai
  continuar com campos vazios. A cena precisa ficar correta nesse caso, não só no caso bom.
- O trabalho já feito nesta frente ainda não foi commitado. Convém salvá-lo antes de começar esta spec.
- Esta spec não foi publicada como issue; fica só neste arquivo, por decisão do autor.
