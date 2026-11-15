"""Pesquisa de preço, mesmo pipeline do OrçaAI: cache 7 dias -> busca por loja -> extração (LLM ou regex)
-> checagem rigorosa de "mesmo produto" -> remoção de outliers -> faixa mín/méd/máx -> histórico.

Regra de ouro: oferta sem URL de origem é descartada; nenhum preço sai sem fonte.
Provedores (BUSCA_PROVIDER): `seed` (anúncios fictícios) ou `serper` (Google Shopping, preço real).
"""

from __future__ import annotations

import json
import logging
import math
import re
import statistics
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import quote_plus, urlparse

from pydantic import BaseModel, Field

from .config import get_settings
from .modelos import Componente
from .store import Store
from .tracing import span

logger = logging.getLogger(__name__)
MIN_AMOSTRAS_OUTLIER = 3
OUTLIER_FATOR_MIN = 1.75
OUTLIER_FATOR_MAX = 2.2
MAD_Z_OUTLIER = 4.5 * 1.4826        # ~4.5 sigma em escala log para detectar fraude quando há consenso estreito
# Sufixos que mudam o produto: "4060" e "4060 Ti" são placas diferentes.
VARIANTES = {"ti", "super", "xt", "xtx", "x3d", "f", "kf", "k", "pro", "max", "plus", "se", "g2", "ii", "iii", "iv", "ax", "ax6"}
GENERICAS = {"geforce", "radeon"}   # títulos de loja costumam omitir
MIN_PALAVRAS = 0.6                  # fração das palavras do modelo no título ("Kyber 750W" não é "Core Reactor II 750W")
MIN_LOJAS_FALLBACK = 2
MIN_OFERTAS_FALLBACK = 3
USADO = re.compile(r"\b(usad[oa]|recondicionad[oa]|seminov[oa]|open box)\b", re.I)
# "Kit Upgrade Ryzen 5 7600 + Placa Mãe" traz o modelo inteiro; "kit" sozinho não serve (memória vem em "Kit 2x16GB")
COMBO = re.compile(
    r"\bkit\s+(?:upgrade|gamer|amd|intel|processador)\b"
    r"|\bcombo\b"
    r"|\s\+\s(?!(?:nf(?:-?e)?|nota|esp[aá]tula|aplicador|garantia)\b)"
    r"|\bpc\s+(?:gamer|home|para|office|completo)\b"
    r"|\bgaming\s+pc\b"
    r"|\bcomputador\b"
    r"|\bnotebook\s+gamer\b"
    r"|\bpara\s+notebook\b",
    re.I,
)
_MARCAS_GENERICAS = {"diversos"}
_SUFIXOS_QUERY = re.compile(r"\(\s*(?:20\d\d|\d+x\d+)\s*\)|\b(?:pcie\s*\d+|atx\s*3\.\d|sfx|nvme|sata)\b", re.I)
SERPER_URL = "https://google.serper.dev/shopping"
SERPER_ORGANIC_URL = "https://google.serper.dev/search"
LOJAS_DOMINIOS: dict[str, str] = {
    "Kabum": "kabum.com.br",
    "Pichau": "pichau.com.br",
    "Terabyte": "terabyteshop.com.br",
    "Mercado Livre": "mercadolivre.com.br",
    "Amazon": "amazon.com.br",
}
SERPER_SIMULTANEAS = 4      # acima disso o Serper devolve 429 (medido no OrçaAI)
TTL_POR_TIPO_DIAS: dict[str, int] = {
    "gpu": 3,
    "cpu": 3,
    "memoria": 3,
    "armazenamento": 3,
    "placa_mae": 7,
    "fonte": 7,
    "cooler": 7,
    "extra": 14,
    "gabinete": 20,
}
CACHE_DISCO = Path(__file__).resolve().parent.parent / ".cache" / "precos.json"
_trava_disco = threading.Lock()
_trava_renovacao = threading.Lock()
_trava_cota = threading.Lock()
_renovando: set[str] = set()


