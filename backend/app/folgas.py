"""Folgas medidas pela ficha: quanto sobra (ou quanto passa) de cada peça no espaço que a outra deixa.

Os limites de "justa" e a tolerância de "ajuste" são os mesmos que a revisão usa (`compat/revisores.py` importa daqui),
para a régua da cena nunca dizer "cabe" onde a revisão diz "não cabe". Achado ignorado não muda a folga: é medida.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from .modelos import Componente

GPU_JUSTA_MM = 15       # sobra abaixo disso: cabos de energia apertados (espaco:gpu_justa)
COOLER_JUSTA_MM = 5     # cooler a menos disso da tampa lateral pode encostar no vidro (espaco:cooler_justo)
PADRAO_JUSTA_MM = 5     # memória sob o cooler e fonte na largura do gabinete
RAM_AJUSTE_MM = 10      # memória até 10 mm acima da folga do cooler: a ventoinha sobe (espaco:ram_cooler atenção)

Estado = Literal["cabe", "justa", "ajuste", "nao_cabe"]


class Folga(BaseModel):
    id: Literal["gpu", "cooler", "memoria", "fonte"]
    peca: str           # componente medido
    limite_de: str      # componente que define o limite
    tamanho_mm: int
    limite_mm: int
    sobra_mm: int       # negativo = passa do limite
    estado: Estado
    dica: str | None = None


def radiador_na_frente(cooler: Componente | None) -> bool:
    """Water cooler com o radiador no painel da frente (sem posição na ficha, vale a frente, como na cena)."""
    return bool(cooler and cooler.specs.get("refrigeracao") == "aio" and cooler.specs.get("radiador_posicao") != "topo")


def limite_gpu(gabinete: Componente, cooler: Componente | None) -> int:
    """Comprimento útil para a GPU: o radiador na frente come parte do espaço."""
    s = gabinete.specs
    return s["gpu_max_com_radiador_frontal_mm"] if radiador_na_frente(cooler) else s["gpu_max_mm"]


def _folga(fid, peca: Componente, limite_de: Componente, tamanho: int, limite: int, justa: int,
           estado_excesso: Estado = "nao_cabe", dica: str | None = None) -> Folga:
    sobra = limite - tamanho
    estado: Estado = estado_excesso if sobra < 0 else "justa" if sobra < justa else "cabe"
    return Folga(id=fid, peca=peca.id, limite_de=limite_de.id, tamanho_mm=tamanho, limite_mm=limite, sobra_mm=sobra,
                 estado=estado, dica=dica if sobra < 0 and estado_excesso == "ajuste" else None)


def calcular(pecas: dict[str, Componente]) -> list[Folga]:
    gpu, case, cooler, ram, psu = (pecas.get(t) for t in ("gpu", "gabinete", "cooler", "memoria", "fonte"))
    ar = cooler if cooler and cooler.specs.get("refrigeracao") == "ar" else None
    out: list[Folga] = []
    if gpu and case:
        comp, maximo = gpu.specs["comprimento_mm"], case.specs["gpu_max_mm"]
        if comp > maximo:          # não cabe nem sem radiador: mesma medida da região de conflito (par:gpu_comprimento)
            out.append(_folga("gpu", gpu, case, comp, maximo, GPU_JUSTA_MM))
        else:                      # cabe no gabinete; com radiador na frente, passar do limite útil é ajuste
            out.append(_folga("gpu", gpu, case, comp, limite_gpu(case, cooler), GPU_JUSTA_MM, "ajuste", "monte o radiador no topo"))
    if ar and case:
        out.append(_folga("cooler", ar, case, ar.specs["altura_mm"], case.specs["cooler_max_mm"], COOLER_JUSTA_MM))
    if ram and ar and ar.specs.get("ram_altura_max_mm") is not None:
        altura, limite = ram.specs["altura_mm"], ar.specs["ram_altura_max_mm"]
        excesso = "ajuste" if altura - limite <= RAM_AJUSTE_MM else "nao_cabe"
        out.append(_folga("memoria", ram, ar, altura, limite, PADRAO_JUSTA_MM, excesso, "a ventoinha precisa subir"))
    if psu and case:
        out.append(_folga("fonte", psu, case, psu.specs["dimensoes"]["c"], case.specs["dimensoes"]["l"], PADRAO_JUSTA_MM))
    return out
