from conftest import BASE_OK


def criar(client, **kw):
    corpo = {"modo": "manual", "orcamento": 8000, "objetivos": {"jogos": ["cs2", "cyberpunk-2077"], "resolucao": "1080p", "fps_alvo": 60}}
    return client.post("/builds", json=corpo | kw).json()["id"]


def add(client, bid, cid, **kw):
    return client.post(f"/builds/{bid}/itens", json={"componente_id": cid, **kw})


def test_fluxo_manual_revisa_a_cada_adicao(client):
    bid = criar(client)
    r = add(client, bid, "r5-7600").json()
    assert r["status"] == "revisada" and any(a["id"] == "faltam_pecas" for a in r["achados"])
    r = add(client, bid, "mb-b760-tuf-d5").json()
    assert any(a["id"].startswith("par:socket") and a["severidade"] == "bloqueante" for a in r["achados"])


def test_peca_de_tipo_unico_substitui_e_travada_nao(client):
    bid = criar(client)
    add(client, bid, "rtx-4060-8g", travado=True)
    assert add(client, bid, "rx-7600").status_code == 409
    client.patch(f"/builds/{bid}/itens/rtx-4060-8g", json={"travado": False})
    r = add(client, bid, "rx-7600").json()
    assert [i["componente_id"] for i in r["itens"]] == ["rx-7600"]


def test_filtro_compativeis_e_ver_todos(client):
    bid = criar(client)
    add(client, bid, "r5-7600")
    so_ok = client.get("/componentes", params={"tipo": "placa_mae", "build_id": bid}).json()
    assert so_ok and all(c["specs"]["socket"] == "AM5" for c in so_ok)
    todas = client.get("/componentes", params={"tipo": "placa_mae", "build_id": bid, "todos": True}).json()
    ruins = [c for c in todas if not c["compativel"]]
    assert ruins and all("Socket" in c["motivo"] for c in ruins)
    assert all(c["preco"]["med"] for c in todas)


def test_aplicar_correcao_de_achado(client):
    bid = criar(client)
    for c in ["r5-7600", "mb-b650m-a", "ram-lpx-d4-32"]:
        r = add(client, bid, c).json()
    a = next(a for a in r["achados"] if a["id"].startswith("par:ddr:"))
    r = client.post(f"/builds/{bid}/aplicar", json={"achado_id": a["id"]}).json()
    assert "ram-lpx-d4-32" not in [i["componente_id"] for i in r["itens"]]
    assert not any(x["id"].startswith("par:ddr:") for x in r["achados"])


def test_agente_proposta_so_entra_com_clique(client):
    bid = criar(client, modo="agente")
    p = client.post(f"/builds/{bid}/agente").json()
    assert p["itens"] and client.get(f"/builds/{bid}").json()["itens"] == []
    r = client.post(f"/builds/{bid}/aplicar", json={"proposta": True}).json()
    assert len(r["itens"]) == len(p["itens"])
    assert client.post(f"/builds/{bid}/aplicar", json={"proposta": True}).status_code == 404


def test_exportacao_bloqueada_e_override_confirmado(client):
    bid = criar(client)
    for c in BASE_OK:
        add(client, bid, c)
    add(client, bid, "mb-b760-tuf-d5")   # socket errado
    r = client.post(f"/builds/{bid}/exportar", json={})
    assert r.status_code == 409 and r.json()["detail"]["bloqueantes"]
    assert client.post(f"/builds/{bid}/exportar", json={"override": True, "confirmacao": "ok"}).status_code == 409
    r = client.post(f"/builds/{bid}/exportar", json={"override": True, "confirmacao": "EXPORTAR MESMO ASSIM"})
    assert r.status_code == 200 and r.content[:2] == b"PK"


def test_flag_desligada_nao_bloqueia(client, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "bloqueante_bloqueia_exportacao", False)
    bid = criar(client)
    add(client, bid, "r5-7600")
    add(client, bid, "mb-b760-tuf-d5")
    assert client.post(f"/builds/{bid}/exportar", json={}).status_code == 200


def test_resultado_precos_fps_cena(client):
    bid = criar(client)
    for c in BASE_OK:
        add(client, bid, c)
    res = client.get(f"/builds/{bid}/resultado").json()
    assert res["total"] > 0 and res["cabe"] == (res["diferenca"] >= 0)
    assert sum(len(v) for v in res["lojas"].values()) == len(BASE_OK)
    assert all(l["url"] for v in res["lojas"].values() for l in v)
    pr = client.get(f"/builds/{bid}/precos").json()
    assert all(p["historico"] for p in pr)
    fps = client.get(f"/builds/{bid}/fps").json()
    assert {f["jogo"] for f in fps} == {"cs2", "cyberpunk-2077"} and all(f["fontes"] for f in fps)
    cena = client.get(f"/builds/{bid}/cena").json()
    assert {p["tipo"] for p in cena["pecas"]} >= {"gabinete", "gpu"} and cena["passos"]


def test_trocas_economia_sem_perder_fps(client):
    bid = criar(client, orcamento=20000)
    for c in ["r7-9800x3d", "mb-b850-tomahawk", "ram-veng-d5-32", "ssd-990pro-2t", "psu-focus-1000", "case-lancool-216", "rtx-3060-12g", "clr-nhd15"]:
        add(client, bid, c)
    trocas = client.get(f"/builds/{bid}/resultado").json()["trocas"]
    cpu = next(t for t in trocas if t["de_id"] == "r7-9800x3d")   # GPU fraca: CPU topo é desperdício
    assert cpu["economia"] > 0 and "sem perder FPS" in cpu["texto"]


def test_comparar_e_importar(client):
    a, b = criar(client), criar(client)
    for c in BASE_OK:
        add(client, a, c)
        add(client, b, c if c != "rtx-4060-8g" else "rtx-4070s")
    cmp = client.get("/comparar", params={"a": a, "b": b}).json()
    assert cmp["b"][0]["fps_med"] > cmp["a"][0]["fps_med"]
    imp = client.post(f"/builds/{a}/importar", json={"texto": "Ryzen 7 7800X3D\nRTX 4070 Super"}).json()
    assert {i["componente_id"] for i in imp["itens"]} == {"r7-7800x3d", "rtx-4070s"}
    r = client.post(f"/builds/{a}/aplicar", json={"itens": imp["itens"]}).json()
    assert {"r7-7800x3d", "rtx-4070s"} <= {i["componente_id"] for i in r["itens"]}


def test_ignorar_achado(client):
    bid = criar(client)
    r = add(client, bid, "r5-7600").json()
    aid = r["achados"][0]["id"]
    r = client.post(f"/builds/{bid}/achados/{aid}/ignorar").json()
    assert next(a for a in r["achados"] if a["id"] == aid)["status"] == "ignorado"


def test_listar_builds(client):
    a = criar(client)
    assert a in [b["id"] for b in client.get("/builds").json()]
