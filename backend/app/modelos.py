"""Contratos Pydantic compartilhados entre rotas, revisão, agente e resultado."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Tipo = Literal["cpu", "gpu", "placa_mae", "memoria", "armazenamento", "fonte", "gabinete", "cooler", "extra"]
Modo = Literal["agente", "hibrido", "manual"]
Severidade = Literal["bloqueante", "atencao", "sugestao"]
Resolucao = Literal["1080p", "1440p"]


class Componente(BaseModel):
    id: str
    tipo: Tipo
    marca: str
    modelo: str
    specs: dict[str, Any]
    specs_origem: dict[str, dict[str, str]] = Field(default_factory=dict)   # campo -> {url, coletado_em} (ficha extraída)
    fonte: str

    @property
    def nome(self) -> str:
        return f"{self.marca} {self.modelo}"


class Objetivos(BaseModel):
    jogos: list[str] = Field(default_factory=list)
    resolucao: Resolucao = "1080p"
    fps_alvo: int = Field(default=60, ge=30, le=500)


class BuildItem(BaseModel):
    componente_id: str
    quantidade: int = Field(default=1, ge=1, le=8)
    travado: bool = False
    ja_tenho: bool = False            # upgrade: peça que o usuário já possui (fora do orçamento, nunca trocada)
    origem: Literal["usuario", "agente"] = "usuario"
    justificativa: str | None = None
    status_pesquisa: Literal["pendente", "ok", "sem_preco"] = "pendente"


class Correcao(BaseModel):
    acao: Literal["trocar", "adicionar", "remover"]
    componente_id: str | None = None   # peça atual (trocar/remover)
    para_id: str | None = None         # peça nova (trocar/adicionar)


class Achado(BaseModel):
    id: str
    agente: str                        # regras | plataforma | espaco_fisico | eletrico
    severidade: Severidade
    itens_envolvidos: list[str]
    descricao: str
    correcao_sugerida: Correcao | None = None
    fonte_url: str | None = None
    verificado: bool = True
    status: Literal["aberto", "aplicado", "ignorado"] = "aberto"
    impacto_preco: float | None = None  # R$ (positivo = encarece)
    impacto_fps: str | None = None
    fisico: bool = False                # destacar na cena 3D


class BuildCriar(BaseModel):
    modo: Modo = "manual"
    orcamento: float = Field(default=6000, gt=0, le=200000)
    cep: str = Field(default="", max_length=9)
    objetivos: Objetivos = Field(default_factory=Objetivos)
    usuario: str = "demo"


class Build(BuildCriar):
    id: str
    status: Literal["rascunho", "revisada", "exportada"] = "rascunho"
    itens: list[BuildItem] = Field(default_factory=list)
    achados: list[Achado] = Field(default_factory=list)


class ItemAdicionar(BaseModel):
    componente_id: str
    quantidade: int = Field(default=1, ge=1, le=8)
    travado: bool = False
    ja_tenho: bool = False


class ItemAtualizar(BaseModel):
    quantidade: int | None = Field(default=None, ge=1, le=8)
    travado: bool | None = None
    ja_tenho: bool | None = None


class Proposta(BaseModel):
    itens: list[BuildItem]
    achados: list[Achado]
    tentativas: int
    convergiu: bool
    avisos: list[str] = Field(default_factory=list)
    custo_estimado: float | None = None


class Aplicar(BaseModel):
    """Único caminho para mudança automática na build: sempre disparado por clique do usuário."""
    proposta: bool = False
    achado_id: str | None = None
    itens: list[BuildItem] | None = None   # importação aceita


class Troca(BaseModel):
    """Troca uma peça da build (`de`) por outra do mesmo tipo (`para`)."""
    de: str
    para: str


class Exportar(BaseModel):
    override: bool = False
    confirmacao: str = ""


class Importar(BaseModel):
    texto: str = Field(max_length=20000)
    ja_tenho: bool = False   # upgrade: as peças coladas são as que o usuário já possui
