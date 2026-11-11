"""Provedor de LLM configurável por LLM_PROVIDER. Toda chamada devolve None em falha: o chamador
sempre tem um caminho determinístico, então o LLM melhora o resultado mas nunca é requisito."""

from __future__ import annotations

import json
import logging
import re

from .config import get_settings
from .tracing import span

logger = logging.getLogger(__name__)


def ativo() -> bool:
    return get_settings().llm_provider != "none"


def _texto(system: str, user: str) -> str:
    s = get_settings()
    if s.llm_provider == "anthropic":
        import anthropic
        cliente = anthropic.Anthropic(api_key=s.llm_api_key or None, timeout=s.llm_timeout_seconds)
        r = cliente.messages.create(model=s.llm_model, max_tokens=16000, system=system,
                                    output_config={"effort": "low"},
                                    messages=[{"role": "user", "content": user}])
        if r.stop_reason == "refusal":
            raise RuntimeError("recusa do modelo")
        return "".join(b.text for b in r.content if b.type == "text")
    from openai import OpenAI
    cliente = OpenAI(api_key=s.llm_api_key, base_url=s.llm_base_url or None, timeout=s.llm_timeout_seconds)
    r = cliente.chat.completions.create(model=s.llm_model, temperature=0,
                                        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
    return r.choices[0].message.content or ""


def completar_json(nome: str, system: str, user: str) -> dict | None:
    """Pede JSON ao modelo. `nome` vira o span no Langfuse."""
    if not ativo():
        return None
    with span(nome, input=user[:2000]):
        try:
            texto = _texto(system + "\nResponda somente com um objeto JSON.", user)
            m = re.search(r"\{.*\}", texto, re.S)
            return json.loads(m.group(0)) if m else None
        except Exception as exc:
            logger.warning("LLM (%s) falhou, seguindo sem IA: %s", nome, exc)
            return None
