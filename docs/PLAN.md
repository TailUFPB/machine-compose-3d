# Plano: machine-compose-3d

Plano em fases para a plataforma de montagem de PC. A referência é o OrçaAI
(entrada, revisão sem IA, pesquisa agêntica de preço com fonte, resultado com viabilidade).

> O pedido original previa aprovação do plano antes de codar. Como o dono do projeto pediu
> para trabalhar sem interrupções, as decisões abaixo usam as opções recomendadas e ficam
> registradas aqui para revisão posterior.

## O que vem do OrçaAI

| OrçaAI | Aqui |
|---|---|
| `src/` em pacote Python plano, FastAPI + Pydantic | `backend/app/` com o mesmo estilo |
| `revisao.py`: regras determinísticas que retornam erros com correção sugerida | `compat/regras.py` (camada 1) |
| `cache.py`: cache de 7 dias, vencido serve de reserva | `precos.py`, mesma regra |
| `calculo.py`: outliers fora de 40%..250% da mediana, faixa mín/med/máx, confiança por nº de lojas e dispersão | mesma fórmula em `precos.py` |
| `precos.py`: o LLM extrai a oferta e confere se é o mesmo produto | extração por LLM + checagem determinística de "mesmo produto" (4060 ≠ 4060 Ti, 8GB ≠ 16GB) |
| `viabilidade.py`: cabe no orçamento, quanto falta, sugestões | `resultado.py` |
| `exportar.py` (openpyxl) | `exportar.py` |
| Langfuse `@observe` | `tracing.py`, um trace por build, cada agente como span |
| Correções exigem aceite do usuário | toda mudança na build passa por `POST /builds/{id}/aplicar` |

## Decisões (recomendações escolhidas)

1. **Sem chaves, tudo funciona.** `LLM_PROVIDER=none` (padrão) usa a heurística determinística
   para os agentes e a extração; `anthropic` ou `openai` (qualquer API compatível) ligam o LLM.
   O padrão garante testes reprodutíveis e demo offline.
2. **Persistência:** repositório em memória, carregado do seed JSON, é a fonte nos testes e na demo.
   Com `SUPABASE_URL` definido, as builds, os achados e o histórico de preço também são gravados no
   Supabase. O schema SQL e o seed SQL são gerados do mesmo JSON (`scripts/gerar_seed_sql.py`).
3. **Busca de preço:** o seed traz ofertas fictícias de Kabum, Pichau, Terabyte, Mercado Livre e
   Amazon. Elas passam pelo mesmo pipeline real (mesmo produto, outliers, faixa). O conector web
   real fica atrás de `BUSCA_PROVIDER` (padrão `seed`).
4. **Achado bloqueante:** flag `BLOQUEANTE_BLOQUEIA_EXPORTACAO=true`. Exportar com bloqueante
   aberto devolve 409, a menos que o pedido traga `override=true` e `confirmacao="EXPORTAR MESMO ASSIM"`.
5. **Fonte obrigatória:** o seed usa a fonte `seed:demo` (dados fictícios) e assim é exibido.
   Achado sem fonte vira `verificado=false` e nunca é bloqueante (o consolidador rebaixa para atenção).
6. **FPS:** medido quando há linha na base; senão interpolado pelo índice relativo de GPU e de CPU
   a partir das medições mais próximas, rotulado "estimado", com faixa e confiança.
7. **3D:** modelos paramétricos (caixas e cilindros dimensionados pela ficha técnica), sem asset por SKU.

## Estrutura de pastas

```
backend/
  app/
    main.py          rotas FastAPI
    config.py        settings (pydantic-settings)
    modelos.py       contratos Pydantic
    store.py         repositório em memória + espelho opcional no Supabase
    seed.json        catálogo fictício: componentes, ofertas, benchmarks
    importar.py      link PCPartPicker, carrinho, texto colado
    compat/
      regras.py      camada 1 (sem IA) + itens faltantes
      revisores.py   camada 2: Plataforma, Espaço físico, Elétrico
      consolidador.py
    agente.py        selecionador (loop propositor <-> revisores)
    llm.py           provedor configurável
    precos.py        pipeline de preço
    fps.py           simulação de jogos
    resultado.py     plano de compra, orçamento, trocas
    exportar.py      Excel
    tracing.py       Langfuse
  tests/
frontend/            Next.js + TS + React Three Fiber, vitest
supabase/
  migrations/001_schema.sql
  seed.sql           gerado
scripts/gerar_seed_sql.py
.env.example
```

## Contratos da API

| Método | Rota | Função |
|---|---|---|
| GET | `/componentes?tipo=&compativel_com=<build_id>&todos=` | catálogo; com build, marca incompatíveis com motivo |
| GET | `/jogos` | jogos e resoluções da base |
| POST | `/builds` | cria build (modo, orçamento, CEP, objetivos) |
| GET | `/builds/{id}` | build + itens + achados |
| POST | `/builds/{id}/importar` | `{texto}`: link, carrinho ou texto vira itens (proposta) |
| POST | `/builds/{id}/itens` | adiciona/troca item (clique do usuário); revisão roda |
| PATCH | `/builds/{id}/itens/{componente_id}` | trava/destrava, quantidade |
| DELETE | `/builds/{id}/itens/{componente_id}` | remove |
| POST | `/builds/{id}/revisar` | camada 1 + camada 2 + consolidador |
| POST | `/builds/{id}/agente` | proposta do agente (modo agente/híbrido/copiloto); não altera a build |
| POST | `/builds/{id}/aplicar` | aplica proposta ou correção de achado (único caminho de mudança automática) |
| POST | `/builds/{id}/achados/{achado_id}/ignorar` | |
| GET | `/builds/{id}/precos` | pesquisa de preço por item (cache 7 dias) |
| GET | `/builds/{id}/fps` | estimativas por jogo |
| GET | `/comparar?a=&b=` | FPS lado a lado |
| GET | `/builds/{id}/resultado` | plano por loja, orçamento, trocas |
| POST | `/builds/{id}/exportar` | xlsx; respeita a flag de bloqueante |
| GET | `/builds/{id}/cena` | dados paramétricos da cena 3D + achados físicos |

## Ordem de implementação (fatias verticais)

1. Seed + store + `/componentes` + `/builds` CRUD (pytest)
2. Camada 1 + itens faltantes + filtro de compatíveis (pytest)
3. Pipeline de preço com histórico (pytest)
4. Simulação de FPS (pytest)
5. Revisores da camada 2 + consolidador (pytest)
6. Agente selecionador: agente, híbrido, copiloto (pytest)
7. Resultado + exportação + flag de bloqueante (pytest)
8. Importação (pytest)
9. Front: lista editável, modos, revisão, preço, FPS, resultado (vitest)
10. Front: cena 3D paramétrica, tutorial animado, conflitos em vermelho, demo de fluidez
11. SQL Supabase + seed SQL + `.env.example` + README

## Ideias de features (branches `ideia/*`)

Cada uma sai de `main` depois do MVP, com testes.

- `ideia/alerta-preco`: lista de observação com preço-alvo, usa o histórico de preço.
- `ideia/caminho-upgrade`: ranking de upgrades por ganho de FPS por real sobre uma build existente.
- `ideia/custo-energia`: consumo estimado por hora de jogo e custo mensal pela tarifa do estado.
- `ideia/compartilhar-build`: link público só-leitura e exportação para texto/Markdown.
