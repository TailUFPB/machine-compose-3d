"""Agente selecionador: monta a build e roda em loop propositor <-> revisores com limite de tentativas.

- agente: monta tudo (respeita peças travadas/que o usuário já tem, se houver);
- hibrido: peças travadas ficam, o resto é escolhido;
- manual (copiloto): tudo o que já está na lista fica; só completa o que falta.
Nunca altera a build: devolve uma Proposta que o usuário aplica com um clique.
"""

from __future__ import annotations

import json

from . import llm
from .compat.consolidador import revisar_build
from .compat.regras import consumo_estimado
from .config import get_settings
from .fps import estimar_build
from .modelos import Achado, Build, BuildItem, Componente, Proposta
from .precos import brl, preco_ref
from .store import Store
from .tracing import span, trace

FOLGA_ALVO = 1.15   # prefere par CPU+GPU que passe o FPS-alvo com 15% de folga


def custo(store: Store, itens: list[BuildItem]) -> float:
    return round(sum((preco_ref(store, i.componente_id) or 0) * i.quantidade for i in itens if not i.ja_tenho), 2)


def _barato(store: Store, cands: list[Componente]) -> Componente | None:
    pc = [(p, c) for c in cands if (p := preco_ref(store, c.id)) is not None]
    return min(pc, key=lambda x: x[0])[1] if pc else None


def _completar(store: Store, fixos: dict[str, Componente], orcamento: float) -> dict[str, Componente]:
    """Escolhe a peça mais barata que atende às restrições das já escolhidas, na ordem de dependência."""
    p = dict(fixos)
    cpu, gpu = p.get("cpu"), p.get("gpu")
    tipo = lambda t: store.por_tipo(t)
    if "placa_mae" not in p and cpu:
        case = p.get("gabinete")
        ok = [c for c in tipo("placa_mae") if c.specs["socket"] == cpu.specs["socket"] and c.specs["memoria"] in cpu.specs["memoria"]
              and (c.specs["bios_nivel"] >= cpu.specs["bios_min"] or c.specs["bios_flashback"])
              and (not case or c.specs["form_factor"] in case.specs["form_factors"])
              and (c.specs["chipset"] != "A620" or cpu.specs["tdp"] < 105)
              and ("memoria" not in p or p["memoria"].specs["ddr"] == c.specs["memoria"])]
        if x := _barato(store, ok):
            p["placa_mae"] = x
    if "cooler" not in p and cpu and (not cpu.specs["cooler_incluso"] or cpu.specs["tdp"] >= 105):
        case = p.get("gabinete")
        ok = [c for c in tipo("cooler") if c.specs["tdp_suportado"] >= cpu.specs["tdp"] * 1.3
              and (c.specs["refrigeracao"] == "ar" and (not case or c.specs["altura_mm"] <= case.specs["cooler_max_mm"])
                   or c.specs["refrigeracao"] == "aio" and (not case or c.specs["radiador_mm"] in case.specs["radiadores"]))]
        if x := _barato(store, ok):
            p["cooler"] = x
    if "gabinete" not in p:
        mb, cooler, psu = p.get("placa_mae"), p.get("cooler"), p.get("fonte")
        def cabe(c: Componente) -> bool:
            s = c.specs
            if mb and mb.specs["form_factor"] not in s["form_factors"]:
                return False
            if gpu:
                limite = s["gpu_max_com_radiador_frontal_mm"] if cooler and cooler.specs["refrigeracao"] == "aio" else s["gpu_max_mm"]
                if gpu.specs["comprimento_mm"] > limite - 15:
                    return False
            if cooler and cooler.specs["refrigeracao"] == "ar" and cooler.specs["altura_mm"] > s["cooler_max_mm"] - 5:
                return False
            if cooler and cooler.specs["refrigeracao"] == "aio" and cooler.specs["radiador_mm"] not in s["radiadores"]:
                return False
            return not psu or psu.specs["form_factor"] in s["psu_form_factor"]
        if x := _barato(store, [c for c in tipo("gabinete") if cabe(c)]):
            p["gabinete"] = x
    if "memoria" not in p and (mb := p.get("placa_mae")):
        gb = 32 if orcamento >= 5000 else 16
        cooler = p.get("cooler")
        base = [c for c in tipo("memoria") if c.specs["ddr"] == mb.specs["memoria"] and c.specs["capacidade_gb"] == gb
                and (not cooler or cooler.specs["refrigeracao"] != "ar" or c.specs["altura_mm"] <= cooler.specs["ram_altura_max_mm"])]
        if x := _barato(store, [c for c in base if c.id in mb.specs["qvl_memoria"]] or base):
            p["memoria"] = x
    if "fonte" not in p:
        comps = list(p.values())
        consumo = consumo_estimado(comps)
        case = p.get("gabinete")
        def serve(c: Componente) -> bool:
            s = c.specs
            if s["potencia_w"] < consumo * get_settings().margem_fonte or (case and s["form_factor"] not in case.specs["psu_form_factor"]):
                return False
            if gpu:
                pico = gpu.specs["tdp"] * gpu.specs["fator_pico"] + (cpu.specs["potencia_pico"] if cpu else 0) + 75
                if pico > s["potencia_w"] and not s["atx3"]:
                    return False
                if gpu.specs["conectores"].get("12V-2x6") and not s["conectores"].get("12V-2x6"):
                    return False
                if gpu.specs["conectores"].get("8pin", 0) > s["conectores"].get("8pin", 0):
                    return False
                if gpu.specs["tdp"] >= 200 and s["tier"] == "C":
                    return False
            return True
        if x := _barato(store, [c for c in tipo("fonte") if serve(c)]):
            p["fonte"] = x
    if "armazenamento" not in p:
        if x := _barato(store, [c for c in tipo("armazenamento") if c.specs["interface"] == "M.2" and c.specs["capacidade_gb"] >= 1000]):
            p["armazenamento"] = x
    return p