class Oferta(BaseModel):
    loja: str
    preco: float
    url: str
    titulo: str
    coletado_em: str
    condicao_pagamento: Literal["a_vista", "parcelado", "desconhecida"] = "desconhecida"


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
    qtd_lojas: int = 0
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
    t = re.sub(r"\d+\s*gb/s", " ", t)                                  # "SATA 6gb/s" é interface, não capacidade
    t = re.sub(r"80\s*plus", "80plus", t)                               # selo da fonte, não a variante "plus"
    t = re.sub(r"\bmax\s+(turbo|boost)\b", r"max\1", t)                 # "Max Turbo" é clock, não a variante "max"
    t = re.sub(r"\bventoinhas?\b|\bfans\b", "fan", t)
    t = re.sub(r"\bd([45])\b", r"ddr\1", t)                             # "B760-Plus WiFi D5" = "DDR5"
    t = re.sub(r"\b(rtx|gtx|rx)(\d{3,4})\b", r"\1 \2", t)               # "Rtx4060" -> "rtx 4060"
    t = re.sub(r"\b(\d+)\s*x\s*(\d+)\s*gb\b", r"\1x\2", t)              # "2 x 16 GB" -> "2x16"
    t = re.sub(r"\b(\d+)x(\d+mm)\b", r"\1 \2", t)                       # "3x120mm" -> "3 120mm"
    t = re.sub(r"(\d)\s+(gb|tb|w|mhz)\b", r"\1\2", t)                   # "16 GB" -> "16gb"
    t = re.sub(r"(?<![/\da-z])(\d+)g\b", r"\1gb", t)                  # "16G" -> "16gb"; preserva SKU ".../1000g"
    t = re.sub(r"(\d+x\d+)gb\b", r"\1", t)                             # "2x16GB" -> "2x16"
    t = re.sub(r"(\d+)mhz\b", r"\1", t)                                 # "6000MHz" -> "6000"
    t = re.sub(r"(\d{3,})\s+x\b", r"\1x", t)                            # "7600 X" -> "7600x"
    t = re.sub(r"(\d{3,})(x3d|xt|ti|kf|f)\b", r"\1 \2", t)              # "7800X3D" -> "7800 x3d"; mantém "7600x"
    return re.findall(r"[a-z0-9.]+", t)


def _capacidades(tokens: list[str], tipo: str) -> set[str]:
    """Extrai capacidades comparáveis conforme categoria (evita confundir TDP ou PCIe 4x4)."""
    padrao = r"\d+(?:gb|tb)"
    if tipo == "fonte":
        padrao += r"|\d+w"
    elif tipo == "memoria":
        padrao += r"|\d+x\d+"
    return {t for t in tokens if re.fullmatch(padrao, t)}


def _eh_token_opcional(tk: str, tem_kit_visto: bool) -> bool:
    """Revisões que títulos costumam omitir ('2024', '3.0', 'pcie5', '2x16')."""
    if re.fullmatch(r"20\d\d|\d\.\d|pcie\d", tk):
        return True
    return bool(re.fullmatch(r"\d+x\d+", tk) and not tem_kit_visto)


def mesmo_produto(comp: Componente, titulo: str, exigir_medidas: bool = True) -> tuple[bool, str | None]:
    """Checagem determinística: todo número do modelo precisa aparecer, nenhum sufixo de variante pode
    sobrar ou faltar, e capacidades/potências (8gb, 1tb, 750w) precisam bater.
    exigir_medidas=False (importação): título sem nenhuma medida pode omitir as do modelo."""
    alvo, visto = _tokens(comp.modelo), _tokens(titulo)
    visto += [t[:-1] for t in visto if comp.tipo == "fonte" and re.fullmatch(r"\d+w", t)]
    tem_kit_visto = any(re.fullmatch(r"\d+x\d+", v) for v in visto)
    numeros = {t for t in alvo if re.search(r"\d", t) and not _eh_token_opcional(t, tem_kit_visto)}
    cap_alvo = _capacidades(alvo, comp.tipo)
    cap_visto = _capacidades(visto, comp.tipo)
    if not exigir_medidas and not cap_visto:
        numeros -= cap_alvo
        if not numeros:
            return False, "sem número de modelo para conferir"
    if faltam := numeros - set(visto):
        return False, f"modelo diferente (falta {', '.join(sorted(faltam))})"
    var_alvo, var_visto = set(alvo) & VARIANTES, set(visto) & VARIANTES
    if var_alvo != var_visto:
        dif = sorted(var_alvo ^ var_visto)
        return False, f"variante diferente ({', '.join(dif)})"
    sobra = cap_visto - cap_alvo - ({f"{n}w" for n in numeros} if comp.tipo == "fonte" else set())
    if sobra:
        return False, f"capacidade/potência diferente ({', '.join(sorted(sobra))})"
    palavras = {t for t in alvo if t.isalpha() and len(t) > 1} - VARIANTES - GENERICAS
    if palavras and len(palavras & set(visto)) / len(palavras) < MIN_PALAVRAS:
        return False, f"linha diferente (falta {', '.join(sorted(palavras - set(visto)))})"
    return True, None


