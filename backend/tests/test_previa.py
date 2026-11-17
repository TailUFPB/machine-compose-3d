import pytest

from app import llm, precos, tracing
from conftest import BASE_OK

COM_NR200P = [("case-nr200p" if i == "case-lancool-216" else i) for i in BASE_OK]


def criar(client, ids=BASE_OK, **flags_por_id):
    bid = client.post("/builds", json={"modo": "manual", "orcamento": 8000}).json()["id"]
    for cid in ids:
        assert client.post(f"/builds/{bid}/itens", json={"componente_id": cid, **flags_por_id.get(cid, {})}).status_code == 200
    return bid


def previa(client, bid, de, para):
    return client.post(f"/builds/{bid}/cena/previa", json={"de": de, "para": para})


def test_previa_nao_grava(client, store, monkeypatch):
    bid = criar(client)
    antes, propostas = store.builds[bid].model_dump(), dict(store.propostas)

    def falha(tabela, *a, **k):   # pesquisar preço da candidata preenche o cache compartilhado ("ofertas"); a build, não
        if tabela != "ofertas":
            raise AssertionError(f"a prévia não pode espelhar {tabela}")
    monkeypatch.setattr(store, "espelhar", falha)
    r = previa(client, bid, "rtx-4060-8g", "rx-7600")
    assert r.status_code == 200, r.text
    assert store.builds[bid].model_dump() == antes and store.propostas == propostas
    assert "rx-7600" in [p["id"] for p in r.json()["pecas"]]


def test_previa_mostra_conflito_da_candidata(client):
    bid = criar(client, COM_NR200P)
    r = previa(client, bid, "rtx-4060-8g", "rtx-4080s").json()
    gpu = [c for c in r["conflitos"] if c["id"].startswith("par:gpu_comprimento")]
    assert gpu and "rtx-4080s" in gpu[0]["itens"]


def test_previa_sem_llm_e_sem_rastro(client, monkeypatch):
    bid = criar(client)

    def proibido(*a, **k):
        raise AssertionError("a prévia não pode chamar LLM nem Langfuse")
    monkeypatch.setattr(llm, "ativo", lambda: True)
    monkeypatch.setattr(llm, "completar_json", proibido)
    monkeypatch.setattr(tracing, "_langfuse", proibido)
    assert previa(client, bid, "rtx-4060-8g", "rx-7600").status_code == 200


def test_previa_diferenca_preco(client, store, monkeypatch):
    bid = criar(client)
    r = previa(client, bid, "rtx-4060-8g", "rx-7600").json()
    esperado = precos.preco_ref(store, "rx-7600") - precos.preco_ref(store, "rtx-4060-8g")
    assert r["diferenca_preco"] == pytest.approx(esperado)

    original = precos.preco_ref
    monkeypatch.setattr(precos, "preco_ref", lambda s, cid: None if cid == "rx-7600" else original(s, cid))
    assert previa(client, bid, "rtx-4060-8g", "rx-7600").json()["diferenca_preco"] is None


def test_previa_erros_iguais_ao_trocar(client):
    bid = criar(client, **{"rtx-4060-8g": {"travado": True}})
    assert previa(client, bid, "rtx-4060-8g", "rx-7600").status_code == 409
    assert previa(client, bid, "psu-a750gl", "r5-7600").status_code == 422


def test_cena_inalterada(client):
    bid = criar(client)
    assert set(client.get(f"/builds/{bid}/cena").json()) == {"pecas", "conflitos", "passos"}
