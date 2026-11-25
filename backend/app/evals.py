"""Evals dos revisores: achados perdidos e achados falsos por revisor, e o que o LLM acrescenta.

    uv run python -m app.evals          # núcleo determinístico
    uv run python -m app.evals --llm    # com a passada do LLM configurado no .env

Cada caso (`evals/casos.json`) é uma lista de peças e, para os revisores que ele cobre, o conjunto exato de achados
esperados (id sem as peças). Perdido = esperado que não saiu. Falso = saiu sem estar esperado.
Para a leitura do conjunto pelo LLM (linha `conjunto`) não há gabarito: conta quantas dicas ele acrescenta, quantas
têm evidência conferida na ficha e quantas repetem um achado das regras sobre as mesmas peças (viés de confirmação).
`--ver` lista as dicas para leitura humana.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from . import llm as llm_mod
from .compat import revisores
from .modelos import BuildItem, Objetivos
from .store import Store, novo_store

CASOS = Path(__file__).resolve().parent.parent / "evals" / "casos.json"
COLUNAS = ("casos", "esperados", "perdidos", "falsos", "llm_acrescentou", "llm_com_fonte", "llm_repetiu")


def rodar(store: Store, casos: list[dict], llm: bool = False) -> dict[str, dict]:
    placar = {n: dict.fromkeys(COLUNAS, 0) | {"detalhe": []} for n in revisores.REVISORES}
    for n, caso in enumerate(casos, 1):
        if llm:
            print(f"[{n}/{len(casos)}] {caso['nome']}", file=sys.stderr, flush=True)
        itens = [BuildItem(componente_id=i) for i in caso["itens"]]
        achados = revisores.revisar(store, itens, list(caso["esperados"]), llm=llm,
                                    objetivos=Objetivos(resolucao=caso.get("resolucao", "1080p")))
        do_llm = [a for a in achados if a.agente == "conjunto"]
        regras_todas = [a for a in achados if a.agente != "conjunto"]
        if llm:
            c = placar.setdefault("conjunto", dict.fromkeys(COLUNAS, 0) | {"detalhe": [], "dicas": []})
            c["casos"] += 1
            c["llm_acrescentou"] += len(do_llm)
            c["llm_com_fonte"] += sum(a.verificado for a in do_llm)
            c["llm_repetiu"] += sum(any(set(a.itens_envolvidos) == set(r.itens_envolvidos) for r in regras_todas) for a in do_llm)
            c["dicas"] += [f"{caso['nome']} | {a.severidade} | {'conferida' if a.verificado else 'sem evidência'} | {a.descricao}"
                           for a in do_llm]
        for nome, esperados in caso["esperados"].items():
            p = placar[nome]
            regras = [a for a in achados if a.agente == nome]
            sairam = {":".join(a.id.split(":")[:2]) for a in regras}
            perdidos, falsos = sorted(set(esperados) - sairam), sorted(sairam - set(esperados))
            p["casos"] += 1
            p["esperados"] += len(esperados)
            p["perdidos"] += len(perdidos)
            p["falsos"] += len(falsos)
            p["detalhe"] += [f"{caso['nome']}: perdido {x}" for x in perdidos] + [f"{caso['nome']}: falso {x}" for x in falsos]
    return placar


def main() -> int:
    if "--llm" in sys.argv and not llm_mod.ativo():
        print("LLM desligado (LLM_PROVIDER=none): configure LLM_PROVIDER e LLM_API_KEY no .env para medir a passada do LLM.")
        return 2
    placar = rodar(novo_store(), json.loads(CASOS.read_text()), llm="--llm" in sys.argv)
    print(f"{'revisor':<15}" + "".join(f"{c:>17}" for c in COLUNAS))
    for nome, p in placar.items():
        print(f"{nome:<15}" + "".join(f"{p[c]:>17}" for c in COLUNAS))
    erros = [d for p in placar.values() for d in p["detalhe"]]
    print("\n".join(erros))
    if "--ver" in sys.argv:
        print("\n".join(placar.get("conjunto", {}).get("dicas", [])))
    if llm_mod.falhas:   # falha não é "o LLM não achou nada": as colunas llm_* ficam subestimadas
        print(f"ATENÇÃO: {llm_mod.falhas} chamada(s) ao LLM falharam e contam como zero nas colunas llm_*. "
              "Tente um LLM_TIMEOUT_SECONDS maior.")
    return 1 if erros or llm_mod.falhas else 0


if __name__ == "__main__":
    sys.exit(main())
