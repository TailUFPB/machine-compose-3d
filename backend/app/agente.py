"""Agente selecionador: monta a build e roda em loop propositor <-> revisores com limite de tentativas.

- agente: monta tudo (respeita peças travadas/que o usuário já tem, se houver);
- hibrido: peças travadas ficam, o resto é escolhido;
- manual (copiloto): tudo o que já está na lista fica; só completa o que falta.
Nunca altera a build: devolve uma Proposta que o usuário aplica com um clique.
"""

from __future__ import annotations

import json

from . import llm, upgrades
from .compat.consolidador import PESO, revisar_build
from .compat.regras import consumo_estimado
from .config import get_settings
from .fps import estimar_build
from .modelos import Achado, Build, BuildItem, Componente, Proposta, Tentativa
from .precos import brl, consultar_cache, preco_ref
from .store import Store
from .tracing import span, trace

FOLGA_ALVO = 1.15   # prefere par CPU+GPU que passe o FPS-alvo com 15% de folga
# perfil -> (folga sobre o FPS-alvo, severidades que o loop corrige com o que sobra do orçamento)
PERFIS = {"economica": (1.0, {"bloqueante"}),
          "equilibrada": (FOLGA_ALVO, {"bloqueante", "atencao"}),
          "com_folga": (1.3, {"bloqueante", "atencao", "sugestao"})}
# Fatia máxima do orçamento para as peças de apoio: o dinheiro da build é da CPU e da GPU.
TETO_CATEGORIA = {"memoria": 0.12, "armazenamento": 0.10, "placa_mae": 0.18, "fonte": 0.12, "gabinete": 0.12, "cooler": 0.08}
NOME_TIPO = {"memoria": "Memória", "armazenamento": "Armazenamento", "placa_mae": "Placa-mãe", "fonte": "Fonte",
             "gabinete": "Gabinete", "cooler": "Cooler"}


def _somar_precos(store: Store, itens: list[BuildItem], minimo: bool = False) -> float:
    total = 0.0
    for item in itens:
        if item.ja_tenho:
            continue
        r = consultar_cache(store, item.componente_id)
        valor = (r.preco_min if minimo else r.preco_med) or 0.0
        total += valor * item.quantidade
    return round(total, 2)


def custo(store: Store, itens: list[BuildItem]) -> float:
    return _somar_precos(store, itens, minimo=False)


def custo_minimo(store: Store, itens: list[BuildItem]) -> float:
    return _somar_precos(store, itens, minimo=True)


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
        cooler = p.get("cooler")
        teto = orcamento * TETO_CATEGORIA["memoria"]
        for gb in ([32] if orcamento >= 5000 else []) + [16]:
            base = [c for c in tipo("memoria") if c.specs["ddr"] == mb.specs["memoria"] and c.specs["capacidade_gb"] == gb
                    and (not cooler or cooler.specs["refrigeracao"] != "ar" or c.specs["altura_mm"] <= cooler.specs["ram_altura_max_mm"])]
            x = _barato(store, [c for c in base if c.id in mb.specs["qvl_memoria"]] or base)
            # 32 GB só entra se couber na fatia da memória; senão cai para 16 GB em vez de dominar o total
            if x and (gb == 16 or preco_ref(store, x.id) <= teto):
                p["memoria"] = x
                break
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


def _comparar(escolha: tuple, opcoes: list[tuple]) -> str | None:
    """Escolha x segunda melhor opção: quanto custa a mais e o que isso compra em FPS."""
    total, fps, pecas = escolha
    nome = lambda o: f"{o[2]['cpu'].nome} + {o[2]['gpu'].nome}"
    outras = [o for o in opcoes if (o[2]["cpu"].id, o[2]["gpu"].id) != (pecas["cpu"].id, pecas["gpu"].id) and o[1] > 0]
    baratas = [o for o in outras if o[0] < total and o[1] < fps]
    if baratas and fps:
        o = max(baratas, key=lambda o: (o[1], -o[0]))
        return (f"{brl(total - o[0])} a mais que {nome(o)} por {(fps / o[1] - 1) * 100:+.0f}% de FPS "
                f"({fps:.0f} contra {o[1]:.0f} no jogo mais pesado).")
    caras = [o for o in outras if o[0] > total and o[1] > fps]
    if caras and fps:
        o = min(caras, key=lambda o: (o[0], -o[1]))
        return (f"O passo seguinte ({nome(o)}) custaria {brl(o[0] - total)} a mais por {(o[1] / fps - 1) * 100:+.0f}% de FPS "
                f"({o[1]:.0f} contra {fps:.0f}).")
    return None


