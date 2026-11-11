from app import upgrades
from app.modelos import Build, Objetivos
from conftest import itens

ANTIGA = ["r5-5500", "mb-b550m-vdh", "ram-fury-d4-16", "ssd-mx500-1t", "psu-a550bn", "case-q300l", "rtx-3050-6g"]


def build():
    return Build(id="u", itens=itens(*ANTIGA, ja_tenho=True),
                 objetivos=Objetivos(jogos=["cyberpunk-2077", "fortnite"], resolucao="1080p", fps_alvo=60))


def test_ranking_por_ganho_por_real(store):
    us = upgrades.sugerir(store, build())
    assert us and all(u.ganho_fps_pct > 3 for u in us)
    assert [u.ganho_por_mil_reais for u in us] == sorted((u.ganho_por_mil_reais for u in us), reverse=True)


def test_pacote_inclui_trocas_obrigatorias(store):
    us = {u.principal: u for u in upgrades.sugerir(store, build(), limite=100)}
    am5 = us.get("r7-7800x3d")
    if am5:   # trocar para AM5 exige placa e memória DDR5
        tipos = {store.componentes[i].tipo for i in am5.pacote}
        assert {"cpu", "placa_mae", "memoria"} <= tipos
    gpu_forte = us["rx-7800xt"]   # 263 W: a fonte de 550 W não cobre consumo x margem
    assert any(store.componentes[i].tipo == "fonte" for i in gpu_forte.pacote)


def test_verba_limita(store):
    assert all(u.custo <= 1500 for u in upgrades.sugerir(store, build(), verba=1500))


def test_rota(client):
    bid = client.post("/builds", json={"modo": "manual"}).json()["id"]
    for c in ANTIGA:
        client.post(f"/builds/{bid}/itens", json={"componente_id": c, "ja_tenho": True})
    assert client.get(f"/builds/{bid}/upgrades", params={"verba": 2500}).json()
