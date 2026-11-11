"""Camada 1: regras determinísticas de compatibilidade (sem IA) + itens faltantes.

A fonte de cada achado é a ficha técnica das peças envolvidas (campo `fonte` do componente).
Regras "par:" comparam duas peças e alimentam o filtro de compatíveis do modo manual.
"""

from __future__ import annotations

from collections.abc import Callable

from ..config import get_settings
from ..modelos import Achado, BuildItem, Componente, Correcao
from ..precos import preco_ref
from ..store import Store

CONSUMO_BASE_W = 75          # placa-mãe, RAM, SSD, ventoinhas
TIPOS_UNICOS = {"cpu", "gpu", "placa_mae", "memoria", "fonte", "gabinete", "cooler"}
ESSENCIAIS = ["cpu", "placa_mae", "memoria", "armazenamento", "fonte", "gabinete"]


def consumo_estimado(comps: list[Componente]) -> int:
    cpu = next((c for c in comps if c.tipo == "cpu"), None)
    gpu = next((c for c in comps if c.tipo == "gpu"), None)
    return CONSUMO_BASE_W + (cpu.specs["potencia_pico"] if cpu else 0) + (gpu.specs["tdp"] if gpu else 0)


def mais_barato(store: Store, candidatos: list[Componente]) -> Componente | None:
    com_preco = [(p, c) for c in candidatos if (p := preco_ref(store, c.id)) is not None]
    return min(com_preco, key=lambda pc: pc[0])[1] if com_preco else None


def _fonte(*comps: Componente) -> str | None:
    fontes = sorted({c.fonte for c in comps if c.fonte})
    return " | ".join(fontes) or None


def _achado(regra: str, sev: str, comps: list[Componente], descricao: str, correcao: Correcao | None = None,
            fisico: bool = False) -> Achado:
    fonte = _fonte(*comps)
    return Achado(id=f"{regra}:{'+'.join(sorted(c.id for c in comps))}", agente="regras", severidade=sev,
                  itens_envolvidos=[c.id for c in comps], descricao=descricao, correcao_sugerida=correcao,
                  fonte_url=fonte, verificado=fonte is not None, fisico=fisico)


def _trocar(store: Store, atual: Componente, filtro: Callable[[Componente], bool]) -> Correcao | None:
    alvo = mais_barato(store, [c for c in store.por_tipo(atual.tipo) if c.id != atual.id and filtro(c)])
    return Correcao(acao="trocar", componente_id=atual.id, para_id=alvo.id) if alvo else None


def _adicionar(store: Store, tipo: str, filtro: Callable[[Componente], bool]) -> Correcao | None:
    alvo = mais_barato(store, [c for c in store.por_tipo(tipo) if filtro(c)])
    return Correcao(acao="adicionar", para_id=alvo.id) if alvo else None


