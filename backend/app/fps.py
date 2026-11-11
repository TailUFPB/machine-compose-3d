"""Simulação de desempenho em jogos.

Medido: existe linha na base para (GPU, CPU, jogo, resolução, preset).
Estimado (sempre rotulado, com faixa e confiança), sem linha exata:
- teto da GPU = medição da mesma GPU com a CPU mais forte medida no jogo/resolução; sem ela, a medição de
  GPU mais próxima em índice, escalada pela razão de índices;
- teto da CPU = medição da mesma CPU com a GPU mais forte em 1080p (onde a CPU limita); sem ela, escala
  pela CPU mais próxima;
- FPS = menor teto; o gargalo é quem limita.
ponytail: interpolação linear por índice; trocar por regressão por jogo quando a base crescer.
"""

from __future__ import annotations

from pydantic import BaseModel

from .modelos import Componente
from .store import Store


class Estimativa(BaseModel):
    jogo: str
    jogo_nome: str
    resolucao: str
    preset: str
    fps_med: float
    fps_min: float           # faixa
    fps_max: float
    fps_1low: float
    tipo: str                # medido | estimado
    confianca: str           # alta | media | baixa
    gargalo: str | None      # cpu | gpu | None (medido sem dados para separar)
    fontes: list[str]
    fps_por_mil_reais: float | None = None   # FPS médio por R$ 1.000 da build


def _idx(store: Store, cid: str) -> float:
    return store.componentes[cid].specs["indice"]


def _linhas(store: Store, jogo: str, res: str) -> list[dict]:
    if not hasattr(store, "_bench_idx"):
        store._bench_idx = {}
        for b in store.benchmarks:
            if b["preset"] == store.preset:
                store._bench_idx.setdefault((b["jogo"], b["resolucao"]), []).append(b)
    return store._bench_idx.get((jogo, res), [])


def _teto(linhas: list[dict], chave: str, outra: str, alvo: str, store: Store) -> tuple[float, str, bool] | None:
    """Teto de um lado (chave = 'gpu_id' ou 'cpu_id'). Usa as linhas com o 'outro lado' mais forte.
    Devolve (fps, fonte, exato)."""
    if not linhas:
        return None
    melhor_outra = max(_idx(store, l[outra]) for l in linhas)
    fortes = [l for l in linhas if _idx(store, l[outra]) == melhor_outra]
    exata = next((l for l in fortes if l[chave] == alvo), None)
    if exata:
        return exata["fps_medio"], exata["fonte"], True
    alvo_idx = _idx(store, alvo)
    perto = min(fortes, key=lambda l: abs(_idx(store, l[chave]) - alvo_idx))
    return perto["fps_medio"] * alvo_idx / _idx(store, perto[chave]), perto["fonte"], False


def estimar(store: Store, gpu: Componente | None, cpu: Componente | None, jogo: str, res: str) -> Estimativa | None:
    if not gpu or not cpu or jogo not in store.jogos:
        return None
    info = store.jogos[jogo]
    linhas = _linhas(store, jogo, res)
    exata = next((l for l in linhas if l["gpu_id"] == gpu.id and l["cpu_id"] == cpu.id), None)
    low = info["low"]
    teto_gpu = _teto(linhas, "gpu_id", "cpu_id", gpu.id, store)
    teto_cpu = _teto(_linhas(store, jogo, "1080p"), "cpu_id", "gpu_id", cpu.id, store)
    gargalo = None
    if teto_gpu and teto_cpu:
        gargalo = "gpu" if teto_gpu[0] <= teto_cpu[0] else "cpu"
    if exata:
        f = exata["fps_medio"]
        return Estimativa(jogo=jogo, jogo_nome=info["nome"], resolucao=res, preset=store.preset, fps_med=f,
                          fps_min=round(f * 0.95, 1), fps_max=round(f * 1.05, 1), fps_1low=exata["fps_1low"],
                          tipo="medido", confianca="alta", gargalo=gargalo, fontes=[exata["fonte"]])
    if not (teto_gpu and teto_cpu):
        return None
    f = round(min(teto_gpu[0], teto_cpu[0]), 1)   # os tetos já são medições combinadas
    exatos = teto_gpu[2] + teto_cpu[2]
    confianca, margem = {2: ("media", 0.10), 1: ("media", 0.15), 0: ("baixa", 0.22)}[exatos]
    return Estimativa(jogo=jogo, jogo_nome=info["nome"], resolucao=res, preset=store.preset, fps_med=f,
                      fps_min=round(f * (1 - margem), 1), fps_max=round(f * (1 + margem), 1), fps_1low=round(f * low, 1),
                      tipo="estimado", confianca=confianca, gargalo=gargalo,
                      fontes=sorted({teto_gpu[1], teto_cpu[1]}))


def estimar_build(store: Store, ids: list[str], jogos: list[str], res: str, custo: float | None = None) -> list[Estimativa]:
    comps = [store.componentes[i] for i in ids if i in store.componentes]
    gpu = next((c for c in comps if c.tipo == "gpu"), None)
    cpu = next((c for c in comps if c.tipo == "cpu"), None)
    saida = []
    for j in jogos or list(store.jogos):
        e = estimar(store, gpu, cpu, j, res)
        if e:
            if custo:
                e.fps_por_mil_reais = round(e.fps_med / custo * 1000, 2)
            saida.append(e)
    return saida
