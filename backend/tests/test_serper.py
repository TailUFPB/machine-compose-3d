"""Provedor real (Google Shopping via serper.dev) com uma resposta real gravada: nada sai para a rede."""
import io
import json
from pathlib import Path

import pytest

from app import precos
from app.config import get_settings

AMOSTRA = (Path(__file__).parent / "serper_rtx4060.json").read_bytes()


@pytest.fixture
def serper(monkeypatch, tmp_path):
    pedidos = []
    def urlopen(req, timeout):
        pedidos.append(json.loads(req.data))
        return io.BytesIO(AMOSTRA)
    monkeypatch.setattr(precos, "CACHE_DISCO", tmp_path / "precos.json")
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


def test_busca_sem_oferta_valida_nao_gasta_credito_de_novo(store, serper):
    assert not precos.pesquisar(store, "psu-a750gl").tem_preco     # a amostra é de placa de vídeo
    pedidos_primeira = len(serper)
    assert not precos.pesquisar(store, "psu-a750gl").tem_preco
    assert len(serper) == pedidos_primeira


def test_consulta_remove_diversos_e_faz_fallback_curto_quando_poucas_lojas(store, monkeypatch, tmp_path):
    fixtures = Path(__file__).parent / "fixtures"
    pedidos = []

    def urlopen(req, timeout):
        body = json.loads(req.data)
        pedidos.append(body["q"])
        if "(2024)" in body["q"]:
            return io.BytesIO((fixtures / "serper_case_h5_longa.json").read_bytes())
        if "NZXT H5 Flow" in body["q"]:
            return io.BytesIO((fixtures / "serper_case_h5_curta.json").read_bytes())
        return io.BytesIO((fixtures / "serper_ext_pasta.json").read_bytes())

    monkeypatch.setattr(precos, "CACHE_DISCO", tmp_path / "precos.json")
    monkeypatch.setattr(precos.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(get_settings(), "busca_provider", "serper")
    monkeypatch.setattr(get_settings(), "serper_api_key", "chave-teste")

    # Caso 1: marca "Diversos" não deve ir para a query de busca
    r_pasta = precos.pesquisar(store, "ext-pasta")
    assert pedidos[-1] == "Pasta térmica Arctic MX-4 4g"
    assert r_pasta.tem_preco

    # Caso 2: H5 Flow (2024) no fixture longo só tem 1 loja ou <2 lojas válidas? Wait — check!
    pedidos.clear()
    # Simula busca longa com só 1 loja (e fallback curta com várias lojas)
    def urlopen_caso_longo_pobre(req, timeout):
        q = json.loads(req.data)["q"]
        pedidos.append(q)
        if "PCIE5" in q:
            return io.BytesIO((fixtures / "serper_psu_a750gl_longa.json").read_bytes())
        return io.BytesIO((fixtures / "serper_psu_a750gl_curta.json").read_bytes())

    monkeypatch.setattr(precos.urllib.request, "urlopen", urlopen_caso_longo_pobre)
    r_psu = precos.pesquisar(store, "psu-a750gl")
    assert pedidos == ["MSI MAG A750GL PCIE5 750W", "MSI MAG A750GL 750W"]
    assert len(r_psu.ofertas) >= 3


def test_outliers_e_loja_unica_com_amostras_reais(store, monkeypatch, tmp_path):
    fixtures = Path(__file__).parent / "fixtures"
    mapa = {
        "AMD Ryzen 5 7600": "serper_cpu_r5_7600.json",
        "NVIDIA GeForce RTX 4060 8GB": "serper_gpu_rtx4060_8g.json",
        "Noctua NH-D15 G2": "serper_clr_nhd15.json",
    }

    def urlopen(req, timeout):
        q = json.loads(req.data)["q"]
        return io.BytesIO((fixtures / mapa[q]).read_bytes())

    monkeypatch.setattr(precos, "CACHE_DISCO", tmp_path / "precos.json")
    monkeypatch.setattr(precos.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(get_settings(), "busca_provider", "serper")
    monkeypatch.setattr(get_settings(), "serper_api_key", "chave-teste")

    r_cpu = precos.pesquisar(store, "r5-7600")
    assert 499.0 not in {o.preco for o in r_cpu.ofertas}
    assert any(d.motivo == "outlier" and "Tray" in d.titulo for d in r_cpu.descartes)
    assert r_cpu.preco_min == 999.99

    r_gpu = precos.pesquisar(store, "rtx-4060-8g")
    assert 10286.51 not in {o.preco for o in r_gpu.ofertas}
    assert r_gpu.preco_min == 1734.0
    assert r_gpu.qtd_lojas == 3

    r_clr = precos.pesquisar(store, "clr-nhd15")
    assert r_clr.tem_preco
    assert r_clr.qtd_lojas == 1
    assert r_clr.confianca == "baixa"


def test_resolver_link_direto_no_clique_e_cache_em_disco(store, monkeypatch, tmp_path):
    fixtures = Path(__file__).parent / "fixtures"
    organic = (fixtures / "serper_organic_kabum.json").read_bytes()
    pedidos = []

    def urlopen(req, timeout):
        pedidos.append((req.full_url, json.loads(req.data)))
        return io.BytesIO(organic)

    monkeypatch.setattr(precos, "CACHE_DISCO", tmp_path / "precos.json")
    monkeypatch.setattr(precos.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(get_settings(), "busca_provider", "serper")
    monkeypatch.setattr(get_settings(), "serper_api_key", "chave-teste")

    fallback = "https://www.google.com/search?tbm=shop&q=Gabinete+Gamer+NZXT+H5+Flow"
    esperado = "https://www.kabum.com.br/produto/692553/gabinete-nzxt-h5-flow-mid-tower-atx-lateral-em-vidro-preto-cc-h52fb-01"

    u1 = precos.resolver_link_loja(store, "Kabum", "Gabinete Gamer NZXT H5 Flow Mid Tower", fallback)
    assert u1 == esperado
    assert len(pedidos) == 1
    assert pedidos[0][0] == "https://google.serper.dev/search"
    assert pedidos[0][1]["q"] == "site:kabum.com.br Gabinete Gamer NZXT H5 Flow Mid Tower"

    # Repetir o clique usa cache (0 créditos) inclusive após recarregar do disco
    assert precos.resolver_link_loja(store, "Kabum", "Gabinete Gamer NZXT H5 Flow Mid Tower", fallback) == esperado
    assert len(pedidos) == 1

    from app.store import novo_store
    outro = novo_store()
    precos.carregar_disco(outro)
    assert precos.resolver_link_loja(outro, "Kabum", "Gabinete Gamer NZXT H5 Flow Mid Tower", fallback) == esperado
    assert len(pedidos) == 1

    # URL já direta da loja não gasta crédito; erro de rede cai no fallback sem quebrar
    direta = "https://www.kabum.com.br/produto/123"
    assert precos.resolver_link_loja(store, "Kabum", "Qualquer Outro", direta) == direta
    assert len(pedidos) == 1

    def cai(req, timeout):
        raise OSError("sem rede")

    monkeypatch.setattr(precos.urllib.request, "urlopen", cai)
    assert precos.resolver_link_loja(store, "Kabum", "Item Sem Cache", fallback) == fallback


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
