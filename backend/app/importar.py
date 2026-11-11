"""Importação: texto colado, carrinho de loja ou lista exportada do PCPartPicker vira itens do catálogo.

Cada linha é casada com o catálogo pela mesma checagem de "mesmo produto" da pesquisa de preço, então
"RTX 4060" nunca vira "RTX 4060 Ti". O resultado é uma proposta: só entra na build com o clique do usuário.
ponytail: link do PCPartPicker sem o texto não é baixado (exige rede/scraping); pedimos o texto exportado.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .modelos import BuildItem
from .precos import _tokens, mesmo_produto
from .store import Store

MIN_COBERTURA = 0.6   # fração das palavras do modelo que precisa estar na linha ("750W" sozinho não basta)
LINK_PCPP = re.compile(r"https?://(\w+\.)?pcpartpicker\.com/(list|user)/\S+", re.I)


class ResultadoImportacao(BaseModel):
    itens: list[BuildItem] = Field(default_factory=list)
    nao_reconhecidas: list[str] = Field(default_factory=list)
    avisos: list[str] = Field(default_factory=list)


def _quantidade(linha: str) -> tuple[int, str]:
    m = re.match(r"\s*(\d+)\s*[x×]\s+(.*)", linha) or re.match(r"(.*?)\s+(?:qtd|quantidade)[:\s]*(\d+)\s*$", linha, re.I)
    if not m:
        return 1, linha
    a, b = m.groups()
    return (int(a), b) if a.isdigit() else (int(b), a)


def importar(store: Store, texto: str, ja_tenho: bool = False) -> ResultadoImportacao:
    r = ResultadoImportacao()
    if LINK_PCPP.search(texto) and len(texto.strip().splitlines()) == 1:
        r.avisos.append("Link do PCPartPicker reconhecido. Para importar sem acessar a internet, cole o texto da lista "
                        "(botão 'Markdown' ou 'Text' na página da lista).")
        return r
    vistos: dict[str, BuildItem] = {}
    for bruta in texto.splitlines():
        linha = re.sub(r"\(\$[\d.,]+.*?\)|R\$\s*[\d.,]+", "", bruta).strip(" -*|\t")
        linha = re.sub(r"^\w[\w ]{0,20}:\s+", "", linha)   # "CPU: ..." / "Placa de vídeo: ..."
        if len(linha) < 3:
            continue
        qtd, linha = _quantidade(linha)
        candidatos = [c for c in store.componentes.values() if c.tipo != "extra" and mesmo_produto(c, linha)[0]]
        if not candidatos:   # sem capacidade no texto ("RTX 4070 Super"): aceita, mas avisa se ficou ambíguo
            candidatos = [c for c in store.componentes.values()
                          if c.tipo != "extra" and mesmo_produto(c, linha, exigir_medidas=False)[0]]
            if len(candidatos) > 1:
                r.avisos.append(f"'{linha}' tem {len(candidatos)} versões no catálogo; escolhida a primeira, confira a capacidade.")
        if not candidatos:
            r.nao_reconhecidas.append(bruta.strip())
            continue
        visto = set(_tokens(linha))
        cobertura = lambda c: len(set(_tokens(c.modelo)) & visto) / len(set(_tokens(c.modelo)))
        candidatos = [c for c in candidatos if cobertura(c) >= MIN_COBERTURA]
        if not candidatos:
            r.nao_reconhecidas.append(bruta.strip())
            continue
        melhor = max(candidatos, key=lambda c: (cobertura(c), len(_tokens(c.modelo))))   # o mais coberto e específico
        if melhor.id in vistos:
            vistos[melhor.id].quantidade += qtd
        else:
            vistos[melhor.id] = BuildItem(componente_id=melhor.id, quantidade=qtd, ja_tenho=ja_tenho, travado=ja_tenho)
    r.itens = list(vistos.values())
    return r