def _fps_min(store: Store, cpu: Componente, gpu: Componente, jogos: list[str], res: str) -> float:
    es = estimar_build(store, [cpu.id, gpu.id], jogos, res)
    return min((e.fps_med for e in es), default=0)


def _escolher_par(store: Store, build: Build, fixos: dict[str, Componente]) -> tuple[dict[str, Componente], list[str]]:
    avisos = []
    jogos, res, alvo = build.objetivos.jogos or list(store.jogos), build.objetivos.resolucao, build.objetivos.fps_alvo
    cpus = [fixos["cpu"]] if "cpu" in fixos else store.por_tipo("cpu")
    gpus = [fixos["gpu"]] if "gpu" in fixos else store.por_tipo("gpu")
    opcoes = []
    ja_tenho = build_ja_tenho(build)
    for cpu in cpus:
        mb = fixos.get("placa_mae")
        if mb and mb.specs["socket"] != cpu.specs["socket"]:
            continue
        for gpu in gpus:
            if None in (preco_ref(store, cpu.id), preco_ref(store, gpu.id)):
                continue
            par = {**fixos, "cpu": cpu, "gpu": gpu}
            completo = _completar(store, par, build.orcamento)
            total = custo(store, [BuildItem(componente_id=c.id, ja_tenho=c.id in ja_tenho) for c in completo.values()])
            opcoes.append((total, _fps_min(store, cpu, gpu, jogos, res), completo))
    if not opcoes:
        return _completar(store, fixos, build.orcamento), ["Nenhum par CPU+GPU com preço disponível."]
    cabe = [o for o in opcoes if o[0] <= build.orcamento]
    folgado = [o for o in cabe if o[1] >= alvo * FOLGA_ALVO]
    no_alvo = [o for o in cabe if o[1] >= alvo]
    if folgado:
        escolha = min(folgado, key=lambda o: o[0])
    elif no_alvo:
        escolha = min(no_alvo, key=lambda o: o[0])
    elif cabe:
        escolha = max(cabe, key=lambda o: (o[1], -o[0]))
        avisos.append(f"Nenhuma combinação no orçamento atinge {alvo} FPS em todos os jogos; esta é a de maior FPS mínimo "
                      f"({escolha[1]:.0f} FPS).")
    else:
        escolha = min(opcoes, key=lambda o: o[0])
        avisos.append(f"Nenhuma build completa cabe em {brl(build.orcamento)}; esta é a mais barata ({brl(escolha[0])}).")
    return escolha[2], avisos


def build_ja_tenho(build: Build) -> set[str]:
    return {i.componente_id for i in build.itens if i.ja_tenho}


