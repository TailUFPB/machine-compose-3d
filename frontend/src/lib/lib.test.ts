import { describe, expect, it } from "vitest";
import type { Cena } from "./api";
import { foraDoGabinete, montarCabos, montarCena, posicaoTutorial } from "./cena";
import { brl, quadroEm } from "./formato";
import { coolerModelo, cpuModelo } from "./cpu";
import { fonteModelo, gabineteModelo } from "./gabinete";
import { gpuModelo } from "./gpu";
import { ssdModelo } from "./ssd";
import { type Modelo, atravessam, progressoExplosao } from "./peca";
import { placaMaeModelo } from "./placa";
import { ramModelo } from "./ram";

const gabinete = (gpu_max: number) => ({
  id: "case", tipo: "gabinete" as const, nome: "Gabinete",
  specs: { dimensoes: { c: 376, a: 292, l: 185 }, gpu_max_mm: gpu_max },
});
const gpu = (comp: number) => ({ id: "gpu", tipo: "gpu" as const, nome: "GPU", specs: { comprimento_mm: comp, slots: 2 } });
const mb = { id: "mb", tipo: "placa_mae" as const, nome: "MB", specs: { form_factor: "ITX" } };

describe("montarCena", () => {
  it("dimensiona pela ficha e marca conflito em vermelho", () => {
    const cena: Cena = { pecas: [gabinete(330), mb, gpu(240)], conflitos: [{ id: "x", itens: ["gpu"], descricao: "", severidade: "atencao" }], passos: [] };
    const caixas = montarCena(cena);
    const g = caixas.find((c) => c.id === "gpu")!;
    expect(g.tam[0]).toBe(240);
    expect(g.conflito).toBe(true);
    expect(caixas.find((c) => c.id === "mb")!.conflito).toBe(false);
  });

  it("GPU maior que o gabinete atravessa a parede na geometria", () => {
    const longa = montarCena({ pecas: [gabinete(330), mb, gpu(400)], conflitos: [], passos: [] });
    expect(foraDoGabinete(longa)).toContain("gpu");
    const curta = montarCena({ pecas: [gabinete(330), mb, gpu(240)], conflitos: [], passos: [] });
    expect(foraDoGabinete(curta)).not.toContain("gpu");
  });
});

describe("posicaoTutorial", () => {
  const cena: Cena = { pecas: [gabinete(330), mb, gpu(240)], conflitos: [], passos: [{ tipo: "placa_mae", texto: "" }, { tipo: "gpu", texto: "" }] };
  const [, placa, placaVideo] = montarCena(cena);
  it("esconde passos futuros e anima o atual até a posição final", () => {
    expect(posicaoTutorial(placaVideo, 0, 0.5)).toBeNull();
    expect(posicaoTutorial(placa, 1, 0)).toEqual(placa.pos);
    expect(posicaoTutorial(placaVideo, 1, 1)).toEqual(placaVideo.pos);
    expect(posicaoTutorial(placaVideo, 1, 0)![2]).toBeGreaterThan(placaVideo.pos[2]);
  });
});

describe("quadroEm", () => {
  it("avança na cadência do FPS médio", () => {
    expect(quadroEm(0, 60, 60)).toBe(0);
    expect(quadroEm(1000, 60, 60)).toBe(60);
    expect(quadroEm(1000, 30, 30)).toBe(30);
  });
  it("o quadro do 1% low segura a imagem por mais tempo", () => {
    // 100 FPS médio, 1% low de 20 FPS: o primeiro quadro de cada bloco dura 50 ms
    expect(quadroEm(40, 100, 20)).toBe(0);
    expect(quadroEm(55, 100, 20)).toBe(1);
  });
});

describe("brl", () => {
  it("formata em reais", () => {
    expect(brl(1234.5).replace(/\s/g, " ")).toBe("R$ 1.234,50");
    expect(brl(null)).toBe("sem preço");
  });
});

