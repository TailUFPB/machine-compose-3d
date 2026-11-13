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


def test_componentes_e_resultado_expoem_qtd_lojas_e_alternativas_sem_preco(client, store):
    comps = client.get("/componentes", params={"tipo": "gpu"}).json()
    assert all(c["preco"]["qtd_lojas"] >= 1 for c in comps if c["preco"]["med"] is not None)

    bid = criar(client, orcamento=12000)
    for c in [*BASE_OK, "clr-ak400"]:
        add(client, bid, c)

    # Remove ofertas do cooler para simular ausência no mercado mantendo a peça no catálogo
    store.anuncios = [a for a in store.anuncios if a["componente_id"] != "clr-ak400"]
    store.cache_precos.pop("clr-ak400", None)

    res = client.get(f"/builds/{bid}/resultado").json()
    assert res["total_minimo"] <= res["total"]
    linhas = [l for xs in res["lojas"].values() for l in xs]
    assert all(l["qtd_lojas"] >= 1 for l in linhas)
    assert all(l["preco_ref"] > 0 and l["subtotal_ref"] == round(l["preco_ref"] * l["quantidade"], 2) for l in linhas)
    assert any("AK400" in nome for nome in res["sem_preco"])
    alts = [a for a in res["alternativas_sem_preco"] if a["de_id"] == "clr-ak400"]
    assert len(alts) == 1
    assert alts[0]["para_id"] != "clr-ak400" and alts[0]["preco_med"] > 0 and alts[0]["qtd_lojas"] >= 1


def test_endpoint_ofertas_ir_redireciona_e_bloqueia_open_redirect(client, store, monkeypatch):
    from app import precos
    from app.config import get_settings

    # Injeta oferta com URL do Google Shopping no cache do componente e simula resolução Serper
    r_atual = precos.pesquisar(store, "case-h5-flow")
    oferta = r_atual.ofertas[0].model_copy(update={"loja": "Kabum", "url": "https://www.google.com/search?tbm=shop&q=H5"})
    store.cache_precos["case-h5-flow"]["resultado"] = r_atual.model_copy(update={"ofertas": [oferta]})

    monkeypatch.setattr(get_settings(), "busca_provider", "serper")
    monkeypatch.setattr(get_settings(), "serper_api_key", "chave-teste")
    direta = "https://www.kabum.com.br/produto/692553/h5-flow"
    store.links_resolvidos[f"Kabum|{oferta.titulo}"] = direta

    resp = client.get(
        "/ofertas/ir",
        params={"componente_id": "case-h5-flow", "loja": "Kabum", "url": oferta.url},
        follow_redirects=False,
    )
    assert resp.status_code == 307
    assert resp.headers["location"] == direta

    # Tentativa de redirecionamento arbitrário deve ser rejeitada
    bloqueado = client.get(
        "/ofertas/ir",
        params={"componente_id": "case-h5-flow", "loja": "Kabum", "url": "https://evil.example/phish"},
        follow_redirects=False,
    )
    assert bloqueado.status_code == 400


def test_alternativa_sem_preco_nao_sugere_item_ja_presente_na_build(client, store):
    ssds = [c.id for c in store.por_tipo("armazenamento")]
    assert len(ssds) >= 2
    bid = criar(client, orcamento=12000)
    add(client, bid, ssds[0])
    add(client, bid, ssds[1])

    # Deixa apenas ssds[1] (já na build) com preço; os demais do mesmo tipo ficam sem oferta
    sem_oferta = set(ssds) - {ssds[1]}
    store.anuncios = [a for a in store.anuncios if a["componente_id"] not in sem_oferta]
    for cid in sem_oferta:
        store.cache_precos.pop(cid, None)

    res = client.get(f"/builds/{bid}/resultado").json()
    assert res["alternativas_sem_preco"] == []


def test_trocar_item_atomico_e_equivalencia_por_categoria(client, store):
    # Equivalência por categoria: GPU forte sem preço deve sugerir GPU próxima de `indice`, não a mais fraca
    gpus = sorted(store.por_tipo("gpu"), key=lambda c: c.specs.get("indice", 0))
    assert len(gpus) >= 3
    gpu_topo = gpus[-1]
    bid = criar(client, orcamento=20000)
    for c in [i for i in BASE_OK if store.get(i).tipo != "gpu"] + [gpu_topo.id]:
        add(client, bid, c)

    store.anuncios = [a for a in store.anuncios if a["componente_id"] != gpu_topo.id]
    store.cache_precos.pop(gpu_topo.id, None)

    res = client.get(f"/builds/{bid}/resultado").json()
    alt_gpu = next(a for a in res["alternativas_sem_preco"] if a["de_id"] == gpu_topo.id)
    assert alt_gpu["para_id"] != gpus[0].id  # não cai na GPU mais fraca só por ser a mais barata

    # Troca atômica preserva quantidade e substitui o item em uma única chamada
    resp_troca = client.post(f"/builds/{bid}/trocar", json={"de_id": gpu_topo.id, "para_id": alt_gpu["para_id"]})
    assert resp_troca.status_code == 200
    ids = {i["componente_id"] for i in resp_troca.json()["itens"]}
    assert gpu_topo.id not in ids and alt_gpu["para_id"] in ids
