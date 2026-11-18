import pytest

from app import folgas
from app.compat.consolidador import revisar_build
from app.modelos import BuildCriar
from conftest import BASE_OK, itens


def pecas(store, *ids, **alteracoes):
    """Peças por tipo, como a cena e os revisores usam; `alteracoes` muda specs de uma peça só neste teste."""
    out = {}
    for cid in ids:
        c = store.componentes[cid]
        if cid in alteracoes:
            c = c.model_copy(update={"specs": {**c.specs, **alteracoes[cid]}})
        out[c.tipo] = c
    return out


def uma(store, fid, *ids, **alteracoes):
    return next((f for f in folgas.calcular(pecas(store, *ids, **alteracoes)) if f.id == fid), None)


def test_gpu_cabe_com_sobra(store):
    f = uma(store, "gpu", "rtx-4060-8g", "case-lancool-216")
    assert (f.peca, f.limite_de, f.tamanho_mm, f.limite_mm, f.sobra_mm, f.estado) == ("rtx-4060-8g", "case-lancool-216", 240, 392, 152, "cabe")


def test_gpu_nao_cabe(store):
    f = uma(store, "gpu", "rtx-4080s", "case-nr200p")
    assert f.sobra_mm == -10 and f.estado == "nao_cabe"


def test_gpu_justa(store):
    assert uma(store, "gpu", "rtx-4060-8g", "case-lancool-216", **{"rtx-4060-8g": {"comprimento_mm": 382}}).estado == "justa"
    assert uma(store, "gpu", "rtx-4060-8g", "case-lancool-216", **{"rtx-4060-8g": {"comprimento_mm": 377}}).estado == "cabe"


def test_radiador_frontal_vira_ajuste(store):
    # lf3-360 sem radiador_posicao = na frente: no Lancool sobram 340 mm para a GPU (392 sem radiador)
    f = uma(store, "gpu", "rtx-4080s", "case-lancool-216", "clr-lf3-360", **{"rtx-4080s": {"comprimento_mm": 350}})
    assert f.estado == "ajuste" and f.dica == "monte o radiador no topo" and f.limite_mm == 340 and f.sobra_mm == -10


def test_radiador_no_topo_usa_gpu_max(store):
    f = uma(store, "gpu", "rtx-4080s", "case-lancool-216", "clr-kraken-240", **{"rtx-4080s": {"comprimento_mm": 350}})
    assert f.limite_mm == 392 and f.estado == "cabe"


def test_memoria_ajuste_e_nao_cabe(store):
    # nh-d15 deixa 32 mm sob a ventoinha
    f = uma(store, "memoria", "ram-fury-d5-32", "clr-nhd15", **{"ram-fury-d5-32": {"altura_mm": 40}})
    assert f.estado == "ajuste" and f.dica == "a ventoinha precisa subir" and f.sobra_mm == -8
    assert uma(store, "memoria", "ram-fury-d5-32", "clr-nhd15", **{"ram-fury-d5-32": {"altura_mm": 43}}).estado == "nao_cabe"
    assert uma(store, "memoria", "ram-veng-d5-32", "clr-nhd15").estado == "nao_cabe"   # 44 mm, passa 12


def test_cooler_e_fonte(store):
    c = uma(store, "cooler", "clr-nhd15", "case-q300l")   # 168 mm numa tampa de 159
    assert c.sobra_mm == -9 and c.estado == "nao_cabe"
    assert uma(store, "cooler", "clr-ak400", "case-lancool-216").sobra_mm == 25
    f = uma(store, "fonte", "psu-a750gl", "case-nr200p")   # 150 mm na largura de 185
    assert (f.tamanho_mm, f.limite_mm, f.sobra_mm, f.estado) == (150, 185, 35, "cabe")


def test_peca_faltando_some(store):
    ids = {f.id for f in folgas.calcular(pecas(store, "rtx-4060-8g", "clr-ak400", "ram-fury-d5-32", "psu-a750gl"))}
    assert ids == {"memoria"}   # sem gabinete: só memória x cooler
    ids = {f.id for f in folgas.calcular(pecas(store, "rtx-4060-8g", "clr-lf3-360", "ram-fury-d5-32", "case-lancool-216"))}
    assert "cooler" not in ids and "memoria" not in ids


@pytest.mark.parametrize("cooler", [None, "clr-lf3-360"])
def test_folgas_concordam_com_a_revisao(store, cooler):
    b = store.criar_build(BuildCriar())
    for gpu in [c.id for c in store.por_tipo("gpu")]:
        for case in [c.id for c in store.por_tipo("gabinete")]:
            ids = [gpu, case] + ([cooler] if cooler else [])
            achados = {":".join(a.id.split(":")[:2]) for a in revisar_build(store, b, itens(*ids))}
            f = uma(store, "gpu", *ids)
            assert (f.estado == "nao_cabe") == ("par:gpu_comprimento" in achados), (gpu, case, cooler)
            assert (f.estado == "ajuste") == ("espaco:radiador_gpu" in achados), (gpu, case, cooler)
            assert (f.estado == "justa") == ("espaco:gpu_justa" in achados), (gpu, case, cooler)


def test_revisao_respeita_radiador_no_topo(store):
    b = store.criar_build(BuildCriar())
    ids = ["rtx-4080s", "case-lancool-216", "clr-kraken-240"]
    store.componentes["rtx-4080s"] = store.componentes["rtx-4080s"].model_copy(
        update={"specs": {**store.componentes["rtx-4080s"].specs, "comprimento_mm": 350}})
    assert not any(a.id.startswith("espaco:radiador_gpu") for a in revisar_build(store, b, itens(*ids)))


def test_cena_e_previa_trazem_folgas(client):
    bid = client.post("/builds", json={"modo": "manual", "orcamento": 8000}).json()["id"]
    for cid in BASE_OK:
        client.post(f"/builds/{bid}/itens", json={"componente_id": cid})
    assert any(f["id"] == "gpu" and f["sobra_mm"] == 152 for f in client.get(f"/builds/{bid}/cena").json()["folgas"])
    previa = client.post(f"/builds/{bid}/cena/previa", json={"de": "rtx-4060-8g", "para": "rx-7600"}).json()
    assert any(f["id"] == "gpu" and f["tamanho_mm"] == 204 for f in previa["folgas"])
