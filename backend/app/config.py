"""Configuração lida do .env (pydantic-settings). Sem nenhuma chave, tudo roda offline com o seed."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", extra="ignore")

    # LLM: none = heurística determinística (padrão, reprodutível)
    llm_provider: Literal["none", "anthropic", "openai"] = "none"
    llm_model: str = "claude-opus-5-5"
    llm_api_key: str = Field(default="", repr=False)
    llm_base_url: str = ""          # só para provider=openai (qualquer API compatível)
    llm_timeout_seconds: float = 60

    # Agente selecionador
    agente_max_tentativas: int = 4

    # Pesquisa de preço
    busca_provider: Literal["seed"] = "seed"
    preco_cache_dias: int = 7
    lojas: str = "Kabum,Pichau,Terabyte,Mercado Livre,Amazon"

    # Revisão
    bloqueante_bloqueia_exportacao: bool = True
    margem_fonte: float = 1.3       # potência da fonte >= consumo estimado x margem

    # Supabase (opcional: espelha builds, achados e histórico de preço)
    supabase_url: str = ""
    supabase_key: str = Field(default="", repr=False)

    # Langfuse (opcional)
    langfuse_public_key: str = ""
    langfuse_secret_key: str = Field(default="", repr=False)
    langfuse_base_url: str = "https://cloud.langfuse.com"

    cors_origins: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