def _justificar(store: Store, build: Build, comps: list[Componente], fixos: set[str]) -> dict[str, str]:
    res, alvo = build.objetivos.resolucao, build.objetivos.fps_alvo
    texto = {}
    for c in comps:
        t = c.tipo
        if c.id in fixos:
            texto[c.id] = "Mantida: peça escolhida pelo usuário."
            continue
        preco = preco_ref(store, c.id)
        base = f"{brl(preco)} (mediana com fonte)" if preco else "sem preço"
        sp = c.specs
        modelos = {
            "cpu": lambda: f"Melhor custo para {alvo} FPS em {res} junto com a GPU; {sp['nucleos']} núcleos; {base}.",
            "gpu": lambda: f"Escolhida pelo melhor custo para o alvo de {alvo} FPS em {res} nos jogos escolhidos; {sp['vram_gb']} GB; {base}.",
            "placa_mae": lambda: f"Socket {sp['socket']}, {sp['memoria']}, BIOS compatível com a CPU; mais barata que atende; {base}.",
            "memoria": lambda: f"{sp['capacidade_gb']} GB {sp['ddr']}, na QVL da placa quando possível; {base}.",
            "armazenamento": lambda: f"NVMe de {sp['capacidade_gb'] // 1000} TB: carga rápida de jogos; {base}.",
            "fonte": lambda: f"{sp['potencia_w']} W com margem sobre o consumo e conectores nativos da GPU; {base}.",
            "gabinete": lambda: f"Cabe a placa, a GPU com folga, o cooler e a fonte; {base}.",
            "cooler": lambda: f"Suporta {sp['tdp_suportado']} W, acima do TDP da CPU; {base}.",
        }
        texto[c.id] = modelos[t]() if t in modelos else base
    r = llm.completar_json("justificativas", "Reescreva cada justificativa de peça em português claro, sem inventar números. "
                           'Formato: {"<id>": "texto"}', json.dumps(texto, ensure_ascii=False))
    if r and set(r) == set(texto) and all(isinstance(v, str) for v in r.values()):
        texto = r
    return texto


def propor(store: Store, build: Build) -> Proposta:
    s = get_settings()
    with trace(build.id, "agente"):
        if build.modo == "manual":
            manter = list(build.itens)
        else:
            manter = [i for i in build.itens if i.travado or i.ja_tenho]
        travados = {i.componente_id for i in manter}
        fixos = {}
        for i in manter:
            c = store.componentes.get(i.componente_id)
            if c and c.tipo != "extra" and c.tipo != "armazenamento":
                fixos.setdefault(c.tipo, c)
        with span("propositor"):
            pecas, avisos = _escolher_par(store, build, fixos)
        melhor: tuple[int, list[BuildItem], list[Achado]] | None = None
        tentativas = 0
        for tentativas in range(1, s.agente_max_tentativas + 1):
            itens = [i for i in manter] + [BuildItem(componente_id=c.id, origem="agente")
                                          for c in pecas.values() if c.id not in travados]
            achados = revisar_build(store, build, itens)
            bloq = [a for a in achados if a.severidade == "bloqueante" and a.status == "aberto"]
            if melhor is None or len(bloq) < melhor[0]:
                melhor = (len(bloq), itens, achados)
            corrigiveis = [a for a in bloq if a.correcao_sugerida and a.correcao_sugerida.acao == "trocar"
                           and a.correcao_sugerida.componente_id not in travados]
            if not bloq or not corrigiveis:
                break
            with span("propositor", input={"tentativa": tentativas + 1}):
                for a in corrigiveis:
                    novo = store.componentes[a.correcao_sugerida.para_id]
                    pecas[novo.tipo] = novo
        n_bloq, itens, achados = melhor
        if n_bloq:
            presos = [a for a in achados if a.severidade == "bloqueante" and set(a.itens_envolvidos) & travados]
            avisos.append(f"Entregue com {n_bloq} bloqueante(s) após {tentativas} tentativa(s)."
                          + (" Envolvem peça travada: destrave para o agente corrigir." if presos else ""))
        justificativas = _justificar(store, build, [store.componentes[i.componente_id] for i in itens], travados)
        for i in itens:
            if i.componente_id not in travados:
                i.justificativa = justificativas.get(i.componente_id)
        return Proposta(itens=itens, achados=achados, tentativas=tentativas, convergiu=n_bloq == 0,
                        avisos=avisos, custo_estimado=custo(store, itens))
