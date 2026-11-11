"use client";
import { type ReactNode, useEffect, useState } from "react";
import {
  type Achado, api, type Build, type Componente, ErroApi, type Estimativa, type Importacao, type Modo, type Objetivos,
  type Proposta, type Resultado, type ResultadoPreco, type Tipo,
} from "@/lib/api";
import { brl, brlRedondo, MODOS, SEVERIDADE, TIPOS } from "@/lib/formato";
import Fluidez from "./Fluidez";

type Atualizar = (b: Build) => void;
type Catalogo = Record<string, Componente>;

const TIPOS_ESCOLHA: Tipo[] = ["cpu", "gpu", "placa_mae", "memoria", "armazenamento", "fonte", "gabinete", "cooler", "extra"];
const SEV_PILL = { bloqueante: "neg", atencao: "aviso", sugestao: "" } as const;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const minusculo = (t: Tipo) => TIPOS[t].toLowerCase();
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const juntar = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);

export function ErroBloco({ erro, onTentar }: { erro: string | null; onTentar?: () => void }) {
  if (!erro) return null;
  return (
    <div className="erro-bloco" role="alert">
      <span>{erro}</span>
      {onTentar && <button className="btn texto" onClick={onTentar}>Tentar de novo</button>}
    </div>
  );
}

function Preco({ v, className }: { v: number | null | undefined; className?: string }) {
  return v == null ? <span className="vazio">sem preço</span> : <span className={`num ${className ?? ""}`}>{brl(v)}</span>;
}

export function useAcao() {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const rodar = async (f: () => Promise<void>) => {
    setOcupado(true); setErro(null);
    try { await f(); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); } finally { setOcupado(false); }
  };
  return { ocupado, erro, rodar };
}

export const rotuloAgente = (modo: Modo, temItens: boolean) =>
  modo === "manual" ? "Completar com o agente" : modo === "hibrido" ? "Completar o que falta" : temItens ? "Montar de novo" : "Montar com o agente";

// ---------------------------------------------------------------- Entrada (nova build e metas)
export interface Metas { modo: Modo; orcamento: number; cep: string; objetivos: Objetivos }

