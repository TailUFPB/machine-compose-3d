// Detalhe fino das peças: campos opcionais da ficha, âncoras novas e subpeças móveis (encaixe).
import { Euler, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { coolerModelo, cpuModelo } from "./cpu";
import { fonteModelo, gabineteModelo } from "./gabinete";
import { gpuModelo } from "./gpu";
import { type Modelo, type Sub, atravessam, lotes } from "./peca";
import { placaMaeModelo } from "./placa";
import { ramModelo } from "./ram";

const fora = (m: Modelo) => m.partes.filter((p) => !p.pos.every((v, i) => Math.abs(v) + p.tam[i] / 2 <= m.tam[i] / 2 + 0.5)).map((p) => p.id);
const cruzam = (m: Modelo, previsto: (a: string, b: string) => boolean = () => false) => atravessam(m).filter(([a, b]) => !previsto(a, b));
const sub = (m: Modelo, id: string) => m.partes.find((p) => p.id === id)!;
const ids = (m: Modelo, re: RegExp) => m.partes.filter((p) => re.test(p.id));
/** Âncoras pedidas existem e caem dentro ou na face do envelope. */
const ancoras = (m: Modelo, nomes: string[]) => nomes.filter((n) => !m.ancoras[n]?.every((v, i) => Math.abs(v) <= m.tam[i] / 2 + 0.5));
/** Quanto a subpeça ABERTA passa do envelope (mm): cantos da caixa girados em torno do centro e deslocados. */
function excessoAberta(m: Modelo, p: Sub): number {
  const gira = new Euler(...(p.movel?.gira ?? [0, 0, 0])), d = p.movel?.desloca ?? [0, 0, 0];
  let pior = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new Vector3(sx * p.tam[0] / 2, sy * p.tam[1] / 2, sz * p.tam[2] / 2).applyEuler(gira).toArray();
    c.forEach((v, i) => { pior = Math.max(pior, Math.abs(v + p.pos[i] + d[i]) - m.tam[i] / 2); });
  }
  return pior;
}
const moveis = (m: Modelo) => m.partes.filter((p) => p.movel);

describe("GPU: bracket, heatpipes, shroud e saídas da ficha", () => {
  // contatos de projeto: heatpipes por dentro das aletas e fans dentro do furo da tampa
  const previsto = (a: string, b: string) => [a, b].some((x) => x.startsWith("heatpipe")) && [a, b].includes("aletas")
    || [a, b].some((x) => x.startsWith("fan-")) && [a, b].includes("shroud");
  const D = "DisplayPort", H = "HDMI";
  const fichas = [
    { dimensoes: { c: 170, a: 120, l: 40 }, conectores: {} },
    { dimensoes: { c: 170, a: 120, l: 40 }, conectores: {}, fans: 2, backplate: false, saidas: [D, H, H] },
    { dimensoes: { c: 340, a: 120, l: 60 }, conectores: { "8pin": 3 }, tdp: 320, vram_gb: 16 },
    { dimensoes: { c: 340, a: 120, l: 60 }, conectores: { "12V-2x6": 1 }, fans: 3, backplate: true, saidas: [D, D, D, H] },
    { dimensoes: { c: 240, a: 111, l: 40 }, saidas: [D, D, D, H, H, "USB-C"] },   // limite da ficha: 6 saídas
    { comprimento_mm: 240, slots: 2, saidas: ["DVI", D, H] },
  ];

  it("cabe no envelope e nada se atravessa, com e sem os campos opcionais", () => {
    for (const specs of fichas) {
      const m = gpuModelo(specs);
      expect([specs, fora(m)]).toEqual([specs, []]);
      expect([specs, cruzam(m, previsto)]).toEqual([specs, []]);
    }
  });

  it("saídas seguem a lista da ficha, cada tipo com seu tamanho; sem a lista, ficam estimadas", () => {
    const m = gpuModelo(fichas[1]), portas = ids(m, /^porta-\d$/), recortes = ids(m, /^recorte-\d$/);
    expect(portas.map((p) => p.nome)).toEqual(["Saída DisplayPort", "Saída HDMI", "Saída HDMI"]);
    expect([...portas, ...recortes].every((p) => p.fonte === "ficha")).toBe(true);
    expect(recortes[0].tam).not.toEqual(recortes[1].tam);
    expect(ids(gpuModelo(fichas[4]), /^porta-\d$/)).toHaveLength(6);
    const est = ids(gpuModelo(fichas[0]), /^porta-\d$/);
    expect(est).toHaveLength(4);
    expect(est.every((p) => p.fonte === "estimado")).toBe(true);
  });

  it("aba do bracket da norma, heatpipes dobrados e shroud com chanfro", () => {
    for (const specs of fichas) {
      const m = gpuModelo(specs);
      expect(sub(m, "bracket-aba").fonte).toBe("norma");
      expect(ids(m, /^bracket-entalhe-\d$/)).toHaveLength(m.tam[1] / 20);
      const pipes = ids(m, /^heatpipe-\d$/), base = sub(m, "base");
      expect(pipes.length).toBeGreaterThanOrEqual(4);
      for (const p of pipes) {
        expect(p.forma.tipo).toBe("curva");
        expect(p.pos[1] + p.tam[1] / 2).toBeCloseTo(base.pos[1] - base.tam[1] / 2, 5);   // sai encostado na base de cobre
      }
      expect(ids(m, /^shroud-parede-[01]$/).map((p) => p.forma.tipo)).toEqual(["perfil", "perfil"]);
    }
  });

  it("parafusos do bracket são móveis e ficam perto da placa quando abertos", () => {
    const m = gpuModelo(fichas[3]);
    expect(moveis(m).map((p) => p.id)).toEqual(["bracket-parafuso-0", "bracket-parafuso-1", "bracket-parafuso-2"]);
    for (const p of moveis(m)) expect(excessoAberta(m, p)).toBeLessThanOrEqual(30);
  });
});

