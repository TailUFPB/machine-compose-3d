"""Pesquisa de preço, mesmo pipeline do OrçaAI: cache 7 dias -> busca por loja -> extração (LLM ou regex)
-> checagem rigorosa de "mesmo produto" -> remoção de outliers -> faixa mín/méd/máx -> histórico.

Regra de ouro: oferta sem URL de origem é descartada; nenhum preço sai sem fonte.
"""

from __future__ import annotations

import re
import statistics
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field

from . import llm
from .config import get_settings
from .modelos import Componente
from .store import Store
from .tracing import span

OUTLIER_MIN, OUTLIER_MAX = 0.4, 2.5   # fora de 40%..250% da mediana (mesmo corte do OrçaAI)
# Sufixos que mudam o produto: "4060" e "4060 Ti" são placas diferentes.
VARIANTES = {"ti", "super", "xt", "xtx", "x3d", "x", "f", "kf", "k", "pro", "max", "plus", "se", "g2"}


class Oferta(BaseModel):
    loja: str
    preco: float
    url: str
    titulo: str
    coletado_em: str


class Descarte(BaseModel):
    loja: str
    titulo: str
    motivo: str
    url: str | None = None


class ResultadoPreco(BaseModel):
    componente_id: str
    ofertas: list[Oferta] = Field(default_factory=list)
    descartes: list[Descarte] = Field(default_factory=list)
    preco_min: float | None = None
    preco_med: float | None = None
    preco_max: float | None = None
    confianca: str | None = None
    do_cache: bool = False
    vencido: bool = False
    coletado_em: str | None = None

    @property
    def tem_preco(self) -> bool:
        return self.preco_med is not None


def brl(v: float) -> str:
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def parse_brl(texto: str) -> float | None:
    m = re.search(r"R\$\s*([\d.]+(?:,\d{1,2})?)", texto or "")
    if not m:
        return None
    return float(m.group(1).replace(".", "").replace(",", "."))


def _tokens(texto: str) -> list[str]:
    t = texto.lower().replace("-", " ").replace("(", " ").replace(")", " ")
    t = re.sub(r"(\d)\s+(gb|tb|w|mhz)\b", r"\1\2", t)         # "16 GB" -> "16gb"
    t = re.sub(r"(\d+x\d+)gb\b", r"\1", t)                       # "2x16GB" -> "2x16"
    t = re.sub(r"(\d+)mhz\b", r"\1", t)                           # "6000MHz" -> "6000"
    t = re.sub(r"(\d+)(x3d|xt|ti|kf|f|x)\b", r"\1 \2", t)     # "7800X3D" -> "7800 x3d"; "12400F" -> "12400 f"
    return re.findall(r"[a-z0-9.]+", t)


def mesmo_produto(comp: Componente, titulo: str, exigir_medidas: bool = True) -> tuple[bool, str | None]:
    """Checagem determinística: todo número do modelo precisa aparecer, nenhum sufixo de variante pode
    sobrar ou faltar, e capacidades/potências (8gb, 1tb, 750w) precisam bater.
    exigir_medidas=False (importação): título sem nenhuma medida pode omitir as do modelo."""
    alvo, visto = _tokens(comp.modelo), _tokens(titulo)
    cap = lambda ts: {t for t in ts if re.fullmatch(r"\d+(gb|tb|w)|\d+x\d+", t)}
    numeros = {t for t in alvo if re.search(r"\d", t)}
    if not exigir_medidas and not cap(visto):
        numeros -= cap(alvo)
        if not numeros:
            return False, "sem número de modelo para conferir"
    if faltam := numeros - set(visto):
        return False, f"modelo diferente (falta {', '.join(sorted(faltam))})"
    var_alvo, var_visto = set(alvo) & VARIANTES, set(visto) & VARIANTES
    if var_alvo != var_visto:
        dif = sorted(var_alvo ^ var_visto)
        return False, f"variante diferente ({', '.join(dif)})"
    if cap(visto) - cap(alvo):
        return False, f"capacidade/potência diferente ({', '.join(sorted(cap(visto) - cap(alvo)))})"
    return True, None


