from app.compat import regras
from conftest import BASE_OK, itens


def ids(achados, sev=None):
    return {a.id.split(":")[0] + ":" + a.id.split(":")[1] if a.id.startswith("par:") else a.id.split(":")[0]
            for a in achados if sev is None or a.severidade == sev}


def bloq(store, lista):
    return [a for a in regras.avaliar(store, itens(*lista)) if a.severidade == "bloqueante"]


def troca(lista, de, para):
    return [para if x == de else x for x in lista]


def test_build_base_sem_bloqueantes(store):
    assert bloq(store, BASE_OK) == []


def test_socket_incompativel_com_correcao(store):
    b = bloq(store, troca(BASE_OK, "mb-b650m-a", "mb-b760-tuf-d5"))
    a = next(a for a in b if a.id.startswith("par:socket"))
    assert a.correcao_sugerida.acao == "trocar" and a.correcao_sugerida.componente_id == "mb-b760-tuf-d5"
    assert store.componentes[a.correcao_sugerida.para_id].specs["socket"] == "AM5"
    assert a.fonte_url and a.verificado


def test_ddr_errada(store):
    b = bloq(store, troca(BASE_OK, "ram-fury-d5-32", "ram-lpx-d4-32"))
    a = next(a for a in b if a.id.startswith("par:ddr:"))
    assert store.componentes[a.correcao_sugerida.para_id].specs["ddr"] == "DDR5"


def test_slots_ram(store):
    lista = itens(*BASE_OK)
    lista[2].quantidade = 3   # 6 módulos em 4 slots
    assert any(a.id.startswith("par:slots_ram") for a in regras.avaliar(store, lista))


def test_form_factor_e_gpu_no_gabinete(store):
    b = bloq(store, ["r5-7600", "mb-b650-gx-ax", "case-nr200p", "rtx-4080s", "psu-sf750"])
    assert {"par:form_factor", "par:gpu_comprimento"} <= {a.id.rsplit(":", 1)[0] for a in b}
    assert all(a.fisico for a in b if a.id.startswith(("par:form", "par:gpu")))


def test_altura_cooler_e_fonte_atx_em_gabinete_sfx(store):
    b = bloq(store, ["r7-7800x3d", "mb-b650i-strix", "case-nr200p", "clr-nhd15", "psu-rm850e"])
    tipos = {a.id.rsplit(":", 1)[0] for a in b}
    assert {"par:cooler_altura", "par:psu_form"} <= tipos


def test_potencia_da_fonte(store):
    b = bloq(store, troca(troca(BASE_OK, "rtx-4060-8g", "rtx-4080s"), "psu-a750gl", "psu-a550bn"))
    a = next(a for a in b if a.id.startswith("par:potencia"))
    assert store.componentes[a.correcao_sugerida.para_id].specs["potencia_w"] >= 550


def test_cooler_e_video_ausentes(store):
    b = bloq(store, ["r7-7800x3d", "mb-b650m-a"])
    assert any(a.id == "cooler_ausente:r7-7800x3d" and a.correcao_sugerida.acao == "adicionar" for a in b)
    b2 = bloq(store, ["i5-12400f", "mb-b760m-d4"])
    assert any(a.id.startswith("video_ausente") for a in b2)


def test_itens_faltantes_sao_sugestoes(store):
    achados = regras.avaliar(store, itens("r5-7600", "mb-b650m-a", "case-q300l"))
    sug = {a.id.split(":")[0] + ":" + a.id.split(":")[1] for a in achados if a.severidade == "sugestao"}
    assert {"faltante:fans", "faltante:wifi", "faltante:so"} <= sug
    assert any(a.id == "faltam_pecas" and a.severidade == "atencao" for a in achados)


def test_filtro_manual_marca_motivo(store):
    base = itens("r5-7600", "mb-b650m-a")
    assert regras.motivo_incompativel(store, base, store.componentes["ram-lpx-d4-32"])
    assert regras.motivo_incompativel(store, base, store.componentes["ram-fury-d5-32"]) is None
    assert "Socket" in regras.motivo_incompativel(store, base, store.componentes["i5-12400f"])
    # a CPU nova substitui a atual: não conflita com a CPU que sai
    assert regras.motivo_incompativel(store, base, store.componentes["r7-7800x3d"]) is None


def test_fonte_atx_em_gabinete_sfx_sugere_sfx_suficiente(store):
    b = bloq(store, ["r5-7600", "mb-b650i-strix", "case-nr200p", "rtx-4070s", "psu-rm850e"])
    a = next(a for a in b if a.id.startswith("par:psu_form"))
    assert a.correcao_sugerida.para_id == "psu-sf750"
