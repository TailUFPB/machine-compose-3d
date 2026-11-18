// Funções puras do painel ao lado da cena 3D: linhas da build, resumo da ficha, bloqueio de troca, diferença de
// conflitos da prévia e a regra "a última prévia pedida vence".
import type { Build, BuildItem, Cena, Componente, Fluxo, Folga, Tipo } from "./api";

export interface LinhaPainel {
  id: string; tipo: Tipo; nome: string; preco: number | null; conflito: boolean; travada: boolean; jaTenho: boolean; quantidade: number;
}

/** Uma linha por peça da build, na ordem da build, sem extras (pasta, SO, Wi-Fi: não aparecem na cena). */
export function linhasPainel(build: Build, catalogo: Record<string, Componente>, cena: Cena | null): LinhaPainel[] {
  const emConflito = new Set(cena?.conflitos.flatMap((c) => c.itens) ?? []);
  return build.itens.flatMap((i) => {
    const c = catalogo[i.componente_id];
    if (!c || c.tipo === "extra") return [];
    return [{ id: c.id, tipo: c.tipo, nome: c.nome, preco: c.preco.med, conflito: emConflito.has(c.id),
              travada: i.travado, jaTenho: i.ja_tenho, quantidade: i.quantidade }];
  });
}

// campo → [rótulo, unidade]
const CAMPOS: Partial<Record<Tipo, [string, string, string][]>> = {
  cpu: [["socket", "Socket", ""], ["nucleos", "Núcleos", ""], ["tdp", "TDP", " W"]],
  gpu: [["vram_gb", "VRAM", " GB"], ["comprimento_mm", "Comprimento", " mm"], ["tdp", "TDP", " W"]],
  placa_mae: [["socket", "Socket", ""], ["form_factor", "Formato", ""], ["memoria", "Memória", ""]],
  memoria: [["capacidade_gb", "Capacidade", " GB"], ["ddr", "Tipo", ""]],
  armazenamento: [["capacidade_gb", "Capacidade", " GB"], ["interface", "Interface", ""]],
  fonte: [["potencia_w", "Potência", " W"], ["form_factor", "Formato", ""], ["tier", "Tier", ""]],
  gabinete: [["form_factors", "Placas aceitas", ""], ["gpu_max_mm", "GPU até", " mm"], ["cooler_max_mm", "Cooler até", " mm"]],
  cooler: [["refrigeracao", "Refrigeração", ""], ["tdp_suportado", "Suporta", " W"]],
};

/** Os campos principais da ficha por tipo, como [rótulo, valor]; campo ausente é omitido. */
export function resumoFicha(tipo: Tipo, specs: Record<string, any>): [string, string][] {
  return (CAMPOS[tipo] ?? []).flatMap(([campo, rotulo, un]): [string, string][] => {
    const v = specs[campo];
    if (v == null) return [];
    return [[rotulo, Array.isArray(v) ? v.join(", ") : `${v}${un}`]];
  });
}

/** Por que a peça não pode ser trocada nem removida (mesma regra do backend, que devolve 409). */
export function bloqueioTroca(item: BuildItem): string | null {
  if (item.travado) return "destrave para trocar";
  if (item.ja_tenho) return "desmarque Já tenho para trocar";
  return null;
}

type Conflito = Cena["conflitos"][number];

/** Conflitos que a prévia cria e que ela resolve. O id do achado traz os ids das peças, então o mesmo problema com a
 *  candidata no lugar da peça atual tem outro id: compara com `de` e `para` trocados por `*`, peça por peça. */
export function diferencaConflitos(atual: Conflito[], previa: Conflito[], de: string, para: string): { novos: Conflito[]; resolvidos: Conflito[] } {
  // id = "regra:subregra:idA+idB": troca peça por peça (nunca por pedaço: "rtx-4070" é prefixo de "rtx-4070s") e
  // reordena o grupo, porque o backend ordena os ids e a candidata pode cair em outra posição
  const chave = (c: Conflito) => c.id.split(":")
    .map((parte) => parte.split("+").map((t) => (t === de || t === para ? "*" : t)).sort().join("+")).join(":");
  const antes = new Set(atual.map(chave)), depois = new Set(previa.map(chave));
  return { novos: previa.filter((c) => !antes.has(chave(c))), resolvidos: atual.filter((c) => !depois.has(chave(c))) };
}

/** Senhas para respostas fora de ordem: só a resposta da última senha pedida deve ser aplicada. */
export function ultimaVence(): { pedir(): number; vale(n: number): boolean } {
  let ultima = 0;
  return { pedir: () => ++ultima, vale: (n) => n === ultima };
}

/** "sobram 152 mm" ou "passa 10 mm". */
export const textoFolga = (f: Folga): string => (f.sobra_mm < 0 ? `passa ${-f.sobra_mm} mm` : `sobram ${f.sobra_mm} mm`);

/** Folgas que a prévia de troca muda (sobra ou estado diferente, ou que somem/aparecem), na ordem da build atual. */
export function folgasQueMudam(atual: Folga[] | undefined, previa: Folga[] | undefined): { id: Folga["id"]; antes: Folga | null; depois: Folga | null }[] {
  const a = new Map((atual ?? []).map((f) => [f.id, f])), d = new Map((previa ?? []).map((f) => [f.id, f]));
  const ids = [...a.keys(), ...[...d.keys()].filter((k) => !a.has(k))];
  return ids.flatMap((id) => {
    const antes = a.get(id) ?? null, depois = d.get(id) ?? null;
    return antes && depois && antes.sobra_mm === depois.sobra_mm && antes.estado === depois.estado ? [] : [{ id, antes, depois }];
  });
}

/** Linhas da seção "Fluxo de ar" do painel. `nao_cabe` quando há menos ventoinhas que as recomendadas. */
export function linhasFluxo(f: Fluxo): { balanco: string; calor: string; estado: "cabe" | "nao_cabe" } {
  const n = f.ventoinhas.length;
  return {
    balanco: `Entrada ${f.entrada} · Saída ${f.saida} · pressão ${f.pressao}`,
    calor: `Calor ${f.calor_w} W: ${f.recomendadas} ventoinhas recomendadas, há ${n}`,
    estado: n >= f.recomendadas ? "cabe" : "nao_cabe",
  };
}

/** O que muda no fluxo de ar com a troca da prévia. */
export function fluxoQueMuda(a: Fluxo | null | undefined, b: Fluxo | null | undefined): string[] {
  if (!a || !b) return [];
  const out: string[] = [];
  if (a.ventoinhas.length !== b.ventoinhas.length) out.push(`Ventoinhas: ${a.ventoinhas.length} → ${b.ventoinhas.length}`);
  if (a.recomendadas !== b.recomendadas) out.push(`Ventoinhas recomendadas: ${a.recomendadas} → ${b.recomendadas}`);
  if (a.pressao !== b.pressao) out.push(`Pressão: ${a.pressao} → ${b.pressao}`);
  return out;
}
