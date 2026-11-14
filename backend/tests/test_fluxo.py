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
