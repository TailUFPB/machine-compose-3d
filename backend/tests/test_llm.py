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


def test_dica_do_llm_so_e_verificada_com_evidencia_que_bate_com_a_ficha(store, llm_falso):
    ev = lambda campo, valor: {"peca": "psu-a750gl", "campo": campo, "valor": valor}
    llm_falso["proxima"] = json.dumps({"achados": [
        {"severidade": "bloqueante", "descricao": "palpite"},
        {"severidade": "sugestao", "descricao": "com evidência", "evidencias": [ev("potencia_w", 750), ev("conectores.12V-2x6", 1)]},
        {"severidade": "atencao", "descricao": "leu errado", "evidencias": [ev("potencia_w", 550)]},
    ]})
    achados = {a.descricao: a for a in revisores.revisar(store, itens("rtx-4060-8g", "psu-a750gl")) if a.agente == "conjunto"}
    assert set(achados) == {"palpite", "com evidência"}   # evidência que não bate com a ficha descarta a dica
    assert not achados["palpite"].verificado and achados["palpite"].severidade == "atencao"
    boa = achados["com evidência"]
    assert boa.verificado and boa.itens_envolvidos == ["psu-a750gl"] and boa.fonte_url == store.componentes["psu-a750gl"].fonte


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


def test_openrouter_usa_endpoint_padrao(monkeypatch):
    openai = pytest.importorskip("openai")
    usado = {}
    class Falso:
        def __init__(self, **kw):
            usado.update(kw)
            self.chat = self
            self.completions = self
        def create(self, **kw):
            msg = type("M", (), {"content": "{}"})
            return type("R", (), {"choices": [type("C", (), {"message": msg})]})
    monkeypatch.setattr(openai, "OpenAI", Falso)
    monkeypatch.setattr(get_settings(), "llm_provider", "openrouter")
    monkeypatch.setattr(get_settings(), "llm_base_url", "")
    assert llm._texto("s", "u") == "{}"
    assert usado["base_url"] == llm.OPENROUTER_URL


def test_revisao_faz_uma_chamada_por_combinacao_de_pecas(store, monkeypatch):
    chamadas = []
    monkeypatch.setattr(get_settings(), "llm_provider", "openai")
    monkeypatch.setattr(llm, "_texto", lambda system, user: chamadas.append(user) or '{"achados": []}')
    for _ in range(2):
        revisores.revisar(store, itens("rtx-4060-8g", "psu-a750gl"))
    assert len(chamadas) == 1   # uma leitura do conjunto, e a repetição sai do cache
    revisores.revisar(store, itens("rtx-4070s", "psu-a750gl"))
    assert len(chamadas) == 2 and chamadas[0].startswith("PEÇAS: ")   # peças primeiro: prefixo estável para o cache
