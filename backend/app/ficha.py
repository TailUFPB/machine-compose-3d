"""Ficha do fabricante (caminho misto): busca (Serper) -> página do fabricante -> extração por LLM -> faixa plausível.

Só entram os campos geométricos de CAMPOS, que fichas costumam publicar; layout interno nunca é extraído.
Regra de ouro (a mesma do preço): valor sem URL de origem não é gravado. Valor fora da faixa é descartado e logado.
Sem SERPER_API_KEY ou sem LLM a extração não roda e o seed é usado como está.
ponytail: o que foi extraído vive na memória do processo (e no espelho do Supabase); reiniciar extrai de novo.
"""

from __future__ import annotations

import json
import logging
import re
import urllib.request
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, Field

from . import llm
from .config import get_settings
from .modelos import Componente
from .store import Store

logger = logging.getLogger(__name__)
SERPER_BUSCA_URL = "https://google.serper.dev/search"
MAX_TEXTO = 12000   # caracteres da página enviados ao LLM

# Faixa plausível por campo: ("int", mín, máx) | ("bool",) | ("um_de", valores) | ("lista", valores, máx itens)
# | ("mapa", chaves, mín, máx)
_FANS, _FAN_MM = ("int", 1, 4), ("int", 80, 140)
CAMPOS: dict[str, dict[str, tuple]] = {
    "gpu": {"fans": _FANS, "fan_mm": _FAN_MM, "backplate": ("bool",),
            "saidas": ("lista", {"DisplayPort", "HDMI", "DVI", "USB-C"}, 6)},
    "cooler": {"fans": _FANS, "fan_mm": _FAN_MM, "heatpipes": ("int", 1, 8), "radiador_posicao": ("um_de", {"frente", "topo"})},
    "placa_mae": {"portas_traseiras": ("lista", {"USB-A", "USB-C", "HDMI", "DisplayPort", "RJ45", "audio", "PS/2"}, 20),
                  "m2_dissipador": ("bool",)},
    "gabinete": {"posicoes_fan": ("mapa", {"frente", "topo", "traseira"}, 0, 4), "lateral": ("um_de", {"vidro", "chapa"}),
                 "baias": ("mapa", {"2.5", "3.5"}, 0, 8)},
    "armazenamento": {"formato": ("um_de", {"M.2", "2.5", "3.5"})},
}


class Descartado(BaseModel):
    campo: str
    valor: Any = None
    motivo: str


class ResultadoFicha(BaseModel):
    componente_id: str
    executou: bool = False
    motivo: str | None = None      # por que não executou
    url: str | None = None         # página do fabricante usada
    gravados: dict[str, Any] = Field(default_factory=dict)
    descartados: list[Descartado] = Field(default_factory=list)


def _inteiro(v: Any, lo: int, hi: int) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def invalido(tipo: str, campo: str, valor: Any) -> str | None:
    """Motivo do descarte, ou None se o valor é plausível para o campo."""
    regra = CAMPOS.get(tipo, {}).get(campo)
    if regra is None:
        return "campo fora da lista"
    forma = regra[0]
    if forma == "int":
        return None if _inteiro(valor, regra[1], regra[2]) else f"fora da faixa {regra[1]}–{regra[2]}"
    if forma == "bool":
        return None if isinstance(valor, bool) else "não é verdadeiro/falso"
    if forma == "um_de":
        return None if isinstance(valor, str) and valor in regra[1] else f"fora de {sorted(regra[1])}"
    if forma == "lista":
        ok = isinstance(valor, list) and 1 <= len(valor) <= regra[2] and all(isinstance(x, str) and x in regra[1] for x in valor)
        return None if ok else f"lista de até {regra[2]} entre {sorted(regra[1])}"
    ok = isinstance(valor, dict) and valor and set(valor) <= regra[1] and all(_inteiro(x, regra[2], regra[3]) for x in valor.values())
    return None if ok else f"mapa de {sorted(regra[1])} com valores {regra[2]}–{regra[3]}"


