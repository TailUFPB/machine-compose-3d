import { describe, expect, it } from "vitest";
import type { Build, BuildItem, Cena, Componente } from "./api";
import { bloqueioTroca, diferencaConflitos, linhasPainel, resumoFicha, ultimaVence } from "./painel";

const item = (componente_id: string, extra: Partial<BuildItem> = {}): BuildItem => ({
  componente_id, quantidade: 1, travado: false, ja_tenho: false, origem: "usuario", justificativa: null, status_pesquisa: "ok", ...extra,
});
const comp = (id: string, tipo: Componente["tipo"], med: number | null): Componente => ({
  id, tipo, marca: "M", modelo: id, nome: `Nome ${id}`, specs: {}, fonte: "seed:demo", compativel: true, motivo: null,
  preco: { min: med, med, max: med, confianca: "alta" },
});
const conflito = (id: string, itens: string[]) => ({ id, itens, descricao: id, severidade: "bloqueante" as const });

describe("linhasPainel", () => {
  const build = { id: "b", itens: [item("gpu1", { travado: true }), item("so1"), item("case1", { ja_tenho: true, quantidade: 2 })] } as Build;
  const catalogo = { gpu1: comp("gpu1", "gpu", 1800), so1: comp("so1", "extra", 500), case1: comp("case1", "gabinete", null) };
  const cena = { pecas: [], passos: [], conflitos: [conflito("par:gpu_comprimento:case1+gpu1", ["gpu1", "case1"])] } as Cena;

  it("ignora extras, mantém a ordem da build e marca conflito, travada e já tenho", () => {
    const linhas = linhasPainel(build, catalogo, cena);
    expect(linhas.map((l) => l.id)).toEqual(["gpu1", "case1"]);
    expect(linhas[0]).toMatchObject({ tipo: "gpu", nome: "Nome gpu1", preco: 1800, conflito: true, travada: true, jaTenho: false });
    expect(linhas[1]).toMatchObject({ preco: null, conflito: true, jaTenho: true, quantidade: 2 });
  });

  it("sem cena, nenhuma linha tem conflito", () => {
    expect(linhasPainel(build, catalogo, null).every((l) => !l.conflito)).toBe(true);
  });
});

describe("resumoFicha", () => {
  it("traz os campos do tipo e omite os ausentes", () => {
    expect(resumoFicha("gpu", { vram_gb: 8, comprimento_mm: 240, tdp: 115 })).toEqual([["VRAM", "8 GB"], ["Comprimento", "240 mm"], ["TDP", "115 W"]]);
    expect(resumoFicha("gpu", { vram_gb: 8 })).toEqual([["VRAM", "8 GB"]]);
  });
  it("lista vira texto separado por vírgula", () => {
    expect(resumoFicha("gabinete", { form_factors: ["ATX", "mATX"] })).toEqual([["Placas aceitas", "ATX, mATX"]]);
  });
});

describe("bloqueioTroca", () => {
  it("travada, já tenho e livre", () => {
    expect(bloqueioTroca(item("a", { travado: true }))).toBe("destrave para trocar");
    expect(bloqueioTroca(item("a", { ja_tenho: true }))).toBe("desmarque Já tenho para trocar");
    expect(bloqueioTroca(item("a"))).toBeNull();
  });
});

describe("diferencaConflitos", () => {
  it("conflito que persiste com a candidata não conta; o que some e o novo contam", () => {
    const atual = [conflito("par:gpu_comprimento:case1+gpu1", ["gpu1", "case1"]), conflito("eletrico:conector:gpu1+psu1", ["gpu1", "psu1"])];
    const previa = [conflito("par:gpu_comprimento:case1+gpu2", ["gpu2", "case1"]), conflito("par:potencia:cpu1+gpu2+psu1", ["psu1", "gpu2"])];
    const { novos, resolvidos } = diferencaConflitos(atual, previa, "gpu1", "gpu2");
    expect(novos.map((c) => c.id)).toEqual(["par:potencia:cpu1+gpu2+psu1"]);
    expect(resolvidos.map((c) => c.id)).toEqual(["eletrico:conector:gpu1+psu1"]);
  });
});

describe("diferencaConflitos com ids que são prefixo um do outro", () => {
  it("rtx-4070 por rtx-4070s: o mesmo conflito com a candidata não conta como novo nem resolvido", () => {
    const atual = [conflito("par:gpu_comprimento:case1+rtx-4070", ["rtx-4070", "case1"])];
    const previa = [conflito("par:gpu_comprimento:case1+rtx-4070s", ["rtx-4070s", "case1"]), conflito("eletrico:pico:psu1+rtx-4070s", ["rtx-4070s", "psu1"])];
    const { novos, resolvidos } = diferencaConflitos(atual, previa, "rtx-4070", "rtx-4070s");
    expect(novos.map((c) => c.id)).toEqual(["eletrico:pico:psu1+rtx-4070s"]);
    expect(resolvidos).toEqual([]);
  });
});

describe("ultimaVence", () => {
  it("só a última senha pedida vale", () => {
    const s = ultimaVence();
    const a = s.pedir(), b = s.pedir();
    expect(s.vale(a)).toBe(false);
    expect(s.vale(b)).toBe(true);
  });
});
