-- Cache compartilhado de anúncios, links resolvidos e consumo diário da Serper.

create table if not exists cache_anuncios (
  componente_id text primary key references componentes(id) on delete cascade,
  familia text,
  anuncios jsonb not null default '[]',
  buscado_em timestamptz not null default now()
);

create table if not exists links_resolvidos (
  chave text primary key,
  url text not null,
  atualizado_em timestamptz not null default now()
);

create table if not exists consumo_serper (
  data date primary key,
  creditos int not null default 0
);
