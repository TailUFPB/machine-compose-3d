"""Fluxo de ar medido pela ficha: quais vagas de ventoinha do gabinete estão ocupadas, por quem e em que sentido.

A cena desenha as ventoinhas desta lista e a revisão (`compat/revisores.py: fluxo_de_ar`) conta as mesmas, para as duas
nunca discordarem. Frente é entrada; traseira e topo são saída (as fichas não têm fundo nem lateral).
Calor e ventoinhas recomendadas são ESTIMATIVA: `W_POR_FAN` watts de TDP por ventoinha, no mínimo `MIN_FANS`.
"""

from __future__ import annotations

from math import ceil
from typing import Literal

from pydantic import BaseModel

from .folgas import radiador_na_frente
from .modelos import Componente

W_POR_FAN = 150       # estimativa: watts de TDP (CPU + GPU) que uma ventoinha de 120 mm do gabinete dá conta de renovar
MIN_FANS = 2          # uma entrada e uma saída
GPU_QUENTE_W = 250    # GPU a partir disso sente o ar já aquecido por um radiador na frente
FAN_MM = 120

Vaga = Literal["frente", "topo", "traseira"]
SENTIDO: dict[str, Literal["entrada", "saida"]] = {"frente": "entrada", "topo": "saida", "traseira": "saida"}


class Ventoinha(BaseModel):
    vaga: Vaga
    indice: int
    sentido: Literal["entrada", "saida"]
    origem: Literal["gabinete", "pacote", "radiador"]


class Fluxo(BaseModel):
    ventoinhas: list[Ventoinha]
    entrada: int
    saida: int
    pressao: Literal["positiva", "equilibrada", "negativa"]
    calor_w: int
    recomendadas: int


def vagas(gabinete: Componente) -> dict[str, int]:
    """Vagas por posição, com a mesma regra de `frontend/src/lib/gabinete.ts`: da ficha (`posicoes_fan`) limitada pelo
    que cabe nas dimensões, ou a estimativa (uma atrás, até três na frente, duas no topo)."""
    s = gabinete.specs
    d = s.get("dimensoes") or {"c": 450, "a": 460, "l": 230}
    comp, alt_total, larg = d["c"], d["a"], d["l"]
    alt = alt_total - 12 - 2 * 1.5            # pés e chapas de cima e de baixo
    pos = s.get("posicoes_fan")
    tras = min(1, pos.get("traseira", 0)) if pos else 1
    frente = min(pos.get("frente", 0) if pos else 3, int((alt - 10) // 125))
    topo = 0 if larg < 125 else (min(pos.get("topo", 0), int((comp - 60) // 130)) if pos else (2 if comp >= 300 else 0))
    return {"frente": max(0, frente), "topo": max(0, topo), "traseira": max(0, tras)}


def _ordem(v: dict[str, int], posicoes: tuple[str, ...]) -> list[tuple[str, int]]:
    return [(p, i) for p in posicoes for i in range(v[p])]


def calcular(pecas: dict[str, Componente], extras: list[tuple[Componente, int]]) -> Fluxo | None:
    case = pecas.get("gabinete")
    if not case:
        return None
    v, cooler = vagas(case), pecas.get("cooler")
    ocupadas: dict[tuple[str, int], str] = {}
    if cooler and cooler.specs.get("refrigeracao") == "aio":   # o radiador fica com as vagas da face dele
        face = "frente" if radiador_na_frente(cooler) else "topo"
        n = cooler.specs.get("fans") or (cooler.specs.get("radiador_mm") or 0) // FAN_MM
        for i in range(min(n, v[face])):
            ocupadas[(face, i)] = "radiador"

    def ocupar(n: int, posicoes: tuple[str, ...], origem: str) -> None:
        for vaga in _ordem(v, posicoes):
            if n <= 0:
                return
            if vaga not in ocupadas:
                ocupadas[vaga] = origem
                n -= 1

    ocupar(case.specs.get("fans_inclusos", 0), ("traseira", "frente", "topo"), "gabinete")   # deslocadas vão para as livres
    pacote = sum((c.specs.get("fans") or 0) * q for c, q in extras if c.specs.get("categoria") == "ventoinhas")
    ocupar(pacote, ("frente", "traseira", "topo"), "pacote")

    ventoinhas = [Ventoinha(vaga=p, indice=i, sentido=SENTIDO[p], origem=o) for (p, i), o in ocupadas.items()]
    ventoinhas.sort(key=lambda x: (("traseira", "frente", "topo").index(x.vaga), x.indice))
    entrada = sum(x.sentido == "entrada" for x in ventoinhas)
    saida = len(ventoinhas) - entrada
    calor = sum(p.specs.get("tdp", 0) for p in (pecas.get("cpu"), pecas.get("gpu")) if p)
    return Fluxo(ventoinhas=ventoinhas, entrada=entrada, saida=saida,
                 pressao="positiva" if entrada > saida else "negativa" if entrada < saida else "equilibrada",
                 calor_w=calor, recomendadas=max(MIN_FANS, ceil(calor / W_POR_FAN)))
