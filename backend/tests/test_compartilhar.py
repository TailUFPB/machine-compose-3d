from conftest import BASE_OK


def montar(client):
    bid = client.post("/builds", json={"modo": "manual"}).json()["id"]
    for c in BASE_OK:
        client.post(f"/builds/{bid}/itens", json={"componente_id": c})
    client.patch(f"/builds/{bid}/itens/ram-fury-d5-32", json={"quantidade": 2})
    return bid


def test_markdown_volta_pelo_importador(client):
    bid = montar(client)
    md = client.get(f"/builds/{bid}/texto").text
    assert md.startswith(f"# Build {bid}") and "R$" in md and "FICTÍCIOS" in md
    outra = client.post("/builds", json={"modo": "manual"}).json()["id"]
    imp = client.post(f"/builds/{outra}/importar", json={"texto": md}).json()
    assert {i["componente_id"]: i["quantidade"] for i in imp["itens"]} == {c: (2 if c == "ram-fury-d5-32" else 1) for c in BASE_OK}


def test_link_somente_leitura(client):
    bid = montar(client)
    token = client.post(f"/builds/{bid}/compartilhar").json()["token"]
    assert client.get(f"/compartilhado/{token}").json()["id"] == bid
    assert client.get("/compartilhado/invalido").status_code == 404
    assert client.post(f"/compartilhado/{token}").status_code == 405
