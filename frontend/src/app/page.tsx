"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Erro, Jogos, Montagem, ResultadoPainel, Revisao } from "@/components/Paineis";
import { api, type Build, type Cena, type Componente, type Modo, type Objetivos } from "@/lib/api";
import { brl } from "@/lib/formato";

const Cena3D = dynamic(() => import("@/components/Cena3D"), { ssr: false, loading: () => <p className="suave">Carregando 3D…</p> });

const ABAS = ["Montagem", "Revisão", "3D", "Jogos", "Resultado"] as const;
type Aba = (typeof ABAS)[number];

interface Form { modo: Modo; orcamento: number; cep: string; objetivos: Objetivos }
const FORM_INICIAL: Form = { modo: "agente", orcamento: 6000, cep: "", objetivos: { jogos: ["cyberpunk-2077", "cs2", "fortnite"], resolucao: "1080p", fps_alvo: 60 } };

function Entrada({ jogos, inicial, onEnviar, rotulo }: { jogos: { id: string; nome: string }[]; inicial: Form; onEnviar: (f: Form) => void; rotulo: string }) {
  const [f, setF] = useState(inicial);
  useEffect(() => setF(inicial), [inicial]);
  const alternar = (id: string) => setF({ ...f, objetivos: { ...f.objetivos, jogos: f.objetivos.jogos.includes(id) ? f.objetivos.jogos.filter((j) => j !== id) : [...f.objetivos.jogos, id] } });
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onEnviar(f); }}>
      <div className="grade">
        <label>Modo
          <select value={f.modo} onChange={(e) => setF({ ...f, modo: e.target.value as Modo })}>
            <option value="agente">Agente: monta tudo</option>
            <option value="hibrido">Híbrido: travo peças, agente completa</option>
            <option value="manual">Manual: escolho peça por peça</option>
          </select>
        </label>
        <label>Orçamento (R$)
          <input type="number" min={500} step={100} value={f.orcamento} onChange={(e) => setF({ ...f, orcamento: +e.target.value })} required />
        </label>
        <label>CEP
          <input inputMode="numeric" pattern="\d{5}-?\d{3}" placeholder="00000-000" value={f.cep} onChange={(e) => setF({ ...f, cep: e.target.value })} />
        </label>
        <label>Resolução
          <select value={f.objetivos.resolucao} onChange={(e) => setF({ ...f, objetivos: { ...f.objetivos, resolucao: e.target.value as Objetivos["resolucao"] } })}>
            <option>1080p</option><option>1440p</option>
          </select>
        </label>
        <label>FPS desejado
          <input type="number" min={30} max={500} value={f.objetivos.fps_alvo} onChange={(e) => setF({ ...f, objetivos: { ...f.objetivos, fps_alvo: +e.target.value } })} />
        </label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: "12px 0" }}>
        <legend className="suave">Jogos-alvo</legend>
        <div className="linha">
          {jogos.map((j) => (
            <label key={j.id} className="linha" style={{ display: "flex", color: "var(--texto)" }}>
              <input type="checkbox" checked={f.objetivos.jogos.includes(j.id)} onChange={() => alternar(j.id)} /> {j.nome}
            </label>
          ))}
        </div>
      </fieldset>
      <button className="primario" type="submit">{rotulo}</button>
    </form>
  );
}

