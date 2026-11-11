// Discos SATA procedurais: SSD de 2,5" e HD de 3,5". Referencial local: x = comprimento (conectores em +x),
// y = espessura, z = largura. Envelopes da norma (SFF-8201 e SFF-8301); conectores SATA com 7 + 15 pinos a 1,27 mm.
import type { Vec3 } from "./cena";
import { type Modelo, type Sub, montador } from "./peca";

type Add = ReturnType<typeof montador>;
const PASSO = 1.27, FUNDO = 6, ALT = 3.5;   // passo dos pinos, profundidade e altura do conector
const SATA = { energia: { pinos: 15, z: -6.2, w: 20.6 }, dados: { pinos: 7, z: 11.3, w: 10.4 } };
const BORDA = 16.5;                         // meia largura do par de conectores

/** Conectores de energia e de dados lado a lado na face +x, apoiados em y = y0. Devolve as âncoras dos dois. */
function sata(add: Add, X: number, y0: number, explode: Vec3, ordem: number): Record<"dados" | "energia", Vec3> {
  const y = y0 + ALT / 2;
  (["energia", "dados"] as const).forEach((id) => {
    const c = SATA[id];
    add(`sata-${id}`, `Conector SATA de ${id}`, "escuro", [X / 2 - FUNDO / 2, y, c.z], [FUNDO, ALT, c.w], explode, ordem, "norma");
    add(`sata-${id}-pinos`, `Pinos de ${id} (${c.pinos})`, "ouro", [X / 2 + 0.15, y, c.z], [0.3, 0.6, c.pinos * PASSO], explode, ordem, "norma", { tipo: "grade", n: [1, 1, c.pinos] });
  });
  return { dados: [X / 2, y, SATA.dados.z], energia: [X / 2, y, SATA.energia.z] };
}

/** Quatro furos de fixação por baixo, nas posições da norma (`xs` medido a partir da face dos conectores). */
const furos = (add: Add, X: number, Y: number, xs: number[], z: number, r: number, explode: Vec3, ordem: number) =>
  xs.flatMap((x) => [-z, z].map((sz) => [X / 2 - x, sz])).forEach(([x, sz], i) =>
    add(`furo-${i}`, "Furo de fixação", "escuro", [x, -Y / 2 - 0.1, sz], [2 * r, 0.2, 2 * r], explode, ordem, "norma", { tipo: "cilindro", raio: r }));

const etiqueta = (add: Add, specs: Record<string, any>, Y: number, tam: Vec3, explode: Vec3) =>
  add("etiqueta", `Etiqueta (${specs.capacidade_gb ?? "?"} GB)`, "lit", [-5, Y / 2 + 0.1, 0], tam, explode, 0, specs.capacidade_gb == null ? "estimado" : "ficha");

/** SSD SATA de 2,5": bandeja com paredes, placa curta junto dos conectores, tampa e etiqueta. */
function ssd25(specs: Record<string, any>): Modelo {
  const [X, Y, Z]: Vec3 = [100, 7, 69.85], t = 1, h = Y - 2 * t;
  const partes: Sub[] = [], add = montador(partes);
  const desce: Vec3 = [0, -12, 0], sobe: Vec3 = [0, 5, 0];

  // metade de baixo: chapa, paredes (a da frente fecha dos dois lados dos conectores) e furos
  add("base", "Carcaça (metade de baixo)", "lo", [0, -Y / 2 + t / 2, 0], [X, t, Z], desce, 2, "norma");
  [-1, 1].forEach((s) => add(`base-lateral${s}`, "Parede lateral", "lo", [0, 0, s * (Z / 2 - t / 2)], [X, h, t], desce, 2, "norma"));
  add("base-fundo", "Parede do fundo", "lo", [-X / 2 + t / 2, 0, 0], [t, h, Z - 2 * t], desce, 2, "norma");
  const w = Z / 2 - t - BORDA;
  [-1, 1].forEach((s) => add(`base-frente${s}`, "Parede da frente", "lo", [X / 2 - t / 2, 0, s * (BORDA + w / 2)], [t, h, w], desce, 2, "norma"));
  furos(add, X, Y, [14, 90.6], 30.86, 1.5, desce, 2);

  // placa interna com os chips em cima; os conectores ficam soldados nela e não saem na explosão
  const yPcb = -1.1, yChip = yPcb + 0.5 + 0.6;
  add("pcb", "Placa interna (PCB)", "pcb", [X / 2 - FUNDO - 30, yPcb, 0], [60, 1, 64], [0, 0, 0], 3);
  add("controlador", "Controlador", "escuro", [30, yChip, -18], [12, 1.2, 12], sobe, 2);
  add("dram", "Cache (DRAM)", "escuro", [30, yChip, 8], [8, 1.2, 10], sobe, 2);
  const nand = (specs.capacidade_gb ?? 1000) >= 2000 ? 4 : 2;
  for (let i = 0; i < nand; i++) add(`nand-${i}`, "Memória flash (NAND)", "escuro", [10 - Math.floor(i / 2) * 16, yChip, i % 2 ? 12 : -12], [12, 1.2, 16], sobe, 2);
  const ancoras = sata(add, X, -Y / 2 + t, [0, 0, 0], 3);

  add("tampa", "Carcaça (metade de cima)", "lo", [0, Y / 2 - t / 2, 0], [X, t, Z], [0, 14, 0], 1, "norma");
  etiqueta(add, specs, Y, [70, 0.2, 50], [0, 22, 0]);
  return { tam: [X, Y, Z], partes, estimados: ["placa interna", "chips"], ancoras: { ...ancoras, base: [0, -Y / 2, 0] } };
}

