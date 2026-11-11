"""Pesquisa de preço, mesmo pipeline do OrçaAI: cache 7 dias -> busca por loja -> extração (LLM ou regex)
-> checagem rigorosa de "mesmo produto" -> remoção de outliers -> faixa mín/méd/máx -> histórico.

Regra de ouro: oferta sem URL de origem é descartada; nenhum preço sai sem fonte.
Provedores (BUSCA_PROVIDER): `seed` (anúncios fictícios) ou `serper` (Google Shopping, preço real).
"""

from __future__ import annotations

import json
import logging
import re
import statistics
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import BaseModel, Field

from .config import get_settings
from .modelos import Componente
from .store import Store
from .tracing import span

logger = logging.getLogger(__name__)
OUTLIER_MIN, OUTLIER_MAX = 0.4, 2.5   # fora de 40%..250% da mediana (mesmo corte do OrçaAI)
# Sufixos que mudam o produto: "4060" e "4060 Ti" são placas diferentes.
VARIANTES = {"ti", "super", "xt", "xtx", "x3d", "x", "f", "kf", "k", "pro", "max", "plus", "se", "g2", "ii", "iii", "iv"}
GENERICAS = {"geforce", "radeon"}   # títulos de loja costumam omitir
MIN_PALAVRAS = 0.6                  # fração das palavras do modelo no título ("Kyber 750W" não é "Core Reactor II 750W")
USADO = re.compile(r"\b(usad[oa]|recondicionad[oa]|seminov[oa]|open box)\b", re.I)
# "Kit Upgrade Ryzen 5 7600 + Placa Mãe" traz o modelo inteiro; "kit" sozinho não serve (memória vem em "Kit 2x16GB")
COMBO = re.compile(r"\bkit\s+(upgrade|gamer)\b|\bcombo\b|\s\+\s|\bpc\s+(gamer|home|para)\b|\bcomputador\b|\bdesktop\b|\bnotebook\b",
                   re.I)
SERPER_URL = "https://google.serper.dev/shopping"
SERPER_SIMULTANEAS = 4      # acima disso o Serper devolve 429 (medido no OrçaAI)
CACHE_DISCO = Path(__file__).resolve().parent.parent / ".cache" / "precos.json"
_trava_disco = threading.Lock()


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
    t = re.sub(r"\d+\s*gb/s", " ", t)                            # "SATA 6gb/s" é interface, não capacidade
    t = re.sub(r"80\s*plus", "80plus", t)                         # selo da fonte, não a variante "plus"
    t = re.sub(r"\bd([45])\b", r"ddr\1", t)                       # "B760-Plus WiFi D5" = "DDR5"
    t = re.sub(r"(\d)\s+(gb|tb|w|mhz)\b", r"\1\2", t)         # "16 GB" -> "16gb"
    t = re.sub(r"(\d+)g\b", r"\1gb", t)                           # "16G" -> "16gb"
    t = re.sub(r"(\d+x\d+)gb\b", r"\1", t)                       # "2x16GB" -> "2x16"
    t = re.sub(r"(\d+)mhz\b", r"\1", t)                           # "6000MHz" -> "6000"
    t = re.sub(r"(\d{3,})(x3d|xt|ti|kf|f|x)\b", r"\1 \2", t)  # "7800X3D" -> "7800 x3d"; "Ventus 2x" fica
    return re.findall(r"[a-z0-9.]+", t)