describe("gpuModelo", () => {
  const dentro = (m: ReturnType<typeof gpuModelo>) =>
    m.partes.every((p) => p.pos.every((v, i) => Math.abs(v) + p.tam[i] / 2 <= m.tam[i] / 2 + 0.5));

  it("cabe no envelope da ficha e segue fans e conectores", () => {
    const curta = gpuModelo({ dimensoes: { c: 170, a: 120, l: 40 }, slots: 2, conectores: {} });
    const longa = gpuModelo({ dimensoes: { c: 315, a: 120, l: 60 }, slots: 3, conectores: { "8pin": 3 } });
    expect(curta.tam).toEqual([170, 40, 120]);
    expect(dentro(curta) && dentro(longa)).toBe(true);
    expect(curta.partes.filter((p) => p.forma.tipo === "fan")).toHaveLength(1);
    expect(longa.partes.filter((p) => p.forma.tipo === "fan")).toHaveLength(3);
    expect(longa.partes.filter((p) => /^energia-\d$/.test(p.id))).toHaveLength(3);
    expect(curta.estimados).toContain("fans");
    expect(gpuModelo({ dimensoes: { c: 240, a: 120, l: 40 }, fans: 2, backplate: false }).estimados).toEqual(["eletrônica"]);
    expect(curta.partes.find((p) => p.id === "fan-0")!.fonte).toBe("estimado");
    expect(curta.partes.find((p) => p.id === "pcie-x1")!.fonte).toBe("norma");
  });

  it("nenhuma subpeça atravessa outra, em todo o catálogo de tamanhos", () => {
    // heatpipes passam por dentro das aletas e os fans ficam dentro do furo da tampa: contatos de projeto
    const previsto = (a: string, b: string) => [a, b].some((x) => x.startsWith("heatpipe")) && [a, b].includes("aletas")
      || [a, b].some((x) => x.startsWith("fan-")) && [a, b].includes("shroud");
    for (const specs of [
      { dimensoes: { c: 170, a: 120, l: 40 }, vram_gb: 6, tdp: 70, conectores: {} },
      { dimensoes: { c: 242, a: 120, l: 40 }, vram_gb: 12, tdp: 170, conectores: { "8pin": 1 } },
      { dimensoes: { c: 340, a: 120, l: 60 }, vram_gb: 16, tdp: 320, conectores: { "12V-2x6": 1 } },
      { dimensoes: { c: 315, a: 120, l: 60 }, vram_gb: 16, tdp: 304, conectores: { "8pin": 3 } },
    ]) expect(atravessam(gpuModelo(specs)).filter(([a, b]) => !previsto(a, b))).toEqual([]);
  });

  it("explosão escalonada: abre na ordem, fecha na ordem inversa", () => {
    expect(progressoExplosao(0, 5, 0.2, true)).toBeGreaterThan(progressoExplosao(5, 5, 0.2, true));
    expect(progressoExplosao(5, 5, 2, true)).toBe(1);
    expect(progressoExplosao(5, 5, 0.2, false)).toBeLessThan(progressoExplosao(0, 5, 0.2, false));
    expect(progressoExplosao(0, 5, 2, false)).toBe(0);
  });
});

describe("placa-mãe e memória procedurais", () => {
  const dentro = (m: Modelo) => m.partes.every((p) => p.pos.every((v, i) => Math.abs(v) + p.tam[i] / 2 <= m.tam[i] / 2 + 0.5));

  it("placa-mãe cabe no formato e nada se atravessa, em ATX, mATX e ITX", () => {
    for (const ff of ["ATX", "mATX", "ITX"]) {
      const m = placaMaeModelo({ form_factor: ff, socket: "AM5", slots_ram: ff === "ITX" ? 2 : 4 });
      expect(dentro(m)).toBe(true);
      expect(atravessam(m)).toEqual([]);
      expect(m.partes.filter((p) => /^dimm-\d$/.test(p.id))).toHaveLength(ff === "ITX" ? 2 : 4);
    }
  });

  it("memória segue o JEDEC e o número de módulos", () => {
    const m = ramModelo({ ddr: "DDR5", modulos: 2, altura_mm: 34 }, 19);
    expect(m.tam[1]).toBe(133.35);
    expect(dentro(m)).toBe(true);
    expect(atravessam(m)).toEqual([]);
    expect(m.partes.filter((p) => p.id.endsWith("-pcb"))).toHaveLength(2);
    expect(ramModelo({ modulos: 1, altura_mm: 31 }).partes.some((p) => p.nome === "Dissipador")).toBe(false);
  });

  it("encaixes: pente da GPU cai no slot PCIe e os módulos caem nos slots de memória", () => {
    const cena: Cena = {
      pecas: [gabinete(400), { id: "mb", tipo: "placa_mae", nome: "MB", specs: { form_factor: "mATX", slots_ram: 4 } }, gpu(240),
        { id: "ram", tipo: "memoria", nome: "RAM", specs: { ddr: "DDR5", modulos: 2, altura_mm: 34 } }],
      conflitos: [], passos: [],
    };
    const cx = montarCena(cena);
    const de = (id: string) => cx.find((c) => c.id === id)!;
    const mundo = (id: string, sub: string) => { const c = de(id), p = c.modelo!.partes.find((s) => s.id === sub)!; return p.pos.map((v, i) => v + c.pos[i]); };
    const slot = mundo("mb", "pcie-0"), pente = mundo("gpu", "pcie-x16");
    expect(pente[1]).toBeCloseTo(slot[1], 5);
    expect(Math.abs(pente[2] - slot[2])).toBeLessThan(4);          // pente dentro da altura do slot
    expect(mundo("ram", "m0-pcb")[0]).toBeCloseTo(mundo("mb", "dimm-3")[0], 5);
    expect(mundo("ram", "m1-pcb")[0]).toBeCloseTo(mundo("mb", "dimm-1")[0], 5);
    expect(foraDoGabinete(cx)).toEqual([]);
  });
});