_PARCELADO_RE = re.compile(r"\b\d+x\b|\bparcel|\bem até\b|\bsem juros\b", re.I)
_A_VISTA_RE = re.compile(r"\b[àa]\s+vista\b|\bpix\b|\bboleto\b", re.I)


def _detectar_condicao_pagamento(anuncio: dict) -> Literal["a_vista", "parcelado", "desconhecida"]:
    texto = f"{anuncio.get('preco_texto', '')} {anuncio.get('titulo', '')}"
    if _PARCELADO_RE.search(texto):
        return "parcelado"
    if _A_VISTA_RE.search(texto):
        return "a_vista"
    return "desconhecida"


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


def _familia_de(comp: Componente) -> str | None:
    """Deriva o nome da família para agrupar versões próximas em uma única busca."""
    if comp.tipo == "gpu":
        if m := re.search(r"\b(RTX|GTX|RX)\s*(\d{4})\b", comp.modelo, re.I):
            return f"{m.group(1).upper()} {m.group(2)}"
        if m := re.search(r"\bArc\s*([AB]\d{3})\b", comp.modelo, re.I):
            return f"Arc {m.group(1).upper()}"
    elif comp.tipo == "cpu":
        if m := re.search(r"\bRyzen\s+([3579])\s+(\d{4})", comp.modelo, re.I):
            return f"Ryzen {m.group(1)} {m.group(2)}"
        if m := re.search(r"\bCore\s+(i[3579]-\d{4,5})", comp.modelo, re.I):
            return f"Core {m.group(1).lower()}"
    return None


def _query_principal(comp: Componente) -> str:
    if comp.marca.strip().lower() in _MARCAS_GENERICAS:
        return comp.modelo
    return comp.nome


def _query_curta(comp: Componente) -> str:
    curta = _SUFIXOS_QUERY.sub(" ", _query_principal(comp))
    return re.sub(r"\s+", " ", curta).strip()


def _hoje_iso(agora: datetime | None = None) -> str:
    return (agora or datetime.now(timezone.utc)).date().isoformat()


def status_consumo(store: Store, agora: datetime | None = None) -> dict:
    hoje = _hoje_iso(agora)
    limite = get_settings().serper_limite_diario
    with _trava_cota:
        usados = store.consumo_serper.get(hoje, 0)
    return {"data": hoje, "usados": usados, "limite": limite, "restantes": max(0, limite - usados)}


def _cota_disponivel(store: Store) -> bool:
    hoje = _hoje_iso()
    limite = get_settings().serper_limite_diario
    with _trava_cota:
        return store.consumo_serper.get(hoje, 0) < limite


def _registrar_consumo(store: Store) -> None:
    hoje = _hoje_iso()
    with _trava_cota:
        total = store.consumo_serper.get(hoje, 0) + 1
        store.consumo_serper[hoje] = total
    store.espelhar("consumo_serper", [{"data": hoje, "creditos": total}])
    _salvar_disco(store)


