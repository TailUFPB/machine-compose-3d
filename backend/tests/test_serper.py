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
    assert serper[0]["q"] == "RTX 4060"
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
    assert {h["componente_id"] for h in outro.historico_precos} == {"rtx-4060-8g", "rtx-4060ti-8g"}   # sem histórico fictício
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
        "Ryzen 5 7600": "serper_cpu_r5_7600.json",
        "RTX 4060": "serper_gpu_rtx4060_8g.json",
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


def test_ttl_por_categoria_e_leitura_passiva_sem_gastar_credito(store, monkeypatch, tmp_path):
    from datetime import datetime, timedelta, timezone

    assert precos.TTL_POR_TIPO_DIAS["gpu"] == 3
    assert precos.TTL_POR_TIPO_DIAS["fonte"] == 7
    assert precos.TTL_POR_TIPO_DIAS["extra"] == 14
    assert precos.TTL_POR_TIPO_DIAS["gabinete"] == 20

    chamadas = []

    def nao_chamar(req, timeout):
        chamadas.append(req)
        raise AssertionError("Leitura passiva não pode chamar a Serper")

    monkeypatch.setattr(precos, "CACHE_DISCO", tmp_path / "precos.json")
    monkeypatch.setattr(precos.urllib.request, "urlopen", nao_chamar)
    monkeypatch.setattr(get_settings(), "busca_provider", "serper")
    monkeypatch.setattr(get_settings(), "serper_api_key", "chave-teste")

    vazio = precos.consultar_cache(store, "rtx-4060-8g")
    assert not vazio.tem_preco and chamadas == []

    agora = datetime(2026, 11, 13, tzinfo=timezone.utc)
    r_gpu = precos.ResultadoPreco(componente_id="rtx-4060-8g", preco_min=1700, preco_med=1800, preco_max=1900)
    r_case = precos.ResultadoPreco(componente_id="case-h5-flow", preco_min=400, preco_med=450, preco_max=500)
    store.cache_precos["rtx-4060-8g"] = {"em": agora - timedelta(days=4), "resultado": r_gpu}
    store.cache_precos["case-h5-flow"] = {"em": agora - timedelta(days=15), "resultado": r_case}

    gpu_cache = precos.consultar_cache(store, "rtx-4060-8g", agora=agora)
    case_cache = precos.consultar_cache(store, "case-h5-flow", agora=agora)
    assert gpu_cache.do_cache and gpu_cache.vencido
    assert case_cache.do_cache and not case_cache.vencido
    assert chamadas == []


def test_swr_retorna_cache_vencido_na_hora_e_renova_em_segundo_plano(store, monkeypatch, tmp_path):
    import threading
    from datetime import datetime, timedelta, timezone

    fixtures = Path(__file__).parent / "fixtures"
    payload = (fixtures / "serper_gpu_rtx4060_8g.json").read_bytes()
    renovou = threading.Event()

    def urlopen(req, timeout):
        renovou.set()
        return io.BytesIO(payload)

    monkeypatch.setattr(precos, "CACHE_DISCO", tmp_path / "precos.json")
    monkeypatch.setattr(precos.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(get_settings(), "busca_provider", "serper")
    monkeypatch.setattr(get_settings(), "serper_api_key", "chave-teste")

    agora = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)
    antigo = precos.ResultadoPreco(componente_id="rtx-4060-8g", preco_min=1500, preco_med=1600, preco_max=1700)
    store.cache_precos["rtx-4060-8g"] = {"em": agora - timedelta(days=5), "resultado": antigo}

    resp = precos.pesquisar(store, "rtx-4060-8g", agora=agora, permitir_busca=True)
    assert resp.do_cache and resp.vencido and resp.preco_med == 1600
    assert renovou.wait(timeout=2.0)

    # Aguarda conclusão da gravação do worker em background
    deadline = datetime.now(timezone.utc) + timedelta(seconds=2)
    while "rtx-4060-8g" in precos._renovando and datetime.now(timezone.utc) < deadline:
        pass
    atualizado = precos.consultar_cache(store, "rtx-4060-8g")
    assert atualizado.do_cache and not atualizado.vencido and atualizado.preco_med != 1600


