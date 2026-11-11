// Memória procedural (UDIMM). Referencial local: x = espessura, y = comprimento, z = altura (pente em -z).
// Norma JEDEC: PCB de 133,35 × 31,25 mm. Um Modelo traz todos os módulos do kit, espaçados por `passo`.
import type { Vec3 } from "./cena";
import type { Fonte, Forma, Modelo, Sub, Tom } from "./peca";

const COMP = 133.35, PCB_ALT = 31.25, PCB_ESP = 1.3, PENTE = 4;
const CAIXA: Forma = { tipo: "caixa" };

export function ramModelo(specs: Record<string, any>, passo = 9.5): Modelo {
  const n: number = specs.modulos ?? 2;
  const alt: number = Math.max(PCB_ALT, specs.altura_mm ?? PCB_ALT);
  const comDissipador = alt > PCB_ALT + 1;
  const ddr5 = specs.ddr === "DDR5";
  const chave = ddr5 ? 2 : 5;   // deslocamento da chave em relação ao centro (estimado)
  const z0 = -alt / 2;
  const partes: Sub[] = [];

  for (let m = 0; m < n; m++) {
    const x = (m - (n - 1) / 2) * passo;
    const abre: Vec3 = [(m - (n - 1) / 2) * 42, 0, 0];   // os módulos se afastam entre si
    const add = (id: string, nome: string, tom: Tom, pos: Vec3, tam: Vec3, extra: Vec3, ordem: number, fonte: Fonte = "estimado", forma: Forma = CAIXA) =>
      partes.push({ id: `m${m}-${id}`, nome, forma, tom, fonte, pos: [x + pos[0], pos[1], pos[2]], tam, explode: [abre[0] + extra[0], extra[1], abre[2] + extra[2]], ordem });

    add("pcb", `PCB ${specs.ddr ?? "DDR"}`, "pcb", [0, 0, z0 + PENTE + (PCB_ALT - PENTE) / 2], [PCB_ESP, COMP, PCB_ALT - PENTE], [0, 0, 0], 3, "norma");
    const a = COMP / 2 + chave - 1.25, b = COMP / 2 - chave - 1.25;   // dois trechos do pente, chave de 2,5 mm
    add("pente-a", "Contatos (pente)", "ouro", [0, -COMP / 2 + a / 2, z0 + PENTE / 2], [PCB_ESP, a, PENTE], [0, 0, 0], 3, "norma", { tipo: "grade", n: [1, Math.round(a / 0.85), 1] });
    add("pente-b", "Contatos (pente)", "ouro", [0, COMP / 2 - b / 2, z0 + PENTE / 2], [PCB_ESP, b, PENTE], [0, 0, 0], 3, "norma", { tipo: "grade", n: [1, Math.round(b / 0.85), 1] });
    for (const lado of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        const y = (i - 3.5) * 14.5 + (i < 4 ? -4 : 4);   // vão no meio para o PMIC
        add(`chip${lado}-${i}`, "Chip de memória", "escuro", [lado * (PCB_ESP / 2 + 0.5), y, z0 + 16], [1, 10, 12], [lado * 7, 0, 0], 2);
      }
      if (comDissipador)
        add(`dissipador${lado}`, "Dissipador", "mid", [lado * (PCB_ESP / 2 + 1.6), 0, z0 + PENTE + 2 + (alt - PENTE - 5) / 2], [1.2, COMP - 1, alt - PENTE - 5], [lado * 15, 0, 0], 1, "ficha");
    }
    if (ddr5) add("pmic", "Regulador (PMIC)", "lit", [PCB_ESP / 2 + 0.4, 0, z0 + 16], [0.8, 5, 5], [7, 0, 0], 2);
    if (comDissipador)
      add("topo", specs.rgb ? "Barra de luz" : "Topo do dissipador", specs.rgb ? "lit" : "hi", [0, 0, alt / 2 - (alt - PCB_ALT) / 2], [5.7, COMP - 1, alt - PCB_ALT], [0, 0, 18], 0, "ficha");
  }
  return { tam: [(n - 1) * passo + 5.7, COMP, alt], partes, estimados: ["chips", "chave do pente"], ancoras: { pente: [0, 0, z0] } };
}
