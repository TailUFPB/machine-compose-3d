"""Camada 2: agentes revisores especialistas (Plataforma, Espaço físico, Elétrico, Fluxo de ar, Armazenamento,
Térmico, Gargalo) e a leitura do conjunto.

Cada revisor é determinístico (conhecimento codificado sobre as fichas). Com LLM ligado, uma chamada lê a build
inteira atrás do que depende de conhecimento de montagem. Dica do LLM só conta como verificada se as evidências
que ela cita baterem com as fichas; evidência errada descarta a dica, e sem evidência ela vira "não verificado",
que o consolidador impede de bloquear.
"""

from __future__ import annotations

import json

from .. import fluxo, llm as llm_mod
from ..fps import estimar_build
from ..folgas import COOLER_JUSTA_MM, GPU_JUSTA_MM, RAM_AJUSTE_MM, limite_gpu, radiador_na_frente
from ..modelos import Achado, BuildItem, Componente, Objetivos
from ..store import Store
from ..tracing import span
from ..precos import brl, preco_ref
from .regras import CONSUMO_BASE_W, _achado, _adicionar, _fonte, _trocar


def _pecas(store: Store, itens: list[BuildItem]) -> dict[str, Componente]:
    out: dict[str, Componente] = {}
    for i in itens:
        c = store.componentes.get(i.componente_id)
        if c and c.tipo not in out:
            out[c.tipo] = c
    return out


def plataforma(store: Store, p: dict[str, Componente], extras: list[tuple[Componente, int]] = (), **_) -> list[Achado]:
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


def espaco_fisico(store: Store, p: dict[str, Componente], extras: list[tuple[Componente, int]] = (), **_) -> list[Achado]:
    gpu, case, cooler, ram = p.get("gpu"), p.get("gabinete"), p.get("cooler"), p.get("memoria")
    out = []
    # radiador na frente (sem posição na ficha vale a frente, como na cena); no topo ele não disputa espaço com a GPU
    if gpu and case and radiador_na_frente(cooler) \
            and limite_gpu(case, cooler) < gpu.specs["comprimento_mm"] <= case.specs["gpu_max_mm"]:
        out.append(_achado("espaco:radiador_gpu", "atencao", [cooler, gpu, case],
                           f"Com o radiador de {cooler.specs['radiador_mm']} mm na frente, sobram "
                           f"{case.specs['gpu_max_com_radiador_frontal_mm']} mm para a GPU de {gpu.specs['comprimento_mm']} mm. "
                           "Monte o radiador no topo.", fisico=True))
    if ram and cooler and cooler.specs["refrigeracao"] == "ar" and ram.specs["altura_mm"] > cooler.specs["ram_altura_max_mm"]:
        excesso = ram.specs["altura_mm"] - cooler.specs["ram_altura_max_mm"]
        out.append(_achado("espaco:ram_cooler", "bloqueante" if excesso > RAM_AJUSTE_MM else "atencao", [ram, cooler],
                           f"A memória de {ram.specs['altura_mm']} mm passa {excesso} mm da folga sob o {cooler.nome} "
                           f"({cooler.specs['ram_altura_max_mm']} mm)" + (": a ventoinha precisa subir." if excesso <= RAM_AJUSTE_MM else "."),
                           _trocar(store, ram, lambda c: c.specs["ddr"] == ram.specs["ddr"]
                                   and c.specs["capacidade_gb"] == ram.specs["capacidade_gb"]
                                   and c.specs["altura_mm"] <= cooler.specs["ram_altura_max_mm"]), fisico=True))
    if gpu and case and 0 <= limite_gpu(case, cooler) - gpu.specs["comprimento_mm"] < GPU_JUSTA_MM:
        out.append(_achado("espaco:gpu_justa", "sugestao", [gpu, case],
                           f"A GPU cabe com menos de {GPU_JUSTA_MM} mm de sobra no {case.nome}: confira a passagem dos cabos de energia.",
                           fisico=True))
    if cooler and case and cooler.specs["refrigeracao"] == "ar" and 0 <= case.specs["cooler_max_mm"] - cooler.specs["altura_mm"] < COOLER_JUSTA_MM:
        out.append(_achado("espaco:cooler_justo", "sugestao", [cooler, case],
                           f"O {cooler.nome} fica a menos de {COOLER_JUSTA_MM} mm da tampa lateral: pode encostar no vidro.", fisico=True))
    return out


def eletrico(store: Store, p: dict[str, Componente], extras: list[tuple[Componente, int]] = (), **_) -> list[Achado]:
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


