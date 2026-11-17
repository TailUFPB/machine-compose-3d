-- Origem por campo da ficha: {campo: {"url": ..., "coletado_em": ...}}. Só campos extraídos de uma página têm entrada
-- (regra: valor extraído sem URL não é gravado); campo do seed fica fora do mapa.
alter table componentes add column if not exists specs_origem jsonb not null default '{}';