def _extrair(anuncio: dict) -> float | None:
    """Extração de preço. Com LLM, ele lê o anúncio; o valor só vale se aparecer no texto (anti-alucinação)."""
    regex = parse_brl(anuncio["preco_texto"])
    r = llm.completar_json("extrator_preco", "Extraia o preço à vista em reais do anúncio. JSON: {\"preco\": número}",
                           f"Título: {anuncio['titulo']}\nTexto: {anuncio['preco_texto']}")
    if r and isinstance(r.get("preco"), (int, float)) and regex and abs(r["preco"] - regex) < 0.01:
        return float(r["preco"])
    return regex


def _confianca(lojas: int, dispersao: float) -> str:
    if lojas >= 3 and dispersao <= 0.25:
        return "alta"
    if lojas >= 2 and dispersao <= 0.50:
        return "media"
    return "baixa"


def _buscar(store: Store, comp: Componente) -> list[dict]:
    """Provedor seed: os anúncios fictícios coletados "hoje". Um provedor web entraria aqui."""
    lojas = {l.strip() for l in get_settings().lojas.split(",")}
    return [a for a in store.anuncios if a["componente_id"] == comp.id and a["loja"] in lojas]


def calcular(comp: Componente, anuncios: list[dict]) -> ResultadoPreco:
    r = ResultadoPreco(componente_id=comp.id)
    candidatas: list[Oferta] = []
    for a in anuncios:
        if not a.get("url"):
            r.descartes.append(Descarte(loja=a["loja"], titulo=a["titulo"], motivo="sem fonte (URL)"))
            continue
        ok, motivo = mesmo_produto(comp, a["titulo"])
        if not ok:
            r.descartes.append(Descarte(loja=a["loja"], titulo=a["titulo"], motivo=motivo, url=a["url"]))
            continue
        preco = _extrair(a)
        if preco is None:
            r.descartes.append(Descarte(loja=a["loja"], titulo=a["titulo"], motivo="preço ilegível", url=a["url"]))
            continue
        candidatas.append(Oferta(loja=a["loja"], preco=preco, url=a["url"], titulo=a["titulo"], coletado_em=a["coletado_em"]))
    if not candidatas:
        return r
    mediana = statistics.median(o.preco for o in candidatas)
    for o in candidatas:
        if OUTLIER_MIN * mediana <= o.preco <= OUTLIER_MAX * mediana:
            r.ofertas.append(o)
        else:
            r.descartes.append(Descarte(loja=o.loja, titulo=o.titulo, motivo="outlier", url=o.url))
    precos = [o.preco for o in r.ofertas]
    r.preco_min, r.preco_max = min(precos), max(precos)
    r.preco_med = round(statistics.median(precos), 2)
    r.confianca = _confianca(len({o.loja for o in r.ofertas}), (r.preco_max - r.preco_min) / r.preco_med)
    r.coletado_em = max(o.coletado_em for o in r.ofertas)
    return r


def pesquisar(store: Store, componente_id: str, agora: datetime | None = None) -> ResultadoPreco:
    agora = agora or datetime.now(timezone.utc)
    comp = store.get(componente_id)
    if comp is None:
        return ResultadoPreco(componente_id=componente_id)
    cache = store.cache_precos.get(componente_id)
    validade = timedelta(days=get_settings().preco_cache_dias)
    if cache and agora - cache["em"] < validade:
        return cache["resultado"].model_copy(update={"do_cache": True})
    with span("pesquisa_preco", input={"componente": comp.nome}):
        r = calcular(comp, _buscar(store, comp))
    if not r.tem_preco and cache:   # busca falhou: cache vencido serve de reserva, rotulado
        return cache["resultado"].model_copy(update={"do_cache": True, "vencido": True})
    if r.tem_preco:
        store.cache_precos[componente_id] = {"em": agora, "resultado": r}
        novos = [{"componente_id": comp.id, "loja": o.loja, "preco": o.preco, "url": o.url, "coletado_em": o.coletado_em}
                 for o in r.ofertas]
        store.historico_precos.extend(novos)
        store.espelhar("ofertas", novos)
    return r


def preco_ref(store: Store, componente_id: str) -> float | None:
    """Preço mediano usado pelo agente e pelo resultado (None = sem preço com fonte)."""
    return pesquisar(store, componente_id).preco_med


def historico(store: Store, componente_id: str) -> list[dict]:
    return sorted((h for h in store.historico_precos if h["componente_id"] == componente_id), key=lambda h: h["coletado_em"])