def fluxo_de_ar(store: Store, p: dict[str, Componente], extras: list[tuple[Componente, int]] = (), **_) -> list[Achado]:
    """Balanço de entrada e saída, ventoinhas para o calor e radiador na frente com GPU quente (`app/fluxo.py`).
    Não são conflitos de encaixe: `fisico=False`, a cena não pinta peça por isso."""
    f, case, cooler, gpu, cpu = fluxo.calcular(p, list(extras)), p.get("gabinete"), p.get("cooler"), p.get("gpu"), p.get("cpu")
    if not f:
        return []
    out = []
    if f.entrada == 0:
        out.append(_achado("fluxo:sem_entrada", "atencao", [case],
                           f"Sem ventoinha de entrada no {case.nome}: o ar frio só entra pelas frestas. "
                           "Ponha uma ventoinha na frente puxando ar para dentro."))
    elif f.pressao == "negativa":
        out.append(_achado("fluxo:pressao_negativa", "sugestao", [case],
                           f"Pressão negativa ({f.entrada} de entrada, {f.saida} de saída): o gabinete puxa poeira pelas "
                           "frestas; ponha mais uma ventoinha de entrada na frente."))
    if len(f.ventoinhas) < f.recomendadas:
        tem_pacote = any(c.specs.get("categoria") == "ventoinhas" for c, _ in extras)
        quentes = [c for c in (cpu, gpu) if c]
        texto = (f"Calor estimado de {f.calor_w} W (TDP da CPU e da GPU) pede umas {f.recomendadas} ventoinhas "
                 f"(estimativa: uma a cada {fluxo.W_POR_FAN} W); a build tem {len(f.ventoinhas)}.")
        out.append(_achado("fluxo:poucas_fans", "atencao", [case, *quentes],
                           texto + (" Faltam vagas no gabinete para mais ventoinhas." if tem_pacote else ""),
                           None if tem_pacote else _adicionar(store, "extra", lambda c: c.specs.get("categoria") == "ventoinhas")))
    if gpu and fluxo.radiador_na_frente(cooler) and gpu.specs.get("tdp", 0) >= fluxo.GPU_QUENTE_W:
        topo = (case.specs.get("posicoes_fan") or {}).get("topo", 0) * fluxo.FAN_MM >= (cooler.specs.get("radiador_mm") or 0)
        out.append(_achado("fluxo:radiador_gpu", "sugestao", [cooler, gpu],
                           f"O radiador na frente sopra ar já aquecido pela CPU na GPU de {gpu.specs['tdp']} W."
                           + (" O gabinete aceita o radiador no topo, como saída: prefira o topo." if topo else "")))
    return out


def armazenamento(store: Store, p: dict[str, Componente], extras=(), discos: list[tuple[Componente, int]] = (), **_) -> list[Achado]:
    """Slots M.2 e baias contra os discos da build.
    ponytail: sem lanes PCIe; a ficha não traz geração nem divisão de lanes por slot. Entra quando o seed tiver."""
    mb, case = p.get("placa_mae"), p.get("gabinete")
    m2 = [(c, q) for c, q in discos if c.specs["interface"] == "M.2"]
    sata = [(c, q) for c, q in discos if c.specs["interface"] == "SATA"]
    out = []
    if mb and (n := sum(q for _, q in m2)) > mb.specs["m2_slots"]:
        out.append(_achado("armazenamento:m2_slots", "bloqueante", [mb, *(c for c, _ in m2)],
                           f"{n} SSDs M.2 para {mb.specs['m2_slots']} slot(s) M.2 na {mb.nome}."))
    elif mb and m2 and not mb.specs.get("m2_dissipador"):
        out.append(_achado("armazenamento:m2_sem_dissipador", "sugestao", [mb, m2[0][0]],
                           f"A {mb.nome} não tem dissipador no slot M.2: SSD NVMe sob carga longa pode reduzir a velocidade."))
    baias = (case.specs.get("baias") or {}) if case else {}
    if sata and baias and (n := sum(q for _, q in sata)) > sum(baias.values()):
        out.append(_achado("armazenamento:baias", "bloqueante", [case, *(c for c, _ in sata)],
                           f"{n} discos SATA para {sum(baias.values())} baias no {case.nome}.", fisico=True))
    return out


PICO_COOLER_BOX_W = 120   # acima disso o cooler de fábrica trabalha no limite


