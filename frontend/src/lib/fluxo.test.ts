// Fluxo de ar no front: as vagas do gabinete batem com as do backend, as ventoinhas da cena vêm do fluxo,
// as setas apontam no sentido do ar e o caminho passa pela GPU (docs/superpowers/specs/2026-11-14-fluxo-de-ar-design.md).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Cena, Fluxo, Ventoinha } from "./api";
import { caminhosDoAr, descricaoFluxo, montarCena, setasDoFluxo } from "./cena";
import { gabineteModelo } from "./gabinete";
import { fluxoQueMuda, linhasFluxo } from "./painel";

const ler = (caminho: string) => JSON.parse(readFileSync(new URL(caminho, import.meta.url), "utf8"));
const seed = ler("../../../backend/app/seed.json") as { componentes: { id: string; tipo: string; specs: Record<string, any> }[] };
const VAGAS = ler("../../../backend/tests/vagas_seed.json") as Record<string, Record<string, number>>;

const v = (vaga: Ventoinha["vaga"], indice: number, origem: Ventoinha["origem"] = "gabinete"): Ventoinha =>
  ({ vaga, indice, origem, sentido: vaga === "frente" ? "entrada" : "saida" });
const fluxo = (ventoinhas: Ventoinha[], extra: Partial<Fluxo> = {}): Fluxo => {
  const entrada = ventoinhas.filter((x) => x.sentido === "entrada").length, saida = ventoinhas.length - entrada;
  return { ventoinhas, entrada, saida, pressao: entrada > saida ? "positiva" : entrada < saida ? "negativa" : "equilibrada", calor_w: 440, recomendadas: 3, ...extra };
};

describe("vagas do gabinete: cena e backend", () => {
  it("as âncoras de ventoinha de cada gabinete do seed batem com vagas_seed.json", () => {
    for (const c of seed.componentes.filter((x) => x.tipo === "gabinete")) {
      const a = Object.keys(gabineteModelo(c.specs).ancoras);
      const conta = { frente: a.filter((k) => k.startsWith("fan_frontal_")).length, topo: a.filter((k) => k.startsWith("fan_topo_")).length, traseira: a.filter((k) => k === "fan_traseiro").length };
      expect(conta, c.id).toEqual(VAGAS[c.id]);
    }
  });
  it("com a lista do fluxo, desenha exatamente as ventoinhas pedidas (o radiador fica com as dele)", () => {
    const specs = seed.componentes.find((x) => x.id === "case-h5-flow")!.specs;
    const ids = gabineteModelo(specs, [], [], [v("frente", 1, "pacote"), v("topo", 0), v("frente", 0, "radiador")]).partes
      .filter((s) => s.forma.tipo === "fan").map((s) => s.id).sort();
    expect(ids).toEqual(["fan-frontal-1", "fan-topo-0"]);
  });
});

const p = (id: string, tipo: Cena["pecas"][number]["tipo"], specs: Record<string, any>) => ({ id, tipo, nome: id, specs });
const caseH5 = seed.componentes.find((x) => x.id === "case-h5-flow")!.specs;
const base = (f: Fluxo | null): Cena => ({
  pecas: [p("case", "gabinete", caseH5), p("mb", "placa_mae", { form_factor: "ATX", socket: "AM5", slots_ram: 4 }),
    p("cpu", "cpu", { socket: "AM5" }), p("cooler", "cooler", { refrigeracao: "ar", altura_mm: 155 }),
    p("gpu", "gpu", { dimensoes: { c: 290, a: 120, l: 60 }, slots: 3 })],
  conflitos: [], passos: [], fluxo: f,
});

