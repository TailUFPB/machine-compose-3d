import { describe, expect, it } from "vitest";
import type { Cena } from "./api";
import { type Cabo, type Caixa, type Vec3, descricaoCena, estadoPasso, focoDaPrevia, foraDoGabinete, montarCabos, montarCena, noMundo, posicaoExplodida, regioesDeConflito } from "./cena";

type Peca = Cena["pecas"][number];
const p = (id: string, tipo: Peca["tipo"], specs: Record<string, any>, nome = id): Peca => ({ id, tipo, nome, specs });
const torre = (fans: number) => p("case", "gabinete", { dimensoes: { c: 480, a: 491, l: 235 }, fans_inclusos: fans }, "Torre");
const media = p("case", "gabinete", { dimensoes: { c: 430, a: 450, l: 210 }, fans_inclusos: 0 }, "Torre média");
const placa = (ff: string) => p("mb", "placa_mae", { form_factor: ff, socket: "AM5", slots_ram: ff === "ITX" ? 2 : 4 }, `Placa ${ff}`);
const cpu = p("cpu", "cpu", { socket: "AM5" }, "Processador");
const ar = p("cooler", "cooler", { refrigeracao: "ar", altura_mm: 155 }, "Cooler a ar");
const aio = (mm: number, posicao?: string) => p("cooler", "cooler", { refrigeracao: "aio", radiador_mm: mm, fans: mm / 120, radiador_posicao: posicao }, "Water cooler");
const ram = (altura: number) => p("ram", "memoria", { ddr: "DDR5", modulos: 2, altura_mm: altura }, "Memória");
const gpu = (c: number, slots: number) => p("gpu", "gpu", { dimensoes: { c, a: 120, l: slots * 20 }, slots, conectores: { "8pin": 2 } }, "Placa de vídeo");
const psu = p("psu", "fonte", { dimensoes: { c: 150, a: 86, l: 140 }, conectores: { "8pin": 2 } }, "Fonte");
const m2 = p("m2", "armazenamento", { interface: "M.2", capacidade_gb: 1000 }, "SSD M.2");
const ssd = p("ssd", "armazenamento", { interface: "SATA", capacidade_gb: 1000 }, "SSD SATA");   // sem `formato`: 2,5"
const hd = p("hd", "armazenamento", { interface: "SATA", formato: "3.5", capacidade_gb: 4000 }, "HD");
const PASSOS: Cena["passos"] = (["cpu", "memoria", "armazenamento", "cooler", "gabinete", "placa_mae", "fonte", "gpu"] as const).map((tipo) => ({ tipo, texto: "" }));
const cena = (...pecas: Peca[]): Cena => ({ pecas, conflitos: [], passos: PASSOS.filter((s) => pecas.some((x) => x.tipo === s.tipo)) });

const builds: Record<string, Cena> = {
  "ATX, cooler a ar, M.2 e discos de 2,5 e 3,5": cena(torre(3), placa("ATX"), cpu, ar, ram(34), gpu(290, 3), psu, m2, ssd, hd),
  "mATX, water cooler de 240 na frente": cena(torre(3), placa("mATX"), cpu, aio(240), ram(34), gpu(290, 3), psu, m2),
  "ATX, water cooler de 360 no topo, memória alta e HD": cena(torre(3), placa("ATX"), cpu, aio(360, "topo"), ram(44), gpu(320, 3), psu, m2, hd),
  "ITX em torre média sem fans": cena(media, placa("ITX"), cpu, ar, ram(34), gpu(240, 2), psu, m2),
};
const cada = (f: (caixas: Caixa[], cabos: Cabo[], c: Cena, nome: string) => void) =>
  Object.entries(builds).forEach(([nome, c]) => { const caixas = montarCena(c); f(caixas, montarCabos(caixas), c, nome); });

const de = (caixas: Caixa[], chave: string) => caixas.find((c) => c.chave === chave)!;
const ancora = (c: Caixa, a: string) => noMundo(c, c.modelo!.ancoras[a]);
const perto = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));
/** Pares de caixas com envelopes sobrepostos em mais de 0,5 mm nos três eixos, como "chaveA|chaveB". */
const sobrepostos = (caixas: Caixa[], pos: (c: Caixa) => Vec3 = (c) => c.pos) => caixas.flatMap((a, i) => caixas.slice(i + 1)
  .filter((b) => [0, 1, 2].every((k) => Math.abs(pos(a)[k] - pos(b)[k]) < (a.tam[k] + b.tam[k]) / 2 - 0.5)).map((b) => `${a.chave}|${b.chave}`));
