from app import energia
from app.modelos import Build
from conftest import BASE_OK, itens


def test_conta_bate(store):
    e = energia.calcular(store, Build(id="e", itens=itens(*BASE_OK)), horas_dia=4, tarifa=1.0)
    # r5-7600 65 W x 0,6 + 4060 115 W x 0,9 + 60 = 202,5 W; fonte Gold 90%
    assert e.consumo_jogando_w == 202 and e.eficiencia_fonte == 0.90
    assert e.kwh_mes == round(202.5 / 0.9 * 4 * 30 / 1000, 1) and e.tarifa_informada


def test_gpu_mais_forte_gasta_mais(store):
    fraca = energia.calcular(store, Build(id="a", itens=itens(*BASE_OK)), 4, None)
    forte = energia.calcular(store, Build(id="b", itens=itens(*[c if c != "rtx-4060-8g" else "rtx-4080s" for c in BASE_OK])), 4, None)
    assert forte.custo_mes > fraca.custo_mes and not fraca.tarifa_informada


def test_rota_valida_parametros(client):
    bid = client.post("/builds", json={"modo": "manual"}).json()["id"]
    assert client.get(f"/builds/{bid}/energia", params={"horas_dia": 30}).status_code == 422
    assert client.get(f"/builds/{bid}/energia").json()["consumo_jogando_w"] == 60
