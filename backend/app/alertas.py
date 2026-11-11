"""Alerta de preço: o usuário define um preço-alvo por peça; o status usa a pesquisa atual e o histórico."""

from __future__ import annotations

import statistics

from pydantic import BaseModel, Field

from .precos import historico, pesquisar
from .store import Store


class AlertaCriar(BaseModel):
    componente_id: str
    preco_alvo: float = Field(gt=0)


class StatusAlerta(BaseModel):
    componente_id: str
    preco_alvo: float
    menor_agora: float | None
    loja: str | None
    url: str | None            # fonte do menor preço
    atingido: bool
    minimo_historico: float | None
    tendencia: str             # queda | alta | estavel | sem_dados


def tendencia(pontos: list[float]) -> str:
    """Compara a média da primeira metade com a da segunda (variação acima de 3%)."""
    if len(pontos) < 4:
        return "sem_dados"
    meio = len(pontos) // 2
    a, b = statistics.mean(pontos[:meio]), statistics.mean(pontos[meio:])
    if b < a * 0.97:
        return "queda"
    if b > a * 1.03:
        return "alta"
    return "estavel"


def status(store: Store, alerta: AlertaCriar) -> StatusAlerta:
    r = pesquisar(store, alerta.componente_id)
    melhor = min(r.ofertas, key=lambda o: o.preco) if r.ofertas else None
    h = historico(store, alerta.componente_id)
    por_dia: dict[str, list[float]] = {}
    for x in h:
        por_dia.setdefault(x["coletado_em"][:10], []).append(x["preco"])
    serie = [statistics.mean(v) for _, v in sorted(por_dia.items())]
    return StatusAlerta(componente_id=alerta.componente_id, preco_alvo=alerta.preco_alvo,
                        menor_agora=melhor.preco if melhor else None, loja=melhor.loja if melhor else None,
                        url=melhor.url if melhor else None, atingido=bool(melhor and melhor.preco <= alerta.preco_alvo),
                        minimo_historico=min((x["preco"] for x in h), default=None), tendencia=tendencia(serie))
