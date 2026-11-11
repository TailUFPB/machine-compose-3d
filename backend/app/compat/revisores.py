"""Camada 2: agentes revisores especialistas (MVP: Plataforma, Espaço físico, Elétrico).

Cada revisor tem um núcleo determinístico (conhecimento codificado sobre as fichas) e, com LLM ligado,
uma segunda passada que pode acrescentar achados. Achado do LLM só conta como verificado se citar uma
das fontes fornecidas; sem isso vira "não verificado" e o consolidador impede que bloqueie.
"""

from __future__ import annotations

import json

from .. import llm
from ..modelos import Achado, BuildItem, Componente, Correcao
from ..store import Store
from ..tracing import span
from .regras import CONSUMO_BASE_W, _achado, _trocar


def _pecas(store: Store, itens: list[BuildItem]) -> dict[str, Componente]:
    out: dict[str, Componente] = {}
    for i in itens:
        c = store.componentes.get(i.componente_id)
        if c and c.tipo not in out:
            out[c.tipo] = c
    return out


def plataforma(store: Store, p: dict[str, Componente]) -> list[Achado]:
    cpu, mb, ram = p.get("cpu"), p.get("placa_mae"), p.get("memoria")
    out = []
    if cpu and mb and cpu.specs["socket"] == mb.specs["socket"] and cpu.specs["bios_min"] > mb.specs["bios_nivel"]:
        if mb.specs["bios_flashback"]:
            out.append(_achado("plataforma:bios", "atencao", [cpu, mb],
                               f"A {mb.nome} pode sair de fábrica com BIOS anterior ao {cpu.nome}. Atualize via BIOS Flashback "
                               "(pendrive, sem CPU) antes da primeira ligação."))
        else:
            out.append(_achado("plataforma:bios", "bloqueante", [cpu, mb],
                               f"O {cpu.nome} exige BIOS mais nova que a de fábrica da {mb.nome}, que não tem Flashback: "
                               "sem uma CPU antiga para atualizar, a placa não dá boot.",
                               _trocar(store, mb, lambda c: c.specs["socket"] == cpu.specs["socket"]
                                       and c.specs["memoria"] == mb.specs["memoria"]
                                       and (c.specs["bios_nivel"] >= cpu.specs["bios_min"] or c.specs["bios_flashback"]))))
    if cpu and mb and mb.specs["chipset"] == "A620" and cpu.specs["tdp"] >= 105:
        out.append(_achado("plataforma:chipset", "atencao", [cpu, mb],
                           f"Chipset A620 com {cpu.nome} ({cpu.specs['tdp']} W): VRM básico, sem overclock e com risco de "
                           "limitação térmica sob carga longa.",
                           _trocar(store, mb, lambda c: c.specs["socket"] == "AM5" and c.specs["chipset"] != "A620"
                                   and c.specs["form_factor"] == mb.specs["form_factor"])))
    if ram and mb and ram.specs["ddr"] == mb.specs["memoria"] and ram.id not in mb.specs["qvl_memoria"]:
        out.append(_achado("plataforma:qvl", "sugestao", [ram, mb],
                           f"{ram.nome} não está na QVL da {mb.nome}. Costuma funcionar, mas o perfil EXPO/XMP pode exigir ajuste.",
                           _trocar(store, ram, lambda c: c.id in mb.specs["qvl_memoria"]
                                   and c.specs["capacidade_gb"] == ram.specs["capacidade_gb"])))
    return out


