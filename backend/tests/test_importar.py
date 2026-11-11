from app.importar import importar


def test_texto_colado_e_carrinho(store):
    texto = """CPU: AMD Ryzen 5 7600 3.8 GHz 6-Core Processor ($199.00 @ Amazon)
Placa de Vídeo NVIDIA GeForce RTX 4060 Ti 8GB - R$ 2.499,90
2x Memória Kingston Fury Beast 32GB (2x16GB) DDR5 6000MHz
Teclado gamer qualquer
"""
    r = importar(store, texto)
    ids = {i.componente_id: i.quantidade for i in r.itens}
    assert ids == {"r5-7600": 1, "rtx-4060ti-8g": 1, "ram-fury-d5-32": 2}
    assert r.nao_reconhecidas == ["Teclado gamer qualquer"]


def test_link_pcpartpicker_pede_texto(store):
    r = importar(store, "https://pcpartpicker.com/list/abc123")
    assert not r.itens and "PCPartPicker" in r.avisos[0]


def test_upgrade_marca_ja_tenho(store):
    r = importar(store, "Ryzen 5 5600", ja_tenho=True)
    assert r.itens[0].ja_tenho and r.itens[0].travado