def avaliar(store: Store, itens: list[BuildItem]) -> list[Achado]:
    comps = [store.componentes[i.componente_id] for i in itens if i.componente_id in store.componentes]
    qtd = {i.componente_id: i.quantidade for i in itens}
    um = lambda tipo: next((c for c in comps if c.tipo == tipo), None)
    cpu, gpu, mb, ram, psu, case, cooler = (um(t) for t in ["cpu", "gpu", "placa_mae", "memoria", "fonte", "gabinete", "cooler"])
    extras = {c.specs.get("categoria") for c in comps if c.tipo == "extra"}
    achados: list[Achado] = []
    margem = get_settings().margem_fonte

    # socket CPU x placa-mãe
    if cpu and mb and cpu.specs["socket"] != mb.specs["socket"]:
        achados.append(_achado("par:socket", "bloqueante", [cpu, mb],
                               f"Socket incompatível: {cpu.nome} é {cpu.specs['socket']}, a placa {mb.nome} é {mb.specs['socket']}.",
                               _trocar(store, mb, lambda c: c.specs["socket"] == cpu.specs["socket"]
                                       and c.specs["memoria"] in cpu.specs["memoria"])))
    # DDR4/DDR5
    if ram and mb and ram.specs["ddr"] != mb.specs["memoria"]:
        achados.append(_achado("par:ddr", "bloqueante", [ram, mb],
                               f"Memória {ram.specs['ddr']} não encaixa na placa {mb.nome} ({mb.specs['memoria']}).",
                               _trocar(store, ram, lambda c: c.specs["ddr"] == mb.specs["memoria"]
                                       and c.specs["capacidade_gb"] == ram.specs["capacidade_gb"])))
    if ram and cpu and ram.specs["ddr"] not in cpu.specs["memoria"]:
        achados.append(_achado("par:ddr_cpu", "bloqueante", [ram, cpu],
                               f"{cpu.nome} não suporta {ram.specs['ddr']} (aceita {', '.join(cpu.specs['memoria'])}).",
                               _trocar(store, ram, lambda c: c.specs["ddr"] in cpu.specs["memoria"]
                                       and c.specs["capacidade_gb"] == ram.specs["capacidade_gb"])))
    # slots de memória
    if ram and mb:
        modulos = ram.specs["modulos"] * qtd.get(ram.id, 1)
        if modulos > mb.specs["slots_ram"]:
            achados.append(_achado("par:slots_ram", "bloqueante", [ram, mb],
                                   f"{modulos} módulos de memória para {mb.specs['slots_ram']} slots na placa."))
    # form factor x gabinete
    if mb and case and mb.specs["form_factor"] not in case.specs["form_factors"]:
        achados.append(_achado("par:form_factor", "bloqueante", [mb, case],
                               f"Placa {mb.specs['form_factor']} não cabe no {case.nome} (aceita {', '.join(case.specs['form_factors'])}).",
                               _trocar(store, case, lambda c: mb.specs["form_factor"] in c.specs["form_factors"]), fisico=True))
    if psu and case and psu.specs["form_factor"] not in case.specs["psu_form_factor"]:
        sev = "atencao" if psu.specs["form_factor"] == "SFX" and "ATX" in case.specs["psu_form_factor"] else "bloqueante"
        txt = ("Fonte SFX em gabinete ATX: precisa de suporte adaptador." if sev == "atencao"
               else f"Fonte {psu.specs['form_factor']} não cabe no {case.nome} (aceita {', '.join(case.specs['psu_form_factor'])}).")
        achados.append(_achado("par:psu_form", sev, [psu, case], txt,
                               _trocar(store, psu, lambda c: c.specs["form_factor"] in case.specs["psu_form_factor"]
                                       and c.specs["potencia_w"] >= consumo_estimado(comps) * margem), fisico=True))
    # comprimento da GPU x folga
    if gpu and case and gpu.specs["comprimento_mm"] > case.specs["gpu_max_mm"]:
        achados.append(_achado("par:gpu_comprimento", "bloqueante", [gpu, case],
                               f"GPU de {gpu.specs['comprimento_mm']} mm não cabe: o {case.nome} aceita até {case.specs['gpu_max_mm']} mm.",
                               _trocar(store, case, lambda c: c.specs["gpu_max_mm"] >= gpu.specs["comprimento_mm"]
                                       and (not mb or mb.specs["form_factor"] in c.specs["form_factors"])), fisico=True))
    # altura do cooler / radiador / socket do cooler
    if cooler and case:
        if cooler.specs["refrigeracao"] == "ar" and cooler.specs["altura_mm"] > case.specs["cooler_max_mm"]:
            achados.append(_achado("par:cooler_altura", "bloqueante", [cooler, case],
                                   f"Cooler de {cooler.specs['altura_mm']} mm não fecha a tampa: limite do {case.nome} é {case.specs['cooler_max_mm']} mm.",
                                   _trocar(store, cooler, lambda c: c.specs["refrigeracao"] == "ar"
                                           and c.specs["altura_mm"] <= case.specs["cooler_max_mm"]
                                           and c.specs["tdp_suportado"] >= cooler.specs["tdp_suportado"] * 0.85), fisico=True))
        if cooler.specs["refrigeracao"] == "aio" and cooler.specs["radiador_mm"] not in case.specs["radiadores"]:
            achados.append(_achado("par:radiador", "bloqueante", [cooler, case],
                                   f"Radiador de {cooler.specs['radiador_mm']} mm não tem suporte no {case.nome}.",
                                   _trocar(store, case, lambda c: cooler.specs["radiador_mm"] in c.specs["radiadores"]), fisico=True))
    if cooler and cpu and cpu.specs["socket"] not in cooler.specs["sockets"]:
        achados.append(_achado("par:cooler_socket", "bloqueante", [cooler, cpu], f"{cooler.nome} não tem suporte ao socket {cpu.specs['socket']}."))
    # TDP total x fonte
    if psu and (cpu or gpu):
        consumo = consumo_estimado(comps)
        minimo = consumo * margem
        if psu.specs["potencia_w"] < minimo:
            envolvidos = [c for c in (psu, cpu, gpu) if c]
            achados.append(_achado("par:potencia", "bloqueante", envolvidos,
                                   f"Fonte de {psu.specs['potencia_w']} W para consumo estimado de {consumo} W "
                                   f"(mínimo {int(minimo)} W com margem de {int((margem - 1) * 100)}%).",
                                   _trocar(store, psu, lambda c: c.specs["potencia_w"] >= minimo
                                           and (not case or c.specs["form_factor"] in case.specs["psu_form_factor"]))))
    # sem refrigeração / sem vídeo
    if cpu and not cooler and not cpu.specs["cooler_incluso"]:
        achados.append(_achado("cooler_ausente", "bloqueante", [cpu], f"{cpu.nome} não vem com cooler.",
                               _adicionar(store, "cooler", lambda c: c.specs["tdp_suportado"] >= cpu.specs["tdp"]
                                          and (not case or c.specs["refrigeracao"] != "ar" or c.specs["altura_mm"] <= case.specs["cooler_max_mm"]))))
    if cpu and not gpu and not cpu.specs["gpu_integrada"]:
        achados.append(_achado("video_ausente", "bloqueante", [cpu], f"{cpu.nome} não tem vídeo integrado: a build precisa de GPU."))
    # itens faltantes
    faltam = [t for t in ESSENCIAIS if not um(t)]
    if faltam:
        achados.append(Achado(id="faltam_pecas", agente="regras", severidade="atencao", itens_envolvidos=[],
                              descricao=f"Peças essenciais faltando: {', '.join(t.replace('_', ' ') for t in faltam)}.",
                              fonte_url="regra:completude", verificado=True))
    if cooler and "pasta_termica" not in extras:
        achados.append(_achado("faltante:pasta", "sugestao", [cooler],
                               "Pasta térmica: confira se o cooler já traz; se for reaproveitar, compre uma.",
                               _adicionar(store, "extra", lambda c: c.specs["categoria"] == "pasta_termica")))
    if case and case.specs["fans_inclusos"] < 2 and "ventoinhas" not in extras:
        achados.append(_achado("faltante:fans", "sugestao", [case],
                               f"O {case.nome} vem com {case.specs['fans_inclusos']} ventoinha(s): fluxo de ar fraco.",
                               _adicionar(store, "extra", lambda c: c.specs["categoria"] == "ventoinhas")))
    if mb and not mb.specs["wifi"] and "wifi" not in extras:
        achados.append(_achado("faltante:wifi", "sugestao", [mb], f"A {mb.nome} não tem Wi-Fi: use cabo ou um adaptador.",
                               _adicionar(store, "extra", lambda c: c.specs["categoria"] == "wifi")))
    if comps and "so" not in extras:
        achados.append(Achado(id="faltante:so", agente="regras", severidade="sugestao", itens_envolvidos=[],
                              descricao="Sistema operacional não incluso na lista.", fonte_url="regra:completude",
                              correcao_sugerida=_adicionar(store, "extra", lambda c: c.specs["categoria"] == "so")))
    if any(c.tipo == "armazenamento" and c.specs["interface"] == "SATA" for c in comps):
        achados.append(Achado(id="faltante:cabo_sata", agente="regras", severidade="sugestao", itens_envolvidos=[],
                              descricao="SSD SATA usa cabo de dados SATA: confira se a placa-mãe traz.", fonte_url="regra:completude"))
    return achados


def motivo_incompativel(store: Store, itens: list[BuildItem], candidato: Componente) -> str | None:
    """Para o filtro do modo manual: o candidato, no lugar da peça do mesmo tipo, gera bloqueante par a par?"""
    if candidato.tipo == "extra":
        return None
    base = [i for i in itens if not (candidato.tipo in TIPOS_UNICOS
                                      and store.componentes.get(i.componente_id, candidato).tipo == candidato.tipo)]
    for a in avaliar(store, base + [BuildItem(componente_id=candidato.id)]):
        if a.id.startswith("par:") and a.severidade == "bloqueante" and candidato.id in a.itens_envolvidos:
            return a.descricao
    return None