def _escolher_par(store: Store, build: Build, fixos: dict[str, Componente],
                  folga: float = FOLGA_ALVO) -> tuple[dict[str, Componente], list[str], str | None]:
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
        return _completar(store, fixos, build.orcamento), ["Nenhum par CPU+GPU com preço disponível."], None
    cabe = [o for o in opcoes if o[0] <= build.orcamento]
    # a mais barata que passa do alvo com a folga do perfil; sem nenhuma, afrouxa a folga até o alvo seco
    escolha = next((min(ok, key=lambda o: o[0]) for f in (folga, FOLGA_ALVO, 1.0)
                    if f <= folga and (ok := [o for o in cabe if o[1] >= alvo * f])), None)
    if escolha:
        pass
    elif cabe:
        teto = max(o[1] for o in cabe)   # a mais barata a até 3% do maior FPS: não paga por diferença que não se vê
        escolha = min((o for o in cabe if o[1] >= teto * 0.97), key=lambda o: o[0])
        avisos.append(f"Nenhuma combinação no orçamento atinge {alvo} FPS em todos os jogos; esta é a de maior FPS mínimo "
                      f"({escolha[1]:.0f} FPS).")
    else:
        escolha = min(opcoes, key=lambda o: o[0])
        avisos.append(f"Nenhuma build completa cabe em {brl(build.orcamento)}; esta é a mais barata ({brl(escolha[0])}).")
    return escolha[2], avisos, _comparar(escolha, cabe or opcoes)


def build_ja_tenho(build: Build) -> set[str]:
    return {i.componente_id for i in build.itens if i.ja_tenho}


def _justificar(store: Store, build: Build, comps: list[Componente], fixos: set[str], usar_llm: bool = True) -> dict[str, str]:
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
    if not usar_llm:
        return texto
    r = llm.completar_json("justificativas", "Reescreva cada justificativa de peça em português claro, sem inventar números. "
                           'Formato: {"<id>": "texto"}', json.dumps(texto, ensure_ascii=False))
    if r and set(r) == set(texto) and all(isinstance(v, str) for v in r.values()):
        texto = r
    return texto


def _chave(c: Componente) -> str:
    return c.id if c.tipo in ("extra", "armazenamento") else c.tipo


def _corrigir(store: Store, build: Build, pecas: dict[str, Componente], itens: list[BuildItem], achados: list[Achado],
              travados: set[str], severidades: set[str], motivos: dict[str, str]) -> list[str]:
    """Aplica em `pecas` as correções dos achados abertos. Bloqueante sempre; atenção e sugestão só com o que sobra
    do orçamento (sugestão nunca adiciona item: sistema operacional e adaptador são decisão de quem compra)."""
    abertos = sorted((a for a in achados if a.status == "aberto" and a.correcao_sugerida), key=lambda a: PESO[a.severidade])
    so_bloq = any(a.severidade == "bloqueante" for a in abertos)
    total, mudancas = custo(store, itens), []
    for a in abertos:
        c, sev = a.correcao_sugerida, a.severidade
        if sev not in severidades or (so_bloq and sev != "bloqueante") or c.acao == "remover" or c.componente_id in travados:
            continue
        if c.acao == "adicionar" and sev == "sugestao":
            continue
        novo = store.componentes[c.para_id]
        atual = pecas.get(_chave(novo))
        if (c.acao == "trocar") != (atual is not None and atual.id == c.componente_id):
            continue   # a peça já mudou nesta rodada (ou o item já está na lista)
        delta = (preco_ref(store, novo.id) or 0) - ((preco_ref(store, atual.id) or 0) if atual else 0)
        if sev != "bloqueante" and delta > 0 and total + delta > build.orcamento:
            continue
        pecas[_chave(novo)] = novo
        motivos[novo.id] = a.descricao
        total += delta
        mudancas.append((f"{atual.nome} → {novo.nome}" if atual else f"+ {novo.nome}") + f" ({a.id.split(':')[0]}: {a.descricao})")
    return mudancas


def _upgrade(store: Store, build: Build, itens: list[BuildItem], travados: set[str]) -> tuple[list[BuildItem], str] | None:
    """Modo upgrade: CPU ou GPU que o usuário já tem (e não travou) não chega ao FPS-alvo. Propõe o pacote de
    troca com mais FPS por real que cabe no orçamento, de preferência o que já alcança o alvo."""
    tipo = lambda i: store.componentes[i.componente_id].tipo
    if not any(i.ja_tenho and not i.travado and tipo(i) in ("cpu", "gpu") for i in itens):
        return None
    jogos, res, alvo = build.objetivos.jogos, build.objetivos.resolucao, build.objetivos.fps_alvo
    fps = lambda ids: min((e.fps_med for e in estimar_build(store, ids, jogos, res)), default=0)
    ids = [i.componente_id for i in itens]
    if not ids or fps(ids) >= alvo:
        return None
    alvo_build = build.model_copy(update={"itens": itens})
    presos = {i.componente_id for i in itens if i.travado}
    ops = []
    for u in upgrades.sugerir(store, alvo_build, verba=build.orcamento - custo(store, itens), limite=50):
        tipos_novos = {store.componentes[x].tipo for x in u.pacote}
        saem = {i.componente_id for i in itens if tipo(i) in tipos_novos and tipo(i) not in ("extra", "armazenamento")}
        if not saem & presos:
            ops.append((u, saem, fps([x for x in ids if x not in saem] + u.pacote)))
    if not ops:
        return None
    u, saem, novo_fps = next((o for o in ops if o[2] >= alvo), ops[0])   # `sugerir` já ordena por FPS por real
    nomes = lambda xs: ", ".join(store.componentes[x].nome for x in xs)
    just = f"Upgrade: {u.ganho_fps_pct:+.0f}% de FPS por {brl(u.custo)} ({u.ganho_por_mil_reais:.1f}% a cada R$ 1.000)."
    novos = [i for i in itens if i.componente_id not in saem] + [BuildItem(componente_id=x, origem="agente", justificativa=just)
                                                                 for x in u.pacote]
    return novos, (f"Upgrade: trocar {nomes(sorted(saem))} por {nomes(u.pacote)} custa {brl(u.custo)} e leva o FPS mínimo a "
                   f"{novo_fps:.0f} ({u.ganho_fps_pct:+.0f}% na média). As peças que você já tem e não entram na troca ficam.")


