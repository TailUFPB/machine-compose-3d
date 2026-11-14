import json
from pathlib import Path

from app import fluxo
from conftest import BASE_OK

VAGAS = json.loads((Path(__file__).parent / "vagas_seed.json").read_text())


def pecas(store, *ids):
    """Peças por tipo (como revisores._pecas) e extras com quantidade: `id` ou `id*n`."""
    p, extras = {}, []
    for i in ids:
        cid, _, n = i.partition("*")
        c = store.componentes[cid]
        if c.tipo == "extra":
            extras.append((c, int(n or 1)))
        else:
            p[c.tipo] = c
    return p, extras


def calc(store, *ids):
    return fluxo.calcular(*pecas(store, *ids))


def vagas_de(f):
    return {(v.vaga, v.indice): (v.sentido, v.origem) for v in f.ventoinhas}


def test_vagas_do_seed(store):
    for c in store.por_tipo("gabinete"):
        assert fluxo.vagas(c) == VAGAS[c.id], c.id


def test_inclusas_ocupam_traseira_frente_topo(store):
    f = calc(store, "case-h5-flow")
    assert vagas_de(f) == {("traseira", 0): ("saida", "gabinete"), ("frente", 0): ("entrada", "gabinete")}
    assert (f.entrada, f.saida, f.pressao) == (1, 1, "equilibrada")


def test_pacote_preenche_frente_primeiro(store):
    f = calc(store, "case-h5-flow", "ext-fan-3pack")
    novas = {k for k, (_, o) in vagas_de(f).items() if o == "pacote"}
    assert novas == {("frente", 1), ("frente", 2), ("topo", 0)}
    assert (f.entrada, f.saida, f.pressao) == (3, 2, "positiva")


def test_pacote_vezes_quantidade_e_limite_de_vagas(store):
    f = calc(store, "case-q300l", "ext-fan-3pack*2")
    assert len(f.ventoinhas) == sum(VAGAS["case-q300l"].values())
    assert len(vagas_de(f)) == len(f.ventoinhas)


def test_radiador_ocupa_so_as_vagas_dele(store):
    f = calc(store, "case-h5-flow", "clr-lf3-360")
    v = vagas_de(f)
    assert all(v[("frente", i)] == ("entrada", "radiador") for i in range(3))
    assert v[("traseira", 0)] == ("saida", "gabinete")
    assert v[("topo", 0)] == ("saida", "gabinete")   # a inclusa da frente foi para o topo
    assert len(v) == len(f.ventoinhas) == 5


def test_radiador_no_topo_e_saida(store):
    v = vagas_de(calc(store, "case-lancool-216", "clr-kraken-240"))
    assert v[("topo", 0)] == v[("topo", 1)] == ("saida", "radiador")


def test_calor_e_recomendadas(store):
    f = calc(store, "case-lancool-216", "r7-9800x3d", "rtx-4080s")
    assert (f.calor_w, f.recomendadas) == (440, 3)
    assert calc(store, "case-lancool-216", "r7-9800x3d").recomendadas == 2


def test_sem_gabinete_sem_fluxo(store, client):
    assert calc(store, "r7-9800x3d", "rtx-4080s") is None
    bid = client.post("/builds", json={"modo": "manual", "orcamento": 8000}).json()["id"]
    client.post(f"/builds/{bid}/itens", json={"componente_id": "r5-7600"})
    assert client.get(f"/builds/{bid}/cena").json()["fluxo"] is None


def test_cena_e_previa_trazem_fluxo(client):
    bid = client.post("/builds", json={"modo": "manual", "orcamento": 8000}).json()["id"]
    for cid in BASE_OK:
        client.post(f"/builds/{bid}/itens", json={"componente_id": cid})
    assert client.get(f"/builds/{bid}/cena").json()["fluxo"]["ventoinhas"]
    previa = client.post(f"/builds/{bid}/cena/previa", json={"de": "rtx-4060-8g", "para": "rx-7600"}).json()
    assert previa["fluxo"]["ventoinhas"]


# --- revisor de fluxo de ar ---------------------------------------------------------------------------------------
from app.compat.consolidador import revisar_build   # noqa: E402
from app.modelos import BuildCriar                  # noqa: E402
from conftest import itens                          # noqa: E402


