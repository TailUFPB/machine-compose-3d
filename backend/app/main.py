"""API FastAPI. Regra: nada muda na build sem um pedido explícito do usuário (rotas de item e /aplicar)."""

from __future__ import annotations

import threading
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from . import agente, exportar, ficha, importar, precos, resultado
from .troca import TrocaInvalida, itens_trocados
from .compat.consolidador import bloqueantes_abertos, revisar_build
from .compat.regras import TIPOS_UNICOS, motivo_incompativel
from .config import get_settings
from .fps import estimar_build
from .modelos import Aplicar, Build, BuildCriar, BuildItem, Exportar, Importar, ItemAdicionar, ItemAtualizar, Troca
from .store import Store, get_store
from .tracing import trace

CONFIRMACAO_OVERRIDE = "EXPORTAR MESMO ASSIM"



@asynccontextmanager
async def _ciclo(_app: FastAPI):
    if get_settings().preco_real:   # preço real: carrega o já coletado e busca o resto em segundo plano
        store = get_store()
        precos.carregar_disco(store)
        threading.Thread(target=precos.aquecer, args=(store,), daemon=True).start()
    yield


app = FastAPI(title="machine-compose-3d", version="0.1.0", lifespan=_ciclo)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins.split(","), allow_methods=["*"], allow_headers=["*"])


def _build(store: Store, build_id: str) -> Build:
    b = store.builds.get(build_id)
    if not b:
        raise HTTPException(404, "build não encontrada")
    return b


def _revisar_e_salvar(store: Store, b: Build) -> Build:
    with trace(b.id, "revisao"):
        b.achados = revisar_build(store, b)
    b.status = "revisada"
    store.salvar(b)
    return b


def _por_no_lugar(store: Store, b: Build, novo: BuildItem) -> None:
    """Peça de tipo único substitui a do mesmo tipo (se não estiver travada); as outras se somam."""
    comp = store.componentes[novo.componente_id]
    for i, atual in enumerate(b.itens):
        tipo_atual = store.componentes[atual.componente_id].tipo
        if atual.componente_id == novo.componente_id:
            b.itens[i] = novo
            return
        if comp.tipo in TIPOS_UNICOS and tipo_atual == comp.tipo:
            if atual.travado:
                raise HTTPException(409, f"{store.componentes[atual.componente_id].nome} está travada: destrave para trocar")
            b.itens[i] = novo
            return
    b.itens.append(novo)


@app.get("/saude")
def saude(store: Store = Depends(get_store)):
    s = get_settings()
    dados = store.aviso if not s.preco_real else "Preços reais do Google Shopping (serper.dev); FPS e fichas ainda do seed fictício."
    return {"ok": True, "llm": s.llm_provider, "busca": "serper" if s.preco_real else "seed", "dados": dados}


@app.get("/jogos")
def jogos(store: Store = Depends(get_store)):
    return {"jogos": [{"id": j["id"], "nome": j["nome"]} for j in store.jogos.values()],
            "resolucoes": store.resolucoes, "preset": store.preset}


@app.get("/componentes")
def componentes(tipo: str | None = None, build_id: str | None = None, todos: bool = False, store: Store = Depends(get_store)):
    b = store.builds.get(build_id) if build_id else None
    saida = []
    for c in store.componentes.values():
        if tipo and c.tipo != tipo:
            continue
        motivo = motivo_incompativel(store, b.itens, c) if b else None
        if motivo and not todos:
            continue
        r = precos.pesquisar(store, c.id)
        saida.append({**c.model_dump(), "nome": c.nome, "compativel": motivo is None, "motivo": motivo,
                      "preco": {"min": r.preco_min, "med": r.preco_med, "max": r.preco_max, "confianca": r.confianca}})
    return saida


@app.post("/componentes/{componente_id}/ficha", response_model=ficha.ResultadoFicha)
def extrair_ficha(componente_id: str, store: Store = Depends(get_store)):
    """Busca a ficha do fabricante e grava os campos geométricos plausíveis, cada um com a URL de origem."""
    if store.get(componente_id) is None:
        raise HTTPException(404, "componente não encontrado")
    return ficha.extrair(store, componente_id)


@app.post("/builds", response_model=Build)
def criar_build(dados: BuildCriar, store: Store = Depends(get_store)):
    return store.criar_build(dados)


@app.get("/builds", response_model=list[Build])
def listar_builds(usuario: str = "demo", store: Store = Depends(get_store)):
    return [b for b in store.builds.values() if b.usuario == usuario]


@app.get("/builds/{build_id}", response_model=Build)
def ver_build(build_id: str, store: Store = Depends(get_store)):
    return _build(store, build_id)


