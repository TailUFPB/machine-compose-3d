from conftest import BASE_OK


def criar(client, ids=BASE_OK, **flags_por_id):
    bid = client.post("/builds", json={"modo": "manual", "orcamento": 8000}).json()["id"]
    for cid in ids:
        r = client.post(f"/builds/{bid}/itens", json={"componente_id": cid, **flags_por_id.get(cid.replace("-", "_"), {})})
        assert r.status_code == 200, r.text
    return bid


def trocar(client, bid, de, para):
    return client.post(f"/builds/{bid}/trocar", json={"de": de, "para": para})


def ids(build):
    return [i["componente_id"] for i in build["itens"]]


def test_troca_substitui_so_a_peca_escolhida(client):
    bid = criar(client)
    r = trocar(client, bid, "rtx-4060-8g", "rx-7600")
    assert r.status_code == 200, r.text
    assert ids(r.json()) == [("rx-7600" if i == "rtx-4060-8g" else i) for i in BASE_OK]
    novo = next(i for i in r.json()["itens"] if i["componente_id"] == "rx-7600")
    assert novo["origem"] == "usuario" and novo["justificativa"] is None


def test_troca_armazenamento_com_dois_discos(client):
    bid = criar(client, BASE_OK + ["ssd-sn770-1t"])
    r = trocar(client, bid, "ssd-nv3-1t", "ssd-990pro-2t")
    assert r.status_code == 200, r.text
    assert "ssd-sn770-1t" in ids(r.json()) and "ssd-990pro-2t" in ids(r.json()) and "ssd-nv3-1t" not in ids(r.json())


def test_troca_mantem_quantidade(client):
    bid = criar(client)
    client.patch(f"/builds/{bid}/itens/ram-fury-d5-32", json={"quantidade": 2})
    r = trocar(client, bid, "ram-fury-d5-32", "ram-veng-d5-32")
    assert r.status_code == 200, r.text
    assert next(i for i in r.json()["itens"] if i["componente_id"] == "ram-veng-d5-32")["quantidade"] == 2


def test_troca_bloqueia_travada_e_ja_tenho(client):
    bid = criar(client, rtx_4060_8g={"travado": True}, psu_a750gl={"ja_tenho": True})
    r = trocar(client, bid, "rtx-4060-8g", "rx-7600")
    assert r.status_code == 409 and "destrave para trocar" in r.json()["detail"]
    r = trocar(client, bid, "psu-a750gl", "psu-rm850e")
    assert r.status_code == 409 and "desmarque Já tenho para trocar" in r.json()["detail"]


def test_troca_erros(client):
    bid = criar(client)
    assert trocar(client, "nao-existe", "rtx-4060-8g", "rx-7600").status_code == 404
    assert trocar(client, bid, "rtx-4060-8g", "gpu-que-nao-existe").status_code == 404
    assert trocar(client, bid, "rx-7600", "rtx-4070").status_code == 404     # rx-7600 não está na build
    assert trocar(client, bid, "rtx-4060-8g", "r5-7600").status_code == 422  # gpu -> cpu


def test_troca_revisa_e_salva(client):
    bid = criar(client)
    r = trocar(client, bid, "rtx-4060-8g", "rx-7600")
    assert r.json()["status"] == "revisada"
    assert "rx-7600" in ids(client.get(f"/builds/{bid}").json())
