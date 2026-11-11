-- machine-compose-3d: schema Supabase/Postgres.
-- O backend usa a service_role (ignora RLS). O front lê com a anon key: catálogo público, builds só do dono.

create table if not exists componentes (
  id text primary key,
  tipo text not null check (tipo in ('cpu','gpu','placa_mae','memoria','armazenamento','fonte','gabinete','cooler','extra')),
  modelo text not null,
  marca text not null,
  specs jsonb not null default '{}',   -- socket, tdp, dimensoes, form_factor, slots...
  fonte text not null                  -- origem da ficha técnica (regra: nenhum achado sem fonte)
);
create index if not exists componentes_tipo on componentes (tipo);

-- Toda oferta coletada fica guardada: é o histórico de preço.
create table if not exists ofertas (
  id bigint generated always as identity primary key,
  componente_id text not null references componentes(id),
  loja text not null,
  preco numeric(12,2) not null check (preco > 0),
  url text not null check (url <> ''),   -- regra: nenhum preço sem fonte
  coletado_em timestamptz not null default now()
);
create index if not exists ofertas_componente_data on ofertas (componente_id, coletado_em desc);

create table if not exists benchmarks (
  id bigint generated always as identity primary key,
  gpu_id text not null references componentes(id),
  cpu_id text not null references componentes(id),
  jogo text not null,
  resolucao text not null check (resolucao in ('1080p','1440p','2160p')),
  preset text not null,
  fps_medio numeric(7,1) not null,
  fps_1low numeric(7,1) not null,
  fonte text not null,                 -- regra: nenhum FPS sem fonte
  data date not null,
  unique (gpu_id, cpu_id, jogo, resolucao, preset)
);

create table if not exists builds (
  id text primary key,
  usuario text not null,
  modo text not null check (modo in ('agente','hibrido','manual')),
  orcamento numeric(12,2) not null check (orcamento > 0),
  cep text not null default '',
  objetivos jsonb not null default '{}',   -- jogos, resolucao, fps_alvo
  status text not null default 'rascunho' check (status in ('rascunho','revisada','exportada')),
  criado_em timestamptz not null default now()
);

create table if not exists build_itens (
  build_id text not null references builds(id) on delete cascade,
  componente_id text not null references componentes(id),
  quantidade int not null default 1 check (quantidade between 1 and 8),
  travado boolean not null default false,
  ja_tenho boolean not null default false,
  origem text not null check (origem in ('usuario','agente')),
  justificativa text,
  status_pesquisa text not null default 'pendente' check (status_pesquisa in ('pendente','ok','sem_preco')),
  primary key (build_id, componente_id)
);

create table if not exists estimativas (
  build_id text not null references builds(id) on delete cascade,
  jogo text not null,
  resolucao text not null,
  preset text not null,
  fps_min numeric(7,1) not null,
  fps_med numeric(7,1) not null,
  fps_max numeric(7,1) not null,
  confianca text not null check (confianca in ('alta','media','baixa')),
  tipo text not null check (tipo in ('medido','estimado')),
  primary key (build_id, jogo, resolucao, preset)
);

create table if not exists revisao_achados (
  id text not null,                      -- determinístico (regra + peças): status sobrevive a novas revisões
  build_id text not null references builds(id) on delete cascade,
  agente text not null,
  severidade text not null check (severidade in ('bloqueante','atencao','sugestao')),
  itens_envolvidos text[] not null default '{}',
  descricao text not null,
  correcao_sugerida jsonb,
  fonte_url text,
  verificado boolean not null default false,
  status text not null default 'aberto' check (status in ('aberto','aplicado','ignorado')),
  impacto_preco numeric(12,2),
  impacto_fps text,
  fisico boolean not null default false,
  primary key (build_id, id),
  -- regra: sem fonte = não verificado, e não verificado nunca bloqueia
  check (verificado = (fonte_url is not null)),
  check (severidade <> 'bloqueante' or verificado)
);

-- RLS
alter table componentes enable row level security;
alter table ofertas enable row level security;
alter table benchmarks enable row level security;
alter table builds enable row level security;
alter table build_itens enable row level security;
alter table estimativas enable row level security;
alter table revisao_achados enable row level security;

create policy "catalogo publico" on componentes for select using (true);
create policy "ofertas publicas" on ofertas for select using (true);
create policy "benchmarks publicos" on benchmarks for select using (true);
create policy "dono le build" on builds for select using (auth.uid()::text = usuario);
create policy "dono le itens" on build_itens for select
  using (exists (select 1 from builds b where b.id = build_id and b.usuario = auth.uid()::text));
create policy "dono le estimativas" on estimativas for select
  using (exists (select 1 from builds b where b.id = build_id and b.usuario = auth.uid()::text));
create policy "dono le achados" on revisao_achados for select
  using (exists (select 1 from builds b where b.id = build_id and b.usuario = auth.uid()::text));

-- Realtime: o front acompanha revisão e itens sem polling
alter publication supabase_realtime add table builds, build_itens, revisao_achados;