describe("placa-mãe: portas da ficha, dissipador do M.2, standoffs, travas e âncoras de cabo", () => {
  const A = "USB-A", C = "USB-C";
  const TOPO = [A, A, A, A, A, A, C, C, "HDMI", "DisplayPort", "RJ45", "audio"], BASICA = ["PS/2", A, A, "HDMI", "DisplayPort", A, A, "RJ45", "audio"];
  const fichas = ["ATX", "mATX", "ITX"].flatMap((form_factor) => {
    const base = { form_factor, socket: form_factor === "mATX" ? "AM4" : "LGA1700", slots_ram: form_factor === "ITX" ? 2 : 4 };
    return [base, { ...base, portas_traseiras: TOPO, m2_dissipador: true }, { ...base, portas_traseiras: BASICA, m2_dissipador: false }];
  });

  it("cabe no envelope e nada se atravessa, com e sem os campos opcionais", () => {
    for (const specs of fichas) {
      const m = placaMaeModelo(specs);
      expect([specs, fora(m)]).toEqual([specs, []]);
      expect([specs, cruzam(m)]).toEqual([specs, []]);
    }
  });

  it("portas traseiras seguem a ficha, cada tipo com seu tamanho", () => {
    for (const specs of fichas) {
      const m = placaMaeModelo(specs), portas = ids(m, /^io-porta-\d+$/), lista = (specs as { portas_traseiras?: string[] }).portas_traseiras;
      if (!lista) { expect(portas.every((p) => p.fonte === "estimado")).toBe(true); continue; }
      expect(portas).toHaveLength(lista.length);
      expect(portas.every((p) => p.fonte === "ficha")).toBe(true);
      lista.forEach((tipo, i) => expect(sub(m, `io-porta-${i}`).nome.toLowerCase()).toContain(tipo === "audio" ? "áudio" : tipo.toLowerCase()));
      expect(sub(m, `io-porta-${lista.indexOf("RJ45")}`).tam).not.toEqual(sub(m, `io-porta-${lista.indexOf(A)}`).tam);
    }
  });

  it("dissipador do M.2 só com a ficha, acima do SSD", () => {
    for (const specs of fichas) {
      const m = placaMaeModelo(specs), d = m.partes.find((p) => p.id === "m2-dissipador");
      expect(d != null).toBe((specs as { m2_dissipador?: boolean }).m2_dissipador === true);
      if (d) {
        expect(d.fonte).toBe("ficha");
        expect(d.pos[2] - d.tam[2] / 2).toBeGreaterThanOrEqual(m.ancoras.m2[2] + 1.5);   // o SSD (3 mm) fica centrado na âncora
      }
    }
  });

  it("standoffs sob cada furo de fixação; capacitores e chips baixos nas áreas livres", () => {
    for (const specs of fichas) {
      const m = placaMaeModelo(specs), pcb = sub(m, "pcb"), baixo = pcb.pos[2] - pcb.tam[2] / 2;
      const furos = ids(m, /^furo-\d$/), standoffs = ids(m, /^standoff-\d$/);
      expect(standoffs).toHaveLength(furos.length);
      for (const s of standoffs) expect(s.pos[2] + s.tam[2] / 2).toBeCloseTo(baixo, 5);
      const miudos = ids(m, /^(cap|chip|indutor)-/);
      expect(miudos.length).toBeGreaterThan(specs.form_factor === "ITX" ? 4 : 15);
      for (const p of miudos) expect(p.pos[2] + p.tam[2] / 2 - (baixo + pcb.tam[2])).toBeLessThanOrEqual(4.5 + 1e-6);   // cabem sob a GPU e o cooler
    }
  });

  it("âncoras de cabo no topo de cada conector, em todos os formatos; ids usados pela cena continuam", () => {
    const nomes = ["fan_cpu", "fan_sys0", "fan_sys1", "fan_sys2", "painel", "usb2", "audio", "sata0", "sata1", "atx24", "eps"];
    for (const specs of fichas) {
      const m = placaMaeModelo(specs);
      expect([specs.form_factor, ancoras(m, [...nomes, "cpu", "dimm0", "pcie", "m2"])]).toEqual([specs.form_factor, []]);
      for (const id of ["atx24", "eps", "fan-cpu-pinos"]) expect(sub(m, id)).toBeDefined();
      for (const [a, id] of [["atx24", "atx24"], ["eps", "eps"], ["fan_cpu", "fan-cpu-pinos"], ["fan_sys1", "fan-sys1-pinos"], ["sata0", "sata-1"]]) {
        const p = sub(m, id);
        expect(m.ancoras[a]).toEqual([p.pos[0], p.pos[1], p.pos[2] + p.tam[2] / 2]);
      }
    }
  });

  it("alavanca do soquete e travas dos slots são móveis e abrem perto da placa", () => {
    for (const specs of fichas) {
      const m = placaMaeModelo(specs), mv = moveis(m).map((p) => p.id);
      expect(mv).toContain("soquete-alavanca");
      expect(mv).toContain("pcie-0-trava");
      expect(mv.filter((id) => /^dimm-\d-trava/.test(id))).toHaveLength(2 * specs.slots_ram);
      for (const p of moveis(m)) expect([p.id, excessoAberta(m, p) <= 30]).toEqual([p.id, true]);
    }
  });
});