export function Entrada({ jogos, inicial, onEnviar, onCancelar, rotulo }: {
  jogos: { id: string; nome: string }[]; inicial: Metas; onEnviar: (f: Metas) => Promise<void> | void; onCancelar?: () => void; rotulo: string;
}) {
  const [f, setF] = useState(inicial);
  const { ocupado, erro, rodar } = useAcao();
  useEffect(() => setF(inicial), [inicial]);
  const obj = (o: Partial<Objetivos>) => setF({ ...f, objetivos: { ...f.objetivos, ...o } });
  const alternar = (id: string) => obj({ jogos: f.objetivos.jogos.includes(id) ? f.objetivos.jogos.filter((j) => j !== id) : [...f.objetivos.jogos, id] });
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); rodar(async () => { await onEnviar(f); }); }}>
      <div className="form-grade">
        <label className="campo">
          <span>Orçamento</span>
          <input type="number" min={500} step={100} value={f.orcamento} onChange={(e) => setF({ ...f, orcamento: +e.target.value })} required aria-describedby="orc-dica" />
          <small id="orc-dica">Em reais, sem as peças que você já tem.</small>
        </label>
        <div className="campo">
          <span id="res-rotulo">Resolução</span>
          <div className="segmentado" role="group" aria-labelledby="res-rotulo">
            {(["1080p", "1440p"] as const).map((r) => (
              <button key={r} type="button" aria-pressed={f.objetivos.resolucao === r} onClick={() => obj({ resolucao: r })}>{r}</button>
            ))}
          </div>
        </div>
        <label className="campo">
          <span>FPS desejado</span>
          <input type="number" min={30} max={500} value={f.objetivos.fps_alvo} onChange={(e) => obj({ fps_alvo: +e.target.value })} />
        </label>
        <label className="campo">
          <span>CEP</span>
          <input inputMode="numeric" pattern="\d{5}-?\d{3}" placeholder="00000-000" value={f.cep} onChange={(e) => setF({ ...f, cep: e.target.value })} aria-describedby="cep-dica" />
          <small id="cep-dica">Opcional, para o frete.</small>
        </label>
        <fieldset className="campo largo" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 500, marginBottom: 8, padding: 0 }}>Jogos</legend>
          <div className="chips">
            {jogos.map((j) => (
              <label key={j.id} className="chip">
                <input type="checkbox" checked={f.objetivos.jogos.includes(j.id)} onChange={() => alternar(j.id)} /> {j.nome}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="campo largo" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 500, marginBottom: 8, padding: 0 }}>Quem escolhe as peças</legend>
          <div className="modos">
            {(Object.keys(MODOS) as Modo[]).map((m) => (
              <label key={m} className="modo">
                <input type="radio" name="modo" checked={f.modo === m} onChange={() => setF({ ...f, modo: m })} />
                <strong>{MODOS[m].nome}</strong>
                <small>{MODOS[m].texto}</small>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <ErroBloco erro={erro} />
      <div className="form-pe">
        {onCancelar && <button type="button" className="btn" onClick={onCancelar}>Cancelar</button>}
        <button className="btn primario" type="submit" disabled={ocupado || !f.objetivos.jogos.length}>{rotulo}</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- Proposta do agente
export function PropostaCard({ proposta, catalogo, onAplicar, onDescartar, ocupado }: {
  proposta: Proposta; catalogo: Catalogo; onAplicar: () => void; onDescartar: () => void; ocupado: boolean;
}) {
  const alertas = proposta.achados.filter((a) => a.severidade !== "sugestao");
  return (
    <section className="card proposta" aria-labelledby="proposta-titulo">
      <div className="card-topo">
        <h2 id="proposta-titulo">Proposta do agente</h2>
        <span className="meta num">{brl(proposta.custo_estimado)} · {proposta.tentativas} {proposta.tentativas === 1 ? "rodada" : "rodadas"} de revisão</span>
      </div>
      {proposta.avisos.map((a) => <p key={a} className="aviso-bloco">{a}</p>)}
      <ul className="lista">
        {proposta.itens.map((i) => {
          const c = catalogo[i.componente_id];
          return (
            <li key={i.componente_id}>
              <span className="linha1">{c?.nome ?? i.componente_id}{i.travado && <span className="muted"> · travada</span>}</span>
              <span className="dir"><Preco v={c?.preco.min} /></span>
              {i.justificativa && <span className="linha2">{i.justificativa}</span>}
            </li>
          );
        })}
      </ul>
      {alertas.map((a) => <p key={a.id}><span className={`pill ${SEV_PILL[a.severidade]}`}>{SEVERIDADE[a.severidade]}</span> {a.descricao}</p>)}
      <div className="acoes" style={{ marginTop: 16 }}>
        <button className="btn primario" disabled={ocupado} onClick={onAplicar}>Aplicar na build</button>
        <button className="btn" onClick={onDescartar}>Descartar</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Exportar (com a confirmação dos bloqueantes)
export function BotaoExportar({ build, primario }: { build: Build; primario?: boolean }) {
  const { ocupado, erro, rodar } = useAcao();
  const [override, setOverride] = useState<{ bloqueantes: string[]; confirmacao_exigida: string } | null>(null);
  const [digitado, setDigitado] = useState("");
  const baixar = (blob: Blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `build-${build.id}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const fechar = () => { setOverride(null); setDigitado(""); };
  const exportar = () => rodar(async () => {
    try { baixar(await api.exportar(build.id)); } catch (e) {
      if (e instanceof ErroApi && e.status === 409) setOverride(e.detalhe);
      else throw e;
    }
  });
  return (
    <>
      <button className={`btn ${primario ? "primario" : ""}`} disabled={ocupado || !build.itens.length} onClick={exportar}>Exportar planilha</button>
      {erro && <span className="neg" role="alert">{erro}</span>}
      {override && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="titulo-override" onKeyDown={(e) => e.key === "Escape" && fechar()}>
          <div className="card">
            <h2 id="titulo-override" style={{ fontSize: 18 }}>A build tem {override.bloqueantes.length === 1 ? "um problema bloqueante" : `${override.bloqueantes.length} problemas bloqueantes`}</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{override.bloqueantes.map((b) => <li key={b}>{b}</li>)}</ul>
            <label className="campo">
              <span>Para exportar mesmo assim, digite <strong>{override.confirmacao_exigida}</strong></span>
              <input autoFocus value={digitado} onChange={(e) => setDigitado(e.target.value)} />
            </label>
            <div className="acoes">
              <button className="btn perigo" disabled={digitado !== override.confirmacao_exigida}
                onClick={() => rodar(async () => { baixar(await api.exportar(build.id, true, digitado)); fechar(); })}>Exportar mesmo assim</button>
              <button className="btn" onClick={fechar}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Visão geral
interface Parte { id: string; tipo: Tipo; nome: string; valor: number }

function OrcamentoPecaAPeca({ partes, total, orcamento, foco, onFoco }: { partes: Parte[]; total: number; orcamento: number; foco: string | null; onFoco: (id: string | null) => void }) {
  const escala = Math.max(total, orcamento);
  const x = (v: number) => `${(v / escala) * 100}%`;
  let acc = 0;
  const segs = partes.map((p) => { const s = { ...p, de: acc }; acc += p.valor; return s; });
  const corte = (orcamento / escala) * 100;
  const camada = (estouro: boolean) => (
    <div className={`camada ${estouro ? "estouro" : ""}`} style={{ clipPath: estouro ? `inset(0 0 0 ${corte}%)` : `inset(0 ${100 - corte}% 0 0)` }} aria-hidden>
      {segs.map((s) => <span key={s.id} className={`seg ${foco === s.id ? "ativo" : ""}`} style={{ left: x(s.de), width: x(s.valor) }} />)}
    </div>
  );
  return (
    <div className="orcamento">
      <div className="escala cima">
        <span className={total > orcamento ? "ate-marco" : "fim"} style={{ left: total > orcamento ? x(orcamento) : "100%", color: "var(--text)" }}>Orçamento {brlRedondo(orcamento)}</span>
      </div>
      <div className={`trilho ${foco ? "foco" : ""}`} role="img"
        aria-label={`${brl(total)} de ${brl(orcamento)}; ${partes.map((p) => `${p.nome} ${brl(p.valor)}`).join(", ")}`}>
        <span className="fundo" style={{ width: x(orcamento) }} />
        {camada(false)}
        {total > orcamento && camada(true)}
        <span className="marco" style={{ left: `calc(${x(orcamento)} - 1px)` }} />
      </div>
      <div className="escala">
        <span style={{ left: 0 }}>R$ 0</span>
        <span className={`fim ${total > orcamento ? "neg" : ""}`} style={{ left: "100%" }}>Total {brl(total)}</span>
      </div>
      <ul className="lista pecas-orc" style={{ marginTop: 16 }} onMouseLeave={() => onFoco(null)}>
        {partes.map((p) => (
          <li key={p.id} className={foco === p.id ? "ativo" : ""} onMouseEnter={() => onFoco(p.id)} onFocus={() => onFoco(p.id)} tabIndex={0}>
            <span className="linha1">{p.nome}</span>
            <span className="dir"><span className="num">{brl(p.valor)}</span><small>{pct(p.valor / total)} do total</small></span>
            <span className="linha2">{TIPOS[p.tipo]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VisaoGeral({ build, catalogo, ir, agente }: {
  build: Build; catalogo: Catalogo; ir: (v: string) => void;
  agente: { rodar: () => void; ocupado: boolean; proposta: ReactNode };
}) {
  const [res, setRes] = useState<Resultado | null>(null);
  const [fps, setFps] = useState<Estimativa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const assinatura = JSON.stringify([build.itens, build.objetivos]);
  useEffect(() => {
    setErro(null);
    Promise.all([api.resultado(build.id), api.fps(build.id)])
      .then(([r, f]) => { setRes(r); setFps(f); })
      .catch(() => setErro("Não deu para carregar preços e FPS desta build."));
  }, [build.id, assinatura, tentativa]);

  const partes: Parte[] = res
    ? Object.values(res.lojas).flat().map((l) => ({ id: l.componente_id, tipo: catalogo[l.componente_id]?.tipo ?? "extra", nome: l.nome, valor: l.subtotal }))
        .sort((a, b) => b.valor - a.valor)
    : [];
  const abertos = build.achados.filter((a) => a.status === "aberto");
  const bloqueantes = abertos.filter((a) => a.severidade === "bloqueante");
  const alvo = build.objetivos.fps_alvo;
  const abaixo = (fps ?? []).filter((f) => f.fps_med < alvo);
  const pior = (fps ?? []).reduce<Estimativa | null>((m, f) => (!m || f.fps_med < m.fps_med ? f : m), null);
  const vazia = build.itens.length === 0;

  // a frase do título: o achado do dia, calculado dos números que a tela mostra
  let achado: ReactNode = `Sem peças ainda. O agente monta a build mais barata que passa de ${alvo} FPS nos seus jogos.`;
  if (!vazia && res) {
    const topo = partes.slice(0, 2);
    const fatia = topo.reduce((s, p) => s + p.valor, 0) / (res.total || 1);
    achado = (
      <>
        {res.cabe ? <>Cabe no orçamento, <strong>sobram {brl(res.diferenca)}</strong>. </> : <><strong className="neg">Passa {brl(-res.diferenca)} do orçamento.</strong> </>}
        {topo.length === 2 && `${maiuscula(juntar(topo.map((p) => minusculo(p.tipo))))} são ${pct(fatia)} do total. `}
        {fps && fps.length > 0 && (abaixo.length ? `${abaixo.length} de ${fps.length} jogos ficam abaixo de ${alvo} FPS.` : `Todos os jogos passam de ${alvo} FPS.`)}
      </>
    );
  }

  return (
    <>
      <div className="titulo">
        <div>
          <h1>Build de {brlRedondo(build.orcamento)}, {build.objetivos.resolucao} a {alvo} FPS</h1>
          <p className="sub">{achado}</p>
        </div>
        <div className="acoes">
          {!vazia && <button className="btn" disabled={agente.ocupado} onClick={agente.rodar}>{agente.ocupado ? "Montando…" : rotuloAgente(build.modo, true)}</button>}
          {vazia ? <button className="btn primario" disabled={agente.ocupado} onClick={agente.rodar}>{agente.ocupado ? "Montando…" : rotuloAgente(build.modo, false)}</button>
            : <BotaoExportar build={build} primario />}
        </div>
      </div>
      {agente.proposta}
      <ErroBloco erro={erro} onTentar={() => setTentativa((t) => t + 1)} />

      <div className="kpis" aria-label="Resumo da build">
        <div className="kpi">
          <span className="rotulo">Total</span>
          <span className={`valor resposta ${res && !res.cabe ? "neg" : ""}`}>{res ? brl(res.total) : <span className="vazio">-</span>}</span>
          <span className="nota num">de {brl(build.orcamento)}{res && (res.cabe ? `, sobram ${brl(res.diferenca)}` : `, passa ${brl(-res.diferenca)}`)}</span>
        </div>
        <div className="kpi">
          <span className="rotulo">Jogo mais pesado</span>
          <span className={`valor ${pior && pior.fps_med < alvo ? "neg" : ""}`}>{pior ? <>{Math.round(pior.fps_med)} <small>FPS</small></> : <span className="vazio">-</span>}</span>
          <span className="nota">{pior ? `${pior.jogo_nome}, alvo ${alvo}` : "precisa de CPU e placa de vídeo"}</span>
        </div>
        <div className="kpi">
          <span className="rotulo">Problemas abertos</span>
          <span className="valor">{abertos.length}</span>
          <span className="nota">{bloqueantes.length ? <strong className="neg">{bloqueantes.length} bloqueante{bloqueantes.length > 1 && "s"}</strong> : "nenhum bloqueante"}</span>
        </div>
        <div className="kpi">
          <span className="rotulo">Peças com preço</span>
          <span className="valor">{res ? <>{partes.length} <small>de {partes.length + res.sem_preco.length}</small></> : <span className="vazio">-</span>}</span>
          <span className="nota">{res ? `${Object.keys(res.lojas).length} ${Object.keys(res.lojas).length === 1 ? "loja" : "lojas"} no plano de compra` : " "}</span>
        </div>
      </div>

      <div className="duas">
        <section className="card" aria-labelledby="orc-titulo">
          <div className="card-topo">
            <h2 id="orc-titulo">Orçamento peça a peça</h2>
            <button className="btn texto" onClick={() => ir("pecas")}>Trocar peças</button>
          </div>
          {vazia && <p className="vazio-bloco">Nenhuma peça. Monte com o agente ou escolha em Peças.</p>}
          {!vazia && !res && !erro && <span className="carregando" />}
          {!vazia && res && partes.length > 0 && <OrcamentoPecaAPeca partes={partes} total={res.total} orcamento={build.orcamento} foco={foco} onFoco={setFoco} />}
          {res && res.sem_preco.length > 0 && <p className="aviso-bloco" style={{ marginTop: 12 }}>Sem preço com fonte: {res.sem_preco.join(", ")}. Fica fora do total.</p>}
          {res && res.ja_tenho.length > 0 && <p className="muted" style={{ marginTop: 12 }}>Já tem: {res.ja_tenho.join(", ")}.</p>}
        </section>

        <div className="coluna">
          <section className="card" aria-labelledby="fps-titulo">
            <div className="card-topo">
              <h2 id="fps-titulo">Jogos a {build.objetivos.resolucao}</h2>
              <button className="btn texto" onClick={() => ir("jogos")}>Detalhes</button>
            </div>
            {fps && fps.length === 0 && <p className="vazio-bloco">Precisa de processador e placa de vídeo para estimar.</p>}
            {fps && fps.length > 0 && (() => {
              const teto = Math.max(alvo * 1.5, ...fps.map((f) => f.fps_med));
              return fps.map((f) => (
                <div key={f.jogo} className="jogo">
                  <span>{f.jogo_nome} <span className="muted">· {f.tipo}</span></span>
                  <span className={`valor ${f.fps_med < alvo ? "neg" : ""}`}>{Math.round(f.fps_med)} <small>FPS</small></span>
                  <div className={`bala ${f.fps_med < alvo ? "abaixo" : ""}`} role="img" aria-label={`${Math.round(f.fps_med)} FPS, alvo ${alvo}`}>
                    <span style={{ width: `${(f.fps_med / teto) * 100}%` }} />
                    <i style={{ left: `calc(${(alvo / teto) * 100}% - 1px)` }} />
                  </div>
                </div>
              ));
            })()}
            {fps && fps.length > 0 && <p className="fonte" style={{ marginTop: 12 }}>A marca azul é o alvo de {alvo} FPS. Estimado = interpolado de medições próximas.</p>}
          </section>

          <section className="card" aria-labelledby="rev-titulo">
            <div className="card-topo">
              <h2 id="rev-titulo">Compatibilidade</h2>
              <button className="btn texto" onClick={() => ir("revisao")}>Ver tudo</button>
            </div>
            {abertos.length === 0 && <p className="muted">{vazia ? "A revisão roda quando houver peças." : "Nenhum problema aberto."}</p>}
            {abertos.slice(0, 3).map((a) => (
              <div key={a.id} className="achado">
                <div className="cab"><span className={`pill ${SEV_PILL[a.severidade]}`}>{SEVERIDADE[a.severidade]}</span></div>
                <p>{a.descricao}</p>
              </div>
            ))}
            {abertos.length > 3 && <button className="btn texto ver-todos" onClick={() => ir("revisao")}>Mais {abertos.length - 3}</button>}
          </section>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Peças
export function Montagem({ build, catalogo, onBuild, agente }: {
  build: Build; catalogo: Catalogo; onBuild: Atualizar; agente: { rodar: () => void; ocupado: boolean; proposta: ReactNode };
}) {
  const { ocupado, erro, rodar } = useAcao();
  const [tipo, setTipo] = useState<Tipo>("cpu");
  const [todos, setTodos] = useState(false);
  const [opcoes, setOpcoes] = useState<Componente[] | null>(null);
  const [texto, setTexto] = useState("");
  const [jaTenho, setJaTenho] = useState(false);
  const [importacao, setImportacao] = useState<Importacao | null>(null);
  const assinatura = build.itens.map((i) => i.componente_id).join();
  const naBuild = new Set(build.itens.map((i) => i.componente_id));

  useEffect(() => {
    setOpcoes(null);
    api.componentes(tipo, build.id, todos).then(setOpcoes).catch(() => setOpcoes([]));
  }, [tipo, todos, build.id, assinatura]);

  const nome = (id: string) => catalogo[id]?.nome ?? id;
  const mudar = (cid: string, dados: Parameters<typeof api.atualizarItem>[2]) => rodar(async () => onBuild(await api.atualizarItem(build.id, cid, dados)));

  return (
    <>
      <div className="titulo">
        <div>
          <h1>Peças</h1>
          <p className="sub">{build.itens.length} {build.itens.length === 1 ? "peça" : "peças"} · modo {MODOS[build.modo].nome.toLowerCase()}: {MODOS[build.modo].texto.toLowerCase()}</p>
        </div>
        <div className="acoes">
          <button className="btn primario" disabled={agente.ocupado} onClick={agente.rodar}>{agente.ocupado ? "Montando…" : rotuloAgente(build.modo, build.itens.length > 0)}</button>
        </div>
      </div>
      {agente.proposta}
      <ErroBloco erro={erro} />
      <div className="duas">
        <section className="card" aria-labelledby="lista-titulo">
          <div className="card-topo"><h2 id="lista-titulo">Na build</h2><span className="meta">Travada: o agente não troca. Já tenho: fica fora do total.</span></div>
          {build.itens.length === 0 && <p className="vazio-bloco">Nenhuma peça. Adicione ao lado, importe uma lista ou use o agente.</p>}
          <div className="rolagem">
            <table>
              {build.itens.length > 0 && <thead><tr><th>Peça</th><th className="num">Menor preço</th><th className="num">Qtd</th><th>Travada</th><th>Já tenho</th><th><span className="sr">Ações</span></th></tr></thead>}
              <tbody>
                {build.itens.map((i) => {
                  const c = catalogo[i.componente_id];
                  return (
                    <tr key={i.componente_id}>
                      <td>
                        {nome(i.componente_id)}
                        <span className="sub">{TIPOS[c?.tipo ?? "extra"]}{i.origem === "agente" && " · escolhida pelo agente"}</span>
                      </td>
                      <td className="num"><Preco v={c?.preco.min} /></td>
                      <td className="num">
                        <input type="number" min={1} max={8} value={i.quantidade} style={{ width: 60, height: 32 }} aria-label={`Quantidade de ${nome(i.componente_id)}`}
                          onChange={(e) => mudar(i.componente_id, { quantidade: +e.target.value })} />
                      </td>
                      <td><input type="checkbox" checked={i.travado} aria-label={`Travar ${nome(i.componente_id)}`} onChange={(e) => mudar(i.componente_id, { travado: e.target.checked })} /></td>
                      <td><input type="checkbox" checked={i.ja_tenho} aria-label={`Já tenho ${nome(i.componente_id)}`}
                        onChange={(e) => mudar(i.componente_id, { ja_tenho: e.target.checked, travado: e.target.checked || i.travado })} /></td>
                      <td className="num"><button className="btn texto perigo" onClick={() => rodar(async () => onBuild(await api.remover(build.id, i.componente_id)))}>Remover</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="coluna">
          <section className="card" aria-labelledby="add-titulo">
            <div className="card-topo"><h2 id="add-titulo">Adicionar peça</h2></div>
            <div className="acoes" style={{ marginBottom: 12 }}>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} aria-label="Tipo de peça" style={{ flex: 1 }}>
                {TIPOS_ESCOLHA.map((t) => <option key={t} value={t}>{TIPOS[t]}</option>)}
              </select>
              <label className="chip"><input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> Incompatíveis</label>
            </div>
            {opcoes === null && <span className="carregando" />}
            {opcoes?.length === 0 && <p className="vazio-bloco">Nenhuma opção compatível com a build.</p>}
            <ul className="lista" style={{ maxHeight: 440, overflowY: "auto" }}>
              {opcoes?.map((c) => (
                <li key={c.id}>
                  <span className="linha1">{c.nome}</span>
                  <span className="dir">
                    {naBuild.has(c.id) ? <span className="pill">Na build</span>
                      : <button className="btn pequeno" disabled={ocupado} onClick={() => rodar(async () => onBuild(await api.adicionar(build.id, c.id)))} aria-label={`Adicionar ${c.nome}`}>Adicionar</button>}
                  </span>
                  <span className="linha2">
                    {c.preco.min != null && "a partir de "}<Preco v={c.preco.min} />{c.preco.confianca && ` · confiança ${c.preco.confianca}`}
                    {!c.compativel && <span className="neg"><br />Incompatível: {c.motivo}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card" aria-labelledby="imp-titulo">
            <div className="card-topo"><h2 id="imp-titulo">Importar lista</h2></div>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Lista para importar" aria-describedby="imp-dica"
              placeholder={"CPU: AMD Ryzen 5 7600\nRTX 4060 8GB\n2x Kingston Fury Beast DDR5 32GB"} />
            <p id="imp-dica" className="fonte" style={{ marginTop: 6 }}>Carrinho de loja, texto do PCPartPicker ou uma peça por linha.</p>
            <div className="acoes" style={{ marginTop: 12, justifyContent: "space-between" }}>
              <label className="chip"><input type="checkbox" checked={jaTenho} onChange={(e) => setJaTenho(e.target.checked)} /> Já tenho estas</label>
              <button className="btn" disabled={!texto.trim() || ocupado} onClick={() => rodar(async () => setImportacao(await api.importar(build.id, texto, jaTenho)))}>Reconhecer</button>
            </div>
            {importacao && (
              <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                {importacao.avisos.map((a) => <p key={a} className="aviso-bloco">{a}</p>)}
                {importacao.itens.length > 0 && <ul className="lista">{importacao.itens.map((i) => <li key={i.componente_id}><span className="linha1">{nome(i.componente_id)}</span><span className="dir num">{i.quantidade}x</span></li>)}</ul>}
                {importacao.nao_reconhecidas.length > 0 && <p className="muted">Não reconhecidas: {importacao.nao_reconhecidas.join("; ")}</p>}
                {importacao.itens.length > 0 && (
                  <button className="btn primario" onClick={() => rodar(async () => { onBuild(await api.aplicar(build.id, { itens: importacao.itens })); setImportacao(null); setTexto(""); })}>
                    Adicionar {importacao.itens.length} à build
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Revisão
export function Revisao({ build, catalogo, onBuild }: { build: Build; catalogo: Catalogo; onBuild: Atualizar }) {
  const { ocupado, erro, rodar } = useAcao();
  const nome = (id: string | null) => (id ? catalogo[id]?.nome ?? id : "");
  const ordem: Achado["severidade"][] = ["bloqueante", "atencao", "sugestao"];
  const lista = [...build.achados].sort((a, b) => (a.status === "aberto" ? 0 : 1) - (b.status === "aberto" ? 0 : 1) || ordem.indexOf(a.severidade) - ordem.indexOf(b.severidade));
  const abertos = build.achados.filter((a) => a.status === "aberto").length;
  const verbo = { trocar: "Trocar", adicionar: "Adicionar", remover: "Remover" } as const;
  return (
    <>
      <div className="titulo">
        <div>
          <h1>Compatibilidade</h1>
          <p className="sub">{abertos ? `${abertos} ${abertos === 1 ? "problema aberto" : "problemas abertos"}.` : "Nenhum problema aberto."} Regras da ficha técnica, depois os revisores de plataforma, espaço físico e parte elétrica. Sem fonte, um achado nunca bloqueia.</p>
        </div>
        <div className="acoes"><button className="btn" disabled={ocupado} onClick={() => rodar(async () => onBuild(await api.revisar(build.id)))}>Revisar de novo</button></div>
      </div>
      <ErroBloco erro={erro} />
      <section className="card" aria-label="Achados da revisão">
        {lista.length === 0 && <p className="muted">{build.itens.length ? "Nenhum achado." : "A revisão roda quando houver peças."}</p>}
        {lista.map((a) => (
          <div key={a.id} className={`achado ${a.status !== "aberto" ? "fechado" : ""}`}>
            <div className="cab">
              <span className={`pill ${a.status === "aberto" ? SEV_PILL[a.severidade] : ""}`}>{a.status === "aberto" ? SEVERIDADE[a.severidade] : a.status === "aplicado" ? "Corrigido" : "Ignorado"}</span>
              {!a.verificado && <span className="pill">Não verificado</span>}
              <span className="quem">{a.agente.replace("_", " ")}</span>
            </div>
            <p>{a.descricao}</p>
            {a.correcao_sugerida && (
              <p className="correcao">
                Correção: <strong>{verbo[a.correcao_sugerida.acao]} {nome(a.correcao_sugerida.componente_id)}{a.correcao_sugerida.para_id && ` por ${nome(a.correcao_sugerida.para_id)}`}</strong>
                {a.impacto_preco != null && <span className="num"> · {a.impacto_preco >= 0 ? "+" : "-"}{brl(Math.abs(a.impacto_preco))}</span>}
                {a.impacto_fps && ` · ${a.impacto_fps}`}
              </p>
            )}
            <p className="fonte">Fonte: {a.fonte_url ?? "sem fonte"}</p>
            {a.status === "aberto" && (
              <div className="acoes">
                {a.correcao_sugerida && <button className="btn pequeno" disabled={ocupado} onClick={() => rodar(async () => onBuild(await api.aplicar(build.id, { achado_id: a.id })))}>Aplicar correção</button>}
                <button className="btn texto" disabled={ocupado} onClick={() => rodar(async () => onBuild(await api.ignorar(build.id, a.id)))}>Ignorar</button>
              </div>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Jogos
export function Jogos({ build, builds, rotulo }: { build: Build; builds: Build[]; rotulo: (b: Build) => string }) {
  const [fps, setFps] = useState<Estimativa[] | null>(null);
  const [outra, setOutra] = useState("");
  const [comparacao, setComparacao] = useState<{ a: Estimativa[]; b: Estimativa[]; custo_a: number; custo_b: number } | null>(null);
  const [demo, setDemo] = useState(0);
  const assinatura = build.itens.map((i) => i.componente_id).join() + build.objetivos.resolucao + build.objetivos.jogos.join();
  useEffect(() => { api.fps(build.id).then(setFps).catch(() => setFps([])); }, [build.id, assinatura]);
  useEffect(() => {
    if (!outra) return setComparacao(null);
    api.comparar(build.id, outra, build.objetivos.resolucao).then(setComparacao).catch(() => setComparacao(null));
  }, [outra, build.id, assinatura]);
  const alvo = build.objetivos.fps_alvo;
  const e = fps?.[demo];
  return (
    <>
      <div className="titulo">
        <div>
          <h1>Jogos</h1>
          <p className="sub">{build.objetivos.resolucao}, preset {fps?.[0]?.preset ?? "Alto"}, alvo de {alvo} FPS. Medido quando há benchmark; estimado com faixa quando não há.</p>
        </div>
      </div>
      <section className="card" aria-labelledby="tab-fps">
        <div className="card-topo"><h2 id="tab-fps">Desempenho previsto</h2></div>
        {fps === null && <span className="carregando" />}
        {fps?.length === 0 && <p className="vazio-bloco">Precisa de processador e placa de vídeo na build.</p>}
        {fps && fps.length > 0 && (
          <div className="rolagem">
            <table>
              <thead><tr><th>Jogo</th><th className="num">FPS médio</th><th className="num">Faixa</th><th className="num">1% low</th><th>Gargalo</th><th>Origem</th><th className="num">FPS por R$ 1 mil</th></tr></thead>
              <tbody>
                {fps.map((f) => (
                  <tr key={f.jogo}>
                    <td>{f.jogo_nome}</td>
                    <td className={`num ${f.fps_med < alvo ? "neg" : ""}`}><strong style={{ fontWeight: 500 }}>{Math.round(f.fps_med)}</strong></td>
                    <td className="num muted">{Math.round(f.fps_min)}-{Math.round(f.fps_max)}</td>
                    <td className="num">{Math.round(f.fps_1low)}</td>
                    <td>{f.gargalo === "cpu" ? "Processador" : f.gargalo === "gpu" ? "Placa de vídeo" : <span className="vazio">-</span>}</td>
                    <td><span className="pill" title={`Fonte: ${f.fontes.join(", ")}`}>{f.tipo}</span> <span className="muted">{f.confianca}</span></td>
                    <td className="num">{f.fps_por_mil_reais ?? <span className="vazio">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="metade">
        <section className="card" aria-labelledby="demo-titulo">
          <div className="card-topo">
            <h2 id="demo-titulo">Como fica na tela</h2>
            {fps && fps.length > 0 && (
              <select value={demo} onChange={(ev) => setDemo(+ev.target.value)} aria-label="Jogo da demonstração">
                {fps.map((f, i) => <option key={f.jogo} value={i}>{f.jogo_nome}</option>)}
              </select>
            )}
          </div>
          {e ? (
            <div style={{ display: "grid", gap: 16 }}>
              <Fluidez fps={e.fps_med} low={e.fps_1low} rotulo="Esta build" />
              {comparacao?.b[demo] && <Fluidez fps={comparacao.b[demo].fps_med} low={comparacao.b[demo].fps_1low} rotulo="Build comparada" />}
            </div>
          ) : <p className="muted">Aparece quando houver estimativa de FPS.</p>}
        </section>
        <section className="card" aria-labelledby="cmp-titulo">
          <div className="card-topo">
            <h2 id="cmp-titulo">Comparar com outra build</h2>
            <select value={outra} onChange={(ev) => setOutra(ev.target.value)} aria-label="Build para comparar">
              <option value="">Escolha uma build</option>
              {builds.filter((b) => b.id !== build.id).map((b) => <option key={b.id} value={b.id}>{rotulo(b)}</option>)}
            </select>
          </div>
          {builds.length < 2 && <p className="muted">Crie outra build para comparar lado a lado.</p>}
          {comparacao && (
            <table>
              <thead><tr><th>Jogo</th><th className="num">Esta <span className="sub">{brl(comparacao.custo_a)}</span></th><th className="num">Outra <span className="sub">{brl(comparacao.custo_b)}</span></th><th className="num">Diferença</th></tr></thead>
              <tbody>
                {comparacao.a.map((x, i) => {
                  const y = comparacao.b[i];
                  const d = y ? Math.round((y.fps_med / x.fps_med - 1) * 100) : null;
                  return (
                    <tr key={x.jogo}>
                      <td>{x.jogo_nome}</td>
                      <td className="num">{Math.round(x.fps_med)}</td>
                      <td className="num">{y ? Math.round(y.fps_med) : <span className="vazio">-</span>}</td>
                      <td className={`num ${d != null && d < 0 ? "neg" : ""}`}>{d == null ? <span className="vazio">-</span> : `${d > 0 ? "+" : ""}${d}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Compra
export function ResultadoPainel({ build, catalogo, onBuild }: { build: Build; catalogo: Catalogo; onBuild: Atualizar }) {
  const { ocupado, erro, rodar } = useAcao();
  const [res, setRes] = useState<Resultado | null>(null);
  const [precos, setPrecos] = useState<ResultadoPreco[]>([]);
  const assinatura = JSON.stringify(build.itens);
  useEffect(() => {
    api.resultado(build.id).then(setRes).catch(() => setRes(null));
    api.precos(build.id).then(setPrecos).catch(() => setPrecos([]));
  }, [build.id, assinatura]);
  const nome = (id: string) => catalogo[id]?.nome ?? id;

  return (
    <>
      <div className="titulo">
        <div>
          <h1>Compra</h1>
          <p className="sub">
            {res ? <>{res.cabe ? <>Total <strong className="num">{brl(res.total)}</strong>, sobram {brl(res.diferenca)}.</> : <>Total <strong className="num neg">{brl(res.total)}</strong>, passa {brl(-res.diferenca)} do orçamento.</>} Frete {res.frete}.</> : "Carregando o plano de compra."}
          </p>
        </div>
        <div className="acoes"><BotaoExportar build={build} primario /></div>
      </div>
      <ErroBloco erro={erro} />
      <div className="duas">
        <section className="card" aria-labelledby="plano-titulo">
          <div className="card-topo"><h2 id="plano-titulo">Onde comprar</h2><span className="meta">Mais barato com fonte, por loja</span></div>
          {!res && <span className="carregando" />}
          {res && Object.keys(res.lojas).length === 0 && <p className="vazio-bloco">Nenhuma peça com preço ainda.</p>}
          {res && Object.entries(res.lojas).map(([loja, linhas], k) => (
            <div key={loja} className="rolagem" style={{ marginTop: k ? 24 : 0 }}>
              <table>
                <thead><tr><th className="loja">{loja}</th><th className="num">Qtd</th><th className="num">Faixa entre lojas</th><th className="num loja">{brl(res.total_por_loja[loja])}</th></tr></thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.componente_id}>
                      <td><a href={l.url} target="_blank" rel="noreferrer">{l.nome}</a><span className="sub">confiança {l.confianca ?? "-"}</span></td>
                      <td className="num">{l.quantidade}</td>
                      <td className="num muted">{brl(l.faixa[0])} a {brl(l.faixa[2])}</td>
                      <td className="num">{brl(l.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {res && res.sem_preco.length > 0 && <p className="aviso-bloco" style={{ marginTop: 16 }}>Sem preço com fonte: {res.sem_preco.join(", ")}.</p>}
        </section>

        <section className="card" aria-labelledby="trocas-titulo">
          <div className="card-topo"><h2 id="trocas-titulo">Trocas que valem</h2></div>
          {res && res.trocas.length === 0 && <p className="muted">Nenhuma troca vantajosa agora.</p>}
          <ul className="lista">
            {res?.trocas.map((t) => (
              <li key={t.de_id + t.para_id}>
                <span className="linha1" style={{ whiteSpace: "normal" }}>{t.texto}</span>
                <span className="dir"><button className="btn pequeno" disabled={ocupado} onClick={() => rodar(async () => onBuild(await api.adicionar(build.id, t.para_id)))}>Trocar</button></span>
                <span className="linha2">{t.de_nome} por {t.para_nome}{t.impacto_fps_pct != null && `, ${t.impacto_fps_pct >= 0 ? "+" : ""}${t.impacto_fps_pct}% FPS estimado`}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card" aria-labelledby="pesq-titulo">
        <div className="card-topo"><h2 id="pesq-titulo">Pesquisa de preço por peça</h2><span className="meta">Anúncio usado, kit, PC montado e outro modelo ficam de fora</span></div>
        <div className="rolagem">
          <table>
            <thead><tr><th>Peça</th><th>Ofertas aceitas</th><th className="num">Faixa</th><th className="num">Descartados</th><th>Histórico</th></tr></thead>
            <tbody>
              {precos.map((p) => (
                <tr key={p.componente_id}>
                  <td>{nome(p.componente_id)}{p.do_cache && <span className="sub">guardado{p.vencido && ", vencido"}</span>}</td>
                  <td>{p.ofertas.length ? p.ofertas.map((o) => <div key={o.url + o.loja + o.preco}><a href={o.url} target="_blank" rel="noreferrer">{o.loja}</a> <span className="num">{brl(o.preco)}</span></div>) : <span className="vazio">-</span>}</td>
                  <td className="num">{p.preco_min != null ? `${brl(p.preco_min)} a ${brl(p.preco_max)}` : <span className="vazio">-</span>}<span className="sub">confiança {p.confianca ?? "-"}</span></td>
                  <td className="num">
                    {p.descartes.length ? (
                      <details>
                        <summary style={{ cursor: "pointer" }}>{p.descartes.length}</summary>
                        <div style={{ textAlign: "left", marginTop: 6 }} className="muted">{p.descartes.map((d, i) => <div key={i}>{d.loja}: {d.motivo}</div>)}</div>
                      </details>
                    ) : "0"}
                  </td>
                  <td><Historico pontos={mediaPorDia(p.historico)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function mediaPorDia(h: { preco: number; coletado_em: string }[]): number[] {
  const dias = new Map<string, number[]>();
  for (const x of h) dias.set(x.coletado_em.slice(0, 10), [...(dias.get(x.coletado_em.slice(0, 10)) ?? []), x.preco]);
  return [...dias.keys()].sort().map((d) => dias.get(d)!.reduce((a, b) => a + b, 0) / dias.get(d)!.length);
}

function Historico({ pontos }: { pontos: number[] }) {
  if (pontos.length < 2) return <span className="vazio">{pontos.length ? "1 coleta" : "-"}</span>;
  const min = Math.min(...pontos), max = Math.max(...pontos), w = 96, h = 24;
  const d = pontos.map((p, i) => `${(i / (pontos.length - 1)) * w},${h - 2 - ((p - min) / (max - min || 1)) * (h - 4)}`).join(" ");
  return (
    <svg width={w} height={h} role="img" aria-label={`de ${brl(pontos[0])} a ${brl(pontos[pontos.length - 1])}`}>
      <polyline points={d} fill="none" stroke="var(--text)" strokeWidth="1.5" />
    </svg>
  );
}
