from app import fps


def test_medido_quando_ha_linha(store):
    b = store.benchmarks[0]
    e = fps.estimar(store, store.componentes[b["gpu_id"]], store.componentes[b["cpu_id"]], b["jogo"], b["resolucao"])
    assert e.tipo == "medido" and e.fps_med == b["fps_medio"] and e.fontes == [b["fonte"]] and e.confianca == "alta"


def test_estimado_rotulado_com_faixa_e_fonte(store):
    medidos = {(b["gpu_id"], b["cpu_id"]) for b in store.benchmarks}
    assert ("rx-6600", "i5-13400f") not in medidos
    e = fps.estimar(store, store.componentes["rx-6600"], store.componentes["i5-13400f"], "cyberpunk-2077", "1080p")
    assert e.tipo == "estimado" and e.fps_min < e.fps_med < e.fps_max
    assert e.confianca in ("media", "baixa") and e.fontes and e.gargalo in ("cpu", "gpu")


def test_gargalo_cpu_com_cpu_fraca_e_gpu_forte(store):
    e = fps.estimar(store, store.componentes["rtx-4080s"], store.componentes["r5-5500"], "cs2", "1080p")
    assert e.gargalo == "cpu"
    e2 = fps.estimar(store, store.componentes["rtx-3050-6g"], store.componentes["r7-9800x3d"], "cyberpunk-2077", "1440p")
    assert e2.gargalo == "gpu"


def test_gpu_melhor_da_mais_fps(store):
    cpu = store.componentes["r7-7800x3d"]
    fraca = fps.estimar(store, store.componentes["rtx-4060-8g"], cpu, "cyberpunk-2077", "1440p")
    forte = fps.estimar(store, store.componentes["rtx-4070tis"], cpu, "cyberpunk-2077", "1440p")
    assert forte.fps_med > fraca.fps_med * 1.5


def test_estimar_build_fps_por_mil_reais(store):
    es = fps.estimar_build(store, ["r5-7600", "rtx-4060-8g"], ["cs2", "fh5"], "1080p", custo=5000)
    assert [e.jogo for e in es] == ["cs2", "fh5"]
    assert es[0].fps_por_mil_reais == round(es[0].fps_med / 5, 2)


def test_sem_gpu_ou_cpu_nao_inventa(store):
    assert fps.estimar_build(store, ["r5-7600"], ["cs2"], "1080p") == []
