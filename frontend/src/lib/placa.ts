// Placa-mãe procedural. Referencial local: x = largura (painel traseiro em +x), y = altura (topo em +y),
// z = espessura (standoffs em -z, componentes em +z). Âncoras dizem onde CPU, RAM, GPU e M.2 encaixam e onde cada cabo chega.
// Norma: dimensões ATX/mATX/ITX, slot PCIe x16 de 89 mm a 42 mm da borda traseira, passo de slot 20,32 mm.
import type { Vec3 } from "./cena";
import type { Fonte, Forma, Modelo, Sub, Tom } from "./peca";

export const DIMM_PASSO = 9.5;   // mm entre slots de memória (estimado)
const DIM: Record<string, [number, number]> = { ATX: [244, 305], mATX: [244, 244], ITX: [170, 170] };
const STANDOFF = 6.35;   // espaçador entre a bandeja e o PCB (norma ATX: 1/4")
const ZT = 36 + STANDOFF, PCB = 1.6, SLOT_PCIE = 20.32;
// Portas do painel traseiro: [largura ao longo da borda (y), altura sobre a placa (z), quantas iguais empilham], em mm
const PORTA: Record<string, [number, number, number]> = {
  "USB-A": [13.1, 5.6, 2], "USB-C": [8.4, 2.6, 2], HDMI: [15, 5.5, 1], DisplayPort: [16.1, 4.8, 1], RJ45: [16, 13.5, 1], audio: [6, 22, 1], "PS/2": [13, 13, 1],
};
const CAIXA: Forma = { tipo: "caixa" };

