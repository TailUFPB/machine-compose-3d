// Fonte e gabinete procedurais. Referencial local dos dois: x = profundidade (traseira em +x), y = altura, z = largura.
import type { Vec3 } from "./cena";
import { type Modelo, type Sub, montador } from "./peca";

/** Fonte ATX/SFX com o fan para baixo: tampa, PCB pendurado com os componentes, fan na chapa de baixo. */
export function fonteModelo(specs: Record<string, any>): Modelo {
  const d = specs.dimensoes ?? { c: 150, a: 86, l: 140 };
  const [X, Y, Z]: Vec3 = [d.c, d.a, d.l];
  const kx = X / 150, ky = Y / 86, kz = Z / 140, k = Math.min(kx, ky, kz);
  const partes: Sub[] = [], add = montador(partes);
  const t = 1;

  // Carcaça: cada chapa sai pelo seu lado na vista explodida
  add("tampa", "Tampa", "lo", [0, Y / 2 - t / 2, 0], [X, t, Z], [0, 38, 0], 1, "ficha");
  [-1, 1].forEach((s) => add(`lateral${s}`, "Lateral", "lo", [0, 0, s * (Z / 2 - t / 2)], [X, Y - 2 * t, t], [0, 0, s * 55], 0, "ficha"));
  add("traseira", "Painel traseiro", "mid", [X / 2 - t / 2, 0, 0], [t, Y - 2 * t, Z - 2 * t], [45, 0, 0], 0, "ficha");
  add("tomada", "Tomada de energia", "escuro", [X / 2 + 0.1, -Y * 0.15, -Z * 0.28], [0.2, 20 * k, 28 * k], [45, 0, 0], 0);
  add("chave", "Chave liga/desliga", "lit", [X / 2 + 0.1, Y * 0.2, -Z * 0.28], [0.2, 10 * k, 14 * k], [45, 0, 0], 0);
  for (let i = 0; i < 5; i++) add(`grade-${i}`, "Grade de ventilação", "escuro", [X / 2 + 0.1, (i - 2) * Y * 0.16, Z * 0.15], [0.2, 5 * k, Z * 0.42], [45, 0, 0], 0);
  add("frente", "Painel dos cabos", "mid", [-X / 2 + t / 2, 0, 0], [t, Y - 2 * t, Z - 2 * t], [-45, 0, 0], 0, "ficha");
  const cabos = Math.max(3, Object.values(specs.conectores ?? {}).reduce((a: number, n) => a + Number(n), 0) + 3);
  for (let i = 0; i < Math.min(8, cabos); i++)
    add(`saida-${i}`, "Saída de cabo", "escuro", [-X / 2 - 0.1, (i % 2 ? -1 : 1) * Y * 0.18, (Math.floor(i / 2) - 1.5) * Z * 0.2], [0.2, 9 * k, 16 * k], [-45, 0, 0], 0);
  add("etiqueta", `Etiqueta (${specs.potencia_w ?? "?"} W, ${specs.certificacao ?? "sem selo"})`, "lit", [0, 0, Z / 2 + 0.1], [X * 0.5, Y * 0.5, 0.2], [0, 0, 55], 0, "ficha");

  // Fan na chapa de baixo
  const r = Math.min(58, X / 2 - 10, Z / 2 - 10), fanT = 25 * ky;
  add("base", "Chapa do fan", "lo", [0, -Y / 2 + t / 2, 0], [X, t, Z], [0, -40, 0], 3, "ficha", { tipo: "placa", furos: [{ x: 0, z: 0, r: r + 2 }] });
  add("fan", `Fan ${Math.round(2 * r + 4)} mm`, "hi", [0, -Y / 2 + fanT / 2, 0], [2 * r, fanT, 2 * r], [0, -72, 0], 4, "estimado", { tipo: "fan", raio: r, pas: 9 });

  // Eletrônica pendurada no PCB, que fica junto da tampa
  const yp = Y / 2 - t - 3;   // face de baixo do PCB
  add("pcb", "PCB", "pcb", [0, yp + 0.8, 0], [X - 8, 1.6, Z - 8], [0, 0, 0], 2);
  const pend = (id: string, nome: string, tom: "cobre" | "metal" | "escuro" | "mid", x: number, z: number, w: number, h: number, p: number, forma?: Sub["forma"]) =>
    add(id, nome, tom, [x * kx, yp - (h * k) / 2, z * kz], [w * k, h * k, p * k], [0, 0, 0], 2, "estimado", forma);
  pend("trafo", "Transformador principal", "cobre", 5, -25, 30, 30, 30);
  pend("trafo-aux", "Transformador auxiliar", "cobre", 30, 10, 16, 20, 16);
  [-35, -10].forEach((z, i) => pend(`cap-${i}`, "Capacitor principal", "escuro", 45, z, 22, 40, 22, { tipo: "cilindro", raio: 11 * k }));
  pend("bobina", "Bobina (PFC)", "cobre", 45, 35, 18, 14, 18, { tipo: "cilindro", raio: 9 * k });
  pend("diss-a", "Dissipador", "metal", -35, -35, 50, 34, 10, { tipo: "aletas", n: 12, passo: 4 * k, esp: 1.2 * k });
  pend("diss-b", "Dissipador", "metal", -20, 30, 70, 34, 10, { tipo: "aletas", n: 17, passo: 4 * k, esp: 1.2 * k });

  return { tam: [X, Y, Z], partes, estimados: ["eletrônica", "fan"], ancoras: { base: [0, -Y / 2, 0] } };
}

