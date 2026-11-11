"""Provedor real (Google Shopping via serper.dev) com uma resposta real gravada: nada sai para a rede."""
import io
import json
from pathlib import Path

import pytest

from app import precos
from app.config import get_settings

AMOSTRA = (Path(__file__).parent / "serper_rtx4060.json").read_bytes()


@pytest.fixture
def serper(monkeypatch):
    pedidos = []
    def urlopen(req, timeout):
        pedidos.append(json.loads(req.data))
        return io.BytesIO(AMOSTRA)
    monkeypatch.setattr(precos.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(get_settings(), "busca_provider", "serper")
    monkeypatch.setattr(get_settings(), "serper_api_key", "chave-teste")
    return pedidos


def test_shopping_vira_ofertas_com_fonte(store, serper):
    r = precos.pesquisar(store, "rtx-4060-8g")
    assert serper[0]["q"] == "NVIDIA GeForce RTX 4060 8GB"
    assert sorted(o.preco for o in r.ofertas) == [1542.0, 2459.0, 3249.0, 5712.67]   # "Ventus 2x" é a mesma placa
    assert {o.loja for o in r.ofertas} == {"Kabum", "Mercado Livre", "Amazon"}         # Shopee fora de LOJAS
    assert all(o.url.startswith("https://") for o in r.ofertas)                        # sem link: busca do Shopping
    motivos = {d.motivo for d in r.descartes}
    assert "usado/recondicionado" in motivos and "variante diferente (ti)" in motivos
    assert r.preco_med == 2854.0


def test_sem_chave_cai_no_seed(store, monkeypatch):
    monkeypatch.setattr(get_settings(), "busca_provider", "serper")
    assert not get_settings().preco_real
    assert precos.pesquisar(store, "rtx-4060-8g").ofertas[0].url.startswith("https://www.")


def test_falha_de_rede_nao_derruba(store, serper, monkeypatch):
    def cai(req, timeout):
        raise OSError("sem rede")
    monkeypatch.setattr(precos.urllib.request, "urlopen", cai)
    assert not precos.pesquisar(store, "rtx-4060-8g").tem_preco


def test_cache_em_disco_sobrevive_reinicio(store, serper, monkeypatch, tmp_path):
    monkeypatch.setattr(precos, "CACHE_DISCO", tmp_path / "precos.json")
    precos.carregar_disco(store)                     # como no início da API
    precos.pesquisar(store, "rtx-4060-8g")
    from app.store import novo_store
    outro = novo_store()
    precos.carregar_disco(outro)
    assert outro.cache_precos["rtx-4060-8g"]["resultado"].preco_med == 2854.0     # recalculado dos anúncios brutos
    assert {h["componente_id"] for h in outro.historico_precos} == {"rtx-4060-8g"}   # sem histórico fictício
    serper.clear()
    assert precos.pesquisar(outro, "rtx-4060-8g").do_cache and not serper            # não gastou crédito


def test_kit_upgrade_sai_mas_kit_de_memoria_fica(store):
    anuncios = [{"componente_id": "r5-7600", "loja": "Terabyte", "url": "https://x", "coletado_em": "2026-11-11",
                 "titulo": "Kit Upgrade, AMD Ryzen 5 7600, Placa Mãe Chipset A620", "preco_texto": "R$ 1.829,99"},
                {"componente_id": "r5-7600", "loja": "Pichau", "url": "https://y", "coletado_em": "2026-11-11",
                 "titulo": "Processador AMD Ryzen 5 7600", "preco_texto": "R$ 999,99"}]
    r = precos.calcular(store.get("r5-7600"), anuncios)
    assert [o.preco for o in r.ofertas] == [999.99] and r.descartes[0].motivo == "kit/combo com outras peças"
    assert precos.COMBO.search("PC Home Pichau HM260 AMD Ryzen 5 7600")
    ok, _ = precos.mesmo_produto(store.get("ram-fury-d5-32"), "Memória Kingston Fury Beast DDR5 32GB (2x16GB) 6000MHz Kit")
    assert ok and not precos.COMBO.search("Memória Kingston Fury Beast DDR5 32GB (2x16GB) 6000MHz Kit")


def test_busca_sem_oferta_valida_nao_gasta_credito_de_novo(store, serper, monkeypatch, tmp_path):
    monkeypatch.setattr(precos, "CACHE_DISCO", tmp_path / "precos.json")
    assert not precos.pesquisar(store, "psu-a750gl").tem_preco     # a amostra é de placa de vídeo
    assert not precos.pesquisar(store, "psu-a750gl").tem_preco
    assert len(serper) == 1


@pytest.mark.parametrize("cid, titulo, esperado", [
    # títulos reais do Google Shopping (11/11/2026)
    ("psu-cx650", "Fonte 650W 80 Plus Bronze Corsair CX650", True),                       # "80 Plus" não é variante
    ("rtx-4070tis", "Placa de Vídeo RTX 4070 TI Super MSI 16G Ventus 2X OC", True),        # "16G" = 16gb
    ("ssd-mx500-1t", "Hd Ssd 1tb Crucial Mx500 2.5 7mm Sata 6gb/s", True),                 # 6gb/s é interface
    ("mb-b760-tuf-d5", "Placa Mãe Asus Tuf Gaming B760-plus Wi-fi Socket LGA 1700 Ddr5", True),
    ("psu-focus-1000", "Fonte De Alimentação Seasonic Focus Gx 1000w Atx 3.1 Gold", True),
    ("case-h5-flow", "Gabinete Gamer NZXT H5 Flow Mid Tower", True),                       # "(2024)" omitido
    ("psu-core2-750", "Fonte XPG Kyber 750W ATX 3.1 80 Plus Gold", False),                 # outra linha
    ("psu-core2-750", "Fonte Xpg 750w Core Reactor 80 Plus Gold Modular", False),          # Reactor I, não II
    ("ram-lpx-d4-32", "Corsair Dominator Platinum RGB 32 GB Ddr4 3200", False),
    ("clr-nhd15", "Noctua NH-D15 chromax.black", False),                                    # sem G2
    ("clr-lf3-360", "Water Cooler Arctic Liquid Freezer Iii Pro 360 A-rgb", False),        # Pro
    ("rtx-4070tis", "Placa D Vídeo Msi Ventus 2x Nvidia Geforce 4070ti 16gb Gddr6", False), # Ti sem Super
])
def test_mesmo_produto_com_titulos_reais(store, cid, titulo, esperado):
    assert precos.mesmo_produto(store.get(cid), titulo)[0] is esperado
