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
