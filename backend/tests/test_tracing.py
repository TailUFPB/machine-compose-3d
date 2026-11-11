import pytest

from app import tracing
from app.config import get_settings


def test_span_funciona_com_e_sem_langfuse(monkeypatch):
    with tracing.trace("b1", "revisao"):
        with tracing.span("revisor_eletrico") as s:
            assert s is None   # sem chaves: no-op
    s = get_settings()
    monkeypatch.setattr(s, "langfuse_public_key", "pk-lf-teste")
    monkeypatch.setattr(s, "langfuse_secret_key", "sk-lf-teste")
    Langfuse = pytest.importorskip("langfuse").Langfuse
    monkeypatch.setattr(tracing, "_cliente", Langfuse(public_key="pk-lf-teste", secret_key="sk-lf-teste",
                                                       tracing_enabled=False))   # nada sai da máquina
    with tracing.trace("b1", "agente"):
        with tracing.span("propositor", input={"x": 1}) as obs:
            assert obs is not None
