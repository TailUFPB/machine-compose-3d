"""Provedor de LLM configurável por LLM_PROVIDER. Toda chamada devolve None em falha: o chamador
sempre tem um caminho determinístico, então o LLM melhora o resultado mas nunca é requisito."""

from __future__ import annotations

import json
import logging
import re

from .config import get_settings
from .tracing import span

logger = logging.getLogger(__name__)
OPENROUTER_URL = "https://openrouter.ai/api/v1"
_cache: dict[tuple, dict] = {}   # mesma combinação de peças = mesmo prompt = mesma resposta
falhas = 0                       # chamadas que não devolveram JSON (erro, tempo esgotado, resposta vazia); os evals leem
CACHE_MAX = 512                  # ponytail: esvazia inteiro ao encher; LRU se a memória virar problema


def ativo() -> bool:
    return get_settings().llm_provider != "none"


def _texto(system: str, user: str) -> str:
    s = get_settings()
    if s.llm_provider == "anthropic":
        import anthropic
        cliente = anthropic.Anthropic(api_key=s.llm_api_key or None, timeout=s.llm_timeout_seconds, max_retries=1)
        r = cliente.messages.create(model=s.llm_model, max_tokens=16000, system=system,
                                    output_config={"effort": "low"},
                                    messages=[{"role": "user", "content": user}])
        if r.stop_reason == "refusal":
            raise RuntimeError("recusa do modelo")
        return "".join(b.text for b in r.content if b.type == "text")
    from openai import OpenAI
    base_url = s.llm_base_url or (OPENROUTER_URL if s.llm_provider == "openrouter" else None)
    cliente = OpenAI(api_key=s.llm_api_key, base_url=base_url, timeout=s.llm_timeout_seconds, max_retries=1)
    extra = {} if s.llm_thinking is None else {"extra_body": {"chat_template_kwargs": {"enable_thinking": s.llm_thinking}}}
    r = cliente.chat.completions.create(model=s.llm_model, temperature=0, max_tokens=s.llm_max_tokens, **extra,
                                        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
    return r.choices[0].message.content or ""


def completar_json(nome: str, system: str, user: str) -> dict | None:
    """Pede JSON ao modelo. `nome` vira o span no Langfuse."""
    global falhas
    if not ativo():
        return None
    s = get_settings()
    chave = (s.llm_provider, s.llm_model, system, user)
    if chave in _cache:
        return _cache[chave]
    with span(nome, input=user[:2000]):
        try:
            texto = _texto(system + "\nResponda somente com um objeto JSON.", user)
            m = re.search(r"\{.*\}", texto, re.S)
            r = json.loads(m.group(0)) if m else None
            if r is None:
                falhas += 1
            else:
                if len(_cache) >= CACHE_MAX:
                    _cache.clear()
                _cache[chave] = r
            return r
        except Exception as exc:
            falhas += 1
            logger.warning("LLM (%s) falhou, seguindo sem IA: %s", nome, exc)
            return None
