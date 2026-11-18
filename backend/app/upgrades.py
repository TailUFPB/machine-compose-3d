"""Caminho de upgrade: para uma build existente (ex.: peças que o usuário já tem), quais trocas dão mais FPS por real.

Cada candidato de CPU ou GPU vira um "pacote": se ele exigir outras trocas (placa por socket, memória por DDR,
fonte por potência), as correções da camada 1 são aplicadas em cadeia e entram no custo.
"""

from __future__ import annotations

from pydantic import BaseModel

from .compat import regras
from .fps import estimar_build
from .modelos import Build, BuildItem
from .precos import preco_ref
from .store import Store

MAX_CORRECOES = 4
# ponytail: o pacote só aplica correções da camada 1; conectores e BIOS (camada 2) ficam para a revisão da build.


class Upgrade(BaseModel):
    principal: str
    pacote: list[str]        # todas as peças a comprar
    custo: float
    ganho_fps_pct: float
    ganho_por_mil_reais: float


def _fps(store: Store, ids: list[str], build: Build) -> float | None:
    es = estimar_build(store, ids, build.objetivos.jogos, build.objetivos.resolucao)
    return sum(e.fps_med for e in es) / len(es) if es else None


def _pacote(store: Store, ids: list[str], novo: str) -> list[str] | None:
    tipo = store.componentes[novo].tipo
    atual = [i for i in ids if store.componentes[i].tipo != tipo] + [novo]
    for _ in range(MAX_CORRECOES):
        bloq = [a for a in regras.avaliar(store, [BuildItem(componente_id=i) for i in atual])
                if a.severidade == "bloqueante" and a.correcao_sugerida]
        if not bloq:
            return atual
        c = bloq[0].correcao_sugerida
        if c.componente_id == novo:
            return None   # o próprio candidato é o problema
        atual = [i for i in atual if i != c.componente_id] + [c.para_id]
    return None


def sugerir(store: Store, build: Build, verba: float | None = None, limite: int = 8) -> list[Upgrade]:
    ids = [i.componente_id for i in build.itens]
    base = _fps(store, ids, build)
    if not base:
        return []
    saida = []
    for tipo in ("gpu", "cpu"):
        for cand in store.por_tipo(tipo):
            if cand.id in ids:
                continue
            pacote = _pacote(store, ids, cand.id)
            if not pacote:
                continue
            comprar = [i for i in pacote if i not in ids]
            precos = [preco_ref(store, i) for i in comprar]
            if None in precos:
                continue
            custo = round(sum(precos), 2)
            novo = _fps(store, pacote, build)
            if not novo or novo <= base * 1.03 or (verba is not None and custo > verba):
                continue
            ganho = (novo / base - 1) * 100
            saida.append(Upgrade(principal=cand.id, pacote=comprar, custo=custo, ganho_fps_pct=round(ganho, 1),
                                 ganho_por_mil_reais=round(ganho / custo * 1000, 2)))
    return sorted(saida, key=lambda u: -u.ganho_por_mil_reais)[:limite]
