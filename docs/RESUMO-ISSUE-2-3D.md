# Resumo: issue #2 "Composição 3D do PC"

Branch de integração `integracao/3d-issue-2`: `main` + os PRs #8, #9, #12, #13, #14 e #16, mesclados nessa ordem (merge commit, autoria preservada).
Total: 67 arquivos, +7.461/-224 linhas, 30 commits (24 Nicole, 5 João Arruda, 1 João Bosco).
Não inclui os PRs de outras frentes (#4-7 ideias, #10-11 e #15 preço/cache).

## Quem construiu o quê

### João Arruda, PR #8 `feat/vista-3d-completa`
- Cena deixa de ser uma caixa por peça: cada peça é montada a partir da ficha (gabinete, placa-mãe, CPU, cooler a ar, water cooler, memória, GPU, M.2, SATA 2,5" e 3,5", fonte).
- Encaixe por âncoras (GPU no slot PCIe, memória nos slots, cooler na CPU, discos nas baias), pinos e contatos visíveis.
- Cabos de energia, fans, painel frontal e mangueiras, sem atravessar peças.
- Build explodida, conflito mostrado na geometria com a medida do excesso, passo a passo com alavancas e travas.
- Ficha com origem por campo (norma, ficha ou estimado), `POST /componentes/{id}/ficha`, migration `002_specs_origem.sql`.
- Docs: `docs/PECAS-3D.md`, `docs/SPEC-VISTA-3D-COMPLETA.md`.

### Nicole
- **#9 `feat/cena-paineis`:** painel "Peças da build" sincronizado com a cena (hover nos dois sentidos), detalhe da peça com preço e ofertas, remover com confirmação, trocar com prévia (`POST /builds/{id}/trocar`, `POST /builds/{id}/cena/previa`, sem gravar nem rastrear).
- **#12 `feat/vistas-folgas`:** vistas Frente/Lateral/Topo com câmera animada, seção Folgas (`backend/app/folgas.py`: GPU x gabinete, cooler x tampa, memória x cooler, fonte x largura), régua na cena, diferença de folgas na prévia. Limites compartilhados com `revisores.py`.
- **#13 `feat/celular`:** qualidade Auto/Alta/Leve (Auto desce para Leve abaixo de 30 q/s por 3 s), toque (1º toque mostra o nome, 2º abre), um dedo rola a página e dois giram e aproximam.
- **#14 `feat/fluxo-ar`:** `backend/app/fluxo.py` (vagas de ventoinha, sentido entrada/saída, pressão, calor, recomendadas), revisor `fluxo_de_ar` com 4 achados não físicos, botão "Fluxo de ar" com setas e partículas, seção no painel.

### João Bosco, PR #16 `feat/3d-dicas-progresso`
- Barra de progresso e dica por tipo de peça no passo a passo (abaixo da cena, para não deslocar o canvas) (`DICAS` em `frontend/src/lib/cena.ts`).
- Luz hemisférica e contraluz, sombras projetadas na qualidade Alta (modo PCF), acabamento brilhante em metais, aviso quando o WebGL está indisponível (sem derrubar a página).
- Estado: 110 testes de frontend e 159 de backend passando, build ok.

## Checklist da issue #2

Feito: formas fiéis procedurais, clicar na peça abre detalhes, trocar/remover pela cena, lista e cena sincronizadas, vista explodida, folgas em mm e régua,
conflito na região exata, foco automático no conflito, vistas prontas, câmera no passo, dicas e barra de progresso, fluxo de ar,
qualidade menor e gestos de toque, descrição textual, testes de layout (ITX, torre média, AIO 360).

Pendente: modelos GLTF por tipo de peça, cabos que não se cruzem, medição em celular real (só emulação), Safari/iPhone sem teste.

## Atenção antes de mesclar

- **Segurança no #8 (Nicole comentou, sem correção no código):** `backend/app/ficha.py:130` aceita qualquer host que tenha a marca num rótulo (ex.: `lian-li.qualquercoisa.com`) e `_texto_da_pagina` não bloqueia IP privado/loopback (SSRF); `POST /componentes/{id}/ficha` (`main.py`) não tem autenticação, gasta Serper e LLM e altera o catálogo global. Corrigir antes de expor a API.
- Os 6 PRs já estão mesclados na integração; o merge final na `main` é o PR único desta branch (`Closes #2`).
- Limites conhecidos de cada PR estão nos corpos deles (régua escondida mas ligada ao explodir, aviso de vagas com pacote pequeno, abrir peça em Leve remonta a malha).
- A migration `supabase/migrations/002_specs_origem.sql` precisa rodar no Supabase.
