// Layout paramétrico da cena 3D: cada peça vira uma caixa dimensionada pela ficha técnica (mm).
// Eixos: X = profundidade (frente -X, traseira +X), Y = altura, Z = largura (lado da placa-mãe em -Z).
import type { Cena, Tipo } from "./api";

export type Vec3 = [number, number, number];
export interface Caixa { id: string; tipo: Tipo; nome: string; pos: Vec3; tam: Vec3; cor: string; conflito: boolean; passo: number }

const MARGEM = 30;
const COR: Partial<Record<Tipo, string>> = {
  gabinete: "#8892a6", placa_mae: "#2f6b4f", cpu: "#c9ccd1", cooler: "#5b7fbf", memoria: "#3a3f4b",
  gpu: "#202634", fonte: "#4a4f5c", armazenamento: "#1f8a70",
};
const MB_DIM: Record<string, [number, number]> = { ATX: [244, 305], mATX: [244, 244], ITX: [170, 170] };

export function montarCena(cena: Cena): Caixa[] {
  const por = (t: Tipo) => cena.pecas.find((p) => p.tipo === t);
  const emConflito = new Set(cena.conflitos.flatMap((c) => c.itens));
  const ordem = cena.passos.map((p) => p.tipo);
  const caixas: Caixa[] = [];
  const add = (p: { id: string; tipo: Tipo; nome: string }, pos: Vec3, tam: Vec3) =>
    caixas.push({ ...p, pos, tam, cor: COR[p.tipo] ?? "#888", conflito: emConflito.has(p.id), passo: Math.max(0, ordem.indexOf(p.tipo)) });

  const gab = por("gabinete");
  const d = gab?.specs.dimensoes ?? { c: 450, a: 460, l: 230 };
  const [C, A, L] = [d.c, d.a, d.l];
  if (gab) add(gab, [0, 0, 0], [C, A, L]);

  const mbP = por("placa_mae");
  const [mbW, mbH] = MB_DIM[mbP?.specs.form_factor ?? "ATX"];
  const mbZ = -L / 2 + 25;
  const mbX = C / 2 - MARGEM - mbW / 2;
  const mbY = A / 2 - MARGEM - mbH / 2;
  if (mbP) add(mbP, [mbX, mbY, mbZ], [mbW, mbH, 4]);

  const cpuPos: Vec3 = [mbX + mbW * 0.05, mbY + mbH * 0.22, mbZ + 4];
  const cpu = por("cpu");
  if (cpu) add(cpu, cpuPos, [40, 40, 6]);

  const cooler = por("cooler");
  if (cooler?.specs.refrigeracao === "aio") {
    const r = cooler.specs.radiador_mm;
    add(cooler, [-C / 2 + MARGEM + 15, 0, 0], [30, r, 120]);   // radiador na frente
  } else if (cooler) {
    const h = cooler.specs.altura_mm;
    add(cooler, [cpuPos[0], cpuPos[1], mbZ + 4 + h / 2], [125, 130, h]);
  }

  const ram = por("memoria");
  if (ram) add(ram, [cpuPos[0] - 75, cpuPos[1], mbZ + 4 + ram.specs.altura_mm / 2], [16, 133, ram.specs.altura_mm]);

  const ssd = por("armazenamento");
  if (ssd) add(ssd, [cpuPos[0], mbY - mbH * 0.05, mbZ + 6], [80, 22, 3]);

  const gpu = por("gpu");
  if (gpu) {
    const comp = gpu.specs.comprimento_mm, esp = gpu.specs.slots * 20;
    add(gpu, [C / 2 - MARGEM - comp / 2, mbY - mbH * 0.15, mbZ + 4 + esp / 2], [comp, 120, esp]);
  }

  const psu = por("fonte");
  if (psu) {
    const pd = psu.specs.dimensoes;
    add(psu, [C / 2 - MARGEM - pd.c / 2, -A / 2 + 20 + pd.a / 2, 0], [pd.c, pd.a, pd.l]);
  }
  return caixas;
}

/** Peças que, pelo layout, atravessam as paredes do gabinete (confere a geometria contra as regras). */
export function foraDoGabinete(caixas: Caixa[]): string[] {
  const g = caixas.find((c) => c.tipo === "gabinete");
  if (!g) return [];
  return caixas.filter((c) => c !== g && c.pos.some((p, i) => Math.abs(p) + c.tam[i] / 2 > g.tam[i] / 2 + 0.5)).map((c) => c.id);
}

/** Tutorial: peça do passo `passo` entra deslizando de fora (+Z) até a posição final. */
export function posicaoTutorial(c: Caixa, passoAtual: number, progresso: number): Vec3 | null {
  if (c.tipo === "gabinete" || c.passo < passoAtual) return c.pos;
  if (c.passo > passoAtual) return null;
  const t = 1 - Math.pow(1 - Math.min(1, Math.max(0, progresso)), 3);   // ease-out
  return [c.pos[0], c.pos[1], c.pos[2] + (1 - t) * 400];
}