def mesmo_produto(comp: Componente, titulo: str, exigir_medidas: bool = True) -> tuple[bool, str | None]:
    """Checagem determinística: todo número do modelo precisa aparecer, nenhum sufixo de variante pode
    sobrar ou faltar, e capacidades/potências (8gb, 1tb, 750w) precisam bater.
    exigir_medidas=False (importação): título sem nenhuma medida pode omitir as do modelo."""
    alvo, visto = _tokens(comp.modelo), _tokens(titulo)
    cap = lambda ts: {t for t in ts if re.fullmatch(r"\d+(gb|tb|w)|\d+x\d+", t)}
    visto += [t[:-1] for t in visto if re.fullmatch(r"\d+w", t)]   # "GX 1000W" também tem o "1000" de "GX-1000"
    # revisão que os títulos costumam omitir ("(2024)", "ATX 3.0", "PCIE5", "(2x16)"); se aparecer diferente, as
    # outras regras pegam
    opcional = lambda tk: re.fullmatch(r"20\d\d|\d\.\d|pcie\d", tk) or (re.fullmatch(r"\d+x\d+", tk)
                                                                          and not any(re.fullmatch(r"\d+x\d+", v) for v in visto))
    numeros = {t for t in alvo if re.search(r"\d", t) and not opcional(t)}
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
    sobra = cap(visto) - cap(alvo) - {f"{n}w" for n in numeros}   # "GX-1000" já diz 1000w
    if sobra:
        return False, f"capacidade/potência diferente ({', '.join(sorted(sobra))})"
    palavras = {t for t in alvo if t.isalpha() and len(t) > 1} - VARIANTES - GENERICAS
    if palavras and len(palavras & set(visto)) / len(palavras) < MIN_PALAVRAS:
        return False, f"linha diferente (falta {', '.join(sorted(palavras - set(visto)))})"
    return True, None


def _extrair(anuncio: dict) -> float | None:
    """Extração de preço do texto do anúncio."""
    # ponytail: sem LLM aqui. O valor do LLM só valia se batesse com o regex, então a chamada nunca mudava o
    # resultado e custava uma requisição por oferta. Volta quando o conector real trouxer a página inteira.
    return parse_brl(anuncio["preco_texto"])


def _confianca(lojas: int, dispersao: float) -> str:
    if lojas >= 3 and dispersao <= 0.25:
        return "alta"
    if lojas >= 2 and dispersao <= 0.50:
        return "media"
    return "baixa"


def _lojas() -> list[str]:
    return [l.strip() for l in get_settings().lojas.split(",") if l.strip()]


def _loja(fonte: str) -> str | None:
    """"KaBuM!", "mercadolivre.com.br", "Amazon.com.br - Seller" -> nome da loja em LOJAS (None = fora da lista)."""
    norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    return next((l for l in _lojas() if norm(l) in norm(fonte)), None)