// Encaixes previstos: o que vai na placa-mãe fica dentro do envelope dela (que vai dos standoffs ao painel traseiro),
// o cooler apoia na CPU e o envelope da torre do cooler a ar cobre o SSD M.2, que fica baixo, entre o soquete e a GPU.
const ENCAIXES = ["mb|cpu", "mb|cooler", "mb|ram", "mb|m2", "mb|gpu", "cpu|cooler", "cooler|m2"];

describe("montarCena: water cooler, discos e fonte", () => {
  it("âncoras coincidem: bloco na CPU, face do radiador no painel, base do disco na baia", () => {
    cada((caixas) => {
      const gab = caixas[0], bloco = de(caixas, "cooler"), rad = de(caixas, "cooler:radiador");
      expect(gab.tipo).toBe("gabinete");
      perto(ancora(bloco, "base"), ancora(de(caixas, "cpu"), "topo"));
      if (rad) {
        const topo = rad.specs.radiador_posicao === "topo", face = ancora(rad, "face"), alvo = gab.modelo!.ancoras[topo ? "radiador_topo" : "radiador_frente"];
        // no topo o radiador desliza em z (para o lado do vidro) até livrar a placa-mãe e a memória
        perto(topo ? [face[0], face[1], 0] : face, topo ? [alvo[0], alvo[1], 0] : alvo);
        expect([rad.id, rad.tipo, rad.tam[topo ? 0 : 1]]).toEqual(["cooler", "cooler", rad.specs.radiador_mm]);
      }
      const ssdC = de(caixas, "ssd"), hdC = de(caixas, "hd");
      if (ssdC) perto(ancora(ssdC, "base"), gab.modelo!.ancoras.baia25_0);
      if (hdC) perto(ancora(hdC, "base"), gab.modelo!.ancoras.baia35_0);
      perto(de(caixas, "m2").pos, noMundo(de(caixas, "mb"), de(caixas, "mb").modelo!.ancoras.m2));
    });
  });

  it("fonte na orientação real: 150 mm na largura do gabinete, 140 na profundidade", () => {
    cada((caixas) => expect(de(caixas, "psu").tam).toEqual([140, 86, 150]));
  });

  it("nada fora do gabinete e nenhum par sobreposto além dos encaixes previstos", () => {
    cada((caixas, _cabos, _c, nome) => {
      expect([nome, foraDoGabinete(caixas)]).toEqual([nome, []]);
      expect([nome, sobrepostos(caixas.slice(1)).filter((par) => !ENCAIXES.includes(par))]).toEqual([nome, []]);
    });
  });

  it("mais de um armazenamento: todos entram, cada disco na sua baia; sem baia ou slot livre, fica fora", () => {
    const duplo = montarCena(cena(torre(0), placa("ATX"), m2, ssd, { ...ssd, id: "ssd2" }, hd, { ...m2, id: "m2b" }));
    expect(duplo.map((c) => c.chave)).toEqual(["case", "mb", "m2", "ssd", "ssd2", "hd"]);
    perto(ancora(de(duplo, "ssd2"), "base"), duplo[0].modelo!.ancoras.baia25_1);
  });

  it("o radiador tira os fans do gabinete da face dele; a GPU tira as tampas dos slots que ocupa", () => {
    const fans = (c: Cena) => montarCena(c)[0].modelo!.partes.filter((s) => s.forma.tipo === "fan").map((s) => s.id);
    expect(fans(builds["ATX, cooler a ar, M.2 e discos de 2,5 e 3,5"])).toEqual(["fan-traseiro", "fan-frontal-0", "fan-frontal-1"]);
    expect(fans(builds["mATX, water cooler de 240 na frente"])).toEqual(["fan-traseiro"]);
    const topo = (n: number) => ({ ...torre(n), specs: { ...torre(n).specs, posicoes_fan: { frente: 1, topo: 2, traseira: 1 } } });
    expect(fans(cena(topo(4), placa("ATX"), cpu, aio(240, "topo")))).toEqual(["fan-traseiro", "fan-frontal-0"]);
    const tampas = (c: Cena) => montarCena(c)[0].modelo!.partes.filter((s) => /^slot-\d$/.test(s.id)).length;
    expect(tampas(cena(torre(0), placa("ATX")))).toBe(7);
    expect(tampas(cena(torre(0), placa("ATX"), gpu(290, 2)))).toBe(5);
    expect(tampas(cena(torre(0), placa("ATX"), gpu(290, 3)))).toBe(4);
    const m = montarCena(cena(torre(0), placa("ATX"), gpu(290, 3)))[0].modelo!;   // a fresta de ventilação sai junto com a tampa
    expect(m.partes.filter((s) => /^slot-\d-vent$/.test(s.id)).map((s) => s.id.slice(0, 6))).toEqual(m.partes.filter((s) => /^slot-\d$/.test(s.id)).map((s) => s.id));
  });
});

