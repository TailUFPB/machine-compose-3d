"""Consolidador: junta camada 1 e camada 2, remove duplicatas, resolve contradições, garante a regra de
fonte (sem fonte = não verificado e nunca bloqueante) e calcula o impacto de cada correção em preço e FPS."""

from __future__ import annotations

from ..fps import estimar_build
from ..modelos import Achado, Build, BuildItem
from ..precos import preco_ref
from ..store import Store
from ..tracing import span
from . import regras, revisores

PESO = {"bloqueante": 0, "atencao": 1, "sugestao": 2}


def _aplicar_correcao(itens: list[BuildItem], a: Achado) -> list[str]:
    ids = [i.componente_id for i in itens]
    c = a.correcao_sugerida
    if not c:
        return ids
    if c.acao == "trocar":
        return [c.para_id if i == c.componente_id else i for i in ids]
    if c.acao == "adicionar":
        return ids + [c.para_id]
    return [i for i in ids if i != c.componente_id]


def _impacto(store: Store, build: Build, a: Achado) -> None:
    c = a.correcao_sugerida
    if not c:
        return
    de = preco_ref(store, c.componente_id) if c.componente_id else 0
    para = preco_ref(store, c.para_id) if c.para_id else 0
    if de is not None and para is not None:
        a.impacto_preco = round((para or 0) - (de or 0), 2)
    tipos = {store.componentes[x].tipo for x in (c.componente_id, c.para_id) if x}
    if not tipos & {"cpu", "gpu"}:
        a.impacto_fps = "sem impacto no FPS"
        return
    jogos, res = build.objetivos.jogos, build.objetivos.resolucao
    antes = estimar_build(store, [i.componente_id for i in build.itens], jogos, res)
    depois = estimar_build(store, _aplicar_correcao(build.itens, a), jogos, res)
    if antes and depois:
        m = lambda es: sum(e.fps_med for e in es) / len(es)
        a.impacto_fps = f"{(m(depois) / m(antes) - 1) * 100:+.0f}% FPS médio (estimado)"


def consolidar(store: Store, build: Build, achados: list[Achado]) -> list[Achado]:
    # regra de fonte
    for a in achados:
        if not a.fonte_url:
            a.verificado = False
        if not a.verificado and a.severidade == "bloqueante":
            a.severidade = "atencao"
            a.descricao += " (não verificado: sem fonte, não bloqueia)"
    # duplicatas: mesmo id, ou mesmas peças + mesma correção -> fica o mais grave (camada 1 desempata)
    unicos: dict[tuple, Achado] = {}
    for a in sorted(achados, key=lambda a: (PESO[a.severidade], a.agente != "regras")):
        corr = a.correcao_sugerida.model_dump_json() if a.correcao_sugerida else a.id
        chave = (tuple(sorted(a.itens_envolvidos)), corr)
        if a.id in {x.id for x in unicos.values()} or chave in unicos:
            continue
        unicos[chave] = a
    lista = list(unicos.values())
    # contradições: duas correções trocam a mesma peça por alvos diferentes -> fica a do achado mais grave
    escolhida: dict[str, Achado] = {}
    for a in lista:
        c = a.correcao_sugerida
        if not (c and c.acao == "trocar"):
            continue
        rival = escolhida.get(c.componente_id)
        if rival is None:
            escolhida[c.componente_id] = a
        elif rival.correcao_sugerida.para_id != c.para_id:
            a.descricao += f" (correção conflitava com '{rival.agente}': prevalece a do achado mais grave)"
            a.correcao_sugerida = None
    # status anterior sobrevive à nova revisão (ignorado continua ignorado)
    anterior = {a.id: a.status for a in build.achados}
    for a in lista:
        if anterior.get(a.id) == "ignorado":
            a.status = "ignorado"
        _impacto(store, build, a)
    return sorted(lista, key=lambda a: (PESO[a.severidade], a.agente, a.id))


def revisar_build(store: Store, build: Build, itens: list[BuildItem] | None = None, llm: bool = True) -> list[Achado]:
    itens = build.itens if itens is None else itens
    alvo = build if itens is build.itens else build.model_copy(update={"itens": itens})
    with span("revisao_camada1"):
        c1 = regras.avaliar(store, itens)
    c2 = revisores.revisar(store, itens, llm=llm)
    with span("consolidador"):
        return consolidar(store, alvo, c1 + c2)


def bloqueantes_abertos(build: Build) -> list[Achado]:
    return [a for a in build.achados if a.severidade == "bloqueante" and a.status == "aberto"]