@app.patch("/builds/{build_id}", response_model=Build)
def atualizar_build(build_id: str, dados: BuildCriar, store: Store = Depends(get_store)):
    b = _build(store, build_id)
    for k, v in dados.model_dump().items():
        setattr(b, k, v)
    b.objetivos = dados.objetivos
    return _revisar_e_salvar(store, b)


@app.post("/builds/{build_id}/itens", response_model=Build)
def adicionar_item(build_id: str, item: ItemAdicionar, store: Store = Depends(get_store)):
    b = _build(store, build_id)
    if item.componente_id not in store.componentes:
        raise HTTPException(404, "componente não encontrado")
    _por_no_lugar(store, b, BuildItem(**item.model_dump(), origem="usuario"))
    return _revisar_e_salvar(store, b)


@app.post("/builds/{build_id}/trocar", response_model=Build)
def trocar(build_id: str, dados: Troca, store: Store = Depends(get_store)):
    """Aplicar troca: substitui exatamente a peça `de` por `para` (qualquer tipo) numa única gravação."""
    b = _build(store, build_id)
    try:
        b.itens = itens_trocados(store, b, dados.de, dados.para)
    except TrocaInvalida as e:
        raise HTTPException(e.status, e.mensagem)
    return _revisar_e_salvar(store, b)


@app.patch("/builds/{build_id}/itens/{componente_id}", response_model=Build)
def atualizar_item(build_id: str, componente_id: str, dados: ItemAtualizar, store: Store = Depends(get_store)):
    b = _build(store, build_id)
    item = next((i for i in b.itens if i.componente_id == componente_id), None)
    if not item:
        raise HTTPException(404, "item não está na build")
    for k, v in dados.model_dump(exclude_none=True).items():
        setattr(item, k, v)
    return _revisar_e_salvar(store, b)


@app.delete("/builds/{build_id}/itens/{componente_id}", response_model=Build)
def remover_item(build_id: str, componente_id: str, store: Store = Depends(get_store)):
    b = _build(store, build_id)
    b.itens = [i for i in b.itens if i.componente_id != componente_id]
    return _revisar_e_salvar(store, b)


@app.post("/builds/{build_id}/revisar", response_model=Build)
def revisar(build_id: str, store: Store = Depends(get_store)):
    return _revisar_e_salvar(store, _build(store, build_id))


@app.post("/builds/{build_id}/importar", response_model=importar.ResultadoImportacao)
def importar_texto(build_id: str, dados: Importar, store: Store = Depends(get_store)):
    _build(store, build_id)
    return importar.importar(store, dados.texto, dados.ja_tenho)


@app.post("/builds/{build_id}/agente")
def rodar_agente(build_id: str, store: Store = Depends(get_store)):
    b = _build(store, build_id)
    p = agente.propor(store, b)
    store.propostas[b.id] = p
    return p


@app.post("/builds/{build_id}/aplicar", response_model=Build)
def aplicar(build_id: str, dados: Aplicar, store: Store = Depends(get_store)):
    b = _build(store, build_id)
    if dados.proposta:
        p = store.propostas.pop(b.id, None)
        if not p:
            raise HTTPException(404, "nenhuma proposta pendente: rode o agente antes")
        b.itens = [i.model_copy() for i in p.itens]
    elif dados.achado_id:
        a = next((x for x in b.achados if x.id == dados.achado_id), None)
        if not a or not a.correcao_sugerida:
            raise HTTPException(404, "achado sem correção aplicável")
        c = a.correcao_sugerida
        if c.acao == "trocar":
            atual = next((i for i in b.itens if i.componente_id == c.componente_id), None)
            if atual and (atual.travado or atual.ja_tenho):
                raise HTTPException(409, "peça travada: destrave para aplicar a correção")
            b.itens = [i for i in b.itens if i.componente_id != c.componente_id]
            b.itens.append(BuildItem(componente_id=c.para_id, origem="agente", justificativa=f"Correção: {a.descricao}"))
        elif c.acao == "adicionar":
            _por_no_lugar(store, b, BuildItem(componente_id=c.para_id, origem="agente", justificativa=f"Correção: {a.descricao}"))
        else:
            b.itens = [i for i in b.itens if i.componente_id != c.componente_id]
        a.status = "aplicado"
    elif dados.itens is not None:
        for item in dados.itens:
            if item.componente_id in store.componentes:
                _por_no_lugar(store, b, item)
    else:
        raise HTTPException(422, "informe proposta, achado_id ou itens")
    return _revisar_e_salvar(store, b)


@app.post("/builds/{build_id}/achados/{achado_id}/ignorar", response_model=Build)
def ignorar(build_id: str, achado_id: str, store: Store = Depends(get_store)):
    b = _build(store, build_id)
    a = next((x for x in b.achados if x.id == achado_id), None)
    if not a:
        raise HTTPException(404, "achado não encontrado")
    a.status = "ignorado"
    store.salvar(b)
    return b


