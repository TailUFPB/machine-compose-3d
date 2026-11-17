// Funções puras do painel ao lado da cena 3D: linhas da build, resumo da ficha, bloqueio de troca, diferença de
// conflitos da prévia e a regra "a última prévia pedida vence".
import type { Build, BuildItem, Cena, Componente, Tipo } from "./api";

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
