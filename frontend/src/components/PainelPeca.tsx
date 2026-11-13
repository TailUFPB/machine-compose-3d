"use client";
// Painel ao lado da cena 3D: sem peça aberta, a lista da build (hover sincronizado com a cena); com peça aberta, o
// detalhe (ficha, preço com fonte, motivo da escolha) e as ações Trocar e Remover.
// Design: docs/superpowers/specs/2026-11-13-cena-paineis-design.md
import { useEffect, useState } from "react";
import { api, type Build, type Cena, type CenaPrevia, type Componente, type ResultadoPreco } from "@/lib/api";
import { brl, TIPOS } from "@/lib/formato";
import { bloqueioTroca, diferencaConflitos, linhasPainel, resumoFicha } from "@/lib/painel";
import { ErroBloco, OfertasPeca, useAcao } from "./Paineis";

export interface PainelProps {
  build: Build;
  catalogo: Record<string, Componente>;
  cena: Cena | null;
  aberta: string | null;                 // `chave` da peça aberta na cena (o radiador do water cooler é `<id>:radiador`)
  onAberta: (chave: string | null) => void;
  destaque: string | null;               // id da peça sob o mouse (na lista ou na cena)
  onDestaque: (id: string | null) => void;
  onBuild: (b: Build) => void;
  /** Prévia de troca em curso (a cena recebida pela página já é a dela); `pedindo`: candidata aguardando resposta. */
  previa: { de: string; para: string; cena: CenaPrevia } | null;
  pedindo: string | null;
  erroPrevia: string | null;
  onPrevia: (de: string, para: string) => void;
  onCancelarPrevia: () => void;
  onAplicarTroca: () => Promise<void>;
}

/** id da peça da build a partir da `chave` da caixa aberta na cena. */
export const idDaChave = (chave: string | null) => chave?.replace(/:radiador$/, "") ?? null;