/** Gabinete torre: pés, cinco chapas, lateral de vidro, fans inclusos e cobertura da fonte. */
export function gabineteModelo(specs: Record<string, any>, passagens: { x: number; z: number }[] = []): Modelo {
  const d = specs.dimensoes ?? { c: 450, a: 460, l: 230 };
  const [C, A, L]: Vec3 = [d.c, d.a, d.l];
  const partes: Sub[] = [], add = montador(partes);
  const t = 1.5, PE = 12, FAN = 25;
  const yBase = -A / 2 + PE, alt = A - PE - 2 * t, yMeio = yBase + t + alt / 2;

  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) =>
    add(`pe-${i}`, "Pé", "escuro", [sx * (C / 2 - 30), -A / 2 + PE / 2, sz * (L / 2 - 20)], [24, PE, 24], [0, -30, 0], 5));
  add("fundo", "Fundo", "lo", [0, yBase + t / 2, 0], [C, t, L], [0, -30, 0], 5, "ficha");
  const furos = C >= 300 && L >= 125 ? [-65, 65].map((x) => ({ x, z: 0, r: 58 })) : [];
  add("topo", "Topo ventilado", "lo", [0, A / 2 - t / 2, 0], [C, t, L], [0, 90, 0], 1, "ficha", { tipo: "placa", furos });
  add("botao", "Botão de ligar", "lit", [-C / 2 + 25, A / 2 + 0.2, L / 2 - 20], [10, 0.4, 10], [0, 90, 0], 1, "estimado", { tipo: "cilindro", raio: 5 });
  [45, 62].forEach((x, i) => add(`usb-${i}`, "USB frontal", "escuro", [-C / 2 + x, A / 2 + 0.1, L / 2 - 20], [12, 0.2, 5], [0, 90, 0], 1));

  add("traseira", "Painel traseiro", "mid", [C / 2 - t / 2, yMeio, 0], [t, alt, L], [100, 0, 0], 2, "ficha");
  // recortes na traseira, alinhados com a placa-mãe (topo a 30 mm) e a fonte (20 mm do chão); só entram se não se pisarem
  const fonteTopo = -A / 2 + 20 + 86 + 4, zMb = -L / 2 + 25;
  add("recorte-fonte", "Recorte da fonte", "escuro", [C / 2 + 0.1, -A / 2 + 20 + 43, 0], [0.2, 80, Math.min(L - 20, 140)], [100, 0, 0], 2);
  const ioBaixo = A / 2 - 30 - 14 - 150;
  if (ioBaixo > fonteTopo) add("recorte-io", "Recorte do painel de portas", "escuro", [C / 2 + 0.1, ioBaixo + 75, zMb + 22], [0.2, 150, 42], [100, 0, 0], 2);
  for (let i = 0, y = ioBaixo - 16; i < 7 && y - 7 > fonteTopo; i++, y -= 20.32)
    add(`slot-${i}`, "Tampa de slot PCIe", "escuro", [C / 2 + 0.1, y, zMb + 62], [0.2, 14, 100], [100, 0, 0], 2, "norma");

  add("frente", "Painel frontal", "mid", [-C / 2 + t / 2, yMeio, 0], [t, alt, L], [-100, 0, 0], 2, "ficha");
  add("bandeja", "Lateral e bandeja da placa-mãe", "lo", [0, yMeio, -L / 2 + t / 2], [C - 2 * t, alt, t], [0, 0, -90], 4, "ficha");
  add("vidro", "Lateral de vidro", "vidro", [0, yMeio, L / 2 - t / 2], [C - 2 * t, alt, t], [0, 0, 120], 0);

  // Fans inclusos: um na traseira, o resto na frente
  const n: number = specs.fans_inclusos ?? 0, r = Math.min(58, L / 2 - 6);
  const fan = (id: string, nome: string, x: number, y: number, sai: number) =>
    add(id, nome, "hi", [x, y, 0], [FAN, 2 * r, 2 * r], [sai, 0, 0], 3, "ficha", { tipo: "fan", raio: r, pas: 9, eixo: "x" });
  if (n >= 1) fan("fan-traseiro", "Fan traseiro", C / 2 - t - FAN / 2, A / 2 - 100, 55);
  const frente = Math.min(3, n - 1, Math.floor((alt - 10) / 125));
  for (let i = 0; i < frente; i++) fan(`fan-frontal-${i}`, `Fan frontal ${i + 1}`, -C / 2 + t + FAN / 2, yMeio + (i - (frente - 1) / 2) * 125, -55);

  if (A >= 400) {
    // cobertura da fonte, com um passa-cabo redondo onde cada cabo sobe
    const cx = (FAN + 2) / 2, w = C - 2 * t - FAN - 2, p = L - 2 * t, R = 7;
    const furos = passagens.filter((f) => Math.abs(f.x - cx) < w / 2 - R - 1 && Math.abs(f.z) < p / 2 - R - 1).map((f) => ({ ...f, r: R }));
    add("cobertura", "Cobertura da fonte", "lo", [cx, fonteTopo + 8, 0], [w, t, p], [0, 0, 0], 4, "estimado", { tipo: "placa", furos });
  }

  return { tam: [C, A, L], partes, estimados: ["recortes", "vidro"], ancoras: { piso: [0, yBase + t, 0] } };
}
