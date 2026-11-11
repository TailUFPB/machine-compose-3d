// CPU e cooler a ar procedurais. Referencial local dos dois: x, y = planta sobre o soquete, z = para fora da placa-mãe.
import type { Vec3 } from "./cena";
import { type Modelo, type Sub, montador } from "./peca";

// Encapsulamento por soquete (mm): AM4 é PGA (pinos na CPU), os outros são LGA (contatos planos).
const ENCAPSULAMENTO: Record<string, { w: number; h: number; pinos: number }> = {
  AM4: { w: 40, h: 40, pinos: 1.6 }, AM5: { w: 40, h: 40, pinos: 0.3 },
  LGA1700: { w: 37.5, h: 45, pinos: 0.3 }, LGA1851: { w: 37.5, h: 45, pinos: 0.3 },
};

export function cpuModelo(specs: Record<string, any>): Modelo {
  const e = ENCAPSULAMENTO[specs.socket] ?? ENCAPSULAMENTO.AM5;
  const SUB = 1.2, DIE = 0.8, IHS = 2.4;
  const T = e.pinos + SUB + DIE + IHS, z0 = -T / 2;
  const partes: Sub[] = [], add = montador(partes);
  const zSub = z0 + e.pinos, zDie = zSub + SUB, zIhs = zDie + DIE;

  add("contatos", e.pinos > 1 ? "Pinos (PGA)" : "Contatos (LGA)", "ouro", [0, 0, z0 + e.pinos / 2], [e.w - 4, e.h - 4, e.pinos], [0, 0, -9], 3, "norma", { tipo: "grade", n: [22, 22, 1], cheio: e.pinos > 1 ? 0.35 : 0.6 });
  add("substrato", "Substrato", "pcb", [0, 0, zSub + SUB / 2], [e.w, e.h, SUB], [0, 0, 0], 2, "norma");
  add("die", `Chip (${specs.nucleos ?? "?"} núcleos)`, "lit", [0, 2, zDie + DIE / 2], [11, 13, DIE], [0, 0, 7], 1);
  for (let i = 0; i < 6; i++) add(`cap-${i}`, "Capacitores", "cobre", [(i - 2.5) * 4, -9, zDie + DIE / 2], [2, 1.2, DIE], [0, 0, 7], 1);
  // IHS: tampa metálica com as quatro abas que apoiam no substrato
  const iw = e.w - 5, ih = e.h - 5;
  add("ihs", "Tampa metálica (IHS)", "metal", [0, 0, zIhs + IHS / 2], [iw, ih, IHS], [0, 0, 16], 0);
  [-1, 1].forEach((s) => add(`ihs-aba-x${s}`, "Aba da tampa", "metal", [s * (iw / 2 - 1), 0, zDie + DIE / 2], [2, ih, DIE], [0, 0, 16], 0));
  [-1, 1].forEach((s) => add(`ihs-aba-y${s}`, "Aba da tampa", "metal", [0, s * (ih / 2 - 1), zDie + DIE / 2], [iw - 4, 2, DIE], [0, 0, 16], 0));
  add("marca", "Marca do pino 1", "ouro", [-e.w / 2 + 1.5, -e.h / 2 + 1.5, zSub + SUB + 0.1], [2, 2, 0.2], [0, 0, 0], 2, "norma");

  return { tam: [e.w, e.h, T], partes, estimados: ["chip", "tampa"], ancoras: { base: [0, 0, z0], topo: [0, 0, T / 2] } };
}

/** Cooler a ar em torre: base, suporte, heatpipes, pilha de aletas, tampa e fan soprando para a traseira (+x). */
export function coolerModelo(specs: Record<string, any>): Modelo {
  const h: number = specs.altura_mm ?? 155;
  const fanMm: number = specs.fan_mm ?? (h < 140 ? 92 : 120);
  const nFans: number = specs.fans ?? 1;
  const nPipes: number = specs.heatpipes ?? Math.min(6, Math.max(2, Math.round((specs.tdp_suportado ?? 180) / 55)));
  const PILHA = 46, FAN = 25, largura = fanMm + 4;
  const meiaX = PILHA / 2 + FAN;   // envelope simétrico: a base fica no centro, sob a pilha
  const z0 = -h / 2;
  const partes: Sub[] = [], add = montador(partes);

  add("base", "Base de contato", "cobre", [0, 0, z0 + 2], [40, 40, 4], [0, 0, -22], 4);
  // suporte de fixação em duas barras ao lado da base, com parafusos de mola nas pontas
  [-1, 1].forEach((s) => {
    add(`suporte${s}`, "Suporte de fixação", "metal", [0, s * 16, z0 + 5.5], [84, 6, 3], [0, 0, -11], 3);
    [-1, 1].forEach((sx) => add(`parafuso${s}${sx}`, "Parafuso de mola", "metal", [sx * 38, s * 16, z0 + 10], [6, 6, 6], [0, 0, -11], 3, "estimado", { tipo: "cilindro", raio: 3, eixo: "z" }));
  });
  const zPilha = z0 + Math.max(32, h - fanMm - 3), altPilha = h / 2 - 3 - zPilha;
  const passo = 2.5, n = Math.floor(altPilha / passo);
  add("aletas", "Pilha de aletas", "metal", [0, 0, zPilha + (n * passo) / 2], [PILHA, largura, n * passo], [0, 0, 0], 2, "estimado", { tipo: "aletas", n, passo, esp: 0.5, eixo: "z" });
  for (let i = 0; i < nPipes; i++) {
    const y = (i - (nPipes - 1) / 2) * 9 + Math.sign(i - (nPipes - 1) / 2) * 22;   // fora da base e do suporte
    add(`heatpipe-${i}`, "Heatpipe", "cobre", [(i % 2 ? 1 : -1) * 9, y, z0 + 4 + (zPilha + n * passo - z0 - 4) / 2], [6, 6, zPilha + n * passo - z0 - 4], [0, 0, 0], 2, specs.heatpipes == null ? "estimado" : "ficha", { tipo: "cilindro", raio: 3, eixo: "z" });
  }
  add("tampa", "Tampa superior", "lo", [0, 0, h / 2 - 1.5], [PILHA, largura, 3], [0, 0, 32], 0);
  const zFan = h / 2 - 3 - fanMm / 2 - (largura - fanMm) / 2 + 2;
  for (let i = 0; i < Math.min(2, nFans); i++) {
    const lado = i === 0 ? -1 : 1;
    add(`fan-${i}`, `Fan ${fanMm} mm`, "hi", [lado * (PILHA / 2 + FAN / 2), 0, Math.max(zFan, z0 + 8 + fanMm / 2)], [FAN, fanMm, fanMm], [lado * 62, 0, 0], 1,
      specs.fan_mm == null ? "estimado" : "ficha", { tipo: "fan", raio: fanMm / 2 - 2, pas: 9, eixo: "x" });
  }
  return { tam: [2 * meiaX, largura, h], partes, estimados: [...(specs.fans == null || specs.fan_mm == null ? ["fans"] : []), ...(specs.heatpipes == null ? ["heatpipes"] : [])], ancoras: { base: [0, 0, z0] } };
}
