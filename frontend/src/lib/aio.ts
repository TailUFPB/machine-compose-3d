// Water cooler all-in-one procedural, em duas peças rígidas: bloco/bomba sobre a CPU e radiador com fans.
// As mangueiras ligam as âncoras `bocal0`/`bocal1` das duas peças e são da cena, não daqui.
import { type Fonte, type Modelo, type Sub, montador } from "./peca";

/** Bloco/bomba. Referencial do cooler a ar: x, y = planta sobre o soquete, z = para fora da placa-mãe. Bocais em +x. */
export function aioBlocoModelo(_specs: Record<string, any>): Modelo {
  const PLACA = 4, BOMBA = 22, TAMPA = 3, R = 30;
  const H = PLACA + BOMBA + TAMPA, z0 = -H / 2, zBomba = z0 + PLACA;
  const partes: Sub[] = [], add = montador(partes);

  add("placa-fria", "Placa fria de cobre", "cobre", [0, 0, z0 + PLACA / 2], [56, 56, PLACA], [0, 0, -22], 3);
  // suporte em duas barras ao lado da placa fria, com parafusos de mola nas pontas
  [-1, 1].forEach((s) => {
    add(`suporte${s}`, "Suporte de fixação", "metal", [0, s * 31, z0 + 2.5], [84, 6, 3], [0, 0, -11], 2);
    [-1, 1].forEach((sx) => add(`parafuso${s}${sx}`, "Parafuso de mola", "metal", [sx * 38, s * 31, zBomba + 3], [6, 6, 6], [0, 0, -11], 2, "estimado", { tipo: "cilindro", raio: 3, eixo: "z" }));
  });
  add("bomba", "Corpo da bomba", "lo", [0, 0, zBomba + BOMBA / 2], [2 * R, 2 * R, BOMBA], [0, 0, 0], 1, "estimado", { tipo: "cilindro", raio: R, eixo: "z" });
  const zBocal = zBomba + BOMBA / 2, bocais = [-11, 11];
  bocais.forEach((y, i) => add(`bocal-${i}`, "Bocal de mangueira", "metal", [R + 6, y, zBocal], [12, 10, 10], [16, 0, 0], 1, "estimado", { tipo: "tubo", raio: 5 }));
  add("tampa", "Tampa da bomba", "mid", [0, 0, H / 2 - TAMPA / 2], [2 * R, 2 * R, TAMPA], [0, 0, 24], 0, "estimado", { tipo: "cilindro", raio: R, eixo: "z" });
  add("anel", "Anel iluminado", "lit", [0, 0, H / 2 + 0.15], [40, 40, 0.3], [0, 0, 24], 0, "estimado", { tipo: "cilindro", raio: 20, eixo: "z" });

  return {
    tam: [84, 68, H], partes, estimados: ["bloco", "bomba", "bocais"],
    ancoras: { base: [0, 0, z0], bocal0: [R + 12, bocais[0], zBocal], bocal1: [R + 12, bocais[1], zBocal] },
  };
}

// Furação do fan (norma de fato): distância entre parafusos por tamanho do quadro.
const FURACAO: Record<number, number> = { 120: 105, 140: 124.5 };

/** Radiador com fans. Referencial local: x = espessura (radiador em -x, fans em +x), y = comprimento, z = largura. */
export function aioRadiadorModelo(specs: Record<string, any>): Modelo {
  const L: number = specs.radiador_mm ?? 240;
  const fanMm: number = specs.fan_mm ?? (L % 140 === 0 ? 140 : 120);
  const cabem = Math.max(1, Math.floor(L / fanMm)), nFans = Math.min(specs.fans ?? cabem, cabem);
  const RAD = 27, FAN = 25, X = RAD + FAN, W = fanMm;
  const TANQUE = 16, BOCAL = 12, MOLDURA = 3;
  const xRad = -X / 2 + RAD / 2, xFan = X / 2 - FAN / 2;
  const daFicha: Fonte = specs.radiador_mm == null ? "estimado" : "ficha";
  const partes: Sub[] = [], add = montador(partes);

  // camada do radiador: bocais e tanque numa ponta, núcleo entre as molduras, tanque de retorno na outra
  const yNucleo0 = -L / 2 + BOCAL + TANQUE, C = L - BOCAL - 2 * TANQUE, yNucleo = yNucleo0 + C / 2;
  const n = Math.round((W - 2 * MOLDURA) / 3), bocais = [-15, 15];
  add("nucleo", `Núcleo de aletas${specs.tdp_suportado ? ` (até ${specs.tdp_suportado} W)` : ""}`, "escuro", [xRad, yNucleo, 0], [RAD, C, W - 2 * MOLDURA], [0, 0, 0], 3, daFicha,
    { tipo: "aletas", n, passo: (W - 2 * MOLDURA) / n, esp: 1, eixo: "z" });
  [-1, 1].forEach((s) => add(`moldura${s}`, "Moldura lateral", "mid", [xRad, yNucleo, s * (W / 2 - MOLDURA / 2)], [RAD, C, MOLDURA], [0, 0, s * 14], 2, daFicha));
  add("tanque-0", "Tanque de entrada e saída", "lo", [xRad, yNucleo0 - TANQUE / 2, 0], [RAD, TANQUE, W], [0, -18, 0], 2);
  add("tanque-1", "Tanque de retorno", "lo", [xRad, L / 2 - TANQUE / 2, 0], [RAD, TANQUE, W], [0, 18, 0], 2);
  bocais.forEach((z, i) => add(`bocal-${i}`, "Bocal de mangueira", "metal", [xRad, -L / 2 + BOCAL / 2, z], [10, BOCAL, 10], [0, -18, 0], 2, "estimado", { tipo: "cilindro", raio: 5 }));

  // camada dos fans, com os quatro parafusos de cada um na furação da norma
  const fonteFan: Fonte = specs.fan_mm == null ? "estimado" : "ficha", d = (FURACAO[fanMm] ?? fanMm - 15) / 2;
  for (let i = 0; i < nFans; i++) {
    const y = (i - (nFans - 1) / 2) * fanMm;
    add(`fan-${i}`, `Fan ${fanMm} mm`, "hi", [xFan, y, 0], [FAN, fanMm, fanMm], [40, 0, 0], 1, fonteFan, { tipo: "fan", raio: fanMm / 2 - 2, pas: 9, eixo: "x" });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sy, sz], k) =>
      add(`parafuso-${i}-${k}`, "Parafuso do fan", "metal", [X / 2 + 0.2, y + sy * d, sz * d], [0.4, 5, 5], [62, 0, 0], 0, "norma", { tipo: "tubo", raio: 2.5 }));
  }

  return {
    tam: [X, L, W], partes,
    estimados: [...(specs.radiador_mm == null ? ["radiador"] : []), "tanques", "bocais", ...(specs.fan_mm == null ? ["fans"] : [])],
    ancoras: { bocal0: [xRad, -L / 2, bocais[0]], bocal1: [xRad, -L / 2, bocais[1]], face: [-X / 2, 0, 0] },
  };
}
