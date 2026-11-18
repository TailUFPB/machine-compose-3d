from datetime import datetime, timedelta, timezone

import pytest

from app import precos


def test_parse_brl():
    assert precos.parse_brl("R$ 1.899,90") == 1899.90
    assert precos.parse_brl("por R$ 45,5 à vista") == 45.5
    assert precos.parse_brl("sem preço") is None
    assert precos.brl(1234.5) == "R$ 1.234,50"


def test_mesmo_produto_recusa_variantes_e_capacidades(store):
    c = store.componentes
    assert precos.mesmo_produto(c["rtx-4060-8g"], "Placa de Vídeo NVIDIA GeForce RTX 4060 8GB Dual")[0]
    assert not precos.mesmo_produto(c["rtx-4060-8g"], "NVIDIA GeForce RTX 4060 Ti 8GB")[0]
    assert not precos.mesmo_produto(c["rtx-4060ti-16g"], "GeForce RTX 4060 Ti 8GB")[0]
    assert not precos.mesmo_produto(c["r5-7600"], "Processador AMD Ryzen 5 7600X")[0]
    assert not precos.mesmo_produto(c["rx-9070"], "AMD Radeon RX 9070 XT 16GB")[0]
    assert precos.mesmo_produto(c["ram-fury-d5-32"], "Memória Kingston Fury Beast 32GB (2x16GB) DDR5 6000MHz")[0]
    assert not precos.mesmo_produto(c["ram-fury-d5-32"], "Kingston Fury Beast DDR5 16GB (2x8) 6000")[0]


def test_pipeline_descarta_produto_errado_e_outlier(store):
    r = precos.pesquisar(store, "rtx-4060-8g")
    assert r.tem_preco and r.preco_min <= r.preco_med <= r.preco_max
    assert all("Ti" not in o.titulo for o in r.ofertas)
    assert any("variante" in d.motivo for d in r.descartes)
    assert all(o.url.startswith("https://") for o in r.ofertas)   # nenhum preço sem fonte


def test_outlier_removido():
    from app.modelos import Componente
    comp = Componente(id="x", tipo="extra", marca="A", modelo="Coisa 10", specs={}, fonte="f")
    anuncios = [{"loja": l, "titulo": "A Coisa 10", "preco_texto": p, "url": "https://x", "coletado_em": "2026"}
                for l, p in [("L1", "R$ 100,00"), ("L2", "R$ 105,00"), ("L3", "R$ 98,00"), ("L4", "R$ 20,00"), ("L5", "R$ 400,00")]]
    r = precos.calcular(comp, anuncios)
    assert sorted(o.preco for o in r.ofertas) == [98, 100, 105]
    assert sum(d.motivo == "outlier" for d in r.descartes) == 2
    assert r.confianca == "alta"


def test_oferta_sem_url_descartada():
    from app.modelos import Componente
    comp = Componente(id="x", tipo="extra", marca="A", modelo="Coisa 10", specs={}, fonte="f")
    r = precos.calcular(comp, [{"loja": "L", "titulo": "A Coisa 10", "preco_texto": "R$ 10,00", "url": "", "coletado_em": "2026"}])
    assert not r.tem_preco and r.descartes[0].motivo == "sem fonte (URL)"


def test_cache_sete_dias_e_reserva_vencida(store):
    t0 = datetime(2026, 11, 10, tzinfo=timezone.utc)
    hist_antes = len(store.historico_precos)
    r1 = precos.pesquisar(store, "rx-7600", agora=t0)
    assert not r1.do_cache and len(store.historico_precos) > hist_antes
    assert precos.pesquisar(store, "rx-7600", agora=t0 + timedelta(days=6)).do_cache
    store.anuncios = [a for a in store.anuncios if a["componente_id"] != "rx-7600"]   # busca falha
    r3 = precos.pesquisar(store, "rx-7600", agora=t0 + timedelta(days=8))
    assert r3.do_cache and r3.vencido and r3.preco_med == r1.preco_med


def test_historico_ordenado(store):
    h = precos.historico(store, "rx-7600")
    assert len(h) >= 8 and h == sorted(h, key=lambda x: x["coletado_em"])


