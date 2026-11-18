# machine-compose-3d

Planejamento de montagem de PC: entrada com orçamento e jogos, revisão de compatibilidade em duas camadas,
pesquisa de preço com fonte, montagem 3D paramétrica e simulação de FPS. A arquitetura segue o
[OrçaAI](https://github.com/Joaomoura07/OrcaAi-Converge-Challenge): entrada, revisão sem IA, pesquisa de preço com
fonte e resultado com viabilidade. O plano completo está em [docs/PLAN.md](docs/PLAN.md).

> Os dados do seed são **fictícios** (fonte `seed:demo`). Os modelos de peça existem e as fichas são aproximadas,
> mas preços e FPS foram inventados para a demonstração. Com `BUSCA_PROVIDER=serper` e `SERPER_API_KEY`, os preços
> passam a ser reais (Google Shopping via serper.dev, link de cada oferta); FPS continua do seed.

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
cd frontend && pnpm e2e            # cena 3D no navegador (Playwright): interação, conflitos e taxa de quadros
```

## Supabase

```bash
psql "$DATABASE_URL" -f supabase/migrations/001_schema.sql
psql "$DATABASE_URL" -f supabase/migrations/002_specs_origem.sql
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

## Cena 3D

As peças são modelos procedurais gerados da ficha técnica; o método está em [docs/PECAS-3D.md](docs/PECAS-3D.md) e a
spec em [docs/SPEC-VISTA-3D-COMPLETA.md](docs/SPEC-VISTA-3D-COMPLETA.md). Cada medida tem origem: norma, ficha ou
estimado. `POST /componentes/{id}/ficha` busca a página do fabricante e extrai os campos geométricos da ficha (fans,
portas, baias), cada um com URL e dentro de uma faixa plausível; sem `SERPER_API_KEY` ou sem LLM, não roda e o seed
é usado como está. O que a extração grava fica em memória e se perde ao reiniciar a API.

Ao lado da cena fica o painel **Peças da build**: passar o mouse numa linha acende a peça na cena (e vice-versa), e
clicar abre o detalhe com a ficha, a faixa e as ofertas de preço (as mesmas da aba Compra) e o motivo da escolha.
**Trocar** lista as peças do mesmo tipo; clicar numa candidata mostra a build com ela no lugar, com o selo
"Prévia: não aplicada", os conflitos e a diferença de preço. `POST /builds/{id}/cena/previa` monta essa cena sem gravar
nada (sem LLM e sem rastro no Langfuse); só **Aplicar troca** (`POST /builds/{id}/trocar`) altera a build. Esc ou
Cancelar descartam a prévia. Design em [docs/superpowers/specs/2026-11-13-cena-paineis-design.md](docs/superpowers/specs/2026-11-13-cena-paineis-design.md).

A barra da cena tem **Vista: Livre, Frente, Lateral, Topo**; arrastar com o mouse volta a Livre. No painel, **Folgas**
mostra quanto sobra (ou passa) da GPU no gabinete, do cooler na tampa, da memória sob o cooler e da fonte na largura do
gabinete, com os estados cabe, justa, ajuste e não cabe e os mesmos limites da revisão (`backend/app/folgas.py`).
Clicar numa folga leva a câmera à vista da medida e desenha a régua; Esc tira a régua. Na prévia de troca, as folgas que
mudam aparecem na diferença. Design em [docs/superpowers/specs/2026-11-14-vistas-folgas-design.md](docs/superpowers/specs/2026-11-14-vistas-folgas-design.md).

**Qualidade: Auto, Alta, Leve** fica na mesma barra. Leve desenha com densidade de pixels 1 e tira pinos, contatos,
trilhas e contornos das peças fechadas (a peça aberta mostra tudo). Auto começa Leve em tela de toque e desce para Leve
se a cena ficar abaixo de 30 q/s; a escolha manual fica guardada no navegador. No toque, o primeiro toque numa peça mostra
o nome e acende a linha no painel, o segundo abre; 1 dedo rola a página e 2 dedos giram e aproximam a cena. Design em
[docs/superpowers/specs/2026-11-14-celular-design.md](docs/superpowers/specs/2026-11-14-celular-design.md).

**Fluxo de ar** (`backend/app/fluxo.py`): cada ventoinha do gabinete, do pacote de ventoinhas e do radiador ocupa uma
vaga com sentido (frente puxa ar para dentro; traseira e topo jogam para fora). O botão **Fluxo de ar** na barra da
cena mostra setas em cada ventoinha e o ar passando pela GPU e pelo cooler; a seção **Fluxo de ar** do painel traz o
balanço (pressão positiva, equilibrada ou negativa) e o calor estimado (TDP da CPU e da GPU, uma ventoinha a cada
150 W). O revisor de fluxo de ar avisa sem entrada, pressão negativa, poucas ventoinhas e radiador na frente com GPU
quente. Design em [docs/superpowers/specs/2026-11-14-fluxo-de-ar-design.md](docs/superpowers/specs/2026-11-14-fluxo-de-ar-design.md).