def _postar_serper(url: str, payload: dict, contexto: str, store: Store | None = None) -> dict | None:
    if store is not None and not _cota_disponivel(store):
        logger.warning("Limite diário da Serper atingido ao consultar %s", contexto)
        return None
    corpo = json.dumps(payload).encode()
    req = urllib.request.Request(url, corpo, {"X-API-KEY": get_settings().serper_api_key,
                                              "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            dados = json.load(r)
        if store is not None:
            _registrar_consumo(store)
        return dados
    except Exception as exc:
        logger.warning("Serper falhou para %s: %s", contexto, exc)
        return None


def _consultar_shopping_serper(store: Store, comp: Componente, query: str, num: int = 20) -> list[dict] | None:
    """Google Shopping via serper.dev: preço, loja e link estruturados, sem LLM. Falha = None."""
    dados = _postar_serper(SERPER_URL, {"q": query, "gl": "br", "hl": "pt-br", "num": num}, comp.id, store=store)
    if dados is None:
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


def _poucas_ofertas(r: ResultadoPreco) -> bool:
    return len(r.ofertas) < MIN_OFERTAS_FALLBACK or len({o.loja for o in r.ofertas}) < MIN_LOJAS_FALLBACK


def _buscar_serper(store: Store, comp: Componente) -> list[dict] | None:
    familia = _familia_de(comp)
    irmaos = [c for c in store.por_tipo(comp.tipo) if _familia_de(c) == familia] if familia else []
    usar_familia = familia is not None and len(irmaos) >= 2
    q1 = familia if usar_familia else _query_principal(comp)
    anuncios = _consultar_shopping_serper(store, comp, q1, num=40 if usar_familia else 20)
    if anuncios is None:
        return None
    q2 = _query_curta(comp)
    if q2 != q1 and _poucas_ofertas(calcular(comp, anuncios)):
        extras = _consultar_shopping_serper(store, comp, q2)
        if extras:
            vistos = {(a["loja"], a["titulo"], a["url"]) for a in anuncios}
            anuncios.extend(a for a in extras if (a["loja"], a["titulo"], a["url"]) not in vistos)
    return anuncios


def _buscar(store: Store, comp: Componente) -> list[dict] | None:
    if get_settings().preco_real:
        return _buscar_serper(store, comp)
    lojas = set(_lojas())
    return [a for a in store.anuncios if a["componente_id"] == comp.id and a["loja"] in lojas]


def _filtrar_outliers(candidatas: list[Oferta]) -> tuple[list[Oferta], list[Descarte]]:
    """Remove outliers em escala log simétrica com MAD para n >= 3; com n <= 2 nunca descarta a mais barata."""
    if len(candidatas) < MIN_AMOSTRAS_OUTLIER:
        return list(candidatas), []
    logs = [math.log(o.preco) for o in candidatas]
    log_med = statistics.median(logs)
    mad = statistics.median(abs(x - log_med) for x in logs)
    limite = min(math.log(OUTLIER_FATOR_MAX), max(math.log(OUTLIER_FATOR_MIN), MAD_Z_OUTLIER * mad))
    validas, descartes = [], []
    for oferta, lp in zip(candidatas, logs):
        if abs(lp - log_med) <= limite:
            validas.append(oferta)
        else:
            descartes.append(Descarte(loja=oferta.loja, titulo=oferta.titulo, motivo="outlier", url=oferta.url))
    if not validas:
        return list(candidatas), []
    return validas, descartes


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
        if preco is None or preco <= 0:
            r.descartes.append(Descarte(loja=a["loja"], titulo=a["titulo"], motivo="preço ilegível", url=a["url"]))
            continue
        candidatas.append(Oferta(
            loja=a["loja"], preco=preco, url=a["url"], titulo=a["titulo"],
            coletado_em=a["coletado_em"], condicao_pagamento=_detectar_condicao_pagamento(a),
        ))
    if not candidatas:
        return r
    validas, descartes_outlier = _filtrar_outliers(candidatas)
    r.ofertas.extend(validas)
    r.descartes.extend(descartes_outlier)
    precos = [o.preco for o in r.ofertas]
    r.preco_min, r.preco_max = min(precos), max(precos)
    r.preco_med = round(statistics.median(precos), 2)
    r.qtd_lojas = len({o.loja for o in r.ofertas})
    r.confianca = _confianca(r.qtd_lojas, (r.preco_max - r.preco_min) / r.preco_med)
    r.coletado_em = max(o.coletado_em for o in r.ofertas)
    return r


def _validade_para(comp: Componente) -> timedelta:
    dias = TTL_POR_TIPO_DIAS.get(comp.tipo, get_settings().preco_cache_dias)
    return timedelta(days=dias)


def _registrar_resultado(store: Store, comp: Componente, r: ResultadoPreco, anuncios: list[dict] | None, agora: datetime) -> None:
    if anuncios is not None and get_settings().preco_real:   # guarda o bruto: regra nova recalcula sem gastar crédito
        store.anuncios = [a for a in store.anuncios if a["componente_id"] != comp.id] + anuncios
    if r.tem_preco or (anuncios is not None and get_settings().preco_real):
        store.cache_precos[comp.id] = {"em": agora, "resultado": r}
        novos = [{"componente_id": comp.id, "loja": o.loja, "preco": o.preco, "url": o.url, "coletado_em": o.coletado_em}
                 for o in r.ofertas]
        store.historico_precos.extend(novos)
        store.espelhar("ofertas", novos)
        store.espelhar("cache_anuncios", [{
            "componente_id": comp.id,
            "familia": _familia_de(comp),
            "anuncios": anuncios or [],
            "buscado_em": agora.isoformat(),
        }])


def _distribuir_para_familia(store: Store, comp: Componente, anuncios: list[dict], agora: datetime) -> None:
    familia = _familia_de(comp)
    if not familia:
        return
    for irmao in store.por_tipo(comp.tipo):
        if irmao.id == comp.id or _familia_de(irmao) != familia:
            continue
        anuncios_irmao = [{**a, "componente_id": irmao.id} for a in anuncios]
        r_irmao = calcular(irmao, anuncios_irmao)
        if r_irmao.tem_preco:
            _registrar_resultado(store, irmao, r_irmao, anuncios_irmao, agora)


def _executar_busca_e_salvar(store: Store, comp: Componente, agora: datetime, cache: dict | None = None) -> ResultadoPreco:
    with span("pesquisa_preco", input={"componente": comp.nome}):
        anuncios = _buscar(store, comp)
        r = calcular(comp, anuncios or [])
    if not r.tem_preco and cache:   # busca falhou: cache vencido serve de reserva, rotulado
        return cache["resultado"].model_copy(update={"do_cache": True, "vencido": True})
    _registrar_resultado(store, comp, r, anuncios, agora)
    if anuncios and get_settings().preco_real:
        _distribuir_para_familia(store, comp, anuncios, agora)
    if get_settings().preco_real and comp.id in store.cache_precos:
        _salvar_disco(store)
    return r


def _agendar_renovacao(store: Store, comp: Componente) -> None:
    with _trava_renovacao:
        if comp.id in _renovando:
            return
        _renovando.add(comp.id)

    def _rodar() -> None:
        try:
            _executar_busca_e_salvar(store, comp, datetime.now(timezone.utc), store.cache_precos.get(comp.id))
        finally:
            with _trava_renovacao:
                _renovando.discard(comp.id)

    threading.Thread(target=_rodar, daemon=True).start()


def pesquisar(store: Store, componente_id: str, agora: datetime | None = None, permitir_busca: bool = True) -> ResultadoPreco:
    agora = agora or datetime.now(timezone.utc)
    comp = store.get(componente_id)
    if comp is None:
        return ResultadoPreco(componente_id=componente_id)
    cache = store.cache_precos.get(componente_id)
    validade = _validade_para(comp)
    if cache and agora - cache["em"] < validade:
        return cache["resultado"].model_copy(update={"do_cache": True})
    if not permitir_busca and get_settings().preco_real:
        if cache:
            return cache["resultado"].model_copy(update={"do_cache": True, "vencido": True})
        return ResultadoPreco(componente_id=componente_id)
    if cache and get_settings().preco_real:
        _agendar_renovacao(store, comp)
        return cache["resultado"].model_copy(update={"do_cache": True, "vencido": True})
    return _executar_busca_e_salvar(store, comp, agora, cache)


# --- preço real: cache em disco (reiniciar não gasta crédito) e pré-busca em paralelo

def _url_da_loja(url: str, dominio: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme in ("http", "https") and (host == dominio or host.endswith(f".{dominio}"))


def _escolher_link_organico(organic: list[dict], dominio: str) -> str | None:
    validos = [str(item.get("link") or "") for item in organic if _url_da_loja(str(item.get("link") or ""), dominio)]
    produtos = [u for u in validos if not urlparse(u).path.startswith("/busca")]
    return produtos[0] if produtos else (validos[0] if validos else None)


def resolver_link_loja(store: Store, loja: str, titulo: str, fallback_url: str) -> str:
    """Resolve link direto da loja via busca orgânica no clique final e cacheia; cai no fallback se falhar."""
    dominio = LOJAS_DOMINIOS.get(loja)
    if not dominio or _url_da_loja(fallback_url, dominio):
        return fallback_url
    chave = f"{loja}|{titulo}"
    if cached := store.links_resolvidos.get(chave):
        return cached
    if not get_settings().preco_real:
        return fallback_url
    dados = _postar_serper(
        SERPER_ORGANIC_URL,
        {"q": f"site:{dominio} {titulo}", "gl": "br", "hl": "pt-br", "num": 5},
        f"link:{loja}",
        store=store,
    )
    if dados is None:
        return fallback_url
    resolvido = _escolher_link_organico(dados.get("organic", []), dominio)
    if not resolvido:
        return fallback_url
    store.links_resolvidos[chave] = resolvido
    store.espelhar("links_resolvidos", [{"chave": chave, "url": resolvido, "atualizado_em": datetime.now(timezone.utc).isoformat()}])
    _salvar_disco(store)
    return resolvido


def _salvar_disco(store: Store) -> None:
    with _trava_disco:
        CACHE_DISCO.parent.mkdir(exist_ok=True)
        buscado_em = {cid: c["em"].isoformat() for cid, c in store.cache_precos.items()}
        CACHE_DISCO.write_text(json.dumps({
            "buscado_em": buscado_em,
            "anuncios": store.anuncios,
            "historico": store.historico_precos,
            "links_resolvidos": store.links_resolvidos,
            "consumo_serper": store.consumo_serper,
        }, ensure_ascii=False))


def _hidratar_supabase(store: Store) -> None:
    for row in store.ler_tabela("cache_anuncios"):
        cid = row.get("componente_id")
        comp = store.get(cid) if cid else None
        if not comp or not row.get("buscado_em"):
            continue
        em = datetime.fromisoformat(str(row["buscado_em"]))
        atual = store.cache_precos.get(cid)
        if atual and atual["em"] >= em:
            continue
        anuncios = row.get("anuncios") or []
        store.anuncios = [a for a in store.anuncios if a["componente_id"] != cid] + anuncios
        store.cache_precos[cid] = {"em": em, "resultado": calcular(comp, anuncios)}
    for row in store.ler_tabela("links_resolvidos"):
        if row.get("chave") and row.get("url"):
            store.links_resolvidos.setdefault(row["chave"], row["url"])
    for row in store.ler_tabela("consumo_serper"):
        if row.get("data") and row.get("creditos") is not None:
            data = str(row["data"])
            store.consumo_serper[data] = max(store.consumo_serper.get(data, 0), int(row["creditos"]))


def carregar_disco(store: Store) -> None:
    """Com provedor real, saem os anúncios e o histórico fictícios do seed e entra o que já foi coletado de verdade.
    O preço é recalculado dos anúncios brutos, então regra nova de "mesmo produto" vale sem nova busca."""
    store.anuncios, store.historico_precos, store.cache_precos, store.links_resolvidos, store.consumo_serper = [], [], {}, {}, {}
    if CACHE_DISCO.exists():
        d = json.loads(CACHE_DISCO.read_text())
        store.anuncios, store.historico_precos = d["anuncios"], d["historico"]
        store.links_resolvidos = d.get("links_resolvidos", {})
        store.consumo_serper = {str(k): int(v) for k, v in d.get("consumo_serper", {}).items()}
        for cid, em in d["buscado_em"].items():
            if comp := store.get(cid):
                store.cache_precos[cid] = {"em": datetime.fromisoformat(em),
                                           "resultado": calcular(comp, [a for a in store.anuncios if a["componente_id"] == cid])}
    _hidratar_supabase(store)


def aquecer(store: Store) -> None:
    """Pesquisa o catálogo todo em paralelo (o agente e o catálogo precisam de quase todos os preços)."""
    with ThreadPoolExecutor(SERPER_SIMULTANEAS) as ex:
        list(ex.map(lambda cid: pesquisar(store, cid), list(store.componentes)))
    logger.info("Preços prontos: %d de %d peças com preço", sum(c["resultado"].tem_preco for c in store.cache_precos.values()),
                len(store.componentes))


def consultar_cache(store: Store, componente_id: str, agora: datetime | None = None) -> ResultadoPreco:
    """Lê apenas do cache (ou seed offline) sem disparar chamadas à Serper."""
    return pesquisar(store, componente_id, agora=agora, permitir_busca=False)


def preco_ref(store: Store, componente_id: str, permitir_busca: bool = False) -> float | None:
    """Preço mediano usado pelo agente e pelo resultado (None = sem preço com fonte)."""
    return pesquisar(store, componente_id, permitir_busca=permitir_busca).preco_med


def historico(store: Store, componente_id: str) -> list[dict]:
    return sorted((h for h in store.historico_precos if h["componente_id"] == componente_id), key=lambda h: h["coletado_em"])