describe("montarCabos: cabos novos, plugues e passo", () => {
  it("cada build tem os cabos das peças que tem", () => {
    const ids = (nome: string) => { const cx = montarCena(builds[nome]); return montarCabos(cx).map((c) => c.id).sort(); };
    const base = ["cabo-atx24", "cabo-audio", "cabo-eps", "cabo-gpu-0", "cabo-gpu-1", "cabo-painel", "cabo-usb2"];
    expect(ids("ATX, cooler a ar, M.2 e discos de 2,5 e 3,5")).toEqual([...base, "cabo-fan-cpu", "cabo-fan-frontal-0", "cabo-fan-frontal-1", "cabo-fan-traseiro",
      "cabo-sata-dados-0", "cabo-sata-dados-1", "cabo-sata-energia-0", "cabo-sata-energia-1"].sort());
    expect(ids("mATX, water cooler de 240 na frente")).toEqual([...base, "cabo-bomba", "cabo-fan-rad-0", "cabo-fan-rad-1", "cabo-fan-traseiro", "mangueira-0", "mangueira-1"].sort());
    expect(ids("ATX, water cooler de 360 no topo, memória alta e HD")).toEqual([...base, "cabo-bomba", "cabo-fan-frontal-0", "cabo-fan-frontal-1", "cabo-fan-rad-0", "cabo-fan-rad-1", "cabo-fan-rad-2",
      "cabo-fan-traseiro", "cabo-sata-dados-0", "cabo-sata-energia-0", "mangueira-0", "mangueira-1"].sort());
    expect(ids("ITX em torre média sem fans")).toEqual([...base, "cabo-fan-cpu"].sort());
  });

  it("cada ponta chega ao conector certo", () => {
    cada((caixas, cabos) => {
      const mb = de(caixas, "mb"), fim = (id: string) => cabos.find((c) => c.id === id)?.pontos.at(-1);
      const sub = (c: Caixa, id: string) => { const s = c.modelo!.partes.find((x) => x.id === id)!; return { c: noMundo(c, s.pos), t: s.tam }; };
      const dentro = (pt: Vec3, { c, t }: { c: Vec3; t: Vec3 }) => pt.forEach((v, k) => expect(Math.abs(v - c[k])).toBeLessThanOrEqual(t[k] / 2 + 0.01));
      for (const [cabo, con] of [["cabo-painel", "painel"], ["cabo-usb2", "usb2"], ["cabo-audio", "audio"], ["cabo-bomba", "fan-cpu"], ["cabo-fan-cpu", "fan-cpu"], ["cabo-sata-dados-0", "sata-1"], ["cabo-sata-dados-1", "sata1"]])
        if (fim(cabo)) dentro(fim(cabo)!, sub(mb, con));
      for (const c of cabos.filter((x) => /^cabo-fan-(rad|traseiro|frontal|topo)/.test(x.id))) expect(["fan-sys0", "fan-sys1", "fan-sys2"].some((h) => {
        const s = sub(mb, h); return c.pontos.at(-1)!.every((v, k) => Math.abs(v - s.c[k]) <= s.t[k] / 2 + 0.01);
      })).toBe(true);
      const bloco = de(caixas, "cooler"), rad = de(caixas, "cooler:radiador");
      for (const m of cabos.filter((c) => c.tipo === "mangueira")) {
        expect([m.raio, m.de, m.para]).toEqual([6, "cooler", "cooler"]);
        const k = Number(m.id.at(-1));
        perto(m.pontos[0], ancora(bloco, `bocal${k}`));
        perto(m.pontos.at(-1)!, ancora(rad, `bocal${1 - k}`));
      }
      for (const c of cabos.filter((x) => x.id.startsWith("cabo-sata-energia"))) perto(c.pontos.at(-1)!, ancora(caixas.find((x) => x.id === c.para)!, "energia"));
    });
  });

  it("todo cabo fica dentro do gabinete, tem dois plugues nas pontas, com a seção do conector, e um passo válido", () => {
    cada((caixas, cabos, c) => {
      const gab = caixas[0];
      for (const cabo of cabos) {
        for (const pt of cabo.pontos) pt.forEach((v, i) => expect([cabo.id, Math.abs(v) <= gab.tam[i] / 2]).toEqual([cabo.id, true]));
        expect(cabo.plugues).toHaveLength(2);
        cabo.plugues!.forEach((pl, i) => {
          const ponta = cabo.pontos.at(i ? -1 : 0)!;
          expect(Math.hypot(...pl.pos.map((v, k) => v - ponta[k]))).toBeCloseTo(4, 5);   // encostado na ponta, do lado do cabo
          expect(pl.tam.every((v) => v > 0)).toBe(true);
        });
        const passos = [cabo.de, cabo.para].map((id) => caixas.find((x) => x.id === id)!.passo);
        expect([cabo.id, cabo.passo]).toEqual([cabo.id, Math.max(...passos)]);
        expect(cabo.passo).toBeLessThan(c.passos.length);
      }
      const atx = cabos.find((x) => x.id === "cabo-atx24")!, con = de(caixas, "mb").modelo!.partes.find((s) => s.id === "atx24")!;
      expect(atx.plugues![1].tam).toEqual([con.tam[0], con.tam[1], 8]);   // plugue de 24 pinos entra por cima, com a planta do conector
      expect(atx.passo).toBe(c.passos.findIndex((s) => s.tipo === "fonte"));
    });
  });

  it("nenhum cabo ou mangueira atravessa uma peça (fora da chegada aos próprios conectores)", () => {
    cada((caixas, cabos, _c, nome) => {
      // o cooler fica dentro do envelope da placa-mãe: o que sai dele (mangueira, cabo) começa lá dentro
      const pontas = (c: Cabo) => [c.de, c.para, ...(c.de === "cooler" ? ["mb"] : [])];
      for (const c of cabos) {
        const total = c.pontos.slice(1).reduce((s, pt, i) => s + Math.hypot(...pt.map((v, k) => v - c.pontos[i][k])), 0);
        let andado = 0;
        for (let i = 1; i < c.pontos.length; i++) {
          const a = c.pontos[i - 1], b = c.pontos[i], seg = Math.hypot(...b.map((v, k) => v - a[k]));
          for (let d = 0; d <= seg; d += 4) {
            const pt = a.map((v, k) => v + ((b[k] - v) * d) / seg), pos = andado + d;
            const chegada = pos < 60 || total - pos < 60;
            const bate = caixas.filter((x) => x.tipo !== "gabinete" && !(chegada && pontas(c).includes(x.id)))
              .filter((x) => pt.every((v, k) => Math.abs(v - x.pos[k]) < x.tam[k] / 2 - 0.5)).map((x) => x.chave);
            expect([nome, c.id, bate]).toEqual([nome, c.id, []]);
          }
          andado += seg;
        }
      }
    });
  });

  it("cabo que sobe de baixo da cobertura da fonte ganha passa-cabo", () => {
    const caixas = montarCena(builds["ATX, cooler a ar, M.2 e discos de 2,5 e 3,5"]);
    expect(caixas[0].modelo!.partes.find((s) => s.id === "cobertura")!.forma).toMatchObject({ tipo: "placa", furos: { length: 6 } });   // ATX, EPS, 2 da GPU, 2 SATA de dados
  });
});

