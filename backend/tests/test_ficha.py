"""Ficha do fabricante: busca gravada (formato do serper.dev/search), LLM falso, nada sai para a rede."""
import io
import json
from pathlib import Path

import pytest

from app import ficha
from app.config import get_settings
from conftest import BASE_OK
from test_api import add, criar

AMOSTRA = (Path(__file__).parent / "serper_ficha_rtx4060.json").read_bytes()
URL_NVIDIA = "https://www.nvidia.com/pt-br/geforce/graphics-cards/40-series/rtx-4060-4060ti/"
EXTRAIDO = {"fans": 2, "fan_mm": 90, "backplate": True, "saidas": ["DisplayPort", "DisplayPort", "DisplayPort", "HDMI"]}


@pytest.fixture
def busca(monkeypatch):
    pedidos = []
    def urlopen(req, timeout):
        if req.full_url != ficha.SERPER_BUSCA_URL:
            raise OSError("página do fabricante fora do ar")   # cai no trecho da busca
        pedidos.append(json.loads(req.data))
        return io.BytesIO(AMOSTRA)
    monkeypatch.setattr(ficha.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(get_settings(), "serper_api_key", "chave-teste")
    monkeypatch.setattr(get_settings(), "llm_provider", "openai")
    return pedidos


def llm_devolve(monkeypatch, campos):
    vistos = []
    def falso(nome, system, user):
        vistos.append(user)
        return {"campos": campos}
    monkeypatch.setattr(ficha.llm, "completar_json", falso)
    return vistos


def test_extrai_da_pagina_do_fabricante_com_origem(store, busca, monkeypatch):
    vistos = llm_devolve(monkeypatch, EXTRAIDO)
    r = ficha.extrair(store, "rtx-4060-8g")
    assert busca[0]["q"].startswith("NVIDIA GeForce RTX 4060 8GB")
    assert "3x DisplayPort" in vistos[0] and "KaBuM" not in vistos[0]   # só o resultado do fabricante vai ao LLM
    assert r.executou and r.url == URL_NVIDIA and r.gravados == EXTRAIDO and not r.descartados
    comp = store.get("rtx-4060-8g")
    assert comp.specs["fan_mm"] == 90
    assert comp.specs_origem["fans"]["url"] == URL_NVIDIA and comp.specs_origem["fans"]["coletado_em"]


def test_fora_da_faixa_e_campo_estranho_sao_descartados(store, busca, monkeypatch, caplog):
    antes = dict(store.get("rtx-4060-8g").specs)
    llm_devolve(monkeypatch, {"fans": 9, "fan_mm": 92, "backplate": "sim", "saidas": ["DisplayPort", "VGA"], "vrm_fases": 8})
    r = ficha.extrair(store, "rtx-4060-8g")
    assert r.gravados == {"fan_mm": 92}
    assert {d.campo for d in r.descartados} == {"fans", "backplate", "saidas", "vrm_fases"}
    comp = store.get("rtx-4060-8g")
    assert comp.specs["fans"] == antes["fans"] and "vrm_fases" not in comp.specs   # o seed fica
    assert set(comp.specs_origem) == {"fan_mm"}
    assert "fans" in caplog.text


@pytest.mark.parametrize("tipo, campo, valor, ok", [
    ("gpu", "fans", 4, True), ("gpu", "fans", 0, False), ("gpu", "fans", True, False), ("gpu", "fan_mm", 141, False),
    ("cooler", "heatpipes", 8, True), ("cooler", "heatpipes", 9, False), ("cooler", "radiador_posicao", "topo", True),
    ("cooler", "radiador_posicao", "lado", False),
    ("placa_mae", "portas_traseiras", ["USB-A", "RJ45", "audio"], True), ("placa_mae", "portas_traseiras", ["VGA"], False),
    ("placa_mae", "m2_dissipador", False, True),
    ("gabinete", "posicoes_fan", {"frente": 3, "topo": 2, "traseira": 1}, True),
    ("gabinete", "posicoes_fan", {"frente": 3, "piso": 2}, False),
    ("gabinete", "baias", {"2.5": 2, "3.5": 9}, False), ("gabinete", "baias", {"2.5": 2, "3.5": 0}, True),
    ("gabinete", "lateral", "vidro", True), ("armazenamento", "formato", "3.5", True),
    ("armazenamento", "formato", "mSATA", False), ("fonte", "fans", 1, False),
])
def test_faixas_plausiveis(tipo, campo, valor, ok):
    assert (ficha.invalido(tipo, campo, valor) is None) is ok


def test_radiador_posicao_so_para_aio(store):
    r = ficha.gravar(store.get("clr-ak400"), {"radiador_posicao": "topo", "heatpipes": 4}, "https://x")
    assert r.gravados == {"heatpipes": 4} and r.descartados[0].campo == "radiador_posicao"


def test_valor_sem_url_nao_e_gravado(store):
    comp = store.get("rtx-4060-8g")
    antes = dict(comp.specs)
    r = ficha.gravar(comp, {"fan_mm": 92}, "")
    assert not r.gravados and r.descartados[0].motivo == "sem fonte (URL)"
    assert comp.specs == antes and not comp.specs_origem


def test_sem_pagina_do_fabricante_nada_e_gravado(store, busca, monkeypatch):
    vistos = llm_devolve(monkeypatch, EXTRAIDO)
    r = ficha.extrair(store, "clr-ak400")   # a amostra não tem resultado da DeepCool
    assert not r.executou and not r.gravados and not vistos and not store.get("clr-ak400").specs_origem


@pytest.mark.parametrize("chave, provedor", [("", "openai"), ("chave-teste", "none")])
def test_sem_chave_ou_sem_llm_nao_roda_e_o_seed_fica(store, monkeypatch, chave, provedor):
    def rede(req, timeout):
        raise AssertionError("não pode sair para a rede")
    monkeypatch.setattr(ficha.urllib.request, "urlopen", rede)
    monkeypatch.setattr(get_settings(), "serper_api_key", chave)
    monkeypatch.setattr(get_settings(), "llm_provider", provedor)
    antes = store.get("rtx-4060-8g").model_dump()
    r = ficha.extrair(store, "rtx-4060-8g")
    assert not r.executou and r.motivo and store.get("rtx-4060-8g").model_dump() == antes


def test_rota_da_ficha_e_origem_na_cena(client, store, busca, monkeypatch):
    llm_devolve(monkeypatch, {"fans": 2, "fan_mm": 300})
    bid = criar(client)
    for c in BASE_OK:
        add(client, bid, c)
    pecas = {p["id"]: p for p in client.get(f"/builds/{bid}/cena").json()["pecas"]}
    assert all(p["origem"] == {} for p in pecas.values())            # seed não tem URL
    assert pecas["case-lancool-216"]["specs"]["posicoes_fan"]["traseira"] == 1
    r = client.post("/componentes/rtx-4060-8g/ficha").json()
    assert r["gravados"] == {"fans": 2} and r["descartados"][0]["campo"] == "fan_mm"
    gpu = next(p for p in client.get(f"/builds/{bid}/cena").json()["pecas"] if p["id"] == "rtx-4060-8g")
    assert gpu["origem"] == {"fans": URL_NVIDIA}
    assert client.post("/componentes/nao-existe/ficha").status_code == 404


def test_seed_tem_campos_novos_e_lacunas(store):
    tem = lambda tipo, campo: [campo in c.specs for c in store.por_tipo(tipo)]
    for tipo, campo in [("gpu", "fans"), ("gpu", "saidas"), ("cooler", "heatpipes"), ("placa_mae", "portas_traseiras"),
                        ("placa_mae", "m2_dissipador"), ("gabinete", "baias"), ("gabinete", "lateral"),
                        ("armazenamento", "formato")]:
        assert any(tem(tipo, campo)) and not all(tem(tipo, campo)), (tipo, campo)   # parte fica para a estimativa
    for c in store.componentes.values():
        for campo in ficha.CAMPOS.get(c.tipo, {}):
            if campo in c.specs:
                assert ficha.invalido(c.tipo, campo, c.specs[campo]) is None, (c.id, campo)
    assert store.get("clr-kraken-240").specs["radiador_posicao"] in ("frente", "topo")
    assert all("radiador_posicao" not in c.specs for c in store.por_tipo("cooler") if c.specs["refrigeracao"] == "ar")