def gravar(comp: Componente, campos: dict[str, Any], url: str, agora: datetime | None = None) -> ResultadoFicha:
    """Valida cada campo extraído e grava em specs + specs_origem. Sem URL nada é gravado."""
    r = ResultadoFicha(componente_id=comp.id, executou=True, url=url or None)
    coletado_em = (agora or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    for campo, valor in campos.items():
        if valor is None:   # a página não informa: continua estimado
            continue
        motivo = "sem fonte (URL)" if not url else invalido(comp.tipo, campo, valor)
        if not motivo and campo == "radiador_posicao" and comp.specs.get("refrigeracao") != "aio":
            motivo = "só vale para water cooler"
        if motivo:
            logger.warning("Ficha de %s: %s=%r descartado (%s)", comp.id, campo, valor, motivo)
            r.descartados.append(Descartado(campo=campo, valor=valor, motivo=motivo))
            continue
        comp.specs[campo] = valor
        comp.specs_origem[campo] = {"url": url, "coletado_em": coletado_em}
        r.gravados[campo] = valor
    return r


def _so_alnum(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _buscar(comp: Componente) -> dict | None:
    """Primeiro resultado orgânico no domínio do fabricante ("Lian Li" -> lian-li.com). Falha ou nada = None."""
    corpo = json.dumps({"q": f"{comp.nome} especificações", "gl": "br", "hl": "pt-br"}).encode()
    req = urllib.request.Request(SERPER_BUSCA_URL, corpo, {"X-API-KEY": get_settings().serper_api_key,
                                                           "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            organicos = json.load(resp).get("organic", [])
    except Exception as exc:
        logger.warning("Serper (ficha) falhou para %s: %s", comp.id, exc)
        return None
    marca = _so_alnum(comp.marca)
    for o in organicos:
        url = urlparse(str(o.get("link") or ""))
        if url.scheme == "https" and marca in _so_alnum(url.hostname or ""):
            return o
    return None


def _texto_da_pagina(url: str) -> str | None:
    """Texto visível da página. Site de fabricante costuma bloquear robô ou montar a ficha por script: falha = None."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; ficha-tecnica)"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read(1_000_000).decode("utf-8", "ignore")
    except Exception as exc:
        logger.info("Página %s não abriu (%s): usando o trecho da busca", url, exc)
        return None
    html = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", html)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()[:MAX_TEXTO] or None


def _nao_rodou(comp_id: str, motivo: str) -> ResultadoFicha:
    return ResultadoFicha(componente_id=comp_id, motivo=motivo)


def extrair(store: Store, componente_id: str) -> ResultadoFicha:
    comp = store.get(componente_id)
    if comp is None or comp.tipo not in CAMPOS:
        return _nao_rodou(componente_id, "tipo de peça sem campos de ficha")
    if not get_settings().serper_api_key or not llm.ativo():
        return _nao_rodou(comp.id, "sem SERPER_API_KEY ou sem LLM: seed usado como está")
    achado = _buscar(comp)
    if achado is None:
        return _nao_rodou(comp.id, "página do fabricante não encontrada")
    url = achado["link"]
    texto = "\n".join(filter(None, [achado.get("title"), achado.get("snippet"), _texto_da_pagina(url)]))
    campos = sorted(CAMPOS[comp.tipo])
    resp = llm.completar_json(
        "ficha_fabricante",
        "Você lê a ficha técnica de uma peça de PC na página do fabricante e extrai SOMENTE os campos pedidos. "
        "Campo que o texto não informa fica de fora: nunca estime nem deduza. Não extraia layout interno (chips, VRM, trilhas). "
        f"Campos e formatos: {json.dumps({c: _formato(CAMPOS[comp.tipo][c]) for c in campos}, ensure_ascii=False)}. "
        'Formato: {"campos": {campo: valor}}',
        json.dumps({"peca": comp.nome, "tipo": comp.tipo, "pagina": texto}, ensure_ascii=False))
    if not isinstance(resp, dict) or not isinstance(resp.get("campos"), dict):
        return _nao_rodou(comp.id, "LLM não devolveu campos")
    r = gravar(comp, resp["campos"], url)
    if r.gravados:
        store.espelhar("componentes", [{"id": comp.id, "tipo": comp.tipo, "modelo": comp.modelo, "marca": comp.marca,
                                        "specs": comp.specs, "specs_origem": comp.specs_origem, "fonte": comp.fonte}])
    return r


def _formato(regra: tuple) -> str:
    forma = regra[0]
    if forma == "int":
        return f"inteiro de {regra[1]} a {regra[2]}"
    if forma == "bool":
        return "true ou false"
    if forma == "um_de":
        return " | ".join(sorted(regra[1]))
    if forma == "lista":
        return f"lista (uma entrada por porta física, repetindo) com valores entre {sorted(regra[1])}"
    return f"objeto com chaves {sorted(regra[1])} e inteiros de {regra[2]} a {regra[3]}"