def espaco_fisico(store: Store, p: dict[str, Componente]) -> list[Achado]:
    gpu, case, cooler, ram = p.get("gpu"), p.get("gabinete"), p.get("cooler"), p.get("memoria")
    out = []
    if cooler and gpu and case and cooler.specs["refrigeracao"] == "aio" \
            and gpu.specs["comprimento_mm"] <= case.specs["gpu_max_mm"] \
            and gpu.specs["comprimento_mm"] > case.specs["gpu_max_com_radiador_frontal_mm"]:
        out.append(_achado("espaco:radiador_gpu", "atencao", [cooler, gpu, case],
                           f"Com o radiador de {cooler.specs['radiador_mm']} mm na frente, sobram "
                           f"{case.specs['gpu_max_com_radiador_frontal_mm']} mm para a GPU de {gpu.specs['comprimento_mm']} mm. "
                           "Monte o radiador no topo.", fisico=True))
    if ram and cooler and cooler.specs["refrigeracao"] == "ar" and ram.specs["altura_mm"] > cooler.specs["ram_altura_max_mm"]:
        excesso = ram.specs["altura_mm"] - cooler.specs["ram_altura_max_mm"]
        out.append(_achado("espaco:ram_cooler", "bloqueante" if excesso > 10 else "atencao", [ram, cooler],
                           f"A memória de {ram.specs['altura_mm']} mm passa {excesso} mm da folga sob o {cooler.nome} "
                           f"({cooler.specs['ram_altura_max_mm']} mm)" + (": a ventoinha precisa subir." if excesso <= 10 else "."),
                           _trocar(store, ram, lambda c: c.specs["ddr"] == ram.specs["ddr"]
                                   and c.specs["capacidade_gb"] == ram.specs["capacidade_gb"]
                                   and c.specs["altura_mm"] <= cooler.specs["ram_altura_max_mm"]), fisico=True))
    if gpu and case and 0 <= case.specs["gpu_max_mm"] - gpu.specs["comprimento_mm"] < 15:
        out.append(_achado("espaco:gpu_justa", "sugestao", [gpu, case],
                           f"A GPU cabe com menos de 15 mm de sobra no {case.nome}: confira a passagem dos cabos de energia.",
                           fisico=True))
    if cooler and case and cooler.specs["refrigeracao"] == "ar" and 0 <= case.specs["cooler_max_mm"] - cooler.specs["altura_mm"] < 5:
        out.append(_achado("espaco:cooler_justo", "sugestao", [cooler, case],
                           f"O {cooler.nome} fica a menos de 5 mm da tampa lateral: pode encostar no vidro.", fisico=True))
    return out


def eletrico(store: Store, p: dict[str, Componente]) -> list[Achado]:
    gpu, psu, cpu = p.get("gpu"), p.get("fonte"), p.get("cpu")
    out = []
    if not (gpu and psu):
        return out
    pico = gpu.specs["tdp"] * gpu.specs["fator_pico"] + (cpu.specs["potencia_pico"] if cpu else 0) + CONSUMO_BASE_W
    if pico > psu.specs["potencia_w"] and not psu.specs["atx3"]:
        out.append(_achado("eletrico:pico", "atencao", [gpu, psu],
                           f"Picos transitórios da GPU podem levar o sistema a ~{int(pico)} W por milissegundos; a "
                           f"{psu.nome} não é ATX 3.x e pode desarmar a proteção.",
                           _trocar(store, psu, lambda c: c.specs["atx3"] and c.specs["potencia_w"] >= psu.specs["potencia_w"]
                                   and c.specs["form_factor"] == psu.specs["form_factor"])))
    precisa, tem = gpu.specs["conectores"], psu.specs["conectores"]
    if precisa.get("12V-2x6") and not tem.get("12V-2x6"):
        oito_necessarios = 3 if gpu.specs["tdp"] > 300 else 2
        if tem.get("8pin", 0) >= oito_necessarios:
            out.append(_achado("eletrico:adaptador", "atencao", [gpu, psu],
                               f"A GPU usa 12V-2x6 e a fonte não tem esse cabo: use o adaptador incluso com {oito_necessarios} "
                               "cabos 8 pinos separados (não use cabo em Y). Fonte ATX 3.x nativa é mais segura.",
                               _trocar(store, psu, lambda c: bool(c.specs["conectores"].get("12V-2x6"))
                                       and c.specs["potencia_w"] >= psu.specs["potencia_w"]
                                       and c.specs["form_factor"] == psu.specs["form_factor"])))
        else:
            out.append(_achado("eletrico:conector", "bloqueante", [gpu, psu],
                               f"A GPU precisa de 12V-2x6 (ou {oito_necessarios}x 8 pinos via adaptador) e a fonte só tem "
                               f"{tem.get('8pin', 0)}x 8 pinos.",
                               _trocar(store, psu, lambda c: bool(c.specs["conectores"].get("12V-2x6"))
                                       and c.specs["potencia_w"] >= psu.specs["potencia_w"]
                                       and c.specs["form_factor"] == psu.specs["form_factor"])))
    if precisa.get("8pin", 0) > tem.get("8pin", 0):
        out.append(_achado("eletrico:conector", "bloqueante", [gpu, psu],
                           f"A GPU pede {precisa['8pin']}x 8 pinos PCIe e a fonte tem {tem.get('8pin', 0)}.",
                           _trocar(store, psu, lambda c: c.specs["conectores"].get("8pin", 0) >= precisa["8pin"]
                                   and c.specs["potencia_w"] >= psu.specs["potencia_w"]
                                   and c.specs["form_factor"] == psu.specs["form_factor"])))
    if psu.specs["tier"] == "C" and gpu.specs["tdp"] >= 200:
        out.append(_achado("eletrico:qualidade", "atencao", [gpu, psu],
                           f"Fonte de entrada (tier C) com GPU de {gpu.specs['tdp']} W: prefira tier A/B para proteção e ripple.",
                           _trocar(store, psu, lambda c: c.specs["tier"] in "AB" and c.specs["potencia_w"] >= psu.specs["potencia_w"]
                                   and c.specs["form_factor"] == psu.specs["form_factor"])))
    return out


