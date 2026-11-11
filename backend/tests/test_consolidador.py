from app.compat.consolidador import consolidar, revisar_build
from app.modelos import Achado, Build, Correcao
from conftest import BASE_OK, itens


def build(store, ids):
    return Build(id="b1", itens=itens(*ids))


def test_sem_fonte_nunca_bloqueia(store):
    b = build(store, BASE_OK)
    a = Achado(id="x", agente="eletrico", severidade="bloqueante", itens_envolvidos=["psu-a750gl"], descricao="palpite")
    [r] = consolidar(store, b, [a])
    assert r.severidade == "atencao" and not r.verificado and "não verificado" in r.descricao


def test_duplicata_fica_a_mais_grave(store):
    b = build(store, BASE_OK)
    corr = Correcao(acao="trocar", componente_id="psu-a750gl", para_id="psu-rm850e")
    a1 = Achado(id="a", agente="eletrico", severidade="atencao", itens_envolvidos=["psu-a750gl"], descricao="1",
                correcao_sugerida=corr, fonte_url="f")
    a2 = Achado(id="b", agente="regras", severidade="bloqueante", itens_envolvidos=["psu-a750gl"], descricao="2",
                correcao_sugerida=corr, fonte_url="f")
    r = consolidar(store, b, [a1, a2])
    assert [x.id for x in r] == ["b"]


def test_contradicao_mantem_correcao_do_mais_grave(store):
    b = build(store, BASE_OK)
    a1 = Achado(id="a", agente="regras", severidade="bloqueante", itens_envolvidos=["psu-a750gl"], descricao="1",
                correcao_sugerida=Correcao(acao="trocar", componente_id="psu-a750gl", para_id="psu-rm850e"), fonte_url="f")
    a2 = Achado(id="b", agente="eletrico", severidade="atencao", itens_envolvidos=["psu-a750gl", "rtx-4060-8g"], descricao="2",
                correcao_sugerida=Correcao(acao="trocar", componente_id="psu-a750gl", para_id="psu-focus-1000"), fonte_url="f")
    r = {x.id: x for x in consolidar(store, b, [a2, a1])}
    assert r["a"].correcao_sugerida.para_id == "psu-rm850e"
    assert r["b"].correcao_sugerida is None and "conflitava" in r["b"].descricao


def test_impacto_em_preco_e_fps(store):
    lista = [x if x != "mb-b650m-a" else "mb-b760-tuf-d5" for x in BASE_OK]
    b = Build(id="b2", itens=itens(*lista))
    b.objetivos.jogos = ["cs2"]
    socket = next(a for a in revisar_build(store, b) if a.id.startswith("par:socket"))
    assert socket.impacto_preco is not None and socket.impacto_fps == "sem impacto no FPS"


def test_ignorado_persiste_entre_revisoes(store):
    b = Build(id="b3", itens=itens(*BASE_OK))
    b.achados = revisar_build(store, b)
    alvo = next(a for a in b.achados if a.id.startswith("faltante:so"))
    alvo.status = "ignorado"
    novos = revisar_build(store, b)
    assert next(a for a in novos if a.id == alvo.id).status == "ignorado"
