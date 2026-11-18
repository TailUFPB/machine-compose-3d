from app import alertas
from app.main import ALERTAS


def test_tendencia():
    assert alertas.tendencia([100, 100, 90, 90]) == "queda"
    assert alertas.tendencia([90, 90, 100, 100]) == "alta"
    assert alertas.tendencia([100, 101, 100, 99]) == "estavel"
    assert alertas.tendencia([100]) == "sem_dados"


def test_status_com_fonte_e_historico(store):
    s = alertas.status(store, alertas.AlertaCriar(componente_id="rx-7600", preco_alvo=99999))
    assert s.atingido and s.url and s.loja
    assert s.minimo_historico is not None and s.tendencia == "queda"   # seed: preços caem ~1%/semana
    assert not alertas.status(store, alertas.AlertaCriar(componente_id="rx-7600", preco_alvo=1)).atingido


def test_rotas(client):
    ALERTAS.clear()
    assert client.post("/alertas", json={"componente_id": "nada", "preco_alvo": 10}).status_code == 404
    client.post("/alertas", json={"componente_id": "rtx-4060-8g", "preco_alvo": 100})
    client.post("/alertas", json={"componente_id": "rtx-4060-8g", "preco_alvo": 5000})   # substitui
    lista = client.get("/alertas").json()
    assert len(lista) == 1 and lista[0]["preco_alvo"] == 5000 and lista[0]["atingido"]