describe("CPU e cooler procedurais", () => {
  const dentro = (m: Modelo) => m.partes.every((p) => p.pos.every((v, i) => Math.abs(v) + p.tam[i] / 2 <= m.tam[i] / 2 + 0.5));

  it("CPU segue o encapsulamento do soquete", () => {
    for (const socket of ["AM4", "AM5", "LGA1700"]) {
      const m = cpuModelo({ socket, nucleos: 6 });
      expect(dentro(m)).toBe(true);
      expect(atravessam(m)).toEqual([]);
    }
    expect(cpuModelo({ socket: "LGA1700" }).tam.slice(0, 2)).toEqual([37.5, 45]);
    expect(cpuModelo({ socket: "AM4" }).partes[0].nome).toBe("Pinos (PGA)");
  });

  it("cooler tem a altura da ficha e só os heatpipes atravessam as aletas", () => {
    for (const specs of [{ altura_mm: 155, tdp_suportado: 220 }, { altura_mm: 125, tdp_suportado: 130 }, { altura_mm: 165, tdp_suportado: 260, fans: 2 }]) {
      const m = coolerModelo(specs);
      expect(m.tam[2]).toBe(specs.altura_mm);
      expect(dentro(m)).toBe(true);
      expect(atravessam(m).filter(([a, b]) => !(a === "aletas" && b.startsWith("heatpipe")))).toEqual([]);
      expect(m.partes.filter((p) => p.forma.tipo === "fan")).toHaveLength(specs.fans ?? 1);
    }
  });

  it("cooler apoia na tampa da CPU, que apoia no soquete", () => {
    const cx = montarCena({ pecas: [gabinete(400), mb, { id: "cpu", tipo: "cpu", nome: "CPU", specs: { socket: "AM5" } },
      { id: "cooler", tipo: "cooler", nome: "Cooler", specs: { refrigeracao: "ar", altura_mm: 155 } }], conflitos: [], passos: [] });
    const c = cx.find((p) => p.id === "cpu")!, k = cx.find((p) => p.id === "cooler")!;
    expect(k.pos[2] - k.tam[2] / 2).toBeCloseTo(c.pos[2] + c.tam[2] / 2, 5);
  });
});