describe("build explodida", () => {
  it("com k = 1 nenhum par de caixas se sobrepõe, o gabinete fica parado e a ordem segue a montagem", () => {
    cada((caixas, _cabos, _c, nome) => {
      expect([nome, sobrepostos(caixas, (c) => posicaoExplodida(c, 1))]).toEqual([nome, []]);
      expect(caixas[0].instala).toEqual([0, 0, 0]);
      for (const c of caixas) expect(posicaoExplodida(c, 0)).toEqual(c.pos);
      const z = (chave: string) => posicaoExplodida(de(caixas, chave), 1)[2];
      expect(["mb", "cpu", "ram", "m2", "cooler", "gpu"].map(z)).toEqual(["mb", "cpu", "ram", "m2", "cooler", "gpu"].map(z).sort((a, b) => a - b));
      expect(de(caixas, "psu").instala[0]).toBeGreaterThan(0);
    });
  });
});

describe("regioesDeConflito", () => {
  const curto = p("case", "gabinete", { dimensoes: { c: 376, a: 292, l: 185 }, gpu_max_mm: 330 }, "Gabinete");
  const conflito = (id: string, itens: string[], descricao: string) => ({ id, itens, descricao, severidade: "bloqueante" as const });

  it("GPU mais longa que o gabinete: a fatia que passa da parede da frente, com o excesso em mm", () => {
    const c: Cena = { ...cena(curto, placa("ITX"), gpu(400, 2)), conflitos: [conflito("gpu-longa", ["gpu", "case"], "A placa de vídeo não cabe no gabinete")] };
    const caixas = montarCena(c), [r, ...resto] = regioesDeConflito(caixas, c.conflitos);
    expect(resto).toEqual([]);
    expect(r.excessoMm).toBe(400 + 30 - 376);   // 30 mm da traseira até o bracket
    expect(r.texto).toBe("A placa de vídeo não cabe no gabinete (passa 54 mm)");
    const g = de(caixas, "gpu");
    expect(r.tam).toEqual([54, g.tam[1], g.tam[2]]);
    expect(r.centro[0] + r.tam[0] / 2).toBeCloseTo(-376 / 2, 5);            // encosta na parede por fora
    expect(r.centro[0] - r.tam[0] / 2).toBeCloseTo(g.pos[0] - g.tam[0] / 2, 5);
    expect(descricaoCena(c, caixas, [r])).toContain("passa 54 mm");
  });

  it("duas peças sobrepostas: a interseção, com a menor dimensão como excesso", () => {
    // torre baixa: a GPU, pendurada na placa ITX, desce até a fonte
    const c: Cena = { ...cena(curto, placa("ITX"), gpu(240, 2), psu), conflitos: [conflito("gpu-fonte", ["gpu", "psu"], "A placa de vídeo encosta na fonte")] };
    const caixas = montarCena(c), a = de(caixas, "gpu"), b = de(caixas, "psu"), [r] = regioesDeConflito(caixas, c.conflitos);
    const inter = [0, 1, 2].map((k) => Math.min(a.pos[k] + a.tam[k] / 2, b.pos[k] + b.tam[k] / 2) - Math.max(a.pos[k] - a.tam[k] / 2, b.pos[k] - b.tam[k] / 2));
    expect(r.tam).toEqual(inter);
    expect(Math.min(...inter)).toBeGreaterThan(1);
    expect(r.texto).toBe(`A placa de vídeo encosta na fonte (passa ${r.excessoMm} mm)`);
    expect(r.excessoMm).toBe(Math.round(Math.min(...inter)));
  });

  it("conflito sem sobreposição (soquete, tipo de memória, peça que cabe) não gera região", () => {
    const c = cena(torre(0), placa("ATX"), cpu, ram(34), gpu(290, 2));
    const caixas = montarCena(c);
    expect(regioesDeConflito(caixas, [conflito("soquete", ["cpu", "mb"], "Soquete incompatível"), conflito("ddr", ["ram", "mb"], "DDR4 em placa DDR5"),
      conflito("justo", ["gpu", "case"], "GPU com menos de 15 mm de folga"), conflito("fora", ["nao-esta-na-cena"], "x")])).toEqual([]);
  });
});

