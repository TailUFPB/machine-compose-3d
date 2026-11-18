"""Exportação do plano de compra para Excel (openpyxl)."""

from __future__ import annotations

from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Font

from .fps import Estimativa
from .precos import brl
from .modelos import Build
from .resultado import Resultado


def _cabecalho(ws, colunas: list[str]) -> None:
    ws.append(colunas)
    for c in ws[ws.max_row]:
        c.font = Font(bold=True)


def gerar_xlsx(build: Build, res: Resultado, fps: list[Estimativa], aviso_dados: str, override: bool) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Resumo"
    ws.append(["Build", build.id])
    ws.append(["Modo", build.modo])
    ws.append(["Orçamento (R$)", build.orcamento])
    ws.append(["Total referência (mediana, R$)", res.total])
    ws.append(["Total menor preço (por conta e risco, R$)", res.total_minimo])
    ws.append(["Situação", "cabe no orçamento" if res.cabe else f"faltam {brl(-res.diferenca)}"])
    ws.append(["Frete", res.frete])
    ws.append(["Dados", aviso_dados])
    if override:
        ws.append(["ATENÇÃO", "Exportado com achado bloqueante aberto, por confirmação explícita do usuário."])
    if res.ja_tenho:
        ws.append(["Já possui", ", ".join(res.ja_tenho)])

    ws = wb.create_sheet("Plano por loja")
    _cabecalho(ws, ["Loja", "Peça", "Qtd", "Preço unit. (R$)", "Subtotal (R$)", "Mín", "Mediana", "Máx", "Lojas", "Confiança", "Fonte (URL)"])
    for loja, linhas in res.lojas.items():
        for l in linhas:
            ws.append([loja, l.nome, l.quantidade, l.preco_unit, l.subtotal, *l.faixa, l.qtd_lojas, l.confianca, l.url])
        ws.append([f"Total {loja}", "", "", "", res.total_por_loja[loja]])

    ws = wb.create_sheet("Revisão")
    _cabecalho(ws, ["Severidade", "Agente", "Descrição", "Status", "Verificado", "Fonte", "Impacto preço (R$)", "Impacto FPS"])
    for a in build.achados:
        ws.append([a.severidade, a.agente, a.descricao, a.status, "sim" if a.verificado else "não", a.fonte_url,
                   a.impacto_preco, a.impacto_fps])

    ws = wb.create_sheet("FPS")
    _cabecalho(ws, ["Jogo", "Resolução", "Preset", "FPS médio", "Faixa mín", "Faixa máx", "1% low", "Tipo", "Confiança", "Gargalo", "Fontes"])
    for e in fps:
        ws.append([e.jogo_nome, e.resolucao, e.preset, e.fps_med, e.fps_min, e.fps_max, e.fps_1low, e.tipo, e.confianca,
                   e.gargalo, ", ".join(e.fontes)])

    ws = wb.create_sheet("Trocas sugeridas")
    _cabecalho(ws, ["De", "Para", "Economia (R$)", "Impacto FPS (%)", "Sugestão"])
    for t in res.trocas:
        ws.append([t.de_nome, t.para_nome, t.economia, t.impacto_fps_pct, t.texto])

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
