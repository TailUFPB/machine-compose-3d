// Placa-mãe procedural. Referencial local: x = largura (painel traseiro em +x), y = altura (topo em +y),
// z = espessura (componentes em +z). Âncoras dizem onde CPU, RAM, GPU e M.2 encaixam.
// Norma: dimensões ATX/mATX/ITX, slot PCIe x16 de 89 mm a 42 mm da borda traseira, passo de slot 20,32 mm.
import type { Vec3 } from "./cena";
import type { Fonte, Forma, Modelo, Sub, Tom } from "./peca";

export const DIMM_PASSO = 9.5;   // mm entre slots de memória (estimado)
const DIM: Record<string, [number, number]> = { ATX: [244, 305], mATX: [244, 244], ITX: [170, 170] };
const ZT = 36, PCB = 1.6, SLOT_PCIE = 20.32;
const CAIXA: Forma = { tipo: "caixa" };

export function placaMaeModelo(specs: Record<string, any>): Modelo {
  const ff: string = specs.form_factor ?? "ATX";
  const [W, H] = DIM[ff] ?? DIM.ATX;
  const z0 = -ZT / 2, zt = z0 + PCB;
  const partes: Sub[] = [];
  /** Componente apoiado no PCB, centrado em (x, y); só entra se couber na placa sem pisar em outro já colocado. */
  const sobre = (id: string, nome: string, tom: Tom, x: number, y: number, w: number, h: number, alt: number, sobe: number, ordem: number, fonte: Fonte = "estimado", forma: Forma = CAIXA) => {
    if (Math.abs(x) + w / 2 > W / 2 - 1 || Math.abs(y) + h / 2 > H / 2 - 1) return false;
    if (partes.some((p) => p.id !== "pcb" && Math.abs(p.pos[0] - x) < (p.tam[0] + w) / 2 && Math.abs(p.pos[1] - y) < (p.tam[1] + h) / 2)) return false;
    partes.push({ id, nome, forma, tom, fonte, pos: [x, y, zt + alt / 2], tam: [w, h, alt], explode: [0, 0, sobe], ordem });
    return true;
  };

  /** Pinos ou contatos na face de cima de um componente já colocado (acompanham a explosão dele). */
  const cima = (id: string, nome: string, tom: Tom, n: Vec3, fx: number, fy: number, cheio = 0.6) => {
    const b = partes.find((p) => p.id === id);
    if (b) partes.push({ id: `${id}-pinos`, nome, forma: { tipo: "grade", n, cheio }, tom, fonte: b.fonte,
      pos: [b.pos[0], b.pos[1], b.pos[2] + b.tam[2] / 2 + 0.15], tam: [b.tam[0] * fx, b.tam[1] * fy, 0.3], explode: b.explode, ordem: b.ordem });
  };
  /** Conector de pinos em pé (headers de fan, USB, painel frontal). */
  const header = (id: string, nome: string, x: number, y: number, nx: number) => {
    if (!sobre(id, nome, "escuro", x, y, nx * 2.54 + 2, 6, 2.5, 12, 5, "norma")) return;
    partes.push({ id: `${id}-pinos`, nome: `Pinos (${nome})`, forma: { tipo: "grade", n: [nx, 2, 1], cheio: 0.3 }, tom: "ouro", fonte: "norma",
      pos: [x, y, zt + 2.5 + 3], tam: [nx * 2.54, 5.08, 6], explode: [0, 0, 12], ordem: 5 });
  };

  partes.push({ id: "pcb", nome: `PCB ${ff}`, forma: CAIXA, tom: "pcb", fonte: "norma", pos: [0, 0, z0 + PCB / 2], tam: [W, H, PCB], explode: [0, 0, 0], ordem: 6 });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy], i) =>
    sobre(`furo-${i}`, "Furo de fixação", "metal", sx * (W / 2 - 6.5), sy * (H / 2 - 10), 7, 7, 0.3, 0, 6, "estimado", { tipo: "cilindro", raio: 3.5, eixo: "z" }));

  // CPU: soquete (base + moldura) e dissipadores do VRM em volta
  const cx = W * 0.05, cy = Math.min(H * 0.22, H / 2 - 77);   // os slots de memória (139 mm + travas) têm de caber
  const soquete = `Soquete ${specs.socket ?? ""}`.trim();
  sobre("soquete-base", soquete, "metal", cx, cy, 44, 44, 1, 26, 3);
  [[-1, 0], [1, 0]].forEach(([s], i) => sobre(`soquete-x${i}`, soquete, "lo", cx + s * 23.5, cy, 3, 50, 4.5, 26, 3));
  [[0, -1], [0, 1]].forEach(([, s], i) => sobre(`soquete-y${i}`, soquete, "lo", cx, cy + s * 23.5, 44, 3, 4.5, 26, 3));
  const am4 = specs.socket === "AM4";   // AM4 tem furos para os pinos da CPU; os LGA têm os pinos no soquete
  cima("soquete-base", am4 ? "Furos dos pinos (PGA)" : "Pinos do soquete (LGA)", am4 ? "escuro" : "ouro", [24, 24, 1], 0.88, 0.88, am4 ? 0.5 : 0.4);
  sobre("vrm-lateral", "Dissipador do VRM", "mid", cx + 72, cy, 16, 90, 24, 62, 0, "estimado", { tipo: "aletas", n: 5, passo: 3.2, esp: 1.8 });
  sobre("vrm-topo", "Dissipador do VRM", "mid", cx, cy + 74, 80, 12, 20, 62, 0, "estimado", { tipo: "aletas", n: 20, passo: 4, esp: 2.4 });

  // Painel traseiro com as portas na face de fora
  const ioH = Math.min(150, H - 40), ioY = H / 2 - 14 - ioH / 2;
  partes.push({ id: "io", nome: "Painel traseiro (I/O)", forma: CAIXA, tom: "lo", fonte: "estimado", pos: [W / 2 - 14, ioY, zt + 17], tam: [28, ioH, 34], explode: [0, 0, 46], ordem: 1 });
  for (let i = 0; i < 5; i++)
    partes.push({ id: `io-porta-${i}`, nome: "Portas traseiras", forma: CAIXA, tom: "escuro", fonte: "estimado", pos: [W / 2 + 0.1, ioY + (i - 2) * (ioH / 5.5), zt + 15], tam: [0.2, 14, 16], explode: [0, 0, 46], ordem: 1 });

  // Memória: slots com travas
  const nDimm: number = specs.slots_ram ?? 4;
  const dimm0: Vec3 = [cx - 68, cy, zt + 3];
  for (let i = 0; i < nDimm; i++) {
    const x = dimm0[0] - i * DIMM_PASSO;
    if (!sobre(`dimm-${i}`, `Slot de memória ${i + 1}`, "escuro", x, cy, 6.5, 139, 11, 18, 4)) continue;
    cima(`dimm-${i}`, "Contatos do slot (288 pinos)", "ouro", [2, 72, 1], 0.45, 0.93);
    [-1, 1].forEach((s) => sobre(`dimm-${i}-trava${s}`, "Trava do slot", "mid", x, cy + s * 72.5, 6.5, 5, 15, 18, 4));
  }

  // Energia
  sobre("atx24", "Conector ATX 24 pinos", "hi", -W / 2 + 7, cy - 10, 9, 52, 13, 14, 5, "norma");
  sobre("eps", "Conector EPS 8 pinos", "hi", cx + 62, H / 2 - 9, 20, 10, 13, 14, 5, "norma");
  cima("atx24", "Pinos (ATX 24)", "escuro", [2, 12, 1], 0.8, 0.92, 0.7);
  cima("eps", "Pinos (EPS 8)", "escuro", [4, 2, 1], 0.88, 0.75, 0.7);

  // PCIe: primeiro x16 e, se couber, um segundo quatro slots abaixo (fora da sombra da GPU)
  const pcieX = W / 2 - 42 - 44.5, pcieY = ff === "ITX" ? -H / 2 + 8 : -0.12 * H;
  [0, 4].forEach((k, i) => {
    const y = pcieY - k * SLOT_PCIE;
    if (!sobre(`pcie-${i}`, "Slot PCIe x16", "escuro", pcieX, y, 89, 7.5, 11, 18, 4, "norma")) return;
    cima(`pcie-${i}`, "Contatos do slot (164 pinos)", "ouro", [82, 2, 1], 0.94, 0.42);
    sobre(`pcie-${i}-trava`, "Trava do slot PCIe", "mid", pcieX - 44.5 - 3.5, y, 7, 9, 12, 18, 4);
  });

  // M.2, chipset, SATA e bateria (tudo baixo: fica sob a GPU)
  const m2: Vec3 = [cx, Math.min(-0.05 * H, cy - 38), zt + 6.4];
  sobre("m2-conector", "Conector M.2", "escuro", cx + 43, m2[1], 6, 22, 4.5, 12, 5, "norma");
  cima("m2-conector", "Contatos M.2 (75 pinos)", "ouro", [1, 34, 1], 0.4, 0.85);
  sobre("m2-parafuso", "Parafuso do M.2", "metal", cx - 43, m2[1], 5, 5, 4.5, 12, 5, "norma", { tipo: "cilindro", raio: 2.5, eixo: "z" });
  sobre("chipset", `Dissipador do chipset ${specs.chipset ?? ""}`.trim(), "mid", -W / 2 + 65, -0.28 * H, 50, 44, 4.5, 30, 2);
  [-1, 1].forEach((s) => sobre(`sata${s}`, "Portas SATA", "hi", -W / 2 + 9, -0.28 * H + s * 12, 14, 16, 4.5, 14, 5));
  sobre("bateria", "Bateria CMOS", "metal", 60, pcieY - 22, 20, 20, 3, 16, 5, "estimado", { tipo: "cilindro", raio: 10, eixo: "z" });

  // Headers de pinos na borda de baixo e junto da CPU
  header("fan-cpu", "Conector do fan da CPU", cx - 38, cy + 44, 2);   // do lado do fan do cooler
  header("usb2", "Conector USB 2.0 interno", -W / 2 + 60, -H / 2 + 6, 5);
  header("painel", "Conector do painel frontal", -W / 2 + 30, -H / 2 + 6, 5);
  header("audio", "Conector de áudio frontal", W / 2 - 60, -H / 2 + 6, 5);

  // Barramentos: trilhas no PCB ligando a CPU às memórias e ao slot PCIe (por último, para não bloquear componentes)
  const trilha = (id: string, nome: string, x0: number, x1: number, y0: number, y1: number, n: Vec3) => {
    const w = x1 - x0, h = y1 - y0, x = (x0 + x1) / 2, y = (y0 + y1) / 2;
    if (w <= 2 || h <= 2) return;
    if (partes.some((p) => p.id !== "pcb" && Math.abs(p.pos[0] - x) < (p.tam[0] + w) / 2 && Math.abs(p.pos[1] - y) < (p.tam[1] + h) / 2)) return;
    partes.push({ id, nome, forma: { tipo: "grade", n, cheio: 0.45 }, tom: "trilha", fonte: "estimado", pos: [x, y, zt + 0.05], tam: [w, h, 0.1], explode: [0, 0, 0], ordem: 6 });
  };
  trilha("trilhas-ram", "Barramento de memória (trilhas)", dimm0[0] + 3.25, cx - 25, cy - 20, cy + 20, [1, 24, 1]);
  trilha("trilhas-pcie", "Barramento PCIe (trilhas)", cx - 14, cx + 14, pcieY + 3.75, m2[1] - 11, [16, 1, 1]);
  trilha("trilhas-m2", "Barramento do M.2 (trilhas)", cx - 10, cx + 10, m2[1] + 11, cy - 25, [12, 1, 1]);

  return {
    tam: [W, H, ZT], partes, estimados: ["layout dos componentes"],
    ancoras: { cpu: [cx, cy, zt + 1], dimm0, pcie: [pcieX, pcieY, zt + 8], m2 },
  };
}