describe("estadoPasso", () => {
  const c = builds["ATX, cooler a ar, M.2 e discos de 2,5 e 3,5"], caixas = montarCena(c), cabos = montarCabos(caixas);
  const n = (tipo: string) => c.passos.findIndex((s) => s.tipo === tipo);
  const em = (passo: number, t: number) => estadoPasso(caixas, cabos, passo, t);

  it("é função só de (passo, progresso): chegar de trás ou da frente dá o mesmo estado", () => {
    for (let i = 0; i < c.passos.length; i++) {
      const direto = em(i, 1);
      for (let j = 0; j < c.passos.length; j++) em(j, 0.3);   // passear por outros passos não deixa memória
      expect(em(i, 1)).toEqual(direto);
      expect(Object.keys(direto.pecas).sort()).toEqual(caixas.map((x) => x.chave).sort());
    }
  });

  it("peças futuras ficam fora (pos null); o gabinete e as de passos anteriores, no lugar", () => {
    const e = em(n("fonte"), 0.5);
    expect(e.pecas.gpu).toEqual({ pos: null, encaixe: 0 });
    for (const chave of ["case", "mb", "cpu", "ram", "m2", "ssd", "hd", "cooler"]) expect(e.pecas[chave]).toEqual({ pos: de(caixas, chave).pos, encaixe: 0 });
    expect(em(0, 0).pecas.case.pos).toEqual([0, 0, 0]);
    expect(em(0, 1).pecas.psu.pos).toBeNull();
  });

  it("a peça do passo entra pela direção de instalação com o encaixe aberto e fecha no fim", () => {
    const g = de(caixas, "gpu"), i = n("gpu");
    expect(em(i, 0).pecas.gpu).toEqual({ pos: posicaoExplodida(g, 1), encaixe: 1 });
    expect(em(i, 0.35).pecas.gpu.pos![2]).toBeGreaterThan(g.pos[2]);
    expect(em(i, 0.35).pecas.gpu.pos![2]).toBeLessThan(posicaoExplodida(g, 1)[2]);
    expect(em(i, 0.7).pecas.gpu).toEqual({ pos: g.pos, encaixe: 1 });
    expect(em(i, 0.85).pecas.gpu.encaixe).toBeCloseTo(0.5, 5);
    expect(em(i, 1).pecas.gpu).toEqual({ pos: g.pos, encaixe: 0 });
    expect(em(n("fonte"), 0).pecas.psu.pos![0]).toBeGreaterThan(de(caixas, "psu").pos[0]);   // a fonte entra pela traseira
  });

  it("a placa-mãe abre e fecha junto o encaixe que recebe a peça, e só ele", () => {
    const mb = de(caixas, "mb").pos;
    expect(em(n("gpu"), 0.3).pecas.mb).toEqual({ pos: mb, encaixe: 1, moveis: ["pcie-0-trava"] });
    expect(em(n("gpu"), 1).pecas.mb).toEqual({ pos: mb, encaixe: 0, moveis: ["pcie-0-trava"] });
    expect(em(n("fonte"), 0.3).pecas.mb).toEqual({ pos: mb, encaixe: 0 });
    // CPU e memória entram antes de a placa ir para o gabinete: a placa já aparece, para mostrar alavanca e travas
    expect(em(n("cpu"), 0.3).pecas.mb).toEqual({ pos: mb, encaixe: 1, moveis: ["soquete-alavanca"] });
    expect(em(n("memoria"), 0.85).pecas.mb).toMatchObject({ pos: mb, moveis: ["dimm-"] });
    expect(em(n("placa_mae"), 0).pecas.mb).toEqual({ pos: mb, encaixe: 0 });
    for (const prefixo of ["soquete-alavanca", "dimm-", "pcie-0-trava"]) expect(de(caixas, "mb").modelo!.partes.some((s) => s.movel && s.id.startsWith(prefixo))).toBe(true);
  });

  it("placa-mãe sem nada montado antes dela entra deslizando no próprio passo", () => {
    const so = cena(torre(0), placa("ATX"), psu), cx = montarCena(so);
    expect(estadoPasso(cx, [], 0, 0).pecas.mb.pos).toBeNull();
    expect(estadoPasso(cx, [], 1, 0).pecas.mb.pos![2]).toBeGreaterThan(de(cx, "mb").pos[2]);
  });

  it("cada cabo aparece no fim do passo em que é ligado e fica nos seguintes", () => {
    const i = n("fonte");
    expect(em(i, 0.79).cabos).not.toContain("cabo-atx24");
    expect(em(i, 0.8).cabos).toContain("cabo-atx24");
    expect(em(i, 1).cabos).not.toContain("cabo-gpu-0");
    expect(em(n("gpu"), 0).cabos).toContain("cabo-atx24");
    expect(em(n("gpu"), 1).cabos.sort()).toEqual(cabos.map((x) => x.id).sort());
    expect(em(0, 1).cabos).toEqual([]);
    expect(em(n("placa_mae"), 1).cabos).toEqual(expect.arrayContaining(["cabo-fan-cpu", "cabo-fan-traseiro", "cabo-painel", "cabo-sata-dados-0"]));
  });
});