def achados(store, *ids, **specs):
    """Achados de fluxo da build; `specs` muda a ficha de uma peça só neste teste (id com `_` no lugar de `-`)."""
    for chave, novo in specs.items():
        cid = chave.replace("_", "-")
        store.componentes[cid] = store.componentes[cid].model_copy(update={"specs": {**store.componentes[cid].specs, **novo}})
    b = store.criar_build(BuildCriar())
    lista = [i for i in ids if "*" not in i] + [i.split("*")[0] for i in ids if "*" in i]
    its = itens(*lista)
    for it in its:
        it.quantidade = next((int(i.split("*")[1]) for i in ids if i.startswith(it.componente_id + "*")), 1)
    return {a.id.split(":")[0] + ":" + a.id.split(":")[1]: a for a in revisar_build(store, b, its) if a.id.startswith("fluxo:")}


def test_sem_entrada(store):
    a = achados(store, "case-q300l")   # 1 inclusa: só a traseira
    assert a["fluxo:sem_entrada"].severidade == "atencao"
    assert "Sem ventoinha de entrada" in a["fluxo:sem_entrada"].descricao


def test_pressao_negativa(store):
    a = achados(store, "case-h5-flow", case_h5_flow={"fans_inclusos": 4, "posicoes_fan": {"frente": 1, "topo": 2, "traseira": 1}})
    assert a["fluxo:pressao_negativa"].severidade == "sugestao"
    assert "Pressão negativa" in a["fluxo:pressao_negativa"].descricao


def test_poucas_fans_sugere_pacote(store):
    a = achados(store, "case-q300l", "rtx-4080s", "r7-9800x3d")   # 440 W pedem 3; o Q300L vem com 1
    assert a["fluxo:poucas_fans"].severidade == "atencao"
    assert a["fluxo:poucas_fans"].correcao_sugerida.acao == "adicionar"
    assert a["fluxo:poucas_fans"].correcao_sugerida.para_id == "ext-fan-3pack"
    # com o pacote e ainda faltando (gabinete sem vagas), o aviso fica, sem correção, falando das vagas
    b = achados(store, "case-q300l", "rtx-4080s", "r7-9800x3d", "ext-fan-3pack",
                case_q300l={"posicoes_fan": {"frente": 1, "topo": 0, "traseira": 1}})
    assert b["fluxo:poucas_fans"].correcao_sugerida is None and "vagas" in b["fluxo:poucas_fans"].descricao


def test_radiador_gpu_quente(store):
    a = achados(store, "case-lancool-216", "clr-lf3-360", "rtx-4080s")
    assert a["fluxo:radiador_gpu"].severidade == "sugestao" and "topo" in a["fluxo:radiador_gpu"].descricao
    assert "fluxo:radiador_gpu" not in achados(store, "case-lancool-216", "clr-lf3-360", "rtx-4060-8g")


def test_fluxo_nao_e_conflito(client):
    bid = client.post("/builds", json={"modo": "manual", "orcamento": 8000}).json()["id"]
    for cid in ["case-q300l", "rtx-4080s", "r7-9800x3d"]:
        client.post(f"/builds/{bid}/itens", json={"componente_id": cid})
    assert not [c for c in client.get(f"/builds/{bid}/cena").json()["conflitos"] if c["id"].startswith("fluxo:")]


def test_achados_concordam_com_o_fluxo(store):
    for case in [c.id for c in store.por_tipo("gabinete")]:
        for pacote in ([], ["ext-fan-3pack"]):
            for cooler in ([], ["clr-lf3-360"], ["clr-kraken-240"]):
                ids = [case, "rtx-4080s", "r7-9800x3d", *pacote, *cooler]
                f, a = calc(store, *ids), achados(store, *ids)
                chave = (case, pacote, cooler)
                assert ("fluxo:sem_entrada" in a) == (f.entrada == 0), chave
                assert ("fluxo:pressao_negativa" in a) == (f.pressao == "negativa" and f.entrada > 0), chave
                assert ("fluxo:poucas_fans" in a) == (len(f.ventoinhas) < f.recomendadas), chave