def termico(store: Store, p: dict[str, Componente], extras=(), **_) -> list[Achado]:
    """Capacidade do cooler contra a potência de pico da CPU (o TDP nominal subestima o calor em carga)."""
    cpu, cooler, case = p.get("cpu"), p.get("cooler"), p.get("gabinete")
    if not cpu:
        return []
    pico = cpu.specs["potencia_pico"]
    cabe = lambda c: (cpu.specs["socket"] in c.specs["sockets"] and c.specs["tdp_suportado"] >= pico
                      and (not case or (c.specs["altura_mm"] <= case.specs["cooler_max_mm"] if c.specs["refrigeracao"] == "ar"
                                        else c.specs["radiador_mm"] in case.specs["radiadores"])))
    if cooler and cooler.specs["tdp_suportado"] < pico:
        return [_achado("termico:cooler_fraco", "atencao", [cooler, cpu],
                        f"O {cooler.nome} dissipa {cooler.specs['tdp_suportado']} W e o {cpu.nome} chega a {pico} W em carga: "
                        "a CPU reduz a frequência para não superaquecer.", _trocar(store, cooler, cabe))]
    if not cooler and cpu.specs["cooler_incluso"] and pico >= PICO_COOLER_BOX_W:
        return [_achado("termico:cooler_box", "sugestao", [cpu],
                        f"O {cpu.nome} chega a {pico} W em carga: o cooler de fábrica segura, mas quente e barulhento.",
                        _adicionar(store, "cooler", cabe))]
    return []


GARGALO_CPU = 1.2      # a GPU renderia 20% a mais com outra CPU: a CPU está segurando
MESMO_FPS = 0.97       # CPU mais barata que mantém 97% do FPS: a atual sobra para esta GPU
ECONOMIA_MIN = 200     # R$: abaixo disso a troca não vale o aviso


def gargalo(store: Store, p: dict[str, Componente], extras=(), obj: Objetivos | None = None, **_) -> list[Achado]:
    """Equilíbrio CPU x GPU pelo FPS mínimo estimado nos jogos e na resolução da build."""
    cpu, gpu, mb = p.get("cpu"), p.get("gpu"), p.get("placa_mae")
    obj = obj or Objetivos()
    if not (cpu and gpu):
        return []
    def fps(c: Componente) -> float:
        return min((e.fps_med for e in estimar_build(store, [c.id, gpu.id], obj.jogos, obj.resolucao)), default=0)
    atual = fps(cpu)
    if not atual:
        return []
    # troca que não puxa outra: mesmo socket; com placa na build, também a memória e a BIOS dela
    serve = lambda c: c.specs["socket"] == cpu.specs["socket"] and (
        not mb or (mb.specs["memoria"] in c.specs["memoria"]
                   and (mb.specs["bios_nivel"] >= c.specs["bios_min"] or mb.specs["bios_flashback"])))
    todas = {c.id: fps(c) for c in store.por_tipo("cpu")}
    teto = max(todas.values())
    if teto >= atual * GARGALO_CPU:
        # a mais barata perto do melhor que este socket alcança (a melhor de todas pode pedir outra placa)
        alcance = max(todas[c.id] for c in store.por_tipo("cpu") if serve(c))
        cor = _trocar(store, cpu, lambda c: serve(c) and todas[c.id] >= alcance * MESMO_FPS) if alcance > atual * 1.05 else None
        return [_achado("gargalo:cpu", "atencao", [cpu, gpu],
                        f"O {cpu.nome} segura a {gpu.nome}: {atual:.0f} FPS mínimo em {obj.resolucao}, e a mesma GPU chega a "
                        f"{teto:.0f} FPS (+{(teto / atual - 1) * 100:.0f}%) com uma CPU mais forte.", cor)]
    preco = preco_ref(store, cpu.id)
    cor = _trocar(store, cpu, lambda c: serve(c) and todas[c.id] >= atual * MESMO_FPS)
    if cor and preco and (economia := preco - preco_ref(store, cor.para_id)) >= ECONOMIA_MIN:
        outra = store.componentes[cor.para_id]
        return [_achado("gargalo:cpu_sobra", "sugestao", [cpu, gpu],
                        f"Com a {gpu.nome} em {obj.resolucao}, o {outra.nome} entrega o mesmo FPS ({todas[outra.id]:.0f} contra "
                        f"{atual:.0f}) por {brl(economia)} a menos: a GPU é o limite, não a CPU.", cor)]
    return []


REVISORES = {"plataforma": plataforma, "espaco_fisico": espaco_fisico, "eletrico": eletrico, "fluxo_de_ar": fluxo_de_ar,
             "armazenamento": armazenamento, "termico": termico, "gargalo": gargalo}