describe("descricaoCena", () => {
  it("cita as peças, onde ficam e os conflitos", () => {
    const c = builds["mATX, water cooler de 240 na frente"], caixas = montarCena(c), txt = descricaoCena(c, caixas, []);
    for (const peca of c.pecas) expect(txt).toContain(peca.nome);
    expect(txt).toContain("radiador de 240 mm na frente");
    expect(txt).toContain("Sem conflitos");
    const d = builds["ATX, water cooler de 360 no topo, memória alta e HD"];
    expect(descricaoCena(d, montarCena(d), [])).toMatch(/radiador de 360 mm no topo.*baia de 3,5 polegadas/);
    const semRegiao: Cena = { ...c, conflitos: [{ id: "s", itens: ["cpu", "mb"], descricao: "Soquete incompatível", severidade: "bloqueante" }] };
    expect(descricaoCena(semRegiao, caixas, [])).toContain("1 conflito: Soquete incompatível.");
  });
});

describe("região de conflito pelo limite da ficha", () => {
  it("GPU maior que gpu_max_mm, mas que não fura a parede, mostra o excesso do achado", () => {
    const cena: Cena = { passos: [], conflitos: [{ id: "x", itens: ["gpu", "case"], descricao: "GPU não cabe", severidade: "bloqueante" }], pecas: [
      { id: "case", tipo: "gabinete", nome: "Case", specs: { dimensoes: { c: 376, a: 292, l: 185 }, gpu_max_mm: 330 } },
      { id: "mb", tipo: "placa_mae", nome: "MB", specs: { form_factor: "ITX", slots_ram: 2 } },
      { id: "gpu", tipo: "gpu", nome: "GPU", specs: { dimensoes: { c: 340, a: 120, l: 60 }, conectores: {} } },
    ] };
    const caixas = montarCena(cena), [r] = regioesDeConflito(caixas, cena.conflitos);
    const gpu = caixas.find((c) => c.id === "gpu")!;
    expect(r.excessoMm).toBe(10);
    expect(r.tam[0]).toBe(10);
    expect(r.centro[0] - r.tam[0] / 2).toBeCloseTo(gpu.pos[0] - gpu.tam[0] / 2, 5);   // na ponta da frente da GPU
  });
});

