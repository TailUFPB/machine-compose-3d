from datetime import datetime, timedelta, timezone

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
