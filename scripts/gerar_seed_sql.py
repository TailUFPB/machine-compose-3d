"""Gera supabase/seed.sql a partir de backend/app/seed.json (mesma fonte da demo e dos testes)."""

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
seed = json.loads((RAIZ / "backend/app/seed.json").read_text())


def q(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=False)
    return "'" + str(v).replace("'", "''") + "'"


linhas = ["-- Gerado por scripts/gerar_seed_sql.py. Dados FICTÍCIOS de demonstração (fonte seed:demo).", "begin;"]
for c in seed["componentes"]:
    linhas.append(f"insert into componentes (id, tipo, modelo, marca, specs, fonte) values ({q(c['id'])}, {q(c['tipo'])}, "
                  f"{q(c['modelo'])}, {q(c['marca'])}, {q(c['specs'])}::jsonb, {q(c['fonte'])}) on conflict (id) do nothing;")
for o in seed["historico_precos"]:
    linhas.append(f"insert into ofertas (componente_id, loja, preco, url, coletado_em) values ({q(o['componente_id'])}, "
                  f"{q(o['loja'])}, {o['preco']}, {q(o['url'])}, {q(o['coletado_em'])});")
for b in seed["benchmarks"]:
    linhas.append(f"insert into benchmarks (gpu_id, cpu_id, jogo, resolucao, preset, fps_medio, fps_1low, fonte, data) values "
                  f"({q(b['gpu_id'])}, {q(b['cpu_id'])}, {q(b['jogo'])}, {q(b['resolucao'])}, {q(b['preset'])}, "
                  f"{b['fps_medio']}, {b['fps_1low']}, {q(b['fonte'])}, {q(b['data'])}) on conflict do nothing;")
linhas.append("commit;")
(RAIZ / "supabase/seed.sql").write_text("\n".join(linhas) + "\n")
print(f"{len(linhas)} linhas -> supabase/seed.sql")