describe("gabinete: fans, lateral, baias e filtros da ficha", () => {
  const fichas = [
    { dimensoes: { c: 480, a: 491, l: 235 }, fans_inclusos: 3, posicoes_fan: { frente: 3, topo: 3, traseira: 1 }, lateral: "vidro", baias: { "2.5": 2, "3.5": 2 } },
    { dimensoes: { c: 480, a: 491, l: 235 }, fans_inclusos: 3 },
    { dimensoes: { c: 376, a: 292, l: 185 }, fans_inclusos: 2, lateral: "chapa", baias: { "2.5": 3, "3.5": 1 } },
    { dimensoes: { c: 376, a: 292, l: 185 }, fans_inclusos: 1 },
    { dimensoes: { c: 387, a: 381, l: 230 }, fans_inclusos: 1, posicoes_fan: { frente: 2, topo: 2, traseira: 1 }, baias: { "2.5": 2, "3.5": 1 } },
    { dimensoes: { c: 446, a: 464, l: 227 }, fans_inclusos: 6, posicoes_fan: { frente: 3, topo: 2, traseira: 1 }, lateral: "vidro", baias: { "2.5": 0, "3.5": 0 } },
  ] as Record<string, any>[];

  it("cabe no envelope e nada se atravessa, com e sem os campos opcionais", () => {
    for (const specs of fichas) {
      const m = gabineteModelo(specs, [{ x: 0, z: 0 }]);
      expect([specs, fora(m)]).toEqual([specs, []]);
      expect([specs, cruzam(m)]).toEqual([specs, []]);
    }
  });

  it("posições de fan seguem a ficha; os fans inclusos ocupam traseira, frente e topo, nessa ordem", () => {
    for (const specs of fichas) {
      const m = gabineteModelo(specs), pos = specs.posicoes_fan;
      const conta = (re: RegExp) => Object.keys(m.ancoras).filter((a) => re.test(a)).length;
      if (pos) expect([conta(/^fan_frontal_\d$/), conta(/^fan_topo_\d$/), conta(/^fan_traseiro$/)]).toEqual([pos.frente, pos.topo, pos.traseira]);
      const vagas = conta(/^fan_(frontal|topo)_\d$|^fan_traseiro$/), fans = m.partes.filter((p) => p.forma.tipo === "fan");
      expect(fans).toHaveLength(Math.min(specs.fans_inclusos, vagas));
      for (const f of fans) expect(Object.values(m.ancoras)).toContainEqual(f.pos);   // cada fan está numa posição
      expect(ancoras(m, Object.keys(m.ancoras))).toEqual([]);
    }
    const m = gabineteModelo(fichas[5]);
    expect(m.partes.filter((p) => p.forma.tipo === "fan").map((p) => p.id)).toEqual(["fan-traseiro", "fan-frontal-0", "fan-frontal-1", "fan-frontal-2", "fan-topo-0", "fan-topo-1"]);
  });

  it("baias seguem a ficha e ficam sob a cobertura; sem a ficha, 2 + 2 estimadas", () => {
    for (const specs of fichas) {
      const m = gabineteModelo(specs), b = specs.baias ?? { "2.5": 2, "3.5": 2 };
      for (const [k, pre] of [["2.5", "baia25"], ["3.5", "baia35"]] as const) {
        const bandejas = ids(m, new RegExp(`^${pre}-\\d$`));
        expect(bandejas).toHaveLength(b[k]);
        expect(bandejas.every((p) => p.fonte === (specs.baias ? "ficha" : "estimado"))).toBe(true);
        bandejas.forEach((p, i) => expect(m.ancoras[`${pre}_${i}`]).toEqual([p.pos[0], p.pos[1] + p.tam[1] / 2, p.pos[2]]));   // piso da baia
      }
      expect(m.estimados.includes("baias")).toBe(!specs.baias);
      const cob = m.partes.find((p) => p.id === "cobertura");
      if (cob) for (const p of ids(m, /^(baia|gaiola)/)) expect(p.pos[1] + p.tam[1] / 2).toBeLessThanOrEqual(cob.pos[1] - cob.tam[1] / 2);
    }
  });

  it("lateral de vidro ou de chapa conforme a ficha; ausente = vidro estimado", () => {
    const vidro = gabineteModelo(fichas[0]), chapa = gabineteModelo(fichas[2]), semFicha = gabineteModelo(fichas[1]);
    expect(sub(vidro, "vidro")).toMatchObject({ tom: "vidro", fonte: "ficha" });
    expect(vidro.estimados).not.toContain("vidro");
    expect(sub(semFicha, "vidro")).toMatchObject({ tom: "vidro", fonte: "estimado" });
    expect(semFicha.estimados).toContain("vidro");
    expect(chapa.partes.some((p) => p.tom === "vidro")).toBe(false);
    expect(ids(chapa, /^lateral-chapa-\d$/).every((p) => p.fonte === "ficha" && p.nome.includes("chapa"))).toBe(true);
    expect(ids(chapa, /^lateral-chapa-\d$/).length).toBeGreaterThan(0);
  });

  it("filtros, entrada de ar, tampas de slot e âncoras de radiador e do painel", () => {
    for (const specs of fichas) {
      const m = gabineteModelo(specs);
      for (const id of ["filtro-frente", "entrada-ar"]) expect(sub(m, id)).toBeDefined();
      expect(ids(m, /^slot-\d-vent$/)).toHaveLength(ids(m, /^slot-\d$/).length);
      expect(m.partes.some((p) => p.id === "filtro-topo")).toBe(Object.keys(m.ancoras).some((a) => a.startsWith("fan_topo_")));
      expect(ancoras(m, ["radiador_frente", "radiador_topo", "painel_io", "piso"])).toEqual([]);
      expect(m.ancoras.radiador_frente[0]).toBeLessThan(-m.tam[0] / 2 + 5);
      expect(m.ancoras.radiador_topo[1]).toBeGreaterThan(m.tam[1] / 2 - 5);
    }
    expect(sub(gabineteModelo(fichas[0]), "slot-0")).toMatchObject({ nome: "Tampa de slot PCIe", fonte: "norma" });
    expect(sub(gabineteModelo(fichas[0], [{ x: 0, z: 0 }]), "cobertura").forma).toMatchObject({ tipo: "placa", furos: { length: 1 } });
  });
});

