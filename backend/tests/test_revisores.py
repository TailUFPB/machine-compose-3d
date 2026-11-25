from app.compat import revisores
from conftest import itens


def rev(store, *ids):
    return revisores.revisar(store, itens(*ids))


def por(achados, prefixo):
    return [a for a in achados if a.id.startswith(prefixo)]


def test_bios_sem_flashback_bloqueia_com_flashback_alerta(store):
    a = por(rev(store, "r7-9800x3d", "mb-b650m-a"), "plataforma:bios")[0]
    assert a.severidade == "bloqueante" and a.agente == "plataforma"
    novo = store.componentes[a.correcao_sugerida.para_id].specs
    assert novo["bios_nivel"] >= 3 or novo["bios_flashback"]
    assert por(rev(store, "r7-9800x3d", "mb-b650-gx-ax"), "plataforma:bios")[0].severidade == "atencao"
    assert not por(rev(store, "r5-7600", "mb-b650m-a"), "plataforma:bios")


def test_chipset_a620_e_qvl(store):
    assert por(rev(store, "r7-7800x3d", "mb-a620m-hdv"), "plataforma:chipset")
    q = por(rev(store, "r5-7600", "mb-b650m-a", "ram-veng-d5-32"), "plataforma:qvl")[0]
    assert q.severidade == "sugestao"


def test_ram_alta_sob_cooler(store):
    assert por(rev(store, "ram-veng-d5-32", "clr-nhd15"), "espaco:ram_cooler")[0].severidade == "bloqueante"
    a = por(rev(store, "ram-veng-d5-32", "clr-pa120se"), "espaco:ram_cooler")[0]
    assert a.severidade == "atencao" and a.fisico


def test_radiador_frontal_x_gpu(store):
    a = por(rev(store, "clr-lf3-360", "rtx-4080s", "case-h5-flow"), "espaco:radiador_gpu")[0]
    assert a.severidade == "atencao" and set(a.itens_envolvidos) == {"clr-lf3-360", "rtx-4080s", "case-h5-flow"}


def test_conectores_e_picos(store):
    assert por(rev(store, "rtx-4070s", "psu-core2-750"), "eletrico:adaptador")[0].severidade == "atencao"
    assert por(rev(store, "rtx-4080s", "psu-cx650"), "eletrico:conector")[0].severidade == "bloqueante"
    assert por(rev(store, "rx-9070xt", "psu-a750gl"), "eletrico:conector")[0].severidade == "bloqueante"
    assert por(rev(store, "rx-7800xt", "psu-cx650"), "eletrico:qualidade")
    assert por(rev(store, "rx-9070xt", "r7-9800x3d", "psu-core2-750"), "eletrico:pico")
    assert not por(rev(store, "rtx-4070s", "psu-rm850e"), "eletrico:")


def test_armazenamento_slots_m2(store):
    a = por(rev(store, "mb-a620m-hdv", "ssd-nv3-1t", "ssd-sn770-1t"), "armazenamento:m2_slots")[0]
    assert a.severidade == "bloqueante" and a.agente == "armazenamento"
    assert not por(rev(store, "mb-b650m-a", "ssd-nv3-1t", "ssd-sn770-1t"), "armazenamento:m2_slots")
    assert not por(rev(store, "mb-b650-gx-ax", "ssd-nv3-1t"), "armazenamento:")


def test_termico_cooler_contra_pico_da_cpu(store):
    a = por(rev(store, "i7-14700kf", "clr-ak400"), "termico:cooler_fraco")[0]
    assert store.componentes[a.correcao_sugerida.para_id].specs["tdp_suportado"] >= 253
    assert por(rev(store, "i5-13400f"), "termico:cooler_box")[0].correcao_sugerida.acao == "adicionar"
    assert not por(rev(store, "r5-7600", "clr-ak400"), "termico:")


def test_gargalo_usa_os_objetivos_da_build(store):
    from app.modelos import Objetivos
    par = itens("r5-5500", "rtx-4080s", "mb-b550m-vdh")
    a = por(revisores.revisar(store, par, objetivos=Objetivos(resolucao="1080p")), "gargalo:cpu")[0]
    nova = store.componentes[a.correcao_sugerida.para_id]
    assert a.severidade == "atencao" and nova.specs["socket"] == "AM4" and nova.specs["indice"] > 60
    assert not por(revisores.revisar(store, par, objetivos=Objetivos(resolucao="1440p")), "gargalo:cpu+")
    sobra = por(rev(store, "r7-9800x3d", "rtx-3050-6g"), "gargalo:cpu_sobra")[0]
    assert sobra.severidade == "sugestao" and store.componentes[sobra.correcao_sugerida.para_id].specs["socket"] == "AM5"