export function placaMaeModelo(specs: Record<string, any>): Modelo {
  const ff: string = specs.form_factor ?? "ATX";
  const [W, H] = DIM[ff] ?? DIM.ATX;
  const z0 = -ZT / 2, zt = z0 + STANDOFF + PCB;   // zt = face de cima do PCB
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
  /** Tenta (x, y); se estiver ocupado (placas pequenas), varre a borda mais próxima, de cima ou de baixo, a partir de x. */
  const vaga = (h: number, x: number, y: number, tenta: (x: number, y: number) => boolean) => {
    if (tenta(x, y)) return true;
    const borda = H / 2 - 2 - h / 2;
    for (const yy of y > 0 ? [borda, -borda] : [-borda, borda]) for (let dx = 0; dx < W; dx += 4) if (tenta(x - dx, yy) || tenta(x + dx, yy)) return true;
    return false;
  };
  /** Conector de pinos em pé (headers de fan, USB, painel frontal). */
  const header = (id: string, nome: string, x: number, y: number, nx: number) => {
    if (!vaga(6, x, y, (xx, yy) => sobre(id, nome, "escuro", xx, yy, nx * 2.54 + 2, 6, 2.5, 12, 5, "norma"))) return;
    const b = partes.at(-1)!;
    partes.push({ id: `${id}-pinos`, nome: `Pinos (${nome})`, forma: { tipo: "grade", n: [nx, 2, 1], cheio: 0.3 }, tom: "ouro", fonte: "norma",
      pos: [b.pos[0], b.pos[1], zt + 2.5 + 3], tam: [nx * 2.54, 5.08, 6], explode: [0, 0, 12], ordem: 5 });
  };
  /** Marca a última subpeça colocada como móvel (estado ABERTO do encaixe). */
  const abre = (movel: Sub["movel"]) => { partes.at(-1)!.movel = movel; };

  partes.push({ id: "pcb", nome: `PCB ${ff}`, forma: CAIXA, tom: "pcb", fonte: "norma", pos: [0, 0, zt - PCB / 2], tam: [W, H, PCB], explode: [0, 0, 0], ordem: 6 });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy], i) =>
    sobre(`furo-${i}`, "Furo de fixação", "metal", sx * (W / 2 - 6.5), sy * (H / 2 - 10), 7, 7, 0.3, 0, 6, "estimado", { tipo: "cilindro", raio: 3.5, eixo: "z" })
      && partes.push({ id: `standoff-${i}`, nome: "Standoff (espaçador da bandeja)", forma: { tipo: "cilindro", raio: 3, eixo: "z" }, tom: "ouro", fonte: "norma",
        pos: [sx * (W / 2 - 6.5), sy * (H / 2 - 10), z0 + STANDOFF / 2], tam: [6, 6, STANDOFF], explode: [0, 0, -14], ordem: 6 }));

  // CPU: soquete (base + moldura) e dissipadores do VRM em volta
  const cx = W * 0.05, cy = Math.min(H * 0.22, H / 2 - 77);   // os slots de memória (139 mm + travas) têm de caber
  const soquete = `Soquete ${specs.socket ?? ""}`.trim();
  sobre("soquete-base", soquete, "metal", cx, cy, 44, 44, 1, 26, 3);
  [[-1, 0], [1, 0]].forEach(([s], i) => sobre(`soquete-x${i}`, soquete, "lo", cx + s * 23.5, cy, 3, 50, 4.5, 26, 3));
  [[0, -1], [0, 1]].forEach(([, s], i) => sobre(`soquete-y${i}`, soquete, "lo", cx, cy + s * 23.5, 44, 3, 4.5, 26, 3));
  // alavanca de retenção ao lado do soquete: gira em torno da ponta de baixo (-y) para soltar a CPU
  if (sobre("soquete-alavanca", "Alavanca do soquete", "metal", cx + 28, cy, 2, 50, 3, 26, 3)) abre({ gira: [1.2, 0, 0], desloca: [0, 25 * (Math.cos(1.2) - 1), 25 * Math.sin(1.2)] });
  const am4 = specs.socket === "AM4";   // AM4 tem furos para os pinos da CPU; os LGA têm os pinos no soquete
  cima("soquete-base", am4 ? "Furos dos pinos (PGA)" : "Pinos do soquete (LGA)", am4 ? "escuro" : "ouro", [24, 24, 1], 0.88, 0.88, am4 ? 0.5 : 0.4);
  sobre("vrm-lateral", "Dissipador do VRM", "mid", cx + 72, cy, 16, 90, 24, 62, 0, "estimado", { tipo: "aletas", n: 5, passo: 3.2, esp: 1.8 });
  sobre("vrm-topo", "Dissipador do VRM", "mid", cx, cy + 74, 80, 12, 20, 62, 0, "estimado", { tipo: "aletas", n: 20, passo: 4, esp: 2.4 });

  // Painel traseiro com as portas na face de fora
  const ioH = Math.min(150, H - 40), ioY = H / 2 - 14 - ioH / 2;
  partes.push({ id: "io", nome: "Painel traseiro (I/O)", forma: CAIXA, tom: "lo", fonte: "estimado", pos: [W / 2 - 14, ioY, zt + 17], tam: [28, ioH, 34], explode: [0, 0, 46], ordem: 1 });
  const io = (i: number, nome: string, fonte: Fonte, y: number, z: number, w: number, h: number, forma: Forma = CAIXA) =>
    partes.push({ id: `io-porta-${i}`, nome, forma, tom: "escuro", fonte, pos: [W / 2 + 0.1, y, zt + z], tam: [0.2, w, h], explode: [0, 0, 46], ordem: 1 });
  const lista: string[] | undefined = specs.portas_traseiras;
  if (!lista) for (let i = 0; i < 5; i++) io(i, "Portas traseiras", "estimado", ioY + (i - 2) * (ioH / 5.5), 15, 14, 16);
  else {
    // colunas ao longo da borda, de cima para baixo: portas iguais e seguidas empilham em z até o limite do tipo
    const colunas: { tipo: string; idx: number[] }[] = [];
    lista.forEach((tipo, i) => {
      const u = colunas.at(-1);
      if (u && u.tipo === tipo && u.idx.length < (PORTA[tipo]?.[2] ?? 1)) u.idx.push(i); else colunas.push({ tipo, idx: [i] });
    });
    const dim = (tipo: string) => PORTA[tipo] ?? [14, 8, 1];
    const soma = colunas.reduce((t, c) => t + dim(c.tipo)[0], 0), vao = Math.max(0.5, Math.min(5, (ioH - 8 - soma) / Math.max(1, colunas.length - 1)));
    let y = ioY + ioH / 2 - 4;
    for (const c of colunas) {
      const [w, h] = dim(c.tipo);
      if (y - w < ioY - ioH / 2 + 2) break;   // ponytail: o que não cabe no painel não é desenhado
      const forma: Forma = c.tipo === "audio" ? { tipo: "grade", n: [1, 1, 3], cheio: 0.75 } : c.tipo === "PS/2" ? { tipo: "tubo", raio: w / 2 } : CAIXA;
      c.idx.forEach((i, k) => io(i, c.tipo === "audio" ? "Áudio (P2)" : `Porta ${c.tipo}`, "ficha", y - w / 2, 17 + (k - (c.idx.length - 1) / 2) * (h + 2.5), w, h, forma));
      y -= w + vao;
    }
  }

  // Memória: slots com travas
  const nDimm: number = specs.slots_ram ?? 4;
  const dimm0: Vec3 = [cx - 68, cy, zt + 3];
  for (let i = 0; i < nDimm; i++) {
    const x = dimm0[0] - i * DIMM_PASSO;
    if (!sobre(`dimm-${i}`, `Slot de memória ${i + 1}`, "escuro", x, cy, 6.5, 139, 11, 18, 4)) continue;
    cima(`dimm-${i}`, "Contatos do slot (288 pinos)", "ouro", [2, 72, 1], 0.45, 0.93);
    [-1, 1].forEach((s) => { if (sobre(`dimm-${i}-trava${s}`, "Trava do slot", "mid", x, cy + s * 72.5, 6.5, 5, 15, 18, 4)) abre({ gira: [-s * 0.4, 0, 0], desloca: [0, s * 2, 0] }); });
  }

  // Energia
  sobre("atx24", "Conector ATX 24 pinos", "hi", -W / 2 + 7, cy - 10, 9, 52, 13, 14, 5, "norma");
  vaga(10, cx + 62, H / 2 - 9, (x, y) => sobre("eps", "Conector EPS 8 pinos", "hi", x, y, 20, 10, 13, 14, 5, "norma"));
  cima("atx24", "Pinos (ATX 24)", "escuro", [2, 12, 1], 0.8, 0.92, 0.7);
  cima("eps", "Pinos (EPS 8)", "escuro", [4, 2, 1], 0.88, 0.75, 0.7);

  // PCIe: primeiro x16 e, se couber, um segundo quatro slots abaixo (fora da sombra da GPU)
  const pcieX = W / 2 - 42 - 44.5, pcieY = ff === "ITX" ? -H / 2 + 8 : -0.12 * H;
  [0, 4].forEach((k, i) => {
    const y = pcieY - k * SLOT_PCIE;
    if (!sobre(`pcie-${i}`, "Slot PCIe x16", "escuro", pcieX, y, 89, 7.5, 11, 18, 4, "norma")) return;
    cima(`pcie-${i}`, "Contatos do slot (164 pinos)", "ouro", [82, 2, 1], 0.94, 0.42);
    if (sobre(`pcie-${i}-trava`, "Trava do slot PCIe", "mid", pcieX - 44.5 - 3.5, y, 7, 9, 12, 18, 4)) abre({ gira: [0, -0.4, 0], desloca: [-2, 0, 0] });
  });

  // M.2, chipset, SATA e bateria (tudo baixo: fica sob a GPU)
  const m2: Vec3 = [cx, Math.min(-0.05 * H, cy - 38), zt + 6.4];
  sobre("m2-conector", "Conector M.2", "escuro", cx + 43, m2[1], 6, 22, 4.5, 12, 5, "norma");
  cima("m2-conector", "Contatos M.2 (75 pinos)", "ouro", [1, 34, 1], 0.4, 0.85);
  sobre("m2-parafuso", "Parafuso do M.2", "metal", cx - 43, m2[1], 5, 5, 4.5, 12, 5, "norma", { tipo: "cilindro", raio: 2.5, eixo: "z" });
  sobre("chipset", `Dissipador do chipset ${specs.chipset ?? ""}`.trim(), "mid", -W / 2 + 65, -0.28 * H, 50, 44, 4.5, 30, 2);
  [-1, 1].forEach((s) => vaga(16, -W / 2 + 9, -0.28 * H + s * 12, (x, y) => sobre(`sata${s}`, "Portas SATA", "hi", x, y, 14, 16, 4.5, 14, 5)));
  sobre("bateria", "Bateria CMOS", "metal", 60, pcieY - 22, 20, 20, 3, 16, 5, "estimado", { tipo: "cilindro", raio: 10, eixo: "z" });

  // Headers de pinos na borda de baixo e junto da CPU
  header("fan-cpu", "Conector do fan da CPU", cx - 38, cy + 44, 2);   // do lado do fan do cooler
  header("usb2", "Conector USB 2.0 interno", -W / 2 + 60, -H / 2 + 6, 5);
  header("painel", "Conector do painel frontal", -W / 2 + 30, -H / 2 + 6, 5);
  header("audio", "Conector de áudio frontal", W / 2 - 60, -H / 2 + 6, 5);
  header("fan-sys0", "Conector de fan do sistema 1", -W / 2 + 30, H / 2 - 6, 2);
  header("fan-sys1", "Conector de fan do sistema 2", -W / 2 + 90, -H / 2 + 6, 2);
  header("fan-sys2", "Conector de fan do sistema 3", W / 2 - 30, -H / 2 + 6, 2);

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

  // Dissipador do M.2 (só com a ficha): fica acima do SSD, que tem 3 mm e é centrado na âncora
  if (specs.m2_dissipador === true)
    partes.push({ id: "m2-dissipador", nome: "Dissipador do M.2", forma: { tipo: "aletas", n: 22, passo: 4, esp: 2.6 }, tom: "mid", fonte: "ficha",
      pos: [cx, m2[1], m2[2] + 1.5 + 2], tam: [88, 24, 4], explode: [0, 0, 34], ordem: 2 });

  // Capacitores, indutores e chips menores nas áreas livres (depois de tudo, para não tirar o lugar de ninguém).
  // Todos com até 4,5 mm: cabem sob a GPU, o cooler e o SSD.
  const cap = (id: string, x: number, y: number) => sobre(id, "Capacitor", "metal", x, y, 6, 6, 4.5, 12, 5, "estimado", { tipo: "cilindro", raio: 3, eixo: "z" });
  const chip = (id: string, nome: string, x: number, y: number, w: number, h: number) => sobre(id, nome, "escuro", x, y, w, h, 1.2, 12, 5);
  for (let i = -3; i <= 3; i++) {   // saída do VRM: entre o soquete e os dois dissipadores
    cap(`cap-vrm-x${i + 3}`, cx + 40, cy + i * 9);
    sobre(`indutor-x${i + 3}`, "Indutor (VRM)", "mid", cx + 52, cy + i * 11, 9, 9, 4.5, 12, 5);
    cap(`cap-vrm-y${i + 3}`, cx + i * 9, cy + 36);
    sobre(`indutor-y${i + 3}`, "Indutor (VRM)", "mid", cx + i * 11, cy + 52, 9, 9, 4.5, 12, 5);
  }
  for (let i = 0; i < 6; i++) cap(`cap-borda-${i}`, -W / 2 + 20 + (i * (W - 40)) / 5, -H / 2 + 18);
  for (let i = 0; i < 4; i++) cap(`cap-audio-${i}`, W / 2 - 24 - i * 8, -H / 2 + 30);
  chip("chip-audio", "Codec de áudio", W / 2 - 45, -H / 2 + 42, 7, 7);
  chip("chip-sio", "Controlador de E/S (Super I/O)", -W / 2 + 100, -H / 2 + 34, 14, 14) || chip("chip-sio", "Controlador de E/S (Super I/O)", -W / 2 + 45, -H / 2 + 30, 14, 14);
  chip("chip-rede", "Controlador de rede", W / 2 - 40, ioY - ioH / 2 - 12, 9, 9);
  chip("chip-bios", "Memória da BIOS", 36, pcieY - 22, 6, 8);
  chip("chip-clock", "Gerador de clock", cx - 44, cy - 44, 6, 6);

  // Âncoras de cabo: centro da face de cima de cada conector
  const ancoras: Record<string, Vec3> = { cpu: [cx, cy, zt + 1], dimm0, pcie: [pcieX, pcieY, zt + 8], m2 };
  const conectores = { fan_cpu: "fan-cpu-pinos", fan_sys0: "fan-sys0-pinos", fan_sys1: "fan-sys1-pinos", fan_sys2: "fan-sys2-pinos",
    painel: "painel-pinos", usb2: "usb2-pinos", audio: "audio-pinos", sata0: "sata-1", sata1: "sata1", atx24: "atx24", eps: "eps" };
  for (const [a, id] of Object.entries(conectores)) {
    const p = partes.find((s) => s.id === id);
    if (p) ancoras[a] = [p.pos[0], p.pos[1], p.pos[2] + p.tam[2] / 2];
  }
  return { tam: [W, H, ZT], partes, estimados: ["layout dos componentes"], ancoras };
}