/** HD de 3,5": PCB embaixo, base fundida em banheira, pratos, eixo do motor, braço atuador e ímã, tampa. */
function hd35(specs: Record<string, any>): Modelo {
  const [X, Y, Z]: Vec3 = [146, 26.1, 101.6], y0 = -Y / 2;
  const partes: Sub[] = [], add = montador(partes);
  const VAO = 3.6, PISO = 4, PAREDE = 4, TAMPA = 1.5;   // vão do PCB sob o piso, piso e paredes da base, tampa
  const yPiso = y0 + VAO + PISO, hParede = Y / 2 - TAMPA - yPiso;
  const desce: Vec3 = [0, -16, 0], sobe: Vec3 = [0, 22, 0];

  // por baixo: PCB com os chips virados para fora e os conectores na ponta
  add("pcb", "Placa controladora (PCB)", "pcb", [X / 2 - FUNDO - 47, y0 + VAO - 0.8, 0], [94, 1.6, 88], desce, 3);
  ([["controlador", "Controlador", 30, 0, 14, 14], ["driver", "Driver do motor", 0, 20, 8, 8], ["cache", "Cache (DRAM)", 40, -25, 10, 8]] as const)
    .forEach(([id, nome, x, z, w, p]) => add(id, nome, "escuro", [x, y0 + VAO - 1.6 - 0.6, z], [w, 1.2, p], desce, 3));
  const ancoras = sata(add, X, y0 + VAO - ALT, desce, 3);

  // base fundida: piso, trilhos com os furos e quatro paredes; fica parada na explosão
  add("base", "Base fundida", "metal", [0, yPiso - PISO / 2, 0], [X, PISO, Z], [0, 0, 0], 4, "norma");
  [-1, 1].forEach((s) => {
    add(`base-trilho${s}`, "Trilho de fixação", "metal", [0, y0 + VAO / 2, s * (Z / 2 - 3)], [X, VAO, 6], [0, 0, 0], 4, "norma");
    add(`base-lateral${s}`, "Parede lateral", "metal", [0, yPiso + hParede / 2, s * (Z / 2 - PAREDE / 2)], [X, hParede, PAREDE], [0, 0, 0], 4, "norma");
    add(`base-ponta${s}`, "Parede da ponta", "metal", [s * (X / 2 - PAREDE / 2), yPiso + hParede / 2, 0], [PAREDE, hParede, Z - 2 * PAREDE], [0, 0, 0], 4, "norma");
  });
  furos(add, X, Y, [41.28, 85.73], 47.625, 1.6, [0, 0, 0], 4);

  // mecânica: pratos empilhados no eixo do motor; braço acima do prato de cima, com o pivô e o ímã ao lado
  const n = Math.min(3, Math.max(1, Math.ceil((specs.capacidade_gb ?? 1000) / 2000)));
  const R = Z / 2 - PAREDE - 0.3, xPrato = -X / 2 + PAREDE + R + 0.5, yTopo = yPiso + 4 + (n - 1) * 3.5;
  for (let i = 0; i < n; i++) add(`prato-${i}`, "Prato", "hi", [xPrato, yPiso + 3.5 + i * 3.5, 0], [2 * R, 1, 2 * R], sobe, 2, "estimado", { tipo: "cilindro", raio: R });
  add("eixo", "Eixo do motor", "mid", [xPrato, yPiso + (yTopo + 1.5 - yPiso) / 2, 0], [24, yTopo + 1.5 - yPiso, 24], sobe, 2, "estimado", { tipo: "cilindro", raio: 12 });
  add("pivo", "Pivô do atuador", "mid", [40, yPiso + (yTopo + 2 - yPiso) / 2, 30], [12, yTopo + 2 - yPiso, 12], sobe, 2, "estimado", { tipo: "cilindro", raio: 6 });
  add("braco", "Braço atuador", "metal", [12, yTopo + 1.25, 30], [44, 1.5, 8], sobe, 2);
  add("ima", "Ímã do atuador", "escuro", [58, yPiso + 4, 27], [20, 8, 34], sobe, 2);

  add("tampa", "Tampa", "metal", [0, Y / 2 - TAMPA / 2, 0], [X, TAMPA, Z], [0, 44, 0], 1, "norma");
  etiqueta(add, specs, Y, [80, 0.2, 60], [0, 54, 0]);
  return { tam: [X, Y, Z], partes, estimados: ["placa controladora", "pratos", "atuador"], ancoras: { ...ancoras, base: [0, y0, 0] } };
}

/** Disco SATA pelo `specs.formato`: "3.5" é HD; qualquer outro valor (ou ausente) é o SSD de 2,5". */
export const discoModelo = (specs: Record<string, any>): Modelo => (String(specs.formato) === "3.5" ? hd35(specs) : ssd25(specs));
