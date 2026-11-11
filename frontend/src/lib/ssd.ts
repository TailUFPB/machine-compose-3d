// SSD M.2 2280 procedural. Referencial local: x = comprimento (conector em +x), y = largura, z = espessura.
// Norma M.2: 22 × 80 mm, PCB de 0,8 mm, chave M no conector.
import { type Modelo, type Sub, montador } from "./peca";

export function ssdModelo(specs: Record<string, any>): Modelo {
  const partes: Sub[] = [], add = montador(partes);
  const zp = -0.4;   // centro do PCB
  add("pcb", "PCB M.2 2280", "pcb", [-1.75, 0, zp], [76.5, 22, 0.8], [0, 0, 0], 2, "norma");
  add("pente-a", "Contatos (chave M)", "ouro", [38.25, -3, zp], [3.5, 16, 0.8], [0, 0, 0], 2, "norma", { tipo: "grade", n: [1, 32, 1] });
  add("pente-b", "Contatos (chave M)", "ouro", [38.25, 8.6, zp], [3.5, 4.8, 0.8], [0, 0, 0], 2, "norma", { tipo: "grade", n: [1, 10, 1] });
  add("controlador", "Controlador", "escuro", [22, 0, 0.6], [10, 10, 1.2], [0, 0, 6], 1);
  add("dram", "Cache (DRAM)", "escuro", [8, 0, 0.5], [8, 6, 1], [0, 0, 6], 1);
  const nand = (specs.capacidade_gb ?? 1000) >= 2000 ? 3 : 2;
  for (let i = 0; i < nand; i++) add(`nand-${i}`, "Memória flash (NAND)", "escuro", [-6 - i * 12.5, 0, 0.6], [11, 18, 1.2], [0, 0, 6], 1);
  add("etiqueta", `Etiqueta (${specs.capacidade_gb ?? "?"} GB)`, "lit", [-4, 0, 1.3], [64, 19, 0.2], [0, 0, 13], 0, "ficha");
  return { tam: [80, 22, 3], partes, estimados: ["chips"], ancoras: { centro: [0, 0, 0] } };
}
