// GPU procedural: subpeças em mm, no referencial local da placa.
// x = comprimento (bracket em +x), y = espessura (backplate em +y, fans em -y), z = altura (slot PCIe em -z).
// Norma PCIe CEM: conector x16 de 89 mm a ~42 mm do bracket, com chave separando o trecho x1 (11,65 mm).
import type { Vec3 } from "./cena";
import type { Fonte, Forma, Modelo, Sub, Tom } from "./peca";

const PCIE = { total: 89, doBracket: 42, x1: 11.65, chave: 1.9 };   // mm
const CONECTOR: Record<string, { w: number; nome: string }> = {
  "8pin": { w: 21, nome: "Conector 8 pinos" },
  "6pin": { w: 15, nome: "Conector 6 pinos" },
  "12V-2x6": { w: 19, nome: "Conector 12V-2x6" },
  "12VHPWR": { w: 19, nome: "Conector 12VHPWR" },
};
const CAIXA: Forma = { tipo: "caixa" };

export function gpuModelo(specs: Record<string, any>): Modelo {
  const estimados: string[] = [];
  const d = specs.dimensoes ?? {};
  const L: number = d.c ?? specs.comprimento_mm ?? 240;
  const H: number = d.a ?? (estimados.push("altura"), 111);
  const T: number = d.l ?? (specs.slots ? specs.slots * 20 : (estimados.push("espessura"), 40));
  const nFans: number = specs.fans ?? (estimados.push("fans"), L < 200 ? 1 : L < 285 ? 2 : 3);
  const temBackplate: boolean = specs.backplate ?? (estimados.push("backplate"), L >= 200);
  const fFans: Fonte = specs.fans == null ? "estimado" : "ficha";
  estimados.push("eletrônica");   // chips, VRM e parafusos seguem o arquétipo, não a ficha

  const partes: Sub[] = [];
  const add = (id: string, nome: string, tom: Tom, pos: Vec3, tam: Vec3, explode: Vec3, ordem: number, fonte: Fonte = "ficha", forma: Forma = CAIXA) =>
    partes.push({ id, nome, forma, tom, fonte, pos, tam, explode, ordem });
  const xr = L / 2;                // face externa do bracket
  const x0 = -L / 2, x1 = xr - 4;  // corpo da placa em x
  const cx = (x0 + x1) / 2, cl = x1 - x0;

  // --- Camadas em y, de cima para baixo: [backplate] PCB · vão dos componentes · aletas · fans/shroud
  const E_BP: Vec3 = [0, 62, 0], E_PCB: Vec3 = [0, 36, 0], E_BR: Vec3 = [42, 0, 0], E_SH: Vec3 = [0, -34, 0], E_FAN: Vec3 = [0, -60, 0];
  const pcbY = T / 2 - (temBackplate ? 4 : 2) - 0.8;
  const pcbBaixo = pcbY - 0.8;
  const VAO = 4;                                   // componentes do PCB vivem aqui
  const fanT = Math.min(15, T * 0.3);
  const finY: [number, number] = [-T / 2 + fanT + 1, pcbBaixo - VAO];
  const finH = finY[1] - finY[0], finYc = (finY[0] + finY[1]) / 2;

  // Bracket: chapa, recortes das saídas (slot de cima) e grade de ventilação (slots de baixo)
  add("bracket", "Bracket", "metal", [xr - 0.75, 0, 0], [1.5, T, H], E_BR, 2, "norma");
  const portaY = pcbBaixo - 3.2;
  const portas: [string, string][] = [["dp1", "DisplayPort"], ["dp2", "DisplayPort"], ["dp3", "DisplayPort"], ["hdmi", "HDMI"]];
  portas.forEach(([id, nome], i) => {
    const z = -H / 2 + 18 + i * 20;
    add(`recorte-${id}`, nome, "escuro", [xr + 0.1, portaY, z], [0.2, 5.4, 15], E_BR, 2, "estimado");
    add(`porta-${id}`, `Saída ${nome}`, "metal", [xr - 6.6, portaY, z], [10, 6, 16], E_PCB, 1, "estimado");
  });
  for (let j = 0, yv = portaY - 9; yv - 2 > -T / 2 + 3; j++, yv -= 5.5)
    for (let i = 0; i < 6; i++) add(`vent-${j}-${i}`, "Ventilação", "escuro", [xr + 0.1, yv, -H / 2 + 18 + i * 14], [0.2, 2.6, 10], E_BR, 2, "estimado");

  // Backplate e PCB
  if (temBackplate) add("backplate", "Backplate", "mid", [cx, T / 2 - 1, 2], [cl - 4, 2, H - 12], E_BP, 0, specs.backplate == null ? "estimado" : "ficha");
  add("pcb", "PCB", "pcb", [cx, pcbY, 1], [cl - 2, 1.6, H - 10], E_PCB, 1);

  // Dedos do PCIe x16 com a chave da norma (trecho x1 junto ao bracket)
  const fim = xr - PCIE.doBracket;
  const longo = Math.min(PCIE.total - PCIE.x1 - PCIE.chave, fim - PCIE.x1 - PCIE.chave - (x0 + 2));
  add("pcie-x1", "Conector PCIe (trecho x1)", "ouro", [fim - PCIE.x1 / 2, pcbY, -H / 2 + 3], [PCIE.x1, 1.6, 6], E_PCB, 1, "norma", { tipo: "grade", n: [11, 1, 1] });
  add("pcie-x16", "Conector PCIe x16", "ouro", [fim - PCIE.x1 - PCIE.chave - longo / 2, pcbY, -H / 2 + 3], [longo, 1.6, 6], E_PCB, 1, "norma", { tipo: "grade", n: [Math.round(longo), 1, 1] });

  // Eletrônica na face de baixo do PCB: GPU (substrato + die), memórias em L, fases do VRM
  const gx = Math.max(x0 + 40, fim - PCIE.total / 2 - 6), gz = -2;
  const compY = (h: number) => pcbBaixo - h / 2;
  add("gpu-substrato", "Encapsulamento da GPU", "pcb", [gx, compY(1), gz], [34, 1, 34], E_PCB, 1, "estimado");
  add("gpu-die", "Chip da GPU (die)", "lit", [gx, pcbBaixo - 1 - 0.4, gz], [17, 0.8, 15], E_PCB, 1, "estimado");
  const nMem = Math.min(8, Math.max(2, Math.ceil((specs.vram_gb ?? 8) / 2)));
  for (let i = 0; i < nMem; i++) {
    const lado = i % 2, k = Math.floor(i / 2) - (Math.ceil(nMem / 2) - 1) / 2;
    const pos: Vec3 = lado === 0 ? [gx + k * 17, compY(1.1), gz + 28] : [gx - 28, compY(1.1), gz + k * 17 - 12];
    add(`vram-${i}`, "Memória (VRAM)", "escuro", pos, lado === 0 ? [14, 1.1, 11] : [11, 1.1, 14], E_PCB, 1, "estimado");
  }
  const fases = Math.min(10, Math.max(3, Math.round((specs.tdp ?? 150) / 30)));
  const vx = Math.min(gx + 40, x1 - 22), passoF = Math.min(10.5, (H - 34) / fases);
  for (let i = 0; i < fases; i++) {
    const z = -H / 2 + 20 + passoF * (i + 0.5);
    add(`indutor-${i}`, "Indutor (VRM)", "mid", [vx, compY(3.6), z], [8, 3.6, passoF - 2], E_PCB, 1, "estimado");
    add(`cap-${i}`, "Capacitor (VRM)", "metal", [vx + 9, compY(3.4), z], [5, 3.4, 5], E_PCB, 1, "estimado", { tipo: "cilindro", raio: 2.5 });
  }

  // Barramentos: trilhas da GPU até o pente PCIe e até as memórias
  add("trilhas-pcie", "Barramento PCIe (trilhas)", "trilha", [gx, pcbBaixo - 0.05, (gz - 17 + -H / 2 + 6) / 2], [26, 0.1, gz - 17 - (-H / 2 + 6)], E_PCB, 1, "estimado", { tipo: "grade", n: [16, 1, 1], cheio: 0.45 });
  add("trilhas-vram", "Barramento de memória (trilhas)", "trilha", [gx, pcbBaixo - 0.05, gz + 19.75], [30, 0.1, 5.5], E_PCB, 1, "estimado", { tipo: "grade", n: [20, 1, 1], cheio: 0.45 });

  // Parafusos de retenção do cooler em volta da GPU, na face de cima (PCB ou backplate)
  const topo = temBackplate ? T / 2 : pcbY + 0.8;
  const hp = temBackplate ? 0.4 : 1.6;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) =>
    add(`parafuso-${i}`, "Parafuso de retenção", "metal", [gx + sx * 24, topo + hp / 2, gz + sz * 24], [4.4, hp, 4.4], temBackplate ? E_BP : E_PCB, temBackplate ? 0 : 1, "estimado", { tipo: "cilindro", raio: 2.2 }));

  // Conectores de energia na borda de cima do PCB (lado do cooler)
  const cons = Object.entries(specs.conectores ?? {}).flatMap(([k, n]) => Array.from({ length: Number(n) }, () => CONECTOR[k] ?? { w: 21, nome: k }));
  let xc = Math.min(-L * 0.05, vx - 12) - cons.reduce((s, c) => s + c.w + 3, 0);
  cons.forEach((c, i) => {
    add(`energia-${i}`, c.nome, "hi", [xc + c.w / 2, pcbBaixo - 5, H / 2 - 7], [c.w, 10, 12], [0, 36, 24], 1);
    add(`energia-${i}-pinos`, `Pinos (${c.nome})`, "escuro", [xc + c.w / 2, pcbBaixo - 5, H / 2 - 0.9], [c.w - 3, 7, 0.2], [0, 36, 24], 1, "norma", { tipo: "grade", n: [c.w > 20 ? 4 : 6, 2, 1], cheio: 0.7 });
    xc += c.w + 3;
  });

  // Dissipador: base de cobre no die, aletas, heatpipes atravessando
  add("base", "Base de contato", "cobre", [gx, pcbBaixo - 1.8 - (VAO - 1.8) / 2, gz], [38, VAO - 1.8, 38], [0, 0, 0], 3, "estimado");
  const passo = 3, n = Math.floor((cl - 12) / passo), finX = x0 + 2 + (n * passo) / 2;
  add("aletas", "Dissipador (aletas)", "metal", [finX, finYc, -5], [n * passo, finH, H - 30], [0, 0, 0], 3, "estimado", { tipo: "aletas", n, passo, esp: 0.5 });
  const rp = Math.min(3, finH / 4);
  [-0.3, -0.1, 0.1, 0.3].forEach((k, i) =>
    add(`heatpipe-${i}`, "Heatpipe", "cobre", [finX, finYc, -5 + k * (H - 30)], [n * passo, 2 * rp, 2 * rp], [0, 0, 0], 3, "estimado", { tipo: "tubo", raio: rp }));

  // Shroud: tampa com os furos dos fans, paredes laterais e parafusos; fans dentro dos furos
  const vaoX = [x0 + 6, x1 - 8];
  const passoFan = (vaoX[1] - vaoX[0]) / nFans;
  const r = Math.min(48, (H - 14) / 2, passoFan / 2 - 3);
  const furos = Array.from({ length: nFans }, (_, i) => ({ x: vaoX[0] + passoFan * (i + 0.5), z: 3, r: r + 1.5 }));
  add("shroud", "Shroud (tampa)", "lo", [cx, -T / 2 + 1.5, 0], [cl, 3, H - 2], E_SH, 4, "estimado", { tipo: "placa", furos });
  const paredeH = fanT - 3 + finH * 0.5, paredeY = -T / 2 + 3 + paredeH / 2;
  add("shroud-parede-0", "Shroud (lateral)", "lo", [cx, paredeY, -H / 2 + 2], [cl, paredeH, 2], E_SH, 4, "estimado");
  add("shroud-parede-1", "Shroud (lateral)", "lo", [cx, paredeY, H / 2 - 2], [cl, paredeH, 2], E_SH, 4, "estimado");
  add("shroud-parede-2", "Shroud (ponta)", "lo", [x0 + 1, paredeY, 0], [2, paredeH, H - 6], E_SH, 4, "estimado");
  furos.forEach((f, i) => {
    add(`fan-${i}`, `Fan ${i + 1}`, "hi", [f.x, -T / 2 + fanT / 2, f.z], [2 * r, fanT, 2 * r], E_FAN, 5, fFans, { tipo: "fan", raio: r, pas: 9 });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], j) =>
      add(`shroud-parafuso-${i}-${j}`, "Parafuso do shroud", "metal", [f.x + sx * Math.min(f.r + 2, passoFan / 2 - 3), -T / 2 - 0.2, sz * (H / 2 - 6)], [3, 0.4, 3], E_SH, 4, "estimado", { tipo: "cilindro", raio: 1.5 }));
  });

  return { tam: [L, T, H], partes, estimados, ancoras: { pcie: [fim - PCIE.total / 2, pcbY, -H / 2 + 3] } };
}