# Leitura do conjunto pelo LLM. Encaixe, conector, potência, folga e slot são conta, e conta é das regras acima;
# o LLM entra no que depende de conhecimento de montagem (canal único x duplo, memória lenta para a plataforma,
# peças desequilibradas entre si). Cada dica cita os campos da ficha que a sustentam e o código confere os valores.
# Prompt montado para o cache de prefixo do provedor: system fixo, peças primeiro, o que muda no fim.
SISTEMA_CONJUNTO = (
    "Você é um montador de PCs experiente revisando uma build. As regras automáticas já conferiram encaixe, socket, "
    "conectores, potência da fonte, folgas, slots e gargalo de FPS: não refaça essas contas nem repita o que está em "
    "JÁ ENCONTRADOS. Seu papel é apontar o que só o conhecimento do conjunto revela, por exemplo: memória em canal único "
    "(1 módulo) quando 2 módulos dariam canal duplo, velocidade ou capacidade de memória ruim para a plataforma ou os "
    "jogos, VRAM curta para a resolução, peça muito acima ou abaixo do resto da build, combinação que desperdiça "
    "dinheiro. Diga o efeito prático e o que trocar. Se a peça atende, não é achado: nunca descreva o que está "
    "adequado nem peça para 'verificar'. Só fale de peça que está em PEÇAS: tipo ausente é build ainda incompleta, "
    "não é achado, e nada pode ser afirmado sobre ele. Lista vazia é a resposta certa para build bem montada. No máximo 3 achados, "
    "uma ou duas frases cada. Toda afirmação sobre a build precisa de evidência: campos copiados das fichas, com o "
    "valor exato, incluindo o campo que prova a afirmação central (ex.: modulos=1 para canal único). "
    'Formato: {"achados": [{"severidade": "atencao|sugestao", "descricao": "...", '
    '"evidencias": [{"peca": "id da peça", "campo": "chave em specs (use a.b para campo aninhado)", "valor": valor}]}]}')
SEM_USO_NA_REVISAO = {"portas_traseiras", "saidas", "backplate", "heatpipes"}   # só desenham a peça na cena


def _campo(specs: dict, caminho: str):
    for chave in str(caminho).split("."):
        specs = specs[chave]   # KeyError/TypeError: o campo não existe na ficha
    return specs


def _confere(por_id: dict[str, Componente], ev: dict) -> bool:
    """A evidência citada pelo LLM existe na ficha com esse valor?"""
    try:
        real = _campo(por_id[ev["peca"]].specs, ev["campo"])
    except (KeyError, TypeError):
        return False
    return real == ev.get("valor") or str(real).strip().lower() == str(ev.get("valor")).strip().lower()


def _passada_llm(p: dict[str, Componente], ja: list[Achado], obj: Objetivos | None) -> list[Achado]:
    por_id = {c.id: c for c in p.values()}
    pecas = {t: {"id": c.id, "nome": c.nome, "specs": {k: v for k, v in c.specs.items() if k not in SEM_USO_NA_REVISAO}}
             for t, c in sorted(p.items())}
    dump = lambda x: json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    r = llm_mod.completar_json(
        "revisor_conjunto", SISTEMA_CONJUNTO,
        f"PEÇAS: {dump(pecas)}\nOBJETIVOS: {dump((obj or Objetivos()).model_dump())}\n"
        f"JÁ ENCONTRADOS: {dump([a.descricao for a in ja])}")
    out, descartados = [], 0
    for i, a in enumerate((r or {}).get("achados", [])[:3]):
        try:
            evs = [e for e in a.get("evidencias") or [] if isinstance(e, dict)]
            if any(not _confere(por_id, e) for e in evs):
                descartados += 1   # leu a ficha errado: a conclusão não se sustenta
                continue
            citadas = [por_id[e["peca"]] for e in evs]
            fonte = _fonte(*citadas)   # sem evidência fica sem fonte: não verificado, nunca bloqueia
            out.append(Achado(id=f"conjunto:llm{i}", agente="conjunto",
                              severidade="sugestao" if a.get("severidade") == "sugestao" else "atencao",
                              itens_envolvidos=sorted({c.id for c in citadas}), descricao=str(a["descricao"])[:500],
                              fonte_url=fonte, verificado=fonte is not None))
        except (KeyError, TypeError, ValueError):
            continue
    if out or descartados:   # fica no trace para medir o que o LLM acrescenta às regras
        with span("llm_discorda_regras", metadata={"achados_regras": len(ja), "achados_llm": len(out),
                                                   "verificados": sum(a.verificado for a in out),
                                                   "descartados_evidencia_errada": descartados}):
            pass
    return out


def revisar(store: Store, itens: list[BuildItem], nomes: list[str] | None = None, llm: bool = True,
            objetivos: Objetivos | None = None) -> list[Achado]:
    """Núcleo determinístico de cada revisor e, com `llm=True` e LLM ligado, uma leitura do conjunto (uma chamada).
    `llm=False` pula essa leitura (a prévia da cena só precisa dos achados determinísticos)."""
    p = _pecas(store, itens)
    todos = [(c, i.quantidade) for i in itens if (c := store.componentes.get(i.componente_id))]
    extras = [x for x in todos if x[0].tipo == "extra"]
    discos = [x for x in todos if x[0].tipo == "armazenamento"]
    out: list[Achado] = []
    for nome in nomes or list(REVISORES):
        with span(f"revisor_{nome}"):
            achados = REVISORES[nome](store, p, extras, obj=objetivos, discos=discos)
            for a in achados:
                a.agente = nome
            out += achados
    return out + (_passada_llm(p, out, objetivos) if llm and p else [])