def _propor(store: Store, build: Build, perfil: str, usar_llm: bool) -> Proposta:
    s = get_settings()
    folga, severidades = PERFIS[perfil]
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
    with span("propositor", input={"perfil": perfil}):
        pecas, avisos, comparacao = _escolher_par(store, build, fixos, folga)
    pecas = {_chave(c): c for c in pecas.values()}
    melhor: tuple[tuple[int, int], list[BuildItem], list[Achado]] | None = None
    historico: list[Tentativa] = []
    motivos: dict[str, str] = {}   # peça que entrou por correção -> achado que ela resolve
    for n in range(1, s.agente_max_tentativas + 1):
        itens = [i.model_copy() for i in manter] + [BuildItem(componente_id=c.id, origem="agente")
                                                    for c in pecas.values() if c.id not in travados]
        achados = revisar_build(store, build, itens, llm=usar_llm)
        conta = lambda sev: sum(a.severidade == sev and a.status == "aberto" for a in achados)
        nota = (conta("bloqueante"), conta("atencao"))
        if melhor is None or nota < melhor[0]:
            melhor = (nota, itens, achados)
        with span("propositor", input={"tentativa": n + 1}):
            mudancas = _corrigir(store, build, pecas, itens, achados, travados, severidades, motivos)
        historico.append(Tentativa(n=n, bloqueantes=nota[0], alertas=nota[1], mudancas=mudancas))
        if not mudancas:
            break
    (n_bloq, _), itens, achados = melhor
    if n_bloq:
        presos = [a for a in achados if a.severidade == "bloqueante" and set(a.itens_envolvidos) & travados]
        avisos.append(f"Entregue com {n_bloq} bloqueante(s) após {len(historico)} tentativa(s)."
                      + (" Envolvem peça travada: destrave para o agente corrigir." if presos else ""))
    justificativas = _justificar(store, build, [store.componentes[i.componente_id] for i in itens], travados, usar_llm)
    for i in itens:
        if i.componente_id not in travados:
            i.justificativa = justificativas.get(i.componente_id)
            if i.componente_id in motivos:
                i.justificativa = f"{i.justificativa.rstrip('.')}. Entrou na revisão: {motivos[i.componente_id]}"
    if up := _upgrade(store, build, itens, {i.componente_id for i in manter if i.travado}):
        itens, aviso = up
        avisos.append(aviso)
        achados = revisar_build(store, build, itens, llm=usar_llm)
    comps = {store.componentes[i.componente_id].tipo: i for i in itens if not i.ja_tenho}
    for t, teto in TETO_CATEGORIA.items():
        if t in comps and (p := preco_ref(store, comps[t].componente_id)) and p > build.orcamento * teto:
            avisos.append(f"{NOME_TIPO[t]} leva {p / build.orcamento * 100:.0f}% do orçamento (referência: até {teto * 100:.0f}%): "
                          "é a opção compatível mais barata.")
    fps = estimar_build(store, [i.componente_id for i in itens], build.objetivos.jogos, build.objetivos.resolucao)
    return Proposta(itens=itens, achados=achados, tentativas=len(historico),
                    convergiu=not any(a.severidade == "bloqueante" and a.status == "aberto" for a in achados),
                    avisos=avisos, custo_estimado=custo(store, itens), custo_minimo=custo_minimo(store, itens),
                    perfil=perfil, fps_min=min((e.fps_med for e in fps), default=None), comparacao=comparacao,
                    historico=historico)


def propor(store: Store, build: Build) -> Proposta:
    """Proposta principal no perfil equilibrado, mais as alternativas (econômica, com folga) que derem build diferente.
    As alternativas saem só do caminho determinístico: o LLM entra na revisão quando uma delas for aplicada."""
    with trace(build.id, "agente"):
        p = _propor(store, build, "equilibrada", usar_llm=True)
        vistos = {frozenset(i.componente_id for i in p.itens)}
        for perfil in ("economica", "com_folga"):
            alt = _propor(store, build, perfil, usar_llm=False)
            ids = frozenset(i.componente_id for i in alt.itens)
            if ids not in vistos:
                vistos.add(ids)
                p.alternativas.append(alt)
        return p
