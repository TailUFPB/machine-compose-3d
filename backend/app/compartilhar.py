"""Compartilhar: texto Markdown da build (que o próprio importador lê de volta) e link só-leitura por token."""

from __future__ import annotations

import secrets

from .modelos import Build
from .precos import brl, preco_ref
from .store import Store

TIPOS = {"cpu": "CPU", "gpu": "Placa de vídeo", "placa_mae": "Placa-mãe", "memoria": "Memória", "armazenamento": "Armazenamento",
         "fonte": "Fonte", "gabinete": "Gabinete", "cooler": "Cooler", "extra": "Extra"}


def markdown(store: Store, build: Build) -> str:
    linhas = [f"# Build {build.id}", "", f"Orçamento: {brl(build.orcamento)} · {build.objetivos.resolucao} @ {build.objetivos.fps_alvo} FPS", ""]
    total = 0.0
    for i in build.itens:
        c = store.componentes.get(i.componente_id)
        if not c:
            continue
        p = preco_ref(store, c.id)
        if p and not i.ja_tenho:
            total += p * i.quantidade
        qtd = f"{i.quantidade}x " if i.quantidade > 1 else ""
        extra = " (já tenho)" if i.ja_tenho else (f" - {brl(p)}" if p else "")
        linhas.append(f"- {TIPOS[c.tipo]}: {qtd}{c.nome}{extra}")
    linhas += ["", f"Total estimado (mediana com fonte): {brl(total)}", f"Dados: {store.aviso}"]
    return "\n".join(linhas)


def criar_token(store: Store, build_id: str) -> str:
    if not hasattr(store, "compartilhados"):
        store.compartilhados = {}
    token = secrets.token_urlsafe(9)
    store.compartilhados[token] = build_id
    return token


def resolver(store: Store, token: str) -> str | None:
    return getattr(store, "compartilhados", {}).get(token)
