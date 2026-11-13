# Design: cena 3D integrada aos painéis (frente 1 da issue #2)

Repo: `TailUFPB/machine-compose-3d` · base: branch `feat/vista-3d-completa` (PR #8, ainda aberta) · data: 13/11/2026.
Aprovado pela usuária em 13/11/2026. Plano de implementação executado na branch `feat/cena-paineis`.

## Intenção e o porquê

Hoje a cena 3D e a lista de peças nunca aparecem na mesma tela: a aba **3D** só desenha a cena; remover, quantidade e
travar ficam na aba **Peças** (`Montagem`, `Paineis.tsx:373-494`); preço e ofertas só na aba **Compra**
(`ResultadoPainel`, `Paineis.tsx:644-735`); o motivo da escolha só no cartão da proposta (`PropostaCard`). Quem olha a
cena vê um conflito em vermelho, mas precisa sair dela para entender o preço ou trocar a peça, e não consegue ver
**antes** de trocar se a peça nova vai caber.

Resultado esperado: na aba 3D, olhar, entender e corrigir a build sem sair da cena, e ver uma troca no lugar antes de
aplicá-la. Itens da issue #2 cobertos: "clicar na peça abre os detalhes: ficha, preço, ofertas e por que foi escolhida",
"trocar ou remover a peça direto da cena", "lista e cena sincronizadas".

## O que a usuária decidiu

1. **Painel na aba 3D**, ao lado da cena (cena ~2/3, painel ~1/3). No celular, o painel vai para baixo da cena.
2. **Trocar com prévia antes de aplicar**: escolher uma candidata mostra na cena como a build ficaria (peça no lugar,
   conflitos e medida do excesso); só "Aplicar troca" altera a build.

## Comportamento

### Painel sem peça aberta: lista da build
- Uma linha por peça da build (sem extras): nome, tipo, preço mediano, ícone de conflito se a peça está num conflito
  aberto da cena, marca de travada/já tenho.
- **Hover sincronizado**: passar o mouse (ou foco de teclado) numa linha acende a peça na cena; passar o mouse na peça
  na cena destaca a linha. Destaque na cena = brilho (emissive) na peça, distinto do pulso vermelho de conflito.
- Clicar na linha abre a peça (mesmo efeito dos botões `abrir-*` de hoje: vista explodida + câmera).

### Painel com peça aberta: detalhe
- Nome, tipo e um resumo da ficha (os campos principais por tipo; não a ficha inteira).
- **Preço**: faixa mín/méd/máx, confiança, ofertas com loja, preço e link (`api.precos`), mesmo conteúdo que a aba
  Compra mostra hoje para essa peça.
- **Por que foi escolhida**: `BuildItem.justificativa` quando existe (peça do agente); senão, "escolhida por você".
- **Dados desta peça** (`DadosPeca`: links da ficha e campos estimados) continua sob a cena (ver "Chamadas minhas").
- Ações: **Trocar**, **Remover**. Peça travada ou "já tenho": as duas ficam desabilitadas com o motivo
  ("destrave para trocar" / "desmarque Já tenho para trocar"), igual à regra do backend (409).
- **Remover** pede confirmação no próprio botão (segundo clique confirma). Ao remover, o painel volta para a lista.

### Trocar com prévia
1. "Trocar" abre a lista de candidatas do mesmo tipo (`api.componentes(tipo, build.id, todos)`): nome, preço, e para
   incompatíveis o motivo; chip "Incompatíveis" igual ao da aba Peças. A candidata atual não aparece.
2. **Clicar numa candidata = prévia.** A cena passa a desenhar a build com a candidata no lugar:
   - selo visível "Prévia: não aplicada" sobre a cena;
   - a candidata fica destacada; se a prévia tem conflito físico, a câmera vai até a região e mostra a medida
     ("passa 22 mm"), reaproveitando `regioesDeConflito`;
   - o painel mostra a diferença: preço (+/- R$), conflitos que aparecem e que somem.
3. **Aplicar troca** grava (`POST /builds/{id}/trocar`), a revisão roda, a cena e a lista
   saem da prévia já com a build nova. **Cancelar** (ou Esc) volta à build atual sem gravar nada.
4. Trocar de candidata durante a prévia troca a prévia (a última pedida vence; respostas atrasadas são ignoradas).
5. A prévia nunca grava nada: nem build, nem achados, nem espelho no Supabase.

## Backend (mudança mínima)

- Helper puro `itens_trocados(build, de, para)`: troca exatamente o item `de` por `para`, para **qualquer tipo**
  (inclusive armazenamento, que não é tipo único), mantendo `quantidade`; o novo item vem com `origem="usuario"`,
  sem justificativa. Valida: componentes existem (404), mesmo tipo (422), `de` está na build (404), `de` não está
  travado (409, "destrave para trocar") nem é "já tenho" (409, "desmarque Já tenho para trocar").
- Nova rota **`POST /builds/{id}/trocar`** `{de, para}`: aplica o helper e grava numa única operação, depois revisa e
  salva (`_revisar_e_salvar`). É o "Aplicar troca".
- Nova rota **`POST /builds/{id}/cena/previa`** `{de, para}`: aplica o mesmo helper **sem gravar**, roda a revisão sem
  passada de LLM e sem trace, e devolve a mesma forma de `GET /builds/{id}/cena`, mais `diferenca_preco`
  (`agente.custo` hipotético − atual).
- `revisores.revisar` e `consolidador.revisar_build` ganham `llm: bool = True`; a prévia passa `False`.
- Refatorar a montagem da resposta de `GET /cena` (`main.py`, função `cena`) num helper usado pela cena e pela prévia,
  para as duas nunca divergirem.
- Nada muda em `adicionar`/`remover`/`precos`/`componentes`.

## Onde a frente entra

Branch nova a partir de `feat/vista-3d-completa` (PR #8, aberta), com PR apontando para ela; quando a #8 entrar na
`main`, a PR passa a apontar para a `main`. Decisão da usuária.

## Restrições

- Regra de ouro do projeto: **nada muda na build sem clique**. A prévia é só leitura; aplicar é um clique explícito.
- Preço sem fonte não aparece (o painel mostra só o que `precos` devolve, que já descarta oferta sem URL).
- Não quebrar os 8 testes de navegador da PR #8 nem o layout em 390 px (`e2e/cena.spec.ts:114`).
- Taxa de quadros: o destaque de hover não pode derrubar o piso de 30 q/s (o teste de quadros continua passando).
- Acesso: tudo por teclado (lista, abrir, trocar, aplicar, cancelar, Esc), e a descrição textual da cena diz quando é
  prévia.
- Estilo: classes existentes de `globals.css` (`.card`, `.duas`, `.lista li.ativo`, `.btn`, `.pill`); o padrão de hover
  sincronizado já existe em `OrcamentoPecaAPeca` (`Paineis.tsx:195-233`, `foco`/`onFoco`).

## Não-objetivos

- Trocar ou remover clicando direto no canvas (o clique na peça continua abrindo a vista explodida; ações ficam no
  painel).
- Prévia para "adicionar" peça que falta ou para "aplicar correção" de achado (só troca, nesta frente).
- Mexer nas abas Peças e Compra além de extrair componentes reutilizáveis.
- Vistas prontas, régua de folga, celular com gestos, fluxo de ar (frentes 2–4).

## Anti-objetivos (falharia mesmo funcionando)

- A prévia gravar qualquer coisa ou deixar a build num estado que a usuária não aplicou.
- A cena "piscar" ou perder a câmera a cada candidata clicada.
- O painel mostrar preço diferente da aba Compra para a mesma peça.

## Chamadas minhas (a revisar)

- Prévia por **clique** na candidata, não por hover (hover dispararia uma revisão por movimento do mouse).
- Remover com confirmação por segundo clique, sem modal.
- Destaque de hover por brilho, não por contorno.
- Prévia limitada a troca 1-por-1; a rota recebe `{de, para}` e não uma lista livre de itens.
- Rota nova `trocar` em vez de reaproveitar `adicionar`: troca atômica para qualquer tipo e bloqueio de "já tenho" no
  backend, sem mudar o comportamento de `adicionar`.
- A diferença de conflitos na prévia cobre só os conflitos que a cena desenha (físicos ou bloqueantes); por isso a
  prévia pula a passada de LLM e o trace (sem custo nem latência por clique).
- **Revisto ao planejar:** os botões `abrir-*`, o `DadosPeca` e a lista de conflitos **ficam onde estão** dentro de
  `Cena3D`. Os testes de navegador dependem do grupo "Abrir peça em vista explodida" com botões de nome curto
  ("GPU"); mover tudo para o painel mudaria esses nomes. O painel é a lista da build (com hover, preço e conflito) e o
  detalhe, e abre a peça pelo mesmo estado `aberta`. Fica uma pequena duplicação (chips curtos na cena e linhas no
  painel), aceita nesta frente.
- "Sem trace" na prévia vale também para os spans das camadas determinísticas: `tracing` ganha `sem_rastro()`.
- Ao aplicar uma troca, o painel abre a peça nova.