describe("focoDaPrevia", () => {
  // GPU de 420 mm não cabe na torre média (430 de comprimento externo, com margem): conflito físico com região
  const longa = { ...gpu(420, 3), id: "gpu2" };
  const c: Cena = { ...cena(media, placa("ATX"), cpu, ar, ram(34), longa, psu, m2),
    conflitos: [{ id: "par:gpu_comprimento:case+gpu2", itens: ["gpu2", "case"], descricao: "GPU não cabe", severidade: "bloqueante" }] };
  const caixas = montarCena(c), regioes = regioesDeConflito(caixas, c.conflitos);

  it("vai para a região do conflito que envolve a candidata", () => {
    const r = regioes.find((x) => x.conflitoId === "par:gpu_comprimento:case+gpu2")!;
    expect(r).toBeDefined();
    expect(focoDaPrevia(caixas, regioes, c.conflitos, "gpu2")).toEqual({ centro: r.centro, maior: Math.max(...r.tam) });
  });

  it("sem conflito da candidata, enquadra a própria peça", () => {
    const ram34 = de(caixas, "ram");
    const f = focoDaPrevia(caixas, regioes, c.conflitos, "ram")!;
    perto(f.centro, ram34.pos);
    expect(f.maior).toBeCloseTo(Math.max(...ram34.tam), 5);
  });

  it("candidata fora da cena devolve null", () => {
    expect(focoDaPrevia(caixas, regioes, c.conflitos, "nao-existe")).toBeNull();
  });
});