def _buscar_serper(comp: Componente) -> list[dict] | None:
    """Google Shopping via serper.dev: preço, loja e link estruturados, sem LLM. Falha = None."""
    corpo = json.dumps({"q": comp.nome, "gl": "br", "hl": "pt-br", "num": 20}).encode()
    req = urllib.request.Request(SERPER_URL, corpo, {"X-API-KEY": get_settings().serper_api_key,
                                                     "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            dados = json.load(r)
    except Exception as exc:
        logger.warning("Serper falhou para %s: %s", comp.id, exc)
        return None
    agora = datetime.now(timezone.utc).isoformat(timespec="seconds")
    anuncios = []
    for a in dados.get("shopping", []):
        titulo = str(a.get("title") or "")
        if loja := _loja(str(a.get("source") or "")):
            anuncios.append({"componente_id": comp.id, "loja": loja, "titulo": titulo, "preco_texto": str(a.get("price") or ""),
                             # sem link no anúncio: a busca do Shopping pelo título é a fonte conferível
                             "url": a.get("link") or f"https://www.google.com/search?tbm=shop&q={quote_plus(titulo)}",
                             "coletado_em": agora})
    return anuncios


def _buscar(store: Store, comp: Componente) -> list[dict] | None:
    if get_settings().preco_real:
        return _buscar_serper(comp)
    lojas = set(_lojas())
    return [a for a in store.anuncios if a["componente_id"] == comp.id and a["loja"] in lojas]


def calcular(comp: Componente, anuncios: list[dict]) -> ResultadoPreco:
    r = ResultadoPreco(componente_id=comp.id)
    candidatas: list[Oferta] = []
    for a in anuncios:
        if not a.get("url"):
            r.descartes.append(Descarte(loja=a["loja"], titulo=a["titulo"], motivo="sem fonte (URL)"))
            continue
        if USADO.search(a["titulo"]):
            ok, motivo = False, "usado/recondicionado"
        elif COMBO.search(a["titulo"]):
            ok, motivo = False, "kit/combo com outras peças"
        else:
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
        anuncios = _buscar(store, comp)
        r = calcular(comp, anuncios or [])
    if not r.tem_preco and cache:   # busca falhou: cache vencido serve de reserva, rotulado
        return cache["resultado"].model_copy(update={"do_cache": True, "vencido": True})
    if anuncios is not None and get_settings().preco_real:   # guarda o bruto: regra nova recalcula sem gastar crédito
        store.anuncios = [a for a in store.anuncios if a["componente_id"] != comp.id] + anuncios
    # preço real: busca que respondeu sem oferta válida também fica no cache (senão cada consulta gasta crédito)
    if r.tem_preco or (anuncios is not None and get_settings().preco_real):
        store.cache_precos[componente_id] = {"em": agora, "resultado": r}
        novos = [{"componente_id": comp.id, "loja": o.loja, "preco": o.preco, "url": o.url, "coletado_em": o.coletado_em}
                 for o in r.ofertas]
        store.historico_precos.extend(novos)
        store.espelhar("ofertas", novos)
    if get_settings().preco_real and componente_id in store.cache_precos:
        _salvar_disco(store)
    return r


# --- preço real: cache em disco (reiniciar não gasta crédito) e pré-busca em paralelo

def _salvar_disco(store: Store) -> None:
    with _trava_disco:
        CACHE_DISCO.parent.mkdir(exist_ok=True)
        buscado_em = {cid: c["em"].isoformat() for cid, c in store.cache_precos.items()}
        CACHE_DISCO.write_text(json.dumps({"buscado_em": buscado_em, "anuncios": store.anuncios,
                                           "historico": store.historico_precos}, ensure_ascii=False))


def carregar_disco(store: Store) -> None:
    """Com provedor real, saem os anúncios e o histórico fictícios do seed e entra o que já foi coletado de verdade.
    O preço é recalculado dos anúncios brutos, então regra nova de "mesmo produto" vale sem nova busca."""
    store.anuncios, store.historico_precos, store.cache_precos = [], [], {}
    if not CACHE_DISCO.exists():
        return
    d = json.loads(CACHE_DISCO.read_text())
    store.anuncios, store.historico_precos = d["anuncios"], d["historico"]
    for cid, em in d["buscado_em"].items():
        if comp := store.get(cid):
            store.cache_precos[cid] = {"em": datetime.fromisoformat(em),
                                       "resultado": calcular(comp, [a for a in store.anuncios if a["componente_id"] == cid])}


def aquecer(store: Store) -> None:
    """Pesquisa o catálogo todo em paralelo (o agente e o catálogo precisam de quase todos os preços)."""
    with ThreadPoolExecutor(SERPER_SIMULTANEAS) as ex:
        list(ex.map(lambda cid: pesquisar(store, cid), list(store.componentes)))
    logger.info("Preços prontos: %d de %d peças com preço", sum(c["resultado"].tem_preco for c in store.cache_precos.values()),
                len(store.componentes))


def preco_ref(store: Store, componente_id: str) -> float | None:
    """Preço mediano usado pelo agente e pelo resultado (None = sem preço com fonte)."""
    return pesquisar(store, componente_id).preco_med


def historico(store: Store, componente_id: str) -> list[dict]:
    return sorted((h for h in store.historico_precos if h["componente_id"] == componente_id), key=lambda h: h["coletado_em"])
