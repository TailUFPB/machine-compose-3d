"use client";
import dynamic from "next/dynamic";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Entrada, ErroBloco, Jogos, type Metas, Montagem, PropostaCard, ResultadoPainel, Revisao, useAcao, VisaoGeral,
} from "@/components/Paineis";
import { api, type Build, type Cena, type CenaPrevia, type Componente, ErroApi, type Proposta } from "@/lib/api";
import { ultimaVence } from "@/lib/painel";
import { MODOS, rotuloBuild } from "@/lib/formato";

import PainelPeca, { idDaChave } from "@/components/PainelPeca";

const Cena3D = dynamic(() => import("@/components/Cena3D"), { ssr: false, loading: () => <span className="carregando" /> });

const METAS_INICIAIS: Metas = { modo: "agente", orcamento: 6000, cep: "", objetivos: { jogos: ["cyberpunk-2077", "cs2", "fortnite"], resolucao: "1080p", fps_alvo: 60 } };

// a visão geral é o "Resumo"; as etapas seguem a ordem de quem monta um PC
const VISTAS = [
  { id: "visao", nome: "Resumo" },
  { id: "metas", nome: "Metas" },
  { id: "pecas", nome: "Peças" },
  { id: "revisao", nome: "Revisão" },
  { id: "jogos", nome: "Jogos" },
  { id: "3d", nome: "3D" },
  { id: "compra", nome: "Compra" },
] as const;
const ETAPAS = VISTAS.slice(1);

