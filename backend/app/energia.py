"""Custo de energia: consumo médio jogando e custo mensal pela tarifa informada pelo usuário.

A tarifa vem do usuário (conta de luz); o padrão é só um ponto de partida editável e é rotulado assim.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .modelos import Build
from .store import Store

CARGA_JOGO = {"cpu": 0.6, "gpu": 0.9}   # fração do TDP em jogo típico
CONSUMO_BASE_W = 60
TARIFA_PADRAO = 0.90                     # R$/kWh, editável


class Energia(BaseModel):
    consumo_jogando_w: int
    eficiencia_fonte: float
    consumo_tomada_w: int
    kwh_mes: float
    custo_mes: float
    tarifa: float
    tarifa_informada: bool
    horas_dia: float = Field(ge=0, le=24)


EFICIENCIA = {"80+ Bronze": 0.85, "80+ Gold": 0.90, "80+ Platinum": 0.92}


def calcular(store: Store, build: Build, horas_dia: float, tarifa: float | None) -> Energia:
    comps = [store.componentes[i.componente_id] for i in build.itens if i.componente_id in store.componentes]
    dc = CONSUMO_BASE_W + sum(c.specs["tdp"] * CARGA_JOGO[c.tipo] for c in comps if c.tipo in CARGA_JOGO)
    psu = next((c for c in comps if c.tipo == "fonte"), None)
    ef = EFICIENCIA.get(psu.specs["certificacao"], 0.82) if psu else 0.82
    tomada = dc / ef
    kwh = tomada * horas_dia * 30 / 1000
    t = tarifa if tarifa is not None else TARIFA_PADRAO
    return Energia(consumo_jogando_w=round(dc), eficiencia_fonte=ef, consumo_tomada_w=round(tomada), kwh_mes=round(kwh, 1),
                   custo_mes=round(kwh * t, 2), tarifa=t, tarifa_informada=tarifa is not None, horas_dia=horas_dia)