@pytest.mark.parametrize("cid, titulo, esperado", [
    ("rtx-4060-8g", "Placa Vídeo Gigabyte Geforce Rtx4060 8gb GDDR6", True),
    ("ssd-nv3-1t", "Snv3s/1000g SSD de 1TB Padrão Nv3 Formato M.2 2280 Nvme 4.0 Gen 4x4", True),
    ("ssd-nv3-1t", "Hd Ssd M.2 Kingston Nv3 Pci-e 4.0x4 Nvme 1tb - Snv3s/1000g", True),
    ("r5-7600x", "AMD Ryzen 5 7600X 6 x 4,7GHz Hexa Core Processador AM5 105W", True),
    ("i5-13400f", "Processador Intel Core i5-13400f, 4.6ghz Max Turbo, Cache 20mb LGA 1700", True),
    ("ram-fury-d5-32", "Memória Ram Kingston Fury Beast 32GB (2 x 16 GB) DDR5 6000MHz Pc Desktop Gamer", True),
    ("clr-ak400", "Cooler Para Processador GamerStorm X Redragon AK400 RD", True),
    ("ext-fan-3pack", "Kit 3 Fans Tgt Humber ARGB 3x120mm Com Controladora Preto", True),
    ("mb-b650m-a", "Placa-mãe Asus Prime B650m-a Ax6 Ii Am5 4x Ddr5", False),
    ("mb-b650m-a", "Placa-mãe Asus Prime B650m-a Ax Ii Amd B650 Am5", False),
])
def test_mesmo_produto_casos_reais_parte_b(store, cid, titulo, esperado):
    assert precos.mesmo_produto(store.get(cid), titulo)[0] is esperado


def test_combo_nao_descarta_nota_fiscal_ou_pc_desktop_em_peca_avulsa(store):
    anuncios = [
        {"componente_id": "ext-pasta", "loja": "Mercado Livre", "url": "https://x/1", "coletado_em": "2026-11-13",
         "titulo": "Pasta Térmica Arctic Mx-4 4g Melhor Desempenho Original + Nf", "preco_texto": "R$ 62,78"},
        {"componente_id": "r7-7700", "loja": "Amazon", "url": "https://x/2", "coletado_em": "2026-11-13",
         "titulo": "MXZ Gaming PC,AMD Ryzen 7 7700", "preco_texto": "R$ 18.716,15"},
    ]
    r_pasta = precos.calcular(store.get("ext-pasta"), [anuncios[0]])
    assert [o.preco for o in r_pasta.ofertas] == [62.78]
    r_cpu = precos.calcular(store.get("r7-7700"), [anuncios[1]])
    assert not r_cpu.ofertas and r_cpu.descartes[0].motivo == "kit/combo com outras peças"


def test_outlier_com_duas_ofertas_nao_descarta_a_mais_barata(store):
    anuncios = [
        {"componente_id": "psu-cx650", "loja": "Pichau", "url": "https://x/1", "coletado_em": "2026-11-13",
         "titulo": "Fonte 650W 80 Plus Bronze Corsair CX650", "preco_texto": "R$ 350,00"},
        {"componente_id": "psu-cx650", "loja": "Terabyte", "url": "https://x/2", "coletado_em": "2026-11-13",
         "titulo": "Fonte Corsair 650W 80 Plus Bronze CX650", "preco_texto": "R$ 2.399,99"},
    ]
    r = precos.calcular(store.get("psu-cx650"), anuncios)
    assert sorted(o.preco for o in r.ofertas) == [350.0, 2399.99]
    assert r.preco_min == 350.0
    assert r.qtd_lojas == 2


def test_outlier_em_grupo_justo_remove_dobro_via_log_mad():
    from app.modelos import Componente
    comp = Componente(id="x", tipo="extra", marca="A", modelo="Coisa 10", specs={}, fonte="f")
    anuncios = [
        {"loja": l, "titulo": "A Coisa 10", "preco_texto": p, "url": "https://x", "coletado_em": "2026"}
        for l, p in [("L1", "R$ 980,00"), ("L2", "R$ 1.000,00"), ("L3", "R$ 1.010,00"), ("L4", "R$ 1.020,00"), ("L5", "R$ 2.000,00")]
    ]
    r = precos.calcular(comp, anuncios)
    assert sorted(o.preco for o in r.ofertas) == [980.0, 1000.0, 1010.0, 1020.0]
    assert [d.motivo for d in r.descartes] == ["outlier"]


def test_detecta_condicao_pagamento_em_oferta():
    from app.modelos import Componente
    comp = Componente(id="x", tipo="extra", marca="A", modelo="Coisa 10", specs={}, fonte="f")
    anuncios = [
        {"loja": "Kabum", "titulo": "A Coisa 10", "preco_texto": "R$ 990,00 à vista no Pix", "url": "https://x/1", "coletado_em": "2026"},
        {"loja": "Pichau", "titulo": "A Coisa 10", "preco_texto": "R$ 1.140,00 em até 12x sem juros", "url": "https://x/2", "coletado_em": "2026"},
        {"loja": "Amazon", "titulo": "A Coisa 10", "preco_texto": "R$ 1.050,00", "url": "https://x/3", "coletado_em": "2026"},
    ]
    r = precos.calcular(comp, anuncios)
    por_loja = {o.loja: o.condicao_pagamento for o in r.ofertas}
    assert por_loja == {"Kabum": "a_vista", "Pichau": "parcelado", "Amazon": "desconhecida"}
