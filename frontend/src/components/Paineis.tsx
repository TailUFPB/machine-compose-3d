"use client";
import { useEffect, useState } from "react";
import {
  type Achado, api, type Build, type Componente, ErroApi, type Estimativa, type Importacao, type Proposta,
  type Resultado, type ResultadoPreco, type Tipo,
} from "@/lib/api";
import { brl, SEVERIDADE, TIPOS } from "@/lib/formato";
import Fluidez from "./Fluidez";

type Atualizar = (b: Build) => void;
type Catalogo = Record<string, Componente>;

const TIPOS_ESCOLHA: Tipo[] = ["cpu", "gpu", "placa_mae", "memoria", "armazenamento", "fonte", "gabinete", "cooler", "extra"];

export function Erro({ erro }: { erro: string | null }) {
  return erro ? <p className="erro-caixa" role="alert">{erro}</p> : null;
}

function useAcao() {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const rodar = async (f: () => Promise<void>) => {
    setOcupado(true); setErro(null);
    try { await f(); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); } finally { setOcupado(false); }
  };
  return { ocupado, erro, rodar };
}

// ---------------------------------------------------------------- Montagem
export function Montagem({ build, catalogo, onBuild }: { build: Build; catalogo: Catalogo; onBuild: Atualizar }) {
  const { ocupado, erro, rodar } = useAcao();
  const [tipo, setTipo] = useState<Tipo>("cpu");
  const [todos, setTodos] = useState(false);
  const [opcoes, setOpcoes] = useState<Componente[]>([]);
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [texto, setTexto] = useState("");
  const [jaTenho, setJaTenho] = useState(false);
  const [importacao, setImportacao] = useState<Importacao | null>(null);
  const assinatura = build.itens.map((i) => i.componente_id).join();

  useEffect(() => {
    api.componentes(tipo, build.id, todos).then(setOpcoes).catch(() => setOpcoes([]));
  }, [tipo, todos, build.id, assinatura]);

  const nome = (id: string) => catalogo[id]?.nome ?? id;
  const rotuloAgente = build.modo === "manual" ? "Copiloto: completar o que falta" : build.modo === "hibrido" ? "Completar com o agente (mantém travadas)" : "Montar com o agente";

  return (
    <div className="grade">
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="linha entre"><h2>Lista da build</h2><span className="suave">modo {build.modo}</span></div>
        {build.itens.length === 0 && <p className="suave">Lista vazia. Escolha peças ao lado, importe uma lista ou use o agente.</p>}
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Peça</th><th>Qtd</th><th>Travada</th><th>Já tenho</th><th></th></tr></thead>
            <tbody>
              {build.itens.map((i) => (
                <tr key={i.componente_id}>
                  <td>
                    <div><span className="suave">{TIPOS[catalogo[i.componente_id]?.tipo ?? "extra"]}</span> · {nome(i.componente_id)}</div>
                    <div className="suave">{brl(catalogo[i.componente_id]?.preco.med)} {i.origem === "agente" && "· escolhida pelo agente"}</div>
                    {i.justificativa && <div className="suave">{i.justificativa}</div>}
                  </td>
                  <td>
                    <input type="number" min={1} max={8} value={i.quantidade} style={{ width: 56 }} aria-label="Quantidade"
                      onChange={(e) => rodar(async () => onBuild(await api.atualizarItem(build.id, i.componente_id, { quantidade: +e.target.value })))} />
                  </td>
                  <td><input type="checkbox" checked={i.travado} aria-label="Travar peça"
                    onChange={(e) => rodar(async () => onBuild(await api.atualizarItem(build.id, i.componente_id, { travado: e.target.checked })))} /></td>
                  <td><input type="checkbox" checked={i.ja_tenho} aria-label="Já tenho esta peça"
                    onChange={(e) => rodar(async () => onBuild(await api.atualizarItem(build.id, i.componente_id, { ja_tenho: e.target.checked, travado: e.target.checked || i.travado })))} /></td>
                  <td><button className="perigo" onClick={() => rodar(async () => onBuild(await api.remover(build.id, i.componente_id)))}>Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="linha" style={{ marginTop: 12 }}>
          <button className="primario" disabled={ocupado} onClick={() => rodar(async () => setProposta(await api.agente(build.id)))}>{rotuloAgente}</button>
        </div>
        <Erro erro={erro} />
        {proposta && (
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Proposta do agente {proposta.convergiu ? <span className="selo ok">sem bloqueantes</span> : <span className="selo sev-bloqueante">com alertas</span>}</h3>
            <p className="suave">{proposta.tentativas} tentativa(s) no loop propositor ↔ revisores · custo estimado {brl(proposta.custo_estimado)}</p>
            {proposta.avisos.map((a) => <p key={a} className="sev-atencao">{a}</p>)}
            <ul>{proposta.itens.map((i) => <li key={i.componente_id}><strong>{nome(i.componente_id)}</strong>{i.travado && " (travada)"}<div className="suave">{i.justificativa}</div></li>)}</ul>
            {proposta.achados.filter((a) => a.severidade !== "sugestao").map((a) => <p key={a.id} className={`sev-${a.severidade}`}>{SEVERIDADE[a.severidade]}: {a.descricao}</p>)}
            <div className="linha">
              <button className="primario" onClick={() => rodar(async () => { onBuild(await api.aplicar(build.id, { proposta: true })); setProposta(null); })}>Aplicar proposta</button>
              <button onClick={() => setProposta(null)}>Descartar</button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Escolher peça</h2>
        <div className="linha">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} aria-label="Tipo de peça">
            {TIPOS_ESCOLHA.map((t) => <option key={t} value={t}>{TIPOS[t]}</option>)}
          </select>
          <label className="linha" style={{ display: "flex" }}>
            <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> ver incompatíveis
          </label>
        </div>
        <ul style={{ listStyle: "none", padding: 0, maxHeight: 420, overflowY: "auto" }}>
          {opcoes.map((c) => (
            <li key={c.id} className="linha entre" style={{ padding: "6px 0", borderBottom: "1px solid var(--borda)" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div>{c.nome}</div>
                <div className="suave">{brl(c.preco.med)}{c.preco.min != null && ` (${brl(c.preco.min)} a ${brl(c.preco.max)})`}</div>
                {!c.compativel && <div className="erro" style={{ fontSize: ".8rem" }}>Incompatível: {c.motivo}</div>}
              </div>
              <button disabled={ocupado} onClick={() => rodar(async () => onBuild(await api.adicionar(build.id, c.id)))}>Adicionar</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Importar lista</h2>
        <p className="suave">Cole o texto de um carrinho, de uma lista do PCPartPicker (Markdown/Text) ou uma peça por linha.</p>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={"CPU: AMD Ryzen 5 7600\nRTX 4060 8GB\n2x Kingston Fury Beast DDR5 32GB"} aria-label="Lista para importar" />
        <div className="linha" style={{ marginTop: 8 }}>
          <label className="linha" style={{ display: "flex" }}><input type="checkbox" checked={jaTenho} onChange={(e) => setJaTenho(e.target.checked)} /> são peças que já tenho (upgrade)</label>
          <button disabled={!texto.trim() || ocupado} onClick={() => rodar(async () => setImportacao(await api.importar(build.id, texto, jaTenho)))}>Reconhecer</button>
        </div>
        {importacao && (
          <div style={{ marginTop: 8 }}>
            {importacao.avisos.map((a) => <p key={a} className="sev-atencao">{a}</p>)}
            {importacao.itens.length > 0 && <ul>{importacao.itens.map((i) => <li key={i.componente_id}>{i.quantidade}x {nome(i.componente_id)}</li>)}</ul>}
            {importacao.nao_reconhecidas.length > 0 && <p className="suave">Não reconhecidas: {importacao.nao_reconhecidas.join("; ")}</p>}
            {importacao.itens.length > 0 && (
              <button className="primario" onClick={() => rodar(async () => { onBuild(await api.aplicar(build.id, { itens: importacao.itens })); setImportacao(null); setTexto(""); })}>
                Adicionar à lista
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Revisão
export function Revisao({ build, catalogo, onBuild }: { build: Build; catalogo: Catalogo; onBuild: Atualizar }) {
  const { ocupado, erro, rodar } = useAcao();
  const nome = (id: string | null) => (id ? catalogo[id]?.nome ?? id : "");
  const grupos: Achado["severidade"][] = ["bloqueante", "atencao", "sugestao"];
  return (
    <section className="card">
      <div className="linha entre">
        <h2>Revisão de compatibilidade</h2>
        <button disabled={ocupado} onClick={() => rodar(async () => onBuild(await api.revisar(build.id)))}>Revisar de novo</button>
      </div>
      <p className="suave">Camada 1: regras da ficha técnica. Camada 2: revisores de plataforma, espaço físico e elétrico. Achado sem fonte aparece como não verificado e nunca bloqueia.</p>
      <Erro erro={erro} />
      {build.achados.length === 0 && <p className="ok">Nenhum achado.</p>}
      {grupos.map((g) => {
        const lista = build.achados.filter((a) => a.severidade === g);
        if (!lista.length) return null;
        return (
          <div key={g}>
            <h3 className={`sev-${g}`}>{SEVERIDADE[g]} ({lista.length})</h3>
            {lista.map((a) => (
              <div key={a.id} className={`achado sev-${g}`} style={{ opacity: a.status === "aberto" ? 1 : 0.55 }}>
                <div className="linha">
                  <span className="selo">{a.agente.replace("_", " ")}</span>
                  {!a.verificado && <span className="selo sev-atencao">não verificado</span>}
                  {a.status !== "aberto" && <span className="selo">{a.status}</span>}
                </div>
                <p>{a.descricao}</p>
                {a.correcao_sugerida && (
                  <p className="suave">
                    Correção: {a.correcao_sugerida.acao} {nome(a.correcao_sugerida.componente_id)}{a.correcao_sugerida.para_id && ` → ${nome(a.correcao_sugerida.para_id)}`}
                    {a.impacto_preco != null && ` · ${a.impacto_preco >= 0 ? "+" : ""}${brl(a.impacto_preco)}`}
                    {a.impacto_fps && ` · ${a.impacto_fps}`}
                  </p>
                )}
                <p className="suave">Fonte: {a.fonte_url ?? "sem fonte"}</p>
                {a.status === "aberto" && (
                  <div className="linha">
                    {a.correcao_sugerida && <button disabled={ocupado} onClick={() => rodar(async () => onBuild(await api.aplicar(build.id, { achado_id: a.id })))}>Aplicar correção</button>}
                    <button disabled={ocupado} onClick={() => rodar(async () => onBuild(await api.ignorar(build.id, a.id)))}>Ignorar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------- Jogos
export function Jogos({ build, builds }: { build: Build; builds: Build[] }) {
  const [fps, setFps] = useState<Estimativa[]>([]);
  const [outra, setOutra] = useState("");
  const [comparacao, setComparacao] = useState<{ a: Estimativa[]; b: Estimativa[]; custo_a: number; custo_b: number } | null>(null);
  const assinatura = build.itens.map((i) => i.componente_id).join() + build.objetivos.resolucao + build.objetivos.jogos.join();
  useEffect(() => { api.fps(build.id).then(setFps).catch(() => setFps([])); }, [build.id, assinatura]);
  useEffect(() => {
    if (!outra) return setComparacao(null);
    api.comparar(build.id, outra, build.objetivos.resolucao).then(setComparacao).catch(() => setComparacao(null));
  }, [outra, build.id, assinatura]);
  const [demo, setDemo] = useState(0);
  const e = fps[demo];
  return (
    <div>
      <section className="card">
        <h2>Desempenho previsto · {build.objetivos.resolucao} · preset {fps[0]?.preset ?? "Alto"}</h2>
        {fps.length === 0 && <p className="suave">Precisa de CPU e GPU na build para estimar FPS.</p>}
        {fps.length > 0 && (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Jogo</th><th>FPS médio</th><th>Faixa</th><th>1% low</th><th>Gargalo</th><th>Tipo</th><th>Confiança</th><th>FPS / R$ 1 mil</th></tr></thead>
              <tbody>
                {fps.map((f) => (
                  <tr key={f.jogo}>
                    <td>{f.jogo_nome}</td>
                    <td className={f.fps_med >= build.objetivos.fps_alvo ? "ok" : "erro"}><strong>{Math.round(f.fps_med)}</strong></td>
                    <td>{Math.round(f.fps_min)}–{Math.round(f.fps_max)}</td>
                    <td>{Math.round(f.fps_1low)}</td>
                    <td>{f.gargalo?.toUpperCase() ?? "-"}</td>
                    <td><span className="selo" title={`Fonte: ${f.fontes.join(", ")}`}>{f.tipo}</span></td>
                    <td>{f.confianca}</td>
                    <td>{f.fps_por_mil_reais ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="suave">Fonte de cada linha no selo "tipo". Estimado = interpolado a partir das medições mais próximas, com faixa.</p>
      </section>
      {e && (
        <section className="card">
          <div className="linha entre">
            <h2>Como fica na tela</h2>
            <select value={demo} onChange={(ev) => setDemo(+ev.target.value)} aria-label="Jogo da demonstração">
              {fps.map((f, i) => <option key={f.jogo} value={i}>{f.jogo_nome}</option>)}
            </select>
          </div>
          <div className="grade">
            <Fluidez fps={e.fps_med} low={e.fps_1low} rotulo={`${e.jogo_nome} (${e.tipo})`} />
            {comparacao?.b[demo] && <Fluidez fps={comparacao.b[demo].fps_med} low={comparacao.b[demo].fps_1low} rotulo="Build comparada" />}
          </div>
        </section>
      )}
      <section className="card">
        <h2>Comparar com outra build</h2>
        <select value={outra} onChange={(ev) => setOutra(ev.target.value)} aria-label="Build para comparar">
          <option value="">escolha…</option>
          {builds.filter((b) => b.id !== build.id).map((b) => <option key={b.id} value={b.id}>{b.id} · {b.modo} · {brl(b.orcamento)}</option>)}
        </select>
        {comparacao && (
          <div className="tabela-rolagem">
            <table>
              <thead><tr><th>Jogo</th><th>Esta ({brl(comparacao.custo_a)})</th><th>Outra ({brl(comparacao.custo_b)})</th><th>Diferença</th></tr></thead>
              <tbody>
                {comparacao.a.map((x, i) => {
                  const y = comparacao.b[i];
                  return (
                    <tr key={x.jogo}>
                      <td>{x.jogo_nome}</td><td>{Math.round(x.fps_med)} <span className="suave">({x.tipo})</span></td>
                      <td>{y ? <>{Math.round(y.fps_med)} <span className="suave">({y.tipo})</span></> : "-"}</td>
                      <td>{y ? `${((y.fps_med / x.fps_med - 1) * 100).toFixed(0)}%` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Resultado
export function ResultadoPainel({ build, onBuild }: { build: Build; onBuild: Atualizar }) {
  const { ocupado, erro, rodar } = useAcao();
  const [res, setRes] = useState<Resultado | null>(null);
  const [precos, setPrecos] = useState<ResultadoPreco[]>([]);
  const [override, setOverride] = useState<{ bloqueantes: string[]; confirmacao_exigida: string } | null>(null);
  const [digitado, setDigitado] = useState("");
  const assinatura = JSON.stringify(build.itens);
  useEffect(() => {
    api.resultado(build.id).then(setRes).catch(() => setRes(null));
    api.precos(build.id).then(setPrecos).catch(() => setPrecos([]));
  }, [build.id, assinatura]);

  const baixar = (blob: Blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `build-${build.id}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportar = () => rodar(async () => {
    try { baixar(await api.exportar(build.id)); } catch (e) {
      if (e instanceof ErroApi && e.status === 409) setOverride(e.detalhe);
      else throw e;
    }
  });

  if (!res) return <p className="suave">Carregando…</p>;
  return (
    <div>
      <section className="card">
        <div className="linha entre">
          <h2>Plano de compra</h2>
          <button className="primario" disabled={ocupado || !build.itens.length} onClick={exportar}>Exportar Excel</button>
        </div>
        <Erro erro={erro} />
        <p>
          Total <strong>{brl(res.total)}</strong> de {brl(res.orcamento)} ·{" "}
          {res.cabe ? <span className="ok">cabe, sobram {brl(res.diferenca)}</span> : <span className="erro">faltam {brl(-res.diferenca)}</span>}
        </p>
        <div className="barra" aria-hidden><span style={{ width: `${Math.min(100, (res.total / res.orcamento) * 100)}%`, background: res.cabe ? "var(--ok)" : "var(--erro)" }} /></div>
        <p className="suave">Frete: {res.frete}. {res.ja_tenho.length > 0 && `Já possui: ${res.ja_tenho.join(", ")}.`}</p>
        {res.sem_preco.length > 0 && <p className="sev-atencao">Sem preço com fonte: {res.sem_preco.join(", ")}</p>}
        {Object.entries(res.lojas).map(([loja, linhas]) => (
          <div key={loja} className="tabela-rolagem">
            <h3>{loja} · {brl(res.total_por_loja[loja])}</h3>
            <table>
              <thead><tr><th>Peça</th><th>Qtd</th><th>Preço</th><th>Faixa (mín/méd/máx)</th><th>Fonte</th></tr></thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.componente_id}>
                    <td>{l.nome}</td><td>{l.quantidade}</td><td>{brl(l.subtotal)}</td>
                    <td className="suave">{brl(l.faixa[0])} / {brl(l.faixa[1])} / {brl(l.faixa[2])} · {l.confianca}</td>
                    <td><a href={l.url} target="_blank" rel="noreferrer">anúncio</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Sugestões de troca</h2>
        {res.trocas.length === 0 && <p className="suave">Nenhuma troca vantajosa encontrada.</p>}
        <ul>
          {res.trocas.map((t) => (
            <li key={t.de_id + t.para_id} style={{ marginBottom: 8 }}>
              <strong>{t.texto}</strong>: {t.de_nome} → {t.para_nome}
              {t.impacto_fps_pct != null && <span className="suave"> ({t.impacto_fps_pct >= 0 ? "+" : ""}{t.impacto_fps_pct}% FPS, estimado)</span>}{" "}
              <button disabled={ocupado} onClick={() => rodar(async () => onBuild(await api.adicionar(build.id, t.para_id)))}>Aplicar troca</button>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Pesquisa de preço por peça</h2>
        <div className="tabela-rolagem">
          <table>
            <thead><tr><th>Peça</th><th>Lojas</th><th>Faixa</th><th>Descartes</th><th>Histórico (8 sem.)</th></tr></thead>
            <tbody>
              {precos.map((p) => (
                <tr key={p.componente_id}>
                  <td>{p.componente_id}{p.do_cache && <div className="suave">cache{p.vencido && " vencido"}</div>}</td>
                  <td>{p.ofertas.map((o) => <div key={o.url + o.loja}><a href={o.url} target="_blank" rel="noreferrer">{o.loja}</a> {brl(o.preco)}</div>)}</td>
                  <td>{brl(p.preco_min)} – {brl(p.preco_max)}<div className="suave">confiança {p.confianca ?? "-"}</div></td>
                  <td className="suave">{p.descartes.map((d, i) => <div key={i}>{d.loja}: {d.motivo}</div>)}</td>
                  <td><Sparkline pontos={mediaPorDia(p.historico)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {override && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-override"
          onKeyDown={(e) => { if (e.key === "Escape") { setOverride(null); setDigitado(""); } }}>
          <div className="card">
            <h2 id="titulo-override" className="erro">Há achados bloqueantes</h2>
            <ul>{override.bloqueantes.map((b) => <li key={b}>{b}</li>)}</ul>
            <p>Para exportar mesmo assim, digite <strong>{override.confirmacao_exigida}</strong>:</p>
            <input autoFocus value={digitado} onChange={(e) => setDigitado(e.target.value)} aria-label="Confirmação" style={{ width: "100%" }} />
            <div className="linha" style={{ marginTop: 12 }}>
              <button className="perigo" disabled={digitado !== override.confirmacao_exigida}
                onClick={() => rodar(async () => { baixar(await api.exportar(build.id, true, digitado)); setOverride(null); setDigitado(""); })}>
                Exportar mesmo assim
              </button>
              <button onClick={() => { setOverride(null); setDigitado(""); }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function mediaPorDia(h: { preco: number; coletado_em: string }[]): number[] {
  const dias = new Map<string, number[]>();
  for (const x of h) dias.set(x.coletado_em.slice(0, 10), [...(dias.get(x.coletado_em.slice(0, 10)) ?? []), x.preco]);
  return [...dias.keys()].sort().map((d) => dias.get(d)!.reduce((a, b) => a + b, 0) / dias.get(d)!.length);
}

function Sparkline({ pontos }: { pontos: number[] }) {
  if (pontos.length < 2) return <span className="suave">-</span>;
  const min = Math.min(...pontos), max = Math.max(...pontos), w = 100, h = 24;
  const d = pontos.map((p, i) => `${(i / (pontos.length - 1)) * w},${h - ((p - min) / (max - min || 1)) * h}`).join(" ");
  return (
    <svg width={w} height={h} role="img" aria-label={`de ${brl(pontos[0])} a ${brl(pontos[pontos.length - 1])}`}>
      <polyline points={d} fill="none" stroke="var(--primaria)" strokeWidth="1.5" />
    </svg>
  );
}