describe("fonte: âncoras das saídas de cabo", () => {
  it("uma âncora por saída, no centro dela, na face dos cabos", () => {
    for (const specs of [{ dimensoes: { c: 150, a: 86, l: 140 }, conectores: { "8pin": 2 } }, { dimensoes: { c: 125, a: 63, l: 100 } }, { conectores: { "8pin": 6 } }]) {
      const m = fonteModelo(specs), saidas = ids(m, /^saida-\d$/);
      expect(saidas.length).toBeGreaterThanOrEqual(3);
      saidas.forEach((p, i) => expect(m.ancoras[`saida${i}`]).toEqual([-m.tam[0] / 2, p.pos[1], p.pos[2]]));
      expect(m.ancoras.base).toEqual([0, -m.tam[1] / 2, 0]);
    }
  });
});

describe("lotes do renderizador", () => {
  const modelos = [gpuModelo({ dimensoes: { c: 340, a: 120, l: 60 }, conectores: { "8pin": 3 } }), placaMaeModelo({ form_factor: "ATX", m2_dissipador: true }),
    gabineteModelo({ fans_inclusos: 3 }), fonteModelo({}), cpuModelo({}), coolerModelo({}), ramModelo({ modulos: 2, altura_mm: 40 })];

  it("cada subpeça entra em um lote só; fans e subpeças móveis ficam sozinhos; o lote anda junto e tem um tom", () => {
    for (const m of modelos) {
      const ls = lotes(m.partes);
      expect(ls.flatMap((l) => l.subs.map((s) => s.id)).sort()).toEqual(m.partes.map((p) => p.id).sort());
      for (const l of ls) {
        const [a] = l.subs;
        if (a.forma.tipo === "fan" || a.movel) expect([l.subs.length, l.pos, l.movel]).toEqual([1, a.pos, a.movel]);
        else expect(l.pos).toEqual([0, 0, 0]);
        for (const s of l.subs) expect([s.explode, s.ordem, s.tom]).toEqual([l.explode, l.ordem, a.tom]);
      }
      expect(ls.length).toBeLessThan(m.partes.length);
    }
  });
});

describe("cooler: heatpipes e fans da ficha", () => {
  it("usa o número de heatpipes da ficha, cabe no envelope e deixa de ser estimado", () => {
    for (const heatpipes of [1, 6, 8]) {
      const m = coolerModelo({ altura_mm: 155, tdp_suportado: 245, heatpipes, fans: 1, fan_mm: 120 });
      const pipes = m.partes.filter((p) => p.id.startsWith("heatpipe-"));
      expect(pipes).toHaveLength(heatpipes);
      expect(pipes.every((p) => p.fonte === "ficha")).toBe(true);
      expect(m.partes.every((p) => p.pos.every((v, i) => Math.abs(v) + p.tam[i] / 2 <= m.tam[i] / 2 + 0.5))).toBe(true);
      expect(atravessam(m).filter(([a, b]) => !(a === "aletas" && b.startsWith("heatpipe")))).toEqual([]);
      expect(m.estimados).toEqual([]);
    }
    expect(coolerModelo({ altura_mm: 155 }).estimados).toEqual(["fans", "heatpipes"]);
  });
});
