import { describe, expect, it } from "vitest";
import { discoModelo } from "./disco";
import { type Modelo, atravessam } from "./peca";

const dentro = (m: Modelo) => m.partes.every((p) => p.pos.every((v, i) => Math.abs(v) + p.tam[i] / 2 <= m.tam[i] / 2 + 0.5));
const ancorasNoEnvelope = (m: Modelo) => Object.values(m.ancoras).every((a) => a.every((v, i) => Math.abs(v) <= m.tam[i] / 2 + 1e-9));
const sub = (m: Modelo, id: string) => m.partes.find((p) => p.id === id)!;
const ids = (m: Modelo, re: RegExp) => m.partes.filter((p) => re.test(p.id));

/** Conectores SATA da norma: 7 pinos de dados e 15 de energia, na face +x, com a âncora no centro da face. */
function conferirSata(m: Modelo) {
  for (const [id, pinos] of [["dados", 7], ["energia", 15]] as const) {
    const corpo = sub(m, `sata-${id}`), p = sub(m, `sata-${id}-pinos`);
    expect(p.forma).toMatchObject({ tipo: "grade", n: [1, 1, pinos] });
    expect(p.tam[2]).toBeCloseTo(pinos * 1.27, 5);
    expect([corpo.fonte, p.fonte]).toEqual(["norma", "norma"]);
    expect(corpo.pos[0] + corpo.tam[0] / 2).toBeCloseTo(m.tam[0] / 2, 5);
    expect(m.ancoras[id]).toEqual([m.tam[0] / 2, corpo.pos[1], corpo.pos[2]]);
  }
  expect(m.ancoras.base).toEqual([0, -m.tam[1] / 2, 0]);
  expect(ancorasNoEnvelope(m)).toBe(true);
  expect(ids(m, /^furo-\d$/)).toHaveLength(4);
  expect(m.partes.filter((p) => p.tom === "lit")).toHaveLength(1);
}

describe("disco SATA de 2,5 polegadas", () => {
  it("segue a norma, com e sem campos opcionais", () => {
    for (const specs of [{ formato: "2.5", capacidade_gb: 4000 }, { formato: "2.5" }, {}, { capacidade_gb: 500 }]) {
      const m = discoModelo(specs);
      expect(m.tam).toEqual([100, 7, 69.85]);
      expect(dentro(m)).toBe(true);
      expect(atravessam(m)).toEqual([]);
      conferirSata(m);
    }
  });

  it("carcaça em duas metades, placa com chips e etiqueta com a capacidade da ficha", () => {
    const m = discoModelo({ formato: "2.5", capacidade_gb: 2000 });
    expect([sub(m, "base").fonte, sub(m, "tampa").fonte]).toEqual(["norma", "norma"]);
    expect(sub(m, "pcb").fonte).toBe("estimado");
    expect(sub(m, "controlador").fonte).toBe("estimado");
    expect(ids(m, /^nand-\d$/)).toHaveLength(4);
    expect(ids(discoModelo({ capacidade_gb: 500 }), /^nand-\d$/)).toHaveLength(2);
    expect(sub(m, "etiqueta").nome).toContain("2000 GB");
    expect(sub(m, "etiqueta").fonte).toBe("ficha");
    expect(sub(discoModelo({}), "etiqueta").fonte).toBe("estimado");
    expect(m.estimados).toContain("chips");
  });

  it("explosão ao longo de y: tampa sobe, base desce, placa parada", () => {
    const m = discoModelo({});
    expect(sub(m, "tampa").explode[1]).toBeGreaterThan(0);
    expect(sub(m, "base").explode[1]).toBeLessThan(0);
    expect(sub(m, "pcb").explode).toEqual([0, 0, 0]);
    expect(sub(m, "sata-dados-pinos").explode).toEqual(sub(m, "pcb").explode);
  });
});

describe("HD de 3,5 polegadas", () => {
  // o eixo do motor passa por dentro dos pratos: contato de projeto
  const previsto = (a: string, b: string) => [a, b].includes("eixo") && [a, b].some((x) => x.startsWith("prato-"));

  it("segue a norma e só o eixo atravessa os pratos", () => {
    for (const specs of [{ formato: "3.5", capacidade_gb: 1000 }, { formato: "3.5", capacidade_gb: 8000 }, { formato: "3.5" }]) {
      const m = discoModelo(specs);
      expect(m.tam).toEqual([146, 26.1, 101.6]);
      expect(dentro(m)).toBe(true);
      expect(atravessam(m).filter(([a, b]) => !previsto(a, b))).toEqual([]);
      conferirSata(m);
    }
  });

  it("mecânica visível na explosão: pratos pela capacidade, eixo, braço e ímã", () => {
    const m = discoModelo({ formato: "3.5", capacidade_gb: 4000 });
    expect(ids(m, /^prato-\d$/)).toHaveLength(2);
    expect(ids(discoModelo({ formato: "3.5" }), /^prato-\d$/)).toHaveLength(1);
    expect(ids(discoModelo({ formato: "3.5", capacidade_gb: 16000 }), /^prato-\d$/)).toHaveLength(3);
    for (const id of ["eixo", "braco", "ima", "pcb", "base", "tampa"]) expect(sub(m, id)).toBeDefined();
    expect(sub(m, "prato-0").forma.tipo).toBe("cilindro");
    expect(sub(m, "prato-0").fonte).toBe("estimado");
    expect(sub(m, "base").fonte).toBe("norma");
    expect(sub(m, "furo-0").fonte).toBe("norma");
    expect(sub(m, "etiqueta").nome).toContain("4000 GB");
    expect(m.estimados).toContain("pratos");
    // tampa sai antes e mais longe que a mecânica; a base fica parada
    expect(sub(m, "tampa").explode[1]).toBeGreaterThan(sub(m, "prato-0").explode[1]);
    expect(sub(m, "prato-0").explode[1]).toBeGreaterThan(0);
    expect(sub(m, "eixo").explode).toEqual(sub(m, "prato-0").explode);
    expect(sub(m, "base").explode).toEqual([0, 0, 0]);
    expect(sub(m, "pcb").explode[1]).toBeLessThan(0);
  });
});
