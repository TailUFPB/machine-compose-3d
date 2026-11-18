# Design: fluxo de ar na cena 3D e na revisão (frente 4 da issue #2)

Repo: `TailUFPB/machine-compose-3d`. Base: branch `feat/celular` (PR #13, sobre #12, #9 e #8). Data: 14/11/2026.
Depois de aprovado, vai para `docs/superpowers/specs/2026-11-14-fluxo-de-ar-design.md` (commitado).

## Intenção e o porquê

A cena mostra onde cada peça encaixa, as folgas e os cabos (#8). Não mostra para onde o ar vai: as ventoinhas do
gabinete (`posicoes_fan` e `fans_inclusos` na ficha, desenhadas em `lib/gabinete.ts`) giram, mas não se sabe quais puxam
ar para dentro e quais jogam para fora. A revisão sabe pouco do assunto: só `faltante:fans` em `compat/regras.py`, que
avisa quando o gabinete vem com menos de 2 ventoinhas.

Quem monta quer saber três coisas:
- se o ar frio entra e o quente sai;
- se há ventoinha suficiente para o calor da CPU e da GPU;
- se o water cooler está num lugar que piora a GPU.

Item da issue #2 coberto: "Fluxo de ar (ventoinhas e direção do ar), junto com o revisor de espaço físico". A
passagem de cabos, citada no mesmo item, já entrou na #8.

## O que a usuária decidiu

1. **Cada ventoinha do gabinete tem um sentido.** É entrada (frente, radiador na frente) ou saída (traseira, topo,
   radiador no topo), e a cena mostra esse sentido.
2. **Botão "Fluxo de ar" na barra da cena.** Liga setas animadas com o caminho do ar: entra frio pela frente, passa
   pela GPU e pelo cooler e sai quente por trás e pelo topo.
3. **Revisor de fluxo de ar no backend**, junto com o de espaço físico, com três verificações:
   - o balanço entre entrada e saída (pressão positiva ou negativa);
   - poucas ventoinhas para o calor da CPU e da GPU;
   - radiador na frente jogando ar quente na GPU.
   Os achados aparecem na revisão e no painel, como as folgas.

## Comportamento

### Ventoinhas e sentido (backend, fonte única)
- Novo `backend/app/fluxo.py`, módulo puro como `folgas.py`. A cena e a revisão usam os mesmos números, para nunca
  discordarem (mesma lição da régua × revisão).
- **Vagas** do gabinete por posição (frente, topo, traseira): vêm de `posicoes_fan`. Sem esse campo, usa a mesma
  estimativa de `lib/gabinete.ts`, portada para o backend: uma atrás, até três na frente e duas no topo, limitadas
  pelas dimensões.
- **Ocupação das vagas:**
  - Ventoinhas inclusas (`fans_inclusos`) ocupam as vagas na ordem de hoje: traseira, frente de baixo para cima,
    topo.
  - O pacote de ventoinhas (`extra` com `categoria: "ventoinhas"`, o `ext-fan-3pack`, que traz 3) ocupa as vagas
    livres nesta ordem: frente, traseira, topo. Hoje o pacote não aparece na cena; passa a aparecer.
  - Água: o radiador ocupa a face dele, frente ou topo (`radiador_na_frente` de `folgas.py`), no lugar das ventoinhas
    do gabinete nessa face, como a cena já faz. As ventoinhas do radiador (`fans` do cooler) contam no sentido da face.
- **Sentido:** frente é entrada; traseira e topo são saída. Não há "fundo" nas fichas.
- `GET /cena` e `POST /cena/previa` devolvem `fluxo`:
  - `ventoinhas`: lista de `{vaga, indice, sentido, origem}`, com `origem` em `gabinete | pacote | radiador`;
  - `entrada` e `saida`: contagens;
  - `pressao`: `positiva | equilibrada | negativa`;
  - `calor_w`: TDP da CPU mais TDP da GPU;
  - `recomendadas`: número de ventoinhas recomendado para esse calor.
- A cena desenha as ventoinhas do gabinete a partir dessa lista. Isso substitui o `fans_inclusos` direto em
  `gabineteModelo`: o que a revisão conta é o que aparece.

### Revisor de fluxo de ar
- Nova função `fluxo_de_ar` em `compat/revisores.py`, registrada em `REVISORES`. Ela entra em `FOCO`, e a passada de
  LLM recebe o foco do revisor.
- Achados (`_achado`, `fisico=False`; ver "Casos de borda"):
  - **`fluxo:sem_entrada`** (atenção): nenhuma ventoinha de entrada. "Sem ventoinha de entrada: o ar frio só entra
    pelas frestas."
  - **`fluxo:pressao_negativa`** (sugestão): mais saída que entrada. "Pressão negativa: o gabinete puxa poeira pelas
    frestas; ponha mais uma ventoinha de entrada na frente."
  - **`fluxo:poucas_fans`** (atenção):
    - quando há menos ventoinhas no gabinete que as `recomendadas` para o `calor_w`;
    - regra: `max(2, ceil(calor_w / 150))`, marcada como estimativa no texto;
    - correção: adicionar o pacote de ventoinhas, como `faltante:fans` já faz;
    - substitui `faltante:fans` de `regras.py`, que sai, para a revisão não dar o mesmo aviso duas vezes.
  - **`fluxo:radiador_gpu`** (sugestão):
    - quando o radiador está na frente e a GPU tem TDP de 250 W ou mais;
    - texto: "O radiador na frente sopra ar já aquecido pela CPU na GPU"; com o gabinete aceitando o radiador no
      topo, sugere o topo;
    - não repete o `espaco:radiador_gpu`, que trata do comprimento da GPU.
- Os achados são medida da ficha, como as folgas. Achado ignorado na revisão não muda o `fluxo` da cena.

### Na cena
- **Botão "Fluxo de ar"** na barra (`btn`, `aria-pressed`). Ele funciona com a build montada; ao abrir peça, explodir,
  entrar no passo a passo ou na prévia, ele desliga.
- **Ligado:**
  - cada ventoinha do gabinete e do radiador ganha uma seta no sentido do ar, azul na entrada e laranja na saída;
  - partículas andam do lado da frente, passam pela GPU e pelo cooler e saem pela traseira e pelo topo; a cor vai
    de azul a laranja ao longo do caminho;
  - sem entrada, as partículas entram fracas pelas frestas da frente. A ideia é mostrar o problema do achado.
- **Qualidade Leve** (frente 3): menos partículas. **Movimento reduzido:** setas paradas ao longo do caminho, sem
  animação.
- A descrição textual da cena ganha a frase do fluxo, por exemplo: "Fluxo de ar: 3 entradas na frente, 2 saídas
  (traseira e topo), pressão positiva."
- Teclado: o botão é alcançável por Tab, e Esc desliga o fluxo como desliga a régua.

### No painel
- Seção **"Fluxo de ar"** no painel "Peças da build", abaixo de "Folgas":
  - "Entrada 3 · Saída 2 · pressão positiva";
  - "Calor 440 W (CPU 120 + GPU 320): 3 ventoinhas recomendadas, há 5", com a classe de estado `cabe` ou
    `nao_cabe`, como as folgas.
- Clicar na seção liga o botão "Fluxo de ar" da cena.
- Na prévia de troca, a diferença ganha a linha do fluxo quando ele muda, por exemplo "Ventoinhas recomendadas:
  3 → 4".

### Casos de borda (decididos depois da leitura do revisor)
- **Achados de fluxo não são conflitos na cena.** Eles usam `fisico=False`, porque `_dados_cena` transforma achado
  físico em região vermelha e em conflito no painel. Aparecem na revisão e na seção "Fluxo de ar", nunca pintando
  peça. Isso mantém os testes de conflito como estão.
- **Radiador e vagas:**
  - o radiador fica com a face dele inteira, porque a cena o desenha centralizado nela. Só as ventoinhas dele contam
    nessa face (`fans` do cooler). Isso foi mudado na revisão final: com "só as vagas que as ventoinhas dele ocupam",
    uma ventoinha do pacote era desenhada dentro do radiador;
  - as ventoinhas inclusas do gabinete que perderam a vaga vão para as vagas livres, na ordem de sempre (traseira,
    frente, topo), porque quem monta move a ventoinha e não a joga fora;
  - o pacote ocupa o que sobrar.
- **Radiador "cabe no topo"** quando `posicoes_fan.topo × 120 ≥ radiador_mm`. A sugestão é só texto. A posição do
  radiador é dado do cooler, e mudar isso pela build fica fora desta frente.
- **`recomendadas` conta todas as ventoinhas do `fluxo`:** gabinete, pacote e radiador. É o que move ar pelo gabinete.
- **Pacote:** traz `fans × quantidade` ventoinhas. O seed ganha `fans: 3` no `ext-fan-3pack`, como diz o nome do
  produto, e o que não couber nas vagas fica de fora da conta.
- **`fluxo:poucas_fans` com o pacote já na build:** o aviso continua, sem correção, e o texto diz que faltam vagas no
  gabinete. `test_regras.py::test_itens_faltantes_sao_sugestoes` deixa de esperar `faltante:fans`. O caso passa a ser
  coberto nos testes de `fluxo`.

## Restrições
- Não quebrar os 50 testes de navegador, os 143 de backend nem o piso de 30 q/s, com o fluxo ligado em Alta no
  notebook.
- Os botões novos cabem em 390 px.
- A revisão e a cena nunca discordam do número de ventoinhas nem do sentido. Um teste de concordância roda sobre
  todos os gabinetes do seed, com e sem pacote e com e sem water cooler.
- Os números da regra de calor (`150 W` por ventoinha, mínimo 2, TDP da GPU ≥ 250 W para o radiador) ficam como
  constantes em `fluxo.py` e vão no texto como estimativa.
- Usar as classes existentes de `globals.css`. CSS novo só para a seção do painel, se precisar.

## Não-objetivos
- Simulação de fluido ou de temperatura real. As partículas mostram o caminho, não a física.
- Escolha manual do sentido de cada ventoinha. O sentido é o padrão da posição.
- Vaga no fundo e ventoinha lateral (as fichas não têm).
- Curva de ventoinha, RPM ou ruído.
- Contar as ventoinhas da GPU e da fonte. Elas não mudam o balanço do gabinete.

## Anti-objetivos
- A cena mostrar uma quantidade de ventoinhas diferente da que a revisão conta.
- Avisar duas vezes a mesma coisa (`faltante:fans` e `fluxo:poucas_fans`).
- O fluxo ligado tapar o conflito, a régua ou a peça que importa.
- Um número de calor apresentado como medido.

## Chamadas minhas (a revisar)
- Frente é entrada; traseira e topo são saída. Radiador na frente é entrada, radiador no topo é saída.
- O pacote ocupa as vagas livres na ordem frente, traseira, topo.
- A regra de calor é `max(2, ceil(calor_w / 150))`, estimativa marcada como tal.
- Para o achado do radiador na frente, o corte é GPU com 250 W ou mais.
- `fluxo:poucas_fans` substitui `faltante:fans`.
- Pressão: positiva com mais entrada, equilibrada com igual, negativa com menos.
- O fluxo desliga com peça aberta, build explodida, passo a passo e prévia.
- A frente entra empilhada em `feat/celular` (PR #13).

## Deixado para quem constrói
- Como desenhar as partículas: `InstancedMesh` andando sobre curvas, ou pontos.
- Por onde passa o caminho entre as âncoras do gabinete, da GPU e do cooler.
- Como portar a estimativa de vagas de `gabinete.ts` sem divergir: um teste dos dois lados com o seed.

