import pytest

from app import agente
from app.modelos import Build, BuildItem, Objetivos


def nova(store, modo="agente", orcamento=7000, itens=(), **obj):
    b = Build(id="b", modo=modo, orcamento=orcamento, itens=list(itens),
              objetivos=Objetivos(**({"jogos": ["cyberpunk-2077", "cs2"], "resolucao": "1440p", "fps_alvo": 60} | obj)))
    store.builds[b.id] = b
    return b


def tipos(store, p):
    return {store.componentes[i.componente_id].tipo: i for i in p.itens}


@pytest.mark.parametrize("orcamento,res,alvo", [(4500, "1080p", 60), (7000, "1440p", 60), (12000, "1440p", 120)])
def test_agente_monta_build_completa_sem_bloqueantes(store, orcamento, res, alvo):
    b = nova(store, orcamento=orcamento, resolucao=res, fps_alvo=alvo)
    p = agente.propor(store, b)
    t = tipos(store, p)
    assert {"cpu", "gpu", "placa_mae", "memoria", "armazenamento", "fonte", "gabinete"} <= set(t)
    assert p.convergiu and not [a for a in p.achados if a.severidade == "bloqueante"]
    assert p.custo_estimado <= orcamento or p.avisos
    assert all(i.justificativa for i in p.itens)
    assert 1 <= p.tentativas <= 4


def test_proposta_nao_altera_build(store):
    b = nova(store)
    agente.propor(store, b)
    assert b.itens == []


def test_hibrido_respeita_peca_travada(store):
    b = nova(store, modo="hibrido", itens=[BuildItem(componente_id="rtx-4060-8g", travado=True),
                                           BuildItem(componente_id="rx-6600")])
    p = agente.propor(store, b)
    t = tipos(store, p)
    assert t["gpu"].componente_id == "rtx-4060-8g" and t["gpu"].travado
    assert all(i.componente_id != "rx-6600" for i in p.itens)


def test_peca_travada_incompativel_vira_aviso_e_nunca_e_trocada(store):
    b = nova(store, modo="hibrido", itens=[BuildItem(componente_id="i5-12400f", travado=True),
                                           BuildItem(componente_id="mb-b650m-a", travado=True)])
    p = agente.propor(store, b)
    ids = {i.componente_id for i in p.itens}
    assert {"i5-12400f", "mb-b650m-a"} <= ids
    assert not p.convergiu and any("travada" in a for a in p.avisos)


def test_copiloto_manual_so_completa(store):
    b = nova(store, modo="manual", itens=[BuildItem(componente_id="r5-7600"), BuildItem(componente_id="rx-7600")])
    p = agente.propor(store, b)
    t = tipos(store, p)
    assert t["cpu"].componente_id == "r5-7600" and t["gpu"].componente_id == "rx-7600"
    assert t["placa_mae"].origem == "agente"


def test_orcamento_impossivel_avisa(store):
    p = agente.propor(store, nova(store, orcamento=1500))
    assert p.avisos and "mais barata" in p.avisos[0]


def test_ja_tenho_fica_fora_do_custo(store):
    b = nova(store, modo="hibrido", itens=[BuildItem(componente_id="rtx-4070s", ja_tenho=True, travado=True)])
    p = agente.propor(store, b)
    assert agente.custo(store, p.itens) == agente.custo(store, [i for i in p.itens if i.componente_id != "rtx-4070s"])
