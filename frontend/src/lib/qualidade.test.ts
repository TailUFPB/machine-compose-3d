// Qualidade da cena no celular: nível inicial, descida do Auto, escolha guardada e subpeças do modo Leve.
import { afterEach, describe, expect, it, vi } from "vitest";
import { placaMaeModelo } from "./placa";
import { desceAuto, guardarEscolha, lerEscolha, nivelInicial, partesVisiveis, rotuloQualidade } from "./qualidade";

function armazenamento(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("nível inicial", () => {
  it("Auto começa Leve no toque e Alta no mouse; escolha manual vence", () => {
    expect(nivelInicial("auto", true)).toBe("leve");
    expect(nivelInicial("auto", false)).toBe("alta");
    expect(nivelInicial("alta", true)).toBe("alta");
    expect(nivelInicial("leve", false)).toBe("leve");
  });
});

describe("descida do Auto", () => {
  it("só desce com 3 amostras seguidas abaixo de 30 q/s", () => {
    expect(desceAuto([25, 25])).toBe(false);
    expect(desceAuto([60, 25, 25, 25])).toBe(true);
    expect(desceAuto([25, 25, 31])).toBe(false);
  });
});

describe("escolha guardada", () => {
  it("sem localStorage ou com erro, Auto", () => {
    expect(lerEscolha()).toBe("auto");
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } });
    expect(lerEscolha()).toBe("auto");
    expect(() => guardarEscolha("leve")).not.toThrow();
  });
  it("valor inválido vira Auto; o guardado volta", () => {
    const s = armazenamento();
    vi.stubGlobal("localStorage", s);
    s.setItem("cena-qualidade", "xyz");
    expect(lerEscolha()).toBe("auto");
    guardarEscolha("leve");
    expect(lerEscolha()).toBe("leve");
  });
});

describe("subpeças no modo Leve", () => {
  const m = placaMaeModelo({ form_factor: "ATX", socket: "AM5", slots_ram: 4 });
  it("fechada no Leve, sem pinos, contatos e trilhas", () => {
    const v = partesVisiveis(m.partes, true, false);
    expect(m.partes.some((p) => p.forma.tipo === "grade")).toBe(true);
    expect(v.some((p) => p.forma.tipo === "grade")).toBe(false);
    expect(v.length).toBeLessThan(m.partes.length);
  });
  it("aberta no Leve ou em Alta, tudo", () => {
    expect(partesVisiveis(m.partes, true, true)).toEqual(m.partes);
    expect(partesVisiveis(m.partes, false, false)).toEqual(m.partes);
  });
});

describe("rótulo", () => {
  it("Auto mostra o nível efetivo", () => {
    expect(rotuloQualidade("auto", "leve")).toBe("Auto (leve)");
    expect(rotuloQualidade("auto", "alta")).toBe("Auto (alta)");
    expect(rotuloQualidade("alta", "alta")).toBe("Alta");
  });
});
