"""Caminho com LLM ligado, usando um provedor falso: o modelo ajuda, mas as regras de fonte continuam valendo."""
import json

import pytest

from app import llm, precos
from app.compat import revisores
from app.config import get_settings
from conftest import itens


@pytest.fixture
def llm_falso(monkeypatch):
    respostas = {}
    monkeypatch.setattr(get_settings(), "llm_provider", "openai")
    monkeypatch.setattr(llm, "_texto", lambda system, user: respostas["proxima"])
    return respostas


def test_achado_do_llm_sem_fonte_permitida_fica_nao_verificado(store, llm_falso):
    llm_falso["proxima"] = json.dumps({"achados": [
        {"severidade": "bloqueante", "itens_envolvidos": ["psu-a750gl"], "descricao": "palpite", "fonte_url": "https://inventada"},
        {"severidade": "atencao", "itens_envolvidos": ["psu-a750gl"], "descricao": "com fonte", "fonte_url": "seed:demo/ficha-tecnica"},
    ]})
    achados = [a for a in revisores.revisar(store, itens("rtx-4060-8g", "psu-a750gl"), ["eletrico"]) if "llm" in a.id]
    palpite = next(a for a in achados if a.descricao == "palpite")
    assert not palpite.verificado and palpite.fonte_url is None and palpite.severidade == "atencao"
    assert next(a for a in achados if a.descricao == "com fonte").verificado


def test_extracao_ignora_preco_alucinado(store, llm_falso):
    llm_falso["proxima"] = '{"preco": 1.0}'
    assert precos._extrair({"titulo": "x", "preco_texto": "R$ 1.899,90"}) == 1899.90


def test_llm_quebrado_cai_no_determinismo(store, monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_provider", "openai")
    def falha(system, user):
        raise RuntimeError("fora do ar")
    monkeypatch.setattr(llm, "_texto", falha)
    assert llm.completar_json("x", "s", "u") is None
    assert precos.pesquisar(store, "rx-7600").tem_preco