export default function PainelPeca(props: PainelProps) {
  const { build, catalogo, cena, aberta, onAberta, destaque, onDestaque } = props;
  const id = idDaChave(aberta);
  const item = build.itens.find((i) => i.componente_id === id);
  return (
    <section className="painel-peca" aria-label="Peças da build">
      {item && catalogo[item.componente_id] ? <Detalhe {...props} key={item.componente_id} /> : (
        <>
          <h2 className="painel-titulo">Peças da build</h2>
          <ul className="lista" onMouseLeave={() => onDestaque(null)}>
            {linhasPainel(build, catalogo, cena).map((l) => (
              <li key={l.id} data-testid={`linha-${l.id}`} className={destaque === l.id ? "ativo" : ""} tabIndex={0} role="button"
                aria-label={`${l.nome}, abrir detalhes`}
                onMouseEnter={() => onDestaque(l.id)} onFocus={() => onDestaque(l.id)} onBlur={() => onDestaque(null)}
                onClick={() => onAberta(l.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAberta(l.id); } }}>
                <span className="linha1">{l.conflito && <span className="pill neg" title="Em conflito na cena">!</span>} {l.nome}</span>
                <span className="dir">{l.preco == null ? <span className="vazio">sem preço</span> : <span className="num">{brl(l.preco)}</span>}
                  {l.quantidade > 1 && <small>{l.quantidade} un.</small>}</span>
                <span className="linha2">{TIPOS[l.tipo]}{l.travada && " · travada"}{l.jaTenho && " · já tenho"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Detalhe(props: PainelProps) {
  const { build, catalogo, aberta, onAberta, onBuild, onCancelarPrevia } = props;
  const id = idDaChave(aberta)!;
  const c = catalogo[id];
  const item = build.itens.find((i) => i.componente_id === id)!;
  const bloqueio = bloqueioTroca(item);
  const { ocupado, erro, rodar } = useAcao();
  const [preco, setPreco] = useState<ResultadoPreco | null | undefined>(undefined);
  const [confirmar, setConfirmar] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const assinatura = JSON.stringify(build.itens);
  useEffect(() => {
    api.precos(build.id).then((ps) => setPreco(ps.find((p) => p.componente_id === id) ?? null)).catch(() => setPreco(null));
  }, [build.id, assinatura, id]);
  const ficha = resumoFicha(c.tipo, c.specs);

  return (
    <div data-testid="detalhe-peca">
      <button className="btn texto pequeno" onClick={() => onAberta(null)}>Voltar à lista</button>
      <h2 className="painel-titulo">{c.nome}</h2>
      <p className="muted">{TIPOS[c.tipo]}{item.quantidade > 1 && ` · ${item.quantidade} unidades`}</p>
      {ficha.length > 0 && (
        <dl className="ficha">{ficha.map(([r, v]) => <div key={r}><dt>{r}</dt><dd>{v}</dd></div>)}</dl>
      )}
      <h3>Preço</h3>
      {preco === undefined ? <span className="carregando" /> : preco ? <OfertasPeca p={preco} /> : <p className="vazio">Sem preço com fonte.</p>}
      <h3>Por que foi escolhida</h3>
      <p>{item.justificativa ?? "escolhida por você"}</p>
      <ErroBloco erro={erro} />
      {bloqueio && <p className="aviso-bloco">Para trocar ou remover: {bloqueio}.</p>}
      {trocando && <Trocar {...props} de={id} />}
      <div className="acoes">
        <button className="btn" data-testid="trocar" aria-pressed={trocando} disabled={!!bloqueio}
          onClick={() => { if (trocando) onCancelarPrevia(); setTrocando(!trocando); }}>Trocar</button>
        <button className="btn perigo" data-testid="remover" disabled={!!bloqueio || ocupado}
          onClick={() => confirmar ? rodar(async () => { onBuild(await api.remover(build.id, id)); onAberta(null); }) : setConfirmar(true)}>
          {confirmar ? "Confirmar remoção" : "Remover"}
        </button>
      </div>
    </div>
  );
}

/** Candidatas do mesmo tipo; clicar numa mostra a prévia na cena, e só "Aplicar troca" grava. */
function Trocar({ build, cena, previa, pedindo, erroPrevia, onPrevia, onCancelarPrevia, onAplicarTroca, catalogo, de }: PainelProps & { de: string }) {
  const tipo = catalogo[de].tipo;
  const [todos, setTodos] = useState(false);
  const [opcoes, setOpcoes] = useState<Componente[] | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const assinatura = JSON.stringify(build.itens);
  useEffect(() => {
    setOpcoes(null);
    api.componentes(tipo, build.id, todos).then((cs) => setOpcoes(cs.filter((c) => c.id !== de))).catch(() => setOpcoes([]));
  }, [tipo, build.id, todos, assinatura, de]);
  const escolhida = pedindo ?? previa?.para ?? null;
  const dif = previa && cena ? diferencaConflitos(cena.conflitos, previa.cena.conflitos, previa.de, previa.para) : null;
  const sinal = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${brl(Math.abs(v))}`;

  return (
    <div className="trocar" aria-label="Trocar peça">
      <h3>Trocar por</h3>
      <label className="chip"><input type="checkbox" data-testid="ver-incompativeis" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> Incompatíveis</label>
      {opcoes === null && <span className="carregando" />}
      {opcoes?.length === 0 && <p className="vazio-bloco">Nenhuma opção compatível com a build.</p>}
      <ul className="lista candidatas">
        {opcoes?.map((c) => (
          <li key={c.id}>
            <button className="btn texto candidata" data-testid={`candidata-${c.id}`} aria-pressed={escolhida === c.id}
              onClick={() => onPrevia(de, c.id)}>{c.nome}</button>
            <span className="dir">{c.preco.med == null ? <span className="vazio">sem preço</span> : <span className="num">{brl(c.preco.med)}</span>}</span>
            {!c.compativel && <span className="linha2 neg">Incompatível: {c.motivo}</span>}
          </li>
        ))}
      </ul>
      <ErroBloco erro={erroPrevia} />
      {previa && previa.de === de && (
        <div className="diferenca" data-testid="diferenca-previa">
          <p><strong>{catalogo[previa.para]?.nome ?? previa.para}</strong> no lugar, ainda não aplicada.</p>
          <p>Preço: {previa.cena.diferenca_preco == null ? "sem preço com fonte" : sinal(previa.cena.diferenca_preco)}</p>
          {dif && dif.novos.length > 0 && <p className="neg">Novos conflitos: {dif.novos.map((c) => c.descricao).join("; ")}</p>}
          {dif && dif.resolvidos.length > 0 && <p className="pos">Resolve: {dif.resolvidos.map((c) => c.descricao).join("; ")}</p>}
          <div className="acoes">
            <button className="btn primario" disabled={aplicando}
              onClick={async () => { setAplicando(true); try { await onAplicarTroca(); } finally { setAplicando(false); } }}>Aplicar troca</button>
            <button className="btn" onClick={onCancelarPrevia}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