describe("SSD, fonte e gabinete procedurais", () => {
  const dentro = (m: Modelo) => m.partes.every((p) => p.pos.every((v, i) => Math.abs(v) + p.tam[i] / 2 <= m.tam[i] / 2 + 0.5));
  const limpo = (m: Modelo, previsto: (a: string, b: string) => boolean = () => false) => atravessam(m).filter(([a, b]) => !previsto(a, b));

  it("SSD M.2 2280 segue a norma", () => {
    const m = ssdModelo({ interface: "M.2", capacidade_gb: 2000 });
    expect(m.tam).toEqual([80, 22, 3]);
    expect(dentro(m)).toBe(true);
    expect(limpo(m)).toEqual([]);
    expect(m.partes.filter((p) => p.id.startsWith("nand"))).toHaveLength(3);
  });

  it("fonte ATX e SFX cabem na ficha; só o fan fica dentro do furo da chapa", () => {
    for (const dimensoes of [{ c: 150, a: 86, l: 140 }, { c: 125, a: 63.5, l: 100 }, { c: 180, a: 86, l: 150 }]) {
      const m = fonteModelo({ dimensoes, potencia_w: 650, conectores: { "8pin": 2 } });
      expect(dentro(m)).toBe(true);
      expect(limpo(m, (a, b) => [a, b].includes("fan") && [a, b].includes("base"))).toEqual([]);
    }
  });

  it("gabinete: chapas fecham o volume da ficha e os fans seguem fans_inclusos", () => {
    for (const [dimensoes, fans] of [[{ c: 480, a: 491, l: 235 }, 3], [{ c: 376, a: 292, l: 185 }, 1], [{ c: 430, a: 450, l: 210 }, 0]] as const) {
      const m = gabineteModelo({ dimensoes, fans_inclusos: fans });
      expect(dentro(m)).toBe(true);
      expect(limpo(m)).toEqual([]);
      expect(m.partes.filter((p) => p.forma.tipo === "fan")).toHaveLength(fans);
    }
  });
});

describe("cabos", () => {
  const cena: Cena = { conflitos: [], passos: [], pecas: [
    { id: "case", tipo: "gabinete", nome: "Case", specs: { dimensoes: { c: 480, a: 491, l: 235 }, fans_inclusos: 3 } },
    { id: "mb", tipo: "placa_mae", nome: "MB", specs: { form_factor: "mATX", socket: "AM5", slots_ram: 4 } },
    { id: "cpu", tipo: "cpu", nome: "CPU", specs: { socket: "AM5" } },
    { id: "cooler", tipo: "cooler", nome: "Cooler", specs: { refrigeracao: "ar", altura_mm: 155 } },
    { id: "gpu", tipo: "gpu", nome: "GPU", specs: { dimensoes: { c: 290, a: 120, l: 60 }, conectores: { "8pin": 2 } } },
    { id: "psu", tipo: "fonte", nome: "PSU", specs: { dimensoes: { c: 150, a: 86, l: 140 }, conectores: { "8pin": 2 } } },
  ] };
  const caixas = montarCena(cena), cabos = montarCabos(caixas);

  it("liga fonte à placa-mãe e à GPU; fans e painel frontal à placa", () => {
    expect(cabos.map((c) => c.id).sort()).toEqual(["cabo-atx24", "cabo-audio", "cabo-eps", "cabo-fan-cpu", "cabo-fan-frontal-0", "cabo-fan-frontal-1",
      "cabo-fan-traseiro", "cabo-gpu-0", "cabo-gpu-1", "cabo-painel", "cabo-usb2"]);
    const gab = caixas[0];
    for (const c of cabos) for (const p of c.pontos) p.forEach((v, i) => expect(Math.abs(v)).toBeLessThanOrEqual(gab.tam[i] / 2));
    expect(gab.modelo!.partes.find((p) => p.id === "cobertura")!.forma).toMatchObject({ tipo: "placa", furos: { length: 4 } });
  });

  it("nenhum cabo atravessa uma peça (fora da chegada aos próprios conectores)", () => {
    for (const c of cabos) {
      const total = c.pontos.slice(1).reduce((s, p, i) => s + Math.hypot(...p.map((v, k) => v - c.pontos[i][k])), 0);
      let andado = 0;
      for (let i = 1; i < c.pontos.length; i++) {
        const a = c.pontos[i - 1], b = c.pontos[i], seg = Math.hypot(...b.map((v, k) => v - a[k]));
        for (let d = 0; d <= seg; d += 4) {
          const pt = a.map((v, k) => v + ((b[k] - v) * d) / seg), pos = andado + d;
          const perto = pos < 60 || total - pos < 60;
          const bate = caixas.filter((x) => x.tipo !== "gabinete" && !(perto && (x.id === c.de || x.id === c.para)))
            .filter((x) => pt.every((v, k) => Math.abs(v - x.pos[k]) < x.tam[k] / 2 - 0.5)).map((x) => x.id);
          expect([c.id, bate]).toEqual([c.id, []]);
        }
        andado += seg;
      }
    }
  });
});