export default function Pagina() {
  const [aviso, setAviso] = useState("");
  const [jogos, setJogos] = useState<{ id: string; nome: string }[]>([]);
  const [catalogo, setCatalogo] = useState<Record<string, Componente>>({});
  const [builds, setBuilds] = useState<Build[]>([]);
  const [build, setBuild] = useState<Build | null>(null);
  const [aba, setAba] = useState<Aba>("Montagem");
  const [cena, setCena] = useState<Cena | null>(null);
  const [editando, setEditando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.saude(), api.jogos(), api.catalogo(), api.builds()])
      .then(([s, j, c, b]) => {
        setAviso(`${s.dados} LLM: ${s.llm}.`);
        setJogos(j.jogos);
        setCatalogo(Object.fromEntries(c.map((x) => [x.id, x])));
        setBuilds(b);
        if (b.length) setBuild(b[b.length - 1]);
      })
      .catch(() => setErro("API indisponível. Rode o backend: cd backend && uv run uvicorn app.main:app --reload"));
  }, []);

  const atualizar = useCallback((b: Build) => {
    setBuild(b);
    setBuilds((xs) => (xs.some((x) => x.id === b.id) ? xs.map((x) => (x.id === b.id ? b : x)) : [...xs, b]));
  }, []);

  const assinatura = build ? JSON.stringify([build.itens, build.achados.map((a) => a.id + a.status)]) : "";
  useEffect(() => {
    if (build && aba === "3D") api.cena(build.id).then(setCena).catch(() => setCena(null));
  }, [aba, build?.id, assinatura]);

  const inicial = useMemo<Form>(() => (build ? { modo: build.modo, orcamento: build.orcamento, cep: build.cep, objetivos: build.objetivos } : FORM_INICIAL), [build?.id, editando]);
  const bloqueantes = build?.achados.filter((a) => a.severidade === "bloqueante" && a.status === "aberto").length ?? 0;

  const criar = async (f: Form) => {
    setErro(null);
    try { atualizar(await api.criar(f)); setAba("Montagem"); } catch (e) { setErro(String(e)); }
  };
  const salvar = async (f: Form) => {
    if (!build) return;
    try { atualizar(await api.atualizar(build.id, f)); setEditando(false); } catch (e) { setErro(String(e)); }
  };

  return (
    <main>
      <header className="topo">
        <h1>Monta PC 3D</h1>
        <span className="aviso-dados">{aviso}</span>
      </header>
      <Erro erro={erro} />

      {!build && jogos.length > 0 && (
        <>
          <p>Informe orçamento, jogos e metas. Depois monte com o agente, no modo híbrido ou peça por peça.</p>
          <Entrada jogos={jogos} inicial={FORM_INICIAL} onEnviar={criar} rotulo="Começar build" />
        </>
      )}

      {build && (
        <>
          <div className="card linha entre">
            <div>
              <strong>Build {build.id}</strong> · {build.modo} · {brl(build.orcamento)} · {build.objetivos.resolucao} @ {build.objetivos.fps_alvo} FPS
              {bloqueantes > 0 ? <span className="selo sev-bloqueante" style={{ marginLeft: 8 }}>{bloqueantes} bloqueante(s)</span> : build.itens.length > 0 && <span className="selo ok" style={{ marginLeft: 8 }}>sem bloqueantes</span>}
            </div>
            <div className="linha">
              <select value={build.id} onChange={(e) => setBuild(builds.find((b) => b.id === e.target.value) ?? null)} aria-label="Trocar de build">
                {builds.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.modo}</option>)}
              </select>
              <button onClick={() => setEditando(!editando)}>{editando ? "Fechar" : "Editar metas"}</button>
              <button onClick={() => setBuild(null)}>Nova build</button>
            </div>
          </div>
          {editando && <Entrada jogos={jogos} inicial={inicial} onEnviar={salvar} rotulo="Salvar metas" />}

          <nav className="abas" role="tablist">
            {ABAS.map((a) => (
              <button key={a} role="tab" aria-selected={aba === a} onClick={() => setAba(a)}>
                {a}{a === "Revisão" && build.achados.length > 0 && ` (${build.achados.filter((x) => x.status === "aberto").length})`}
              </button>
            ))}
          </nav>

          {aba === "Montagem" && <Montagem build={build} catalogo={catalogo} onBuild={atualizar} />}
          {aba === "Revisão" && <Revisao build={build} catalogo={catalogo} onBuild={atualizar} />}
          {aba === "3D" && <section className="card">{cena ? <Cena3D cena={cena} /> : <p className="suave">Carregando…</p>}</section>}
          {aba === "Jogos" && <Jogos build={build} builds={builds} />}
          {aba === "Resultado" && <ResultadoPainel build={build} onBuild={atualizar} />}
        </>
      )}
    </main>
  );
}