describe("setas e caminho do ar", () => {
  const f = fluxo([v("traseira", 0), v("frente", 0), v("topo", 0)]);
  const caixas = montarCena(base(f));
  it("a seta da frente aponta para dentro (+X) e a do topo para cima (+Y)", () => {
    const s = setasDoFluxo(caixas, f);
    expect(s).toHaveLength(3);
    expect(s.find((x) => x.sentido === "entrada")!.dir).toEqual([1, 0, 0]);
    expect(s.filter((x) => x.sentido === "saida").map((x) => x.dir)).toContainEqual([0, 1, 0]);
  });
  it("o caminho começa na frente, passa pela GPU e termina numa saída", () => {
    const g = caixas.find((c) => c.tipo === "gpu")!, gab = caixas.find((c) => c.tipo === "gabinete")!;
    const cs = caminhosDoAr(caixas, f);
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) {
      expect(c[0][0]).toBeLessThan(gab.pos[0] - gab.tam[0] / 4);                      // começa na metade da frente
      expect(c.some((pt) => pt.every((x, i) => Math.abs(x - g.pos[i]) < 1))).toBe(true);   // passa pelo centro da GPU
      const fim = c[c.length - 1];
      expect(fim[0] > gab.pos[0] + gab.tam[0] / 4 || fim[1] > gab.pos[1] + gab.tam[1] / 4).toBe(true);   // sai por trás ou pelo topo
    }
  });
  it("sem gabinete ou sem fluxo, nada", () => {
    expect(caminhosDoAr(montarCena({ ...base(null), pecas: base(null).pecas.slice(1) }), f)).toEqual([]);
    expect(setasDoFluxo(caixas, null)).toEqual([]);
  });
});

describe("setas do radiador", () => {
  it("ficam sobre as ventoinhas do próprio radiador (no topo ele vai para o lado do vidro)", () => {
    const kraken = seed.componentes.find((x) => x.id === "clr-kraken-240")!.specs;
    const lancool = seed.componentes.find((x) => x.id === "case-lancool-216")!.specs;
    const f = fluxo([v("traseira", 0), v("frente", 0), v("frente", 1), v("frente", 2), v("topo", 0, "radiador"), v("topo", 1, "radiador")]);
    const c: Cena = { ...base(f), pecas: [p("case", "gabinete", lancool), ...base(f).pecas.slice(1, 3), p("cooler", "cooler", kraken), base(f).pecas[4]] };
    const caixas = montarCena(c);
    const rad = caixas.find((x) => x.chave.endsWith(":radiador"))!;
    const doRad = setasDoFluxo(caixas, f).filter((s) => s.sentido === "saida" && s.dir[1] === 1);
    expect(doRad).toHaveLength(2);
    for (const s of doRad) for (const k of [0, 2]) expect(Math.abs(s.pos[k] - rad.pos[k])).toBeLessThanOrEqual(rad.tam[k] / 2);
  });
});

describe("textos do fluxo", () => {
  it("descrição, linhas do painel e o que muda na prévia", () => {
    const f = fluxo([v("traseira", 0), v("frente", 0), v("frente", 1), v("frente", 2), v("topo", 0)]);
    expect(descricaoFluxo(f)).toBe("Fluxo de ar: 3 entradas na frente, 2 saídas (traseira e topo), pressão positiva.");
    expect(descricaoFluxo(fluxo([v("traseira", 0)]))).toBe("Fluxo de ar: nenhuma entrada, 1 saída (traseira), pressão negativa.");
    expect(linhasFluxo(f)).toEqual({ balanco: "Entrada 3 · Saída 2 · pressão positiva", calor: "Calor 440 W: 3 ventoinhas recomendadas, há 5", estado: "cabe" });
    expect(linhasFluxo(fluxo([v("traseira", 0)])).estado).toBe("nao_cabe");
    expect(fluxoQueMuda(f, { ...f, recomendadas: 4 })).toEqual(["Ventoinhas recomendadas: 3 → 4"]);
    expect(fluxoQueMuda(f, fluxo([v("traseira", 0)]))).toContain("Pressão: positiva → negativa");
    expect(fluxoQueMuda(f, f)).toEqual([]);
    expect(fluxoQueMuda(null, f)).toEqual([]);
  });
});
