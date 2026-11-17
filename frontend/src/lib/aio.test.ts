import { describe, expect, it } from "vitest";
import { aioBlocoModelo, aioRadiadorModelo } from "./aio";
import { type Modelo, atravessam } from "./peca";

const dentro = (m: Modelo) => m.partes.every((p) => p.pos.every((v, i) => Math.abs(v) + p.tam[i] / 2 <= m.tam[i] / 2 + 0.5));
const ancorasNoEnvelope = (m: Modelo) => Object.values(m.ancoras).every((a) => a.every((v, i) => Math.abs(v) <= m.tam[i] / 2 + 1e-9));
const ids = (m: Modelo, re: RegExp) => m.partes.filter((p) => re.test(p.id));

describe("water cooler: bloco", () => {
  const m = aioBlocoModelo({ radiador_mm: 240, tdp_suportado: 250 });

  it("cabe no envelope e nada se atravessa", () => {
    expect(dentro(m)).toBe(true);
    expect(atravessam(m)).toEqual([]);
    expect(dentro(aioBlocoModelo({}))).toBe(true);
  });

  it("tem placa fria, bomba, quatro parafusos, dois bocais e um único destaque", () => {
    expect(m.partes.find((p) => p.id === "placa-fria")!.tom).toBe("cobre");
    expect(m.partes.some((p) => p.id === "bomba")).toBe(true);
    expect(ids(m, /^parafuso/)).toHaveLength(4);
    expect(ids(m, /^bocal-\d$/)).toHaveLength(2);
    expect(m.partes.filter((p) => p.tom === "lit")).toHaveLength(1);
    expect(m.partes.every((p) => p.fonte === "estimado")).toBe(true);
    expect(m.estimados.length).toBeGreaterThan(0);
  });

  it("âncoras: base na face de baixo, bocais na ponta de cada bocal", () => {
    expect(ancorasNoEnvelope(m)).toBe(true);
    expect(m.ancoras.base).toEqual([0, 0, -m.tam[2] / 2]);
    for (const i of [0, 1]) {
      const b = m.partes.find((p) => p.id === `bocal-${i}`)!;
      expect(m.ancoras[`bocal${i}`]).toEqual([b.pos[0] + b.tam[0] / 2, b.pos[1], b.pos[2]]);
    }
  });

  it("explosão ao longo de z: placa fria desce, tampa sobe, bomba parada", () => {
    const e = (id: string) => m.partes.find((p) => p.id === id)!.explode[2];
    expect(e("placa-fria")).toBeLessThan(0);
    expect(e("bomba")).toBe(0);
    expect(e("tampa")).toBeGreaterThan(0);
  });
});

describe("water cooler: radiador", () => {
  it("segue o comprimento da ficha: envelope, fans e parafusos, em 120, 240, 280 e 360", () => {
    for (const [mm, fans, largura] of [[120, 1, 120], [240, 2, 120], [280, 2, 140], [360, 3, 120]]) {
      const m = aioRadiadorModelo({ radiador_mm: mm, tdp_suportado: 250 });
      expect(m.tam).toEqual([52, mm, largura]);
      expect(dentro(m)).toBe(true);
      expect(atravessam(m)).toEqual([]);
      expect(m.partes.filter((p) => p.forma.tipo === "fan")).toHaveLength(fans);
      expect(ids(m, /^parafuso/)).toHaveLength(4 * fans);
      expect(ids(m, /^tanque-\d$/)).toHaveLength(2);
      expect(ids(m, /^bocal-\d$/)).toHaveLength(2);
      expect(m.partes.find((p) => p.id === "nucleo")!.forma.tipo).toBe("aletas");
      expect(ancorasNoEnvelope(m)).toBe(true);
    }
  });

  it("fonte: comprimento da ficha, furação do fan da norma, fan estimado se a ficha não traz", () => {
    const de = (m: Modelo, id: string) => m.partes.find((p) => p.id === id)!.fonte;
    const semFan = aioRadiadorModelo({ radiador_mm: 240 });
    expect(de(semFan, "nucleo")).toBe("ficha");
    expect(de(semFan, "tanque-0")).toBe("estimado");
    expect(de(semFan, "fan-0")).toBe("estimado");
    expect(de(semFan, "parafuso-0-0")).toBe("norma");
    expect(semFan.estimados).toContain("fans");

    const comFan = aioRadiadorModelo({ radiador_mm: 360, fans: 3, fan_mm: 120 });
    expect(de(comFan, "fan-0")).toBe("ficha");
    expect(comFan.estimados).not.toContain("fans");

    const vazio = aioRadiadorModelo({});
    expect(vazio.tam).toEqual([52, 240, 120]);
    expect(de(vazio, "nucleo")).toBe("estimado");
    expect(vazio.estimados).toContain("radiador");
  });

  it("specs.fans manda na contagem, até o que cabe no radiador", () => {
    const fans = (s: Record<string, any>) => aioRadiadorModelo(s).partes.filter((p) => p.forma.tipo === "fan").length;
    expect(fans({ radiador_mm: 360, fans: 2 })).toBe(2);
    expect(fans({ radiador_mm: 240, fans: 4 })).toBe(2);
    const m = aioRadiadorModelo({ radiador_mm: 360, fans: 2 });
    expect(dentro(m)).toBe(true);
    expect(atravessam(m)).toEqual([]);
  });

  it("âncoras: bocais na ponta -y, face no lado oposto aos fans", () => {
    const m = aioRadiadorModelo({ radiador_mm: 280 });
    for (const i of [0, 1]) {
      const b = m.partes.find((p) => p.id === `bocal-${i}`)!;
      expect(m.ancoras[`bocal${i}`]).toEqual([b.pos[0], b.pos[1] - b.tam[1] / 2, b.pos[2]]);
      expect(m.ancoras[`bocal${i}`][1]).toBe(-140);
    }
    const fan = m.partes.find((p) => p.id === "fan-0")!;
    expect(m.ancoras.face).toEqual([-26, 0, 0]);
    expect(fan.pos[0]).toBeGreaterThan(0);
    expect(fan.explode[0]).toBeGreaterThan(0);
    expect(m.partes.find((p) => p.id === "nucleo")!.explode).toEqual([0, 0, 0]);
  });
});