def test_busca_por_familia_preenche_irmaos_com_uma_chamada(store, monkeypatch, tmp_path):
    assert precos._familia_de(store.get("r5-7600")) == "Ryzen 5 7600"
    assert precos._familia_de(store.get("r5-7600x")) == "Ryzen 5 7600"

    chamadas = []
    resposta = {
        "shopping": [
            {"title": "Processador AMD Ryzen 5 7600 AM5", "source": "Kabum", "price": "R$ 1.299,00", "link": "https://www.kabum.com.br/p/1"},
            {"title": "Processador AMD Ryzen 5 7600 AM5", "source": "Pichau", "price": "R$ 1.320,00", "link": "https://www.pichau.com.br/p/1"},
            {"title": "Processador AMD Ryzen 5 7600 AM5", "source": "Terabyte", "price": "R$ 1.350,00", "link": "https://www.terabyteshop.com.br/p/1"},
            {"title": "Processador AMD Ryzen 5 7600X AM5", "source": "Kabum", "price": "R$ 1.499,00", "link": "https://www.kabum.com.br/p/2"},
            {"title": "Processador AMD Ryzen 5 7600X AM5", "source": "Pichau", "price": "R$ 1.519,00", "link": "https://www.pichau.com.br/p/2"},
        ]
    }

    def urlopen(req, timeout):
        chamadas.append(json.loads(req.data))
        return io.BytesIO(json.dumps(resposta).encode())

    monkeypatch.setattr(precos, "CACHE_DISCO", tmp_path / "precos.json")
    monkeypatch.setattr(precos.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(get_settings(), "busca_provider", "serper")
    monkeypatch.setattr(get_settings(), "serper_api_key", "chave-teste")

    r_base = precos.pesquisar(store, "r5-7600")
    assert r_base.tem_preco and r_base.preco_med == 1320.0
    assert len(chamadas) == 1
    assert chamadas[0]["q"] == "Ryzen 5 7600"

    r_irmao = precos.consultar_cache(store, "r5-7600x")
    assert r_irmao.tem_preco and r_irmao.preco_med == 1509.0


def test_limite_diario_serper_bloqueia_novas_chamadas_e_persiste(store, monkeypatch, tmp_path):
    fixtures = Path(__file__).parent / "fixtures"
    payload_clr = (fixtures / "serper_clr_nhd15.json").read_bytes()
    payload_org = (fixtures / "serper_organic_kabum.json").read_bytes()
    chamadas = []

    def urlopen(req, timeout):
        chamadas.append(req.full_url)
        return io.BytesIO(payload_org if "search" in req.full_url and "shopping" not in req.full_url else payload_clr)

    monkeypatch.setattr(precos, "CACHE_DISCO", tmp_path / "precos.json")
    monkeypatch.setattr(precos.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(get_settings(), "busca_provider", "serper")
    monkeypatch.setattr(get_settings(), "serper_api_key", "chave-teste")
    monkeypatch.setattr(get_settings(), "serper_limite_diario", 2)

    assert precos.pesquisar(store, "clr-nhd15").tem_preco
    precos.resolver_link_loja(store, "Kabum", "NZXT H5 Flow", "https://www.google.com/search?tbm=shop&q=h5")
    assert precos.status_consumo(store)["usados"] == 2
    assert precos.status_consumo(store)["restantes"] == 0

    # Atingiu o limite: nova busca não pode chamar a rede
    chamadas.clear()
    r_bloq = precos.pesquisar(store, "case-h5-flow")
    assert not r_bloq.tem_preco and chamadas == []

    from app.store import novo_store
    outro = novo_store()
    precos.carregar_disco(outro)
    assert precos.status_consumo(outro)["usados"] == 2


def test_supabase_hidrata_cache_e_consumo(store, monkeypatch, tmp_path):
    from datetime import datetime, timezone

    hoje = datetime.now(timezone.utc).date().isoformat()
    tabelas = {
        "cache_anuncios": [{
            "componente_id": "case-h5-flow",
            "familia": None,
            "buscado_em": datetime.now(timezone.utc).isoformat(),
            "anuncios": [{"componente_id": "case-h5-flow", "loja": "Kabum", "titulo": "Gabinete NZXT H5 Flow",
                          "preco_texto": "R$ 499,90", "url": "https://www.kabum.com.br/p/1",
                          "coletado_em": datetime.now(timezone.utc).isoformat()}],
        }],
        "links_resolvidos": [{"chave": "Kabum|NZXT H5 Flow", "url": "https://www.kabum.com.br/p/1"}],
        "consumo_serper": [{"data": hoje, "creditos": 7}],
    }

    monkeypatch.setattr(precos, "CACHE_DISCO", tmp_path / "inexistente.json")
    monkeypatch.setattr(store, "ler_tabela", lambda nome: tabelas.get(nome, []))
    monkeypatch.setattr(get_settings(), "busca_provider", "serper")
    monkeypatch.setattr(get_settings(), "serper_api_key", "chave-teste")

    precos.carregar_disco(store)
    assert precos.consultar_cache(store, "case-h5-flow").preco_med == 499.9
    assert store.links_resolvidos["Kabum|NZXT H5 Flow"] == "https://www.kabum.com.br/p/1"
    assert precos.status_consumo(store)["usados"] == 7


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
