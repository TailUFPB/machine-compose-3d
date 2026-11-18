"""Langfuse opcional: um trace por build (`trace`), cada agente como span (`span`). Sem chaves, no-op."""

from __future__ import annotations

import logging
from contextlib import contextmanager, nullcontext
from contextvars import ContextVar

from .config import get_settings

logger = logging.getLogger(__name__)
_cliente = None
_mudo: ContextVar[bool] = ContextVar("sem_rastro", default=False)


@contextmanager
def sem_rastro():
    """Dentro deste bloco nenhum span vai para o Langfuse (usado pela prévia, que não registra nada)."""
    token = _mudo.set(True)
    try:
        yield
    finally:
        _mudo.reset(token)
AGENTES = ("revisor_", "propositor", "extrator_", "justificativas")   # viram observações do tipo agente


def _langfuse():
    global _cliente
    s = get_settings()
    if not (s.langfuse_public_key and s.langfuse_secret_key):
        return None
    if _cliente is None:
        try:
            from langfuse import Langfuse
            _cliente = Langfuse(public_key=s.langfuse_public_key, secret_key=s.langfuse_secret_key, base_url=s.langfuse_base_url)
        except Exception as exc:
            logger.warning("Langfuse indisponível: %s", exc)
            _cliente = False
    return _cliente or None


@contextmanager
def span(nome: str, **atributos):
    lf = None if _mudo.get() else _langfuse()
    ctx = nullcontext()
    if lf:
        try:
            ctx = lf.start_as_current_observation(name=nome, as_type="agent" if nome.startswith(AGENTES) else "span", **atributos)
        except Exception as exc:
            logger.warning("Langfuse span falhou: %s", exc)
    with ctx as s:
        yield s


def trace(build_id: str, nome: str):
    """Span raiz da operação na build; os spans dos agentes ficam aninhados nele."""
    return span(f"build:{build_id}:{nome}", metadata={"build_id": build_id})
