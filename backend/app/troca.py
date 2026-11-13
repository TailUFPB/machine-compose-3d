"""Troca de uma peça por outra do mesmo tipo: usada para aplicar (`POST /trocar`) e para a prévia na cena.

Troca exatamente o item `de`, para qualquer tipo (armazenamento não é tipo único: `adicionar` somaria um disco).
A função não muta a build: devolve a lista nova de itens.
"""

from __future__ import annotations

from .modelos import Build, BuildItem
from .store import Store


class TrocaInvalida(Exception):
    def __init__(self, status: int, mensagem: str):
        super().__init__(mensagem)
        self.status, self.mensagem = status, mensagem


def itens_trocados(store: Store, build: Build, de: str, para: str) -> list[BuildItem]:
    atual, novo = store.get(de), store.get(para)
    if novo is None:
        raise TrocaInvalida(404, "componente não encontrado")
    item = next((i for i in build.itens if i.componente_id == de), None)
    if item is None or atual is None:
        raise TrocaInvalida(404, "item não está na build")
    if atual.tipo != novo.tipo:
        raise TrocaInvalida(422, f"troca precisa ser do mesmo tipo ({atual.tipo} por {novo.tipo})")
    if para != de and any(i.componente_id == para for i in build.itens):
        raise TrocaInvalida(409, f"{novo.nome} já está na build: escolha outra peça")
    if item.travado:
        raise TrocaInvalida(409, f"{atual.nome} está travada: destrave para trocar")
    if item.ja_tenho:
        raise TrocaInvalida(409, f"{atual.nome} é uma peça que você já tem: desmarque Já tenho para trocar")
    trocado = BuildItem(componente_id=para, quantidade=item.quantidade, origem="usuario")
    return [trocado if i is item else i.model_copy() for i in build.itens]