REVISORES = {"plataforma": plataforma, "espaco_fisico": espaco_fisico, "eletrico": eletrico}
FOCO = {"plataforma": "BIOS, chipset, CPUs suportadas, QVL de memória",
        "espaco_fisico": "conflitos de montagem: radiador x GPU, RAM alta x cooler, folgas",
        "eletrico": "picos transitórios, conectores 12V-2x6 e 8 pinos, qualidade da fonte"}


def _passada_llm(nome: str, p: dict[str, Componente], ja: list[Achado]) -> list[Achado]:
    fontes = sorted({c.fonte for c in p.values()})
    pecas = {t: {"id": c.id, "nome": c.nome, "specs": c.specs, "fonte": c.fonte} for t, c in p.items()}
    r = llm.completar_json(
        f"revisor_{nome}",
        f"Você é o revisor de {FOCO[nome]} de uma build de PC. Aponte só problemas reais que ainda não estão na lista. "
        'Formato: {"achados": [{"severidade": "atencao|sugestao", "itens_envolvidos": [ids], "descricao": "...", '
        '"fonte_url": "uma das fontes fornecidas ou null"}]}',
        json.dumps({"pecas": pecas, "fontes_permitidas": fontes, "ja_encontrados": [a.descricao for a in ja]}, ensure_ascii=False))
    out = []
    for i, a in enumerate((r or {}).get("achados", [])[:5]):
        try:
            fonte = a.get("fonte_url") if a.get("fonte_url") in fontes else None
            itens = [x for x in a.get("itens_envolvidos", []) if x in {c.id for c in p.values()}]
            out.append(Achado(id=f"{nome}:llm{i}", agente=nome, severidade="sugestao" if a.get("severidade") == "sugestao" else "atencao",
                              itens_envolvidos=itens, descricao=str(a["descricao"])[:500], fonte_url=fonte, verificado=fonte is not None))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def revisar(store: Store, itens: list[BuildItem], nomes: list[str] | None = None) -> list[Achado]:
    p = _pecas(store, itens)
    out: list[Achado] = []
    for nome in nomes or list(REVISORES):
        with span(f"revisor_{nome}"):
            achados = REVISORES[nome](store, p)
            for a in achados:
                a.agente = nome
            out += achados + _passada_llm(nome, p, achados)
    return out