@app.get("/builds/{build_id}/precos")
def precos_build(build_id: str, store: Store = Depends(get_store)):
    b = _build(store, build_id)
    with trace(b.id, "precos"):
        resultado.itens_com_status(store, b.itens)
        return [{**precos.pesquisar(store, i.componente_id).model_dump(), "historico": precos.historico(store, i.componente_id)}
                for i in b.itens]


@app.get("/builds/{build_id}/fps")
def fps_build(build_id: str, resolucao: str | None = None, store: Store = Depends(get_store)):
    b = _build(store, build_id)
    total = agente.custo(store, b.itens) or None
    es = estimar_build(store, [i.componente_id for i in b.itens], b.objetivos.jogos, resolucao or b.objetivos.resolucao, total)
    store.espelhar("estimativas", [{"build_id": b.id, "jogo": e.jogo, "resolucao": e.resolucao, "preset": e.preset,
                                    "fps_min": e.fps_min, "fps_med": e.fps_med, "fps_max": e.fps_max,
                                    "confianca": e.confianca, "tipo": e.tipo} for e in es], substituir=("build_id", b.id))
    return es


@app.get("/comparar")
def comparar(a: str, b: str, resolucao: str = Query("1080p"), store: Store = Depends(get_store)):
    ba, bb = _build(store, a), _build(store, b)
    jogos = sorted(set(ba.objetivos.jogos) | set(bb.objetivos.jogos))
    lado = lambda x: estimar_build(store, [i.componente_id for i in x.itens], jogos, resolucao, agente.custo(store, x.itens) or None)
    return {"a": lado(ba), "b": lado(bb), "custo_a": agente.custo(store, ba.itens), "custo_b": agente.custo(store, bb.itens)}


@app.get("/builds/{build_id}/resultado", response_model=resultado.Resultado)
def ver_resultado(build_id: str, store: Store = Depends(get_store)):
    return resultado.calcular(store, _build(store, build_id))


@app.post("/builds/{build_id}/exportar")
def exportar_xlsx(build_id: str, dados: Exportar, store: Store = Depends(get_store)):
    b = _build(store, build_id)
    bloq = bloqueantes_abertos(b)
    override = False
    if bloq and get_settings().bloqueante_bloqueia_exportacao:
        if not (dados.override and dados.confirmacao == CONFIRMACAO_OVERRIDE):
            raise HTTPException(409, {"mensagem": "Há achados bloqueantes abertos. Corrija ou confirme o override.",
                                      "confirmacao_exigida": CONFIRMACAO_OVERRIDE,
                                      "bloqueantes": [a.descricao for a in bloq]})
        override = True
    res = resultado.calcular(store, b)
    fps = estimar_build(store, [i.componente_id for i in b.itens], b.objetivos.jogos, b.objetivos.resolucao, res.total or None)
    xlsx = exportar.gerar_xlsx(b, res, fps, store.aviso, override)
    b.status = "exportada"
    store.salvar(b)
    return Response(xlsx, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="build-{b.id}.xlsx"'})


PASSOS = [("cpu", "Encaixe a CPU no socket da placa-mãe (alinhe o triângulo)."),
          ("memoria", "Instale a memória nos slots A2/B2."),
          ("armazenamento", "Instale o SSD no slot M.2 principal."),
          ("cooler", "Aplique pasta térmica e fixe o cooler."),
          ("gabinete", "Prepare o gabinete: remova as tampas laterais."),
          ("placa_mae", "Parafuse a placa-mãe nos espaçadores do gabinete."),
          ("fonte", "Instale a fonte na base com a ventoinha para baixo."),
          ("gpu", "Encaixe a GPU no slot PCIe x16 e ligue os cabos de energia.")]


@app.get("/builds/{build_id}/cena")
def cena(build_id: str, store: Store = Depends(get_store)):
    """Dados para a cena 3D paramétrica: fichas, peças em conflito físico e passos do tutorial."""
    b = _build(store, build_id)
    comps = [store.componentes[i.componente_id] for i in b.itens if i.componente_id in store.componentes]
    tipos = {c.tipo for c in comps}
    conflitos = [{"id": a.id, "itens": a.itens_envolvidos, "descricao": a.descricao, "severidade": a.severidade}
                 for a in b.achados if a.status == "aberto" and (a.fisico or a.severidade == "bloqueante") and a.itens_envolvidos]
    return {"pecas": [{"id": c.id, "tipo": c.tipo, "nome": c.nome, "specs": c.specs,
                       "origem": {campo: o["url"] for campo, o in c.specs_origem.items() if o.get("url")}}   # ausente = seed/estimado
                      for c in comps if c.tipo != "extra"],
            "conflitos": conflitos,
            "passos": [{"tipo": t, "texto": txt} for t, txt in PASSOS if t in tipos]}
