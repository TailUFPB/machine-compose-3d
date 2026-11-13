"""Repositório em memória carregado do seed. Com SUPABASE_URL, espelha as escritas no Supabase (best effort).

ponytail: memória de processo único; para várias instâncias, ler do Supabase em vez de só espelhar.
"""

from __future__ import annotations

import json
import logging
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import get_settings
from .modelos import Build, BuildCriar, Componente

logger = logging.getLogger(__name__)
SEED = Path(__file__).resolve().parent / "seed.json"


class Store:
    def __init__(self, seed: dict[str, Any]):
        self.aviso: str = seed["aviso"]
        self.componentes: dict[str, Componente] = {c["id"]: Componente(**c) for c in seed["componentes"]}
        self.jogos: dict[str, dict] = {j["id"]: j for j in seed["jogos"]}
        self.resolucoes: list[str] = seed["resolucoes"]
        self.preset: str = seed["preset"]
        self.benchmarks: list[dict] = seed["benchmarks"]
        self.anuncios: list[dict] = seed["anuncios"]                 # o que a "busca" encontra hoje
        self.historico_precos: list[dict] = seed["historico_precos"]  # ofertas já coletadas
        self.cache_precos: dict[str, dict] = {}                      # componente_id -> {resultado, em}
        self.links_resolvidos: dict[str, str] = {}                   # "loja|titulo" -> URL direta resolvida no clique
        self.builds: dict[str, Build] = {}
        self.propostas: dict[str, Any] = {}                          # build_id -> Proposta pendente
        self._sb = None

    # --- catálogo
    def por_tipo(self, tipo: str) -> list[Componente]:
        return [c for c in self.componentes.values() if c.tipo == tipo]

    def get(self, componente_id: str) -> Componente | None:
        return self.componentes.get(componente_id)

    # --- builds
    def criar_build(self, dados: BuildCriar) -> Build:
        b = Build(id=uuid.uuid4().hex[:12], **dados.model_dump())
        self.builds[b.id] = b
        self.salvar(b)
        return b

    def salvar(self, b: Build) -> None:
        self.builds[b.id] = b
        self.espelhar("builds", [{"id": b.id, "usuario": b.usuario, "modo": b.modo, "orcamento": b.orcamento,
                                   "cep": b.cep, "objetivos": b.objetivos.model_dump(), "status": b.status}])
        self.espelhar("build_itens", [{"build_id": b.id, **i.model_dump()} for i in b.itens], substituir=("build_id", b.id))
        self.espelhar("revisao_achados", [{"build_id": b.id, **a.model_dump(mode="json"),
                                           "correcao_sugerida": a.correcao_sugerida.model_dump() if a.correcao_sugerida else None}
                                          for a in b.achados], substituir=("build_id", b.id))

    # --- Supabase opcional
    def espelhar(self, tabela: str, linhas: list[dict], substituir: tuple[str, str] | None = None) -> None:
        s = get_settings()
        if not s.supabase_url:
            return
        try:
            if self._sb is None:
                from supabase import create_client
                self._sb = create_client(s.supabase_url, s.supabase_key)
            if substituir:
                self._sb.table(tabela).delete().eq(*substituir).execute()
            if linhas:
                self._sb.table(tabela).upsert(linhas).execute()
        except Exception as exc:  # espelho nunca derruba a API
            logger.warning("Supabase (%s) falhou: %s", tabela, exc)


@lru_cache
def get_store() -> Store:
    return Store(json.loads(SEED.read_text()))


def novo_store() -> Store:
    """Store limpo para testes."""
    return Store(json.loads(SEED.read_text()))
