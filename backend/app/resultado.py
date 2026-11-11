"""Resultado: plano de compra por loja, viabilidade no orçamento e sugestões de troca com impacto."""

from __future__ import annotations

from pydantic import BaseModel, Field

from .compat.regras import motivo_incompativel
from .fps import estimar_build
from .modelos import Build, BuildItem
from .precos import brl, pesquisar, preco_ref
from .store import Store

TOLERANCIA_FPS = -0.02   # até 2% a menos conta como "sem perder FPS"


class LinhaCompra(BaseModel):
    componente_id: str
    nome: str
    quantidade: int
    preco_unit: float
    subtotal: float
    url: str
    faixa: tuple[float, float, float]
    confianca: str | None


class Troca(BaseModel):
    de_id: str
    para_id: str
    de_nome: str
    para_nome: str
    economia: float          # positivo = mais barato
    impacto_fps_pct: float | None
    texto: str


class Resultado(BaseModel):
    lojas: dict[str, list[LinhaCompra]] = Field(default_factory=dict)
    total_por_loja: dict[str, float] = Field(default_factory=dict)
    total: float = 0
    orcamento: float
    cabe: bool
    diferenca: float         # positivo = sobra, negativo = falta
    sem_preco: list[str] = Field(default_factory=list)
    ja_tenho: list[str] = Field(default_factory=list)
    trocas: list[Troca] = Field(default_factory=list)
    frete: str = "a confirmar com o CEP na loja"


def _fps_medio(store: Store, ids: list[str], build: Build) -> float | None:
    es = estimar_build(store, ids, build.objetivos.jogos, build.objetivos.resolucao)
    return sum(e.fps_med for e in es) / len(es) if es else None


def sugerir_trocas(store: Store, build: Build, sobra: float, limite: int = 6) -> list[Troca]:
    ids = [i.componente_id for i in build.itens]
    base_fps = _fps_medio(store, ids, build)
    trocas: list[Troca] = []
    for item in build.itens:
        atual = store.componentes.get(item.componente_id)
        if not atual or item.travado or item.ja_tenho or atual.tipo == "extra":
            continue
        p_atual = preco_ref(store, atual.id)
        if p_atual is None:
            continue
        resto = [i for i in build.itens if i.componente_id != atual.id]
        for alt in store.por_tipo(atual.tipo):
            p_alt = preco_ref(store, alt.id)
            if alt.id == atual.id or p_alt is None or motivo_incompativel(store, resto, alt):
                continue
            if atual.tipo == "memoria" and alt.specs["capacidade_gb"] < atual.specs["capacidade_gb"]:
                continue
            if atual.tipo == "armazenamento" and alt.specs["capacidade_gb"] < atual.specs["capacidade_gb"]:
                continue
            economia = round(p_atual - p_alt, 2)
            delta = None
            if atual.tipo in ("cpu", "gpu") and base_fps:
                novo = _fps_medio(store, [alt.id if i == atual.id else i for i in ids], build)
                delta = (novo / base_fps - 1) if novo else None
            if economia > 0 and (delta is None or delta >= TOLERANCIA_FPS):
                texto = f"Economize {brl(economia)} sem perder FPS" if delta is not None else f"Economize {brl(economia)}"
            elif economia > 0 and delta is not None and delta > -0.15:
                texto = f"Economize {brl(economia)} perdendo {abs(delta) * 100:.0f}% de FPS"
            elif economia < 0 and -economia <= sobra and delta is not None and delta >= 0.08:
                texto = f"Com {brl(-economia)} a mais (cabe no orçamento), +{delta * 100:.0f}% de FPS"
            else:
                continue
            trocas.append(Troca(de_id=atual.id, para_id=alt.id, de_nome=atual.nome, para_nome=alt.nome, economia=economia,
                                impacto_fps_pct=round(delta * 100, 1) if delta is not None else None, texto=texto))
    # uma por peça: economia sem perder FPS, depois economia com perda, depois upgrades (maior ganho)
    def rank(t: Troca) -> tuple:
        if t.economia > 0:
            sem_perda = t.impacto_fps_pct is None or t.impacto_fps_pct >= TOLERANCIA_FPS * 100
            return (0 if sem_perda else 1, -t.economia)
        return (2, -(t.impacto_fps_pct or 0))
    melhor: dict[str, Troca] = {}
    for t in trocas:
        if t.de_id not in melhor or rank(t) < rank(melhor[t.de_id]):
            melhor[t.de_id] = t
    return sorted(melhor.values(), key=rank)[:limite]


def calcular(store: Store, build: Build) -> Resultado:
    lojas: dict[str, list[LinhaCompra]] = {}
    sem_preco, ja_tenho = [], []
    for item in build.itens:
        comp = store.componentes.get(item.componente_id)
        if not comp:
            continue
        if item.ja_tenho:
            ja_tenho.append(comp.nome)
            continue
        r = pesquisar(store, comp.id)
        if not r.ofertas:
            sem_preco.append(comp.nome)
            continue
        melhor = min(r.ofertas, key=lambda o: o.preco)
        lojas.setdefault(melhor.loja, []).append(LinhaCompra(
            componente_id=comp.id, nome=comp.nome, quantidade=item.quantidade, preco_unit=melhor.preco,
            subtotal=round(melhor.preco * item.quantidade, 2), url=melhor.url,
            faixa=(r.preco_min, r.preco_med, r.preco_max), confianca=r.confianca))
    totais = {l: round(sum(x.subtotal for x in linhas), 2) for l, linhas in lojas.items()}
    total = round(sum(totais.values()), 2)
    diferenca = round(build.orcamento - total, 2)
    return Resultado(lojas=lojas, total_por_loja=totais, total=total, orcamento=build.orcamento, cabe=diferenca >= 0,
                     diferenca=diferenca, sem_preco=sem_preco, ja_tenho=ja_tenho,
                     trocas=sugerir_trocas(store, build, max(diferenca, 0)))


def itens_com_status(store: Store, itens: list[BuildItem]) -> list[BuildItem]:
    for i in itens:
        i.status_pesquisa = "ok" if pesquisar(store, i.componente_id).tem_preco else "sem_preco"
    return itens