/** Marca: um gabinete visto de frente com a ventoinha, no matiz dos dados. */
function Marca({ onClick }: { onClick: () => void }) {
  return (
    <a className="marca" href="#" onClick={(e) => { e.preventDefault(); onClick(); }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="5" y="2" width="14" height="20" rx="2" fill="#66c0f4" />
        <circle cx="12" cy="14" r="4" stroke="#171a21" strokeWidth="1.8" />
        <path d="M8.5 6h7" stroke="#171a21" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      Monta PC
    </a>
  );
}

function useVista(): [string, (v: string) => void] {
  const [vista, setVista] = useState("visao");
  useEffect(() => {
    const ler = () => setVista(location.hash.slice(1) || "visao");
    ler();
    addEventListener("hashchange", ler);
    return () => removeEventListener("hashchange", ler);
  }, []);
  const ir = useCallback((v: string) => { location.hash = v === "visao" ? "" : v; setVista(v); scrollTo(0, 0); }, []);
  return [vista, ir];
}

export default function Pagina() {
  const [vista, ir] = useVista();
  const [fonteDados, setFonteDados] = useState("");
  const [jogos, setJogos] = useState<{ id: string; nome: string }[]>([]);
  const [catalogo, setCatalogo] = useState<Record<string, Componente>>({});
  const [builds, setBuilds] = useState<Build[]>([]);
  const [build, setBuild] = useState<Build | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [cena, setCena] = useState<Cena | null>(null);
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);       // peça aberta, comum à cena e ao painel
  const [destaque, setDestaque] = useState<string | null>(null);   // peça sob o mouse, na lista ou na cena
  // Prévia de troca: nunca grava; a última candidata pedida vence (respostas atrasadas são ignoradas)
  const [previa, setPrevia] = useState<{ de: string; para: string; cena: CenaPrevia } | null>(null);
  const [pedindo, setPedindo] = useState<{ de: string; para: string } | null>(null);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const senhaPrevia = useRef(ultimaVence());
  const agenteAcao = useAcao();

  useEffect(() => {
    setErro(null);
    Promise.all([api.saude(), api.jogos(), api.catalogo(), api.builds()])
      .then(([s, j, c, b]) => {
        setFonteDados(s.dados);
        setJogos(j.jogos);
        setCatalogo(Object.fromEntries(c.map((x) => [x.id, x])));
        setBuilds(b);
        if (b.length) setBuild(b[b.length - 1]);
        setCarregado(true);
      })
      .catch(() => setErro("Não deu para falar com a API. Confira se o backend está rodando."));
  }, [tentativa]);

  const atualizar = useCallback((b: Build) => {
    setBuild(b);
    setBuilds((xs) => (xs.some((x) => x.id === b.id) ? xs.map((x) => (x.id === b.id ? b : x)) : [...xs, b]));
  }, []);

  const assinatura = build ? JSON.stringify([build.itens, build.achados.map((a) => a.id + a.status)]) : "";
  useEffect(() => {
    if (build && vista === "3d") api.cena(build.id).then(setCena).catch(() => setCena(null));
  }, [vista, build?.id, assinatura]);
  useEffect(() => { setProposta(null); setAberta(null); setDestaque(null); }, [build?.id]);

  const mensagem = (e: unknown) => (e instanceof ErroApi || e instanceof Error ? e.message : String(e));
  const pedirPrevia = useCallback((de: string, para: string) => {
    if (!build) return;
    const n = senhaPrevia.current.pedir();
    setPedindo({ de, para }); setErroPrevia(null);
    api.previa(build.id, de, para)
      .then((c) => { if (senhaPrevia.current.vale(n)) { setPrevia({ de, para, cena: c }); setPedindo(null); } })
      .catch((e) => { if (senhaPrevia.current.vale(n)) { setErroPrevia(mensagem(e)); setPedindo(null); } });
  }, [build?.id]);
  const cancelarPrevia = useCallback(() => { senhaPrevia.current.pedir(); setPrevia(null); setPedindo(null); }, []);
  const aplicarTroca = useCallback(async () => {
    if (!build || !previa) return;
    try {
      const b = await api.trocar(build.id, previa.de, previa.para);
      cancelarPrevia(); atualizar(b); setAberta(previa.para);
    } catch (e) { setErroPrevia(mensagem(e)); }
  }, [build?.id, previa]);
  // a build mudou (aqui ou em outra aba) ou a aba 3D saiu de cena: a prévia não vale mais
  useEffect(() => { cancelarPrevia(); setErroPrevia(null); }, [build?.id, assinatura, vista]);
  useEffect(() => {   // a peça aberta deixou de ser a que está sendo trocada (voltar à lista, clique fora): prévia órfã
    const de = previa?.de ?? pedindo?.de;
    if (de && idDaChave(aberta) !== de) cancelarPrevia();
  }, [aberta]);
  useEffect(() => {   // na prévia, Esc cancela (a cena não fecha a peça aberta por baixo)
    if (!previa && !pedindo) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") cancelarPrevia(); };
    addEventListener("keydown", tecla);
    return () => removeEventListener("keydown", tecla);
  }, [previa, pedindo]);

  const navegar = ir;
  const rotulo = (b: Build) => `${rotuloBuild(b)} · ${MODOS[b.modo].nome}`;
  const abertos = build?.achados.filter((a) => a.status === "aberto") ?? [];
  const bloqueantes = abertos.filter((a) => a.severidade === "bloqueante").length;
  const metasDaBuild = useMemo<Metas>(() => (build ? { modo: build.modo, orcamento: build.orcamento, cep: build.cep, objetivos: build.objetivos } : METAS_INICIAIS), [build?.id]);

  const agente = {
    ocupado: agenteAcao.ocupado,
    rodar: () => build && agenteAcao.rodar(async () => setProposta(await api.agente(build.id))),
    proposta: (
      <>
        <ErroBloco erro={agenteAcao.erro} />
        {proposta && build && (
          <PropostaCard proposta={proposta} catalogo={catalogo} ocupado={agenteAcao.ocupado} onDescartar={() => setProposta(null)}
            onAplicar={() => agenteAcao.rodar(async () => { atualizar(await api.aplicar(build.id, { proposta: true })); setProposta(null); })} />
        )}
      </>
    ),
  };

  const criar = async (f: Metas) => { atualizar(await api.criar(f)); navegar("visao"); };
  const salvarMetas = async (f: Metas) => { if (build) { atualizar(await api.atualizar(build.id, f)); navegar("visao"); } };
  const semBuild = carregado && !build;
  const vistaAtual = semBuild ? "nova" : vista;
  // etapa feita: o que já dá para afirmar com os dados da build
  const feita: Record<string, boolean> = {
    metas: !!build, pecas: !!build?.itens.length, revisao: !!build?.itens.length && bloqueantes === 0,
  };

  return (
    <>
      <header className="topo">
        <div className="topo-in">
          <Marca onClick={() => navegar("visao")} />
          {build && (
            <nav className="passos" aria-label="Etapas">
              <a href="#" aria-current={vistaAtual === "visao" ? "page" : undefined} onClick={(e) => { e.preventDefault(); navegar("visao"); }}>Resumo</a>
              {ETAPAS.map((v, i) => (
                <a key={v.id} href={`#${v.id}`} aria-current={vistaAtual === v.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); navegar(v.id); }}>
                  <span className={`n ${feita[v.id] && vistaAtual !== v.id ? "feito" : ""}`} aria-hidden>{feita[v.id] && vistaAtual !== v.id ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5.2l2 2L8 3" /></svg> : i + 1}</span>
                  {v.nome}
                  {feita[v.id] && <span className="sr"> (feito)</span>}
                  {v.id === "revisao" && abertos.length > 0 && <span className={`alerta num ${bloqueantes ? "neg" : ""}`} aria-label={`${abertos.length} abertos`}>{abertos.length}</span>}
                </a>
              ))}
            </nav>
          )}
          <div className="topo-dir">
            {builds.length > 0 && (
              <select value={build?.id ?? ""} aria-label="Trocar de build" onChange={(e) => { setBuild(builds.find((b) => b.id === e.target.value) ?? null); navegar("visao"); }}>
                {builds.map((b) => <option key={b.id} value={b.id}>{rotuloBuild(b)}</option>)}
              </select>
            )}
            <button className="btn" onClick={() => navegar("nova")}>Nova build</button>
          </div>
        </div>
      </header>

      <main className="canvas">
        {erro && <ErroBloco erro={erro} onTentar={() => setTentativa((t) => t + 1)} />}
        {!carregado && !erro && <><span className="carregando" style={{ width: 320, height: 24 }} /><span className="carregando" /></>}

        {carregado && (vistaAtual === "nova" || vistaAtual === "metas") && (
          <>
            <div className="titulo">
              <div>
                <h1>{vistaAtual === "nova" ? "Nova build" : "Metas da build"}</h1>
                <p className="sub">Orçamento, jogos e FPS que você quer. Com isso o agente escolhe as peças, ou você monta à mão.</p>
              </div>
            </div>
            {vistaAtual === "nova"
              ? <Entrada jogos={jogos} inicial={METAS_INICIAIS} onEnviar={criar} onCancelar={build ? () => navegar("visao") : undefined} rotulo="Criar build" />
              : <Entrada jogos={jogos} inicial={metasDaBuild} onEnviar={salvarMetas} onCancelar={() => navegar("visao")} rotulo="Salvar metas" />}
          </>
        )}

        {build && vistaAtual === "visao" && <VisaoGeral build={build} catalogo={catalogo} ir={navegar} agente={agente} />}
        {build && vistaAtual === "pecas" && <Montagem build={build} catalogo={catalogo} onBuild={atualizar} agente={agente} />}
        {build && vistaAtual === "revisao" && <Revisao build={build} catalogo={catalogo} onBuild={atualizar} />}
        {build && vistaAtual === "jogos" && <Jogos build={build} builds={builds} rotulo={rotulo} />}
        {build && vistaAtual === "compra" && <ResultadoPainel build={build} catalogo={catalogo} onBuild={atualizar} />}
        {build && vistaAtual === "3d" && (
          <>
            <div className="titulo">
              <div>
                <h1>Montagem 3D</h1>
                <p className="sub">Peças em escala pela ficha técnica. O que conflita fica em vermelho; o modo passo a passo mostra a ordem de montagem.</p>
              </div>
            </div>
            <section className="card cena-com-painel" aria-label="Cena 3D">
              {cena ? (
                <>
                  <Cena3D key={build?.id} cena={previa?.cena ?? cena} aberta={aberta} onAberta={setAberta} destaque={destaque}
                    onDestaque={setDestaque} previa={previa && { para: previa.para }} escNoPainel={!!(previa || pedindo)} />
                  <PainelPeca build={build} catalogo={catalogo} cena={cena} aberta={aberta} onAberta={setAberta}
                    destaque={destaque} onDestaque={setDestaque} onBuild={atualizar}
                    previa={previa} pedindo={pedindo} erroPrevia={erroPrevia}
                    onPrevia={pedirPrevia} onCancelarPrevia={cancelarPrevia} onAplicarTroca={aplicarTroca} />
                </>
              ) : <span className="carregando" />}
            </section>
          </>
        )}
        {fonteDados && <p className="fonte-dados">{fonteDados}</p>}
      </main>
    </>
  );
}
