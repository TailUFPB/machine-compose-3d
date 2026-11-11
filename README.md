# machine-compose-3d

Planejamento de montagem de PC: entrada com orçamento e jogos, revisão de compatibilidade em duas camadas,
pesquisa de preço com fonte, montagem 3D paramétrica e simulação de FPS. A arquitetura segue o
[OrçaAI](https://github.com/Joaomoura07/OrcaAi-Converge-Challenge): entrada, revisão sem IA, pesquisa de preço com
fonte e resultado com viabilidade. O plano completo está em [docs/PLAN.md](docs/PLAN.md).

> Os dados do seed são **fictícios** (fonte `seed:demo`). Os modelos de peça existem e as fichas são aproximadas,
> mas preços e FPS foram inventados para a demonstração.

## Regras de ouro (como o código garante)

| Regra | Onde |
|---|---|
| Nenhum preço sem fonte | `precos.calcular` descarta oferta sem URL; `ofertas.url` é `not null` e não pode ser vazio no SQL |
| Nenhum FPS sem fonte | `fps.Estimativa` sempre traz `tipo` (medido/estimado), faixa, confiança e `fontes` |
| Achado sem fonte = não verificado e nunca bloqueia | `consolidador.consolidar`, mais uma `check` em `revisao_achados` |
| Nada muda na build sem clique | o agente devolve uma `Proposta`; só `POST /builds/{id}/aplicar` e as rotas de item alteram a build |

## Rodar

```bash
# API (Python 3.11+, uv)
cd backend && uv sync && uv run uvicorn app.main:app --reload       # http://localhost:8000/docs

# Front (Node 22, pnpm)
cd frontend && pnpm install && pnpm dev                               # http://localhost:3000
```

Se a API rodar em outra porta, ajuste `NEXT_PUBLIC_API_URL` em `frontend/.env.local` e inclua a origem do front em `CORS_ORIGINS`.
Sem `.env`, tudo roda offline: agentes e extração usam o caminho determinístico. Veja `.env.example` para ligar LLM
(`anthropic` ou qualquer API compatível com OpenAI), Supabase e Langfuse.

## Testes

```bash
cd backend && uv run pytest        # regras, revisores, consolidador, preço, FPS, agente, importação, API
cd frontend && pnpm test           # layout 3D, tutorial, demo de fluidez, formatação
```

## Supabase

```bash
psql "$DATABASE_URL" -f supabase/migrations/001_schema.sql
python3 scripts/gerar_seed.py && python3 scripts/gerar_seed_sql.py   # regenera seed.json e seed.sql
psql "$DATABASE_URL" -f supabase/seed.sql
```

## Como funciona

- **Modos:** *agente* monta tudo; *híbrido* mantém as peças travadas e completa o resto; *manual* revisa a cada
  adição, filtra peças compatíveis (com "ver incompatíveis" mostrando o motivo) e oferece o agente como copiloto.
- **Agente selecionador:** escolhe o par CPU+GPU de menor custo que atinge o FPS-alvo com 15% de folga, completa a
  plataforma pela peça mais barata que atende às restrições e entra no loop propositor ↔ revisores
  (`AGENTE_MAX_TENTATIVAS`). Se o limite estourar, entrega a melhor versão com os alertas.
- **Revisão:** camada 1 (`compat/regras.py`: socket, DDR, slots, form factor, GPU × folga, cooler, TDP × fonte e itens
  faltantes); camada 2 (`compat/revisores.py`: Plataforma, Espaço físico, Elétrico); consolidador (duplicatas,
  contradições, severidade, impacto em preço e FPS).
- **Achado bloqueante:** `BLOQUEANTE_BLOQUEIA_EXPORTACAO=true` impede a exportação (409). O usuário pode forçar
  digitando a confirmação `EXPORTAR MESMO ASSIM`, e a planilha registra o override.
- **Preço:** cache de 7 dias (o vencido serve de reserva), checagem de mesmo produto (4060 ≠ 4060 Ti, 8GB ≠ 16GB),
  outliers fora de 40%..250% da mediana, faixa mín/méd/máx e histórico.
- **FPS:** medido quando há linha na base; senão estimado pelos tetos de GPU e CPU das medições mais próximas, com
  gargalo, 1% low, confiança e FPS por R$ 1.000.
- **3D:** caixas dimensionadas pela ficha (`frontend/src/lib/cena.ts`), com peça em conflito pulsando em vermelho e
  tutorial passo a passo.
