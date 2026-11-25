import json

from app import evals


def test_revisores_nao_perdem_nem_inventam_achado_nos_casos(store):
    placar = evals.rodar(store, json.loads(evals.CASOS.read_text()))
    assert not [d for p in placar.values() for d in p["detalhe"]]
    assert all(p["casos"] and p["esperados"] for p in placar.values())   # todo revisor tem caso positivo
