// Fonte e gabinete procedurais. Referencial local dos dois: x = profundidade (traseira em +x), y = altura, z = largura.
// A ficha da fonte segue a norma ATX: `c` (150) é a largura, que fica em z; `l` (140) é a profundidade, em x.
import type { Vec3 } from "./cena";
import { type Fonte, type Modelo, type Sub, montador } from "./peca";

/** Fonte ATX/SFX com o fan para baixo: tampa, PCB pendurado com os componentes, fan na chapa de baixo. */
export function fonteModelo(specs: Record<string, any>): Modelo {
  const d = specs.dimensoes ?? { c: 150, a: 86, l: 140 };
  const [X, Y, Z]: Vec3 = [d.l, d.a, d.c];
  const kx = X / 140, ky = Y / 86, kz = Z / 150, k = Math.min(kx, ky, kz);
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
  const ancoras: Record<string, Vec3> = { base: [0, -Y / 2, 0] };
  for (let i = 0; i < Math.min(8, cabos); i++) {
    const y = (i % 2 ? -1 : 1) * Y * 0.18, z = (Math.floor(i / 2) - 1.5) * Z * 0.2;
    add(`saida-${i}`, "Saída de cabo", "escuro", [-X / 2 - 0.1, y, z], [0.2, 9 * k, 16 * k], [-45, 0, 0], 0);
    ancoras[`saida${i}`] = [-X / 2, y, z];   // centro da saída, na face dos cabos
  }
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

  return { tam: [X, Y, Z], partes, estimados: ["eletrônica", "fan"], ancoras };
}

/**
 * Gabinete torre: pés, cinco chapas, lateral, filtros, fans, gaiola de discos e cobertura da fonte.
 * Ficha opcional: `posicoes_fan` {frente, topo, traseira}, `lateral` ("vidro" | "chapa") e `baias` {"2.5", "3.5"}.
 * `ocultar`: ids (ou prefixos de id, até o hífen) de subpeças que a build dispensa: fans no lugar do radiador, tampas de slot da GPU.
 */
export function gabineteModelo(specs: Record<string, any>, passagens: { x: number; z: number }[] = [], ocultar: string[] = []): Modelo {
  const d = specs.dimensoes ?? { c: 450, a: 460, l: 230 };
  const [C, A, L]: Vec3 = [d.c, d.a, d.l];
  const partes: Sub[] = [], add = montador(partes);
  const t = 1.5, PE = 12, FAN = 25, FILTRO = 1;
  const yBase = -A / 2 + PE, alt = A - PE - 2 * t, yMeio = yBase + t + alt / 2;
  const estimados = ["recortes"];
  const ancoras: Record<string, Vec3> = { piso: [0, yBase + t, 0] };

  // Posições de fan: da ficha, ou a estimativa (uma atrás, até três na frente, duas no topo); nunca mais do que cabe
  const pos: Record<string, number> | undefined = specs.posicoes_fan;
  const r = Math.min(58, L / 2 - 6);
  const nTras = pos ? Math.min(1, pos.traseira ?? 0) : 1;
  const nFrente = Math.min(pos ? pos.frente ?? 0 : 3, Math.floor((alt - 10) / 125));
  const nTopo = L < 125 ? 0 : pos ? Math.min(pos.topo ?? 0, Math.floor((C - 60) / 130)) : C >= 300 ? 2 : 0;
  const xTopo = Array.from({ length: nTopo }, (_, i) => (i - (nTopo - 1) / 2) * 130);
  const xFrente = -C / 2 + t + FILTRO;   // face interna da frente, depois do filtro: onde fans e radiador encostam

  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) =>
    add(`pe-${i}`, "Pé", "escuro", [sx * (C / 2 - 30), -A / 2 + PE / 2, sz * (L / 2 - 20)], [24, PE, 24], [0, -30, 0], 5));
  add("fundo", "Fundo", "lo", [0, yBase + t / 2, 0], [C, t, L], [0, -30, 0], 5, "ficha");
  add("topo", "Topo ventilado", "lo", [0, A / 2 - t / 2, 0], [C, t, L], [0, 90, 0], 1, "ficha", { tipo: "placa", furos: xTopo.map((x) => ({ x, z: 0, r: 58 })) });
  if (nTopo) {
    const w = (nTopo - 1) * 130 + 124, p = Math.min(124, L - 52);   // malha magnética sobre os furos, sem pisar no botão e nos USB
    add("filtro-topo", "Filtro de poeira do topo", "escuro", [0, A / 2 + 0.2, 0], [w, 0.4, p], [0, 125, 0], 0, "estimado", { tipo: "grade", n: [Math.round(w / 7), 1, Math.round(p / 7)], cheio: 0.5 });
  }
  add("botao", "Botão de ligar", "lit", [-C / 2 + 25, A / 2 + 0.2, L / 2 - 20], [10, 0.4, 10], [0, 90, 0], 1, "estimado", { tipo: "cilindro", raio: 5 });
  [45, 62].forEach((x, i) => add(`usb-${i}`, "USB frontal", "escuro", [-C / 2 + x, A / 2 + 0.1, L / 2 - 20], [12, 0.2, 5], [0, 90, 0], 1));
  ancoras.painel_io = [-C / 2 + 45, A / 2 - t, L / 2 - 20];   // os cabos do painel saem por baixo do botão e dos USB
  ancoras.radiador_topo = [0, A / 2 - t, 0];

  add("traseira", "Painel traseiro", "mid", [C / 2 - t / 2, yMeio, 0], [t, alt, L], [100, 0, 0], 2, "ficha");
  // recortes na traseira, alinhados com a placa-mãe (topo a 30 mm) e a fonte (20 mm do chão); só entram se não se pisarem
  const fonteTopo = -A / 2 + 20 + 86 + 4, zMb = -L / 2 + 25;
  add("recorte-fonte", "Recorte da fonte", "escuro", [C / 2 + 0.1, -A / 2 + 20 + 43, 0], [0.2, 80, Math.min(L - 20, 150)], [100, 0, 0], 2);
  const ioBaixo = A / 2 - 30 - 14 - 150;
  if (ioBaixo > fonteTopo) add("recorte-io", "Recorte do painel de portas", "escuro", [C / 2 + 0.1, ioBaixo + 75, zMb + 22], [0.2, 150, 42], [100, 0, 0], 2);
  for (let i = 0, y = ioBaixo - 16; i < 7 && y - 7 > fonteTopo; i++, y -= 20.32) {   // tampas de slot: chapa com a fresta de ventilação
    add(`slot-${i}`, "Tampa de slot PCIe", "metal", [C / 2 + 0.1, y, zMb + 62], [0.2, 14, 100], [100, 0, 0], 2, "norma");
    add(`slot-${i}-vent`, "Ventilação da tampa de slot", "escuro", [C / 2 + 0.3, y, zMb + 62], [0.2, 7, 84], [100, 0, 0], 2, "estimado", { tipo: "grade", n: [1, 1, 12], cheio: 0.6 });
  }

  // Frente: chapa, entrada de ar em frestas por fora e filtro de poeira por dentro
  add("frente", "Painel frontal", "mid", [-C / 2 + t / 2, yMeio, 0], [t, alt, L], [-100, 0, 0], 2, "ficha");
  add("entrada-ar", "Entrada de ar frontal", "escuro", [-C / 2 - 0.1, yMeio, 0], [0.2, alt * 0.8, L * 0.6], [-100, 0, 0], 2, "estimado", { tipo: "grade", n: [1, Math.round((alt * 0.8) / 14), 1], cheio: 0.55 });
  const pFiltro = Math.min(L - 2 * t - 4, 2 * r + 8);
  add("filtro-frente", "Filtro de poeira frontal", "escuro", [xFrente - FILTRO / 2, yMeio, 0], [FILTRO, alt * 0.8, pFiltro], [-78, 0, 0], 2, "estimado", { tipo: "grade", n: [1, Math.round((alt * 0.8) / 7), Math.round(pFiltro / 7)], cheio: 0.5 });
  ancoras.radiador_frente = [xFrente, yMeio, 0];

  add("bandeja", "Lateral e bandeja da placa-mãe", "lo", [0, yMeio, -L / 2 + t / 2], [C - 2 * t, alt, t], [0, 0, -90], 4, "ficha");
  // Lateral: vidro (estimado se a ficha não diz) ou chapa, desenhada em corte (só a moldura) para o interior continuar visível
  const fLateral: Fonte = specs.lateral ? "ficha" : "estimado", zLat = L / 2 - t / 2, wLat = C - 2 * t, B = 18;
  if (!specs.lateral) estimados.push("vidro");
  if (specs.lateral !== "chapa") add("vidro", "Lateral de vidro", "vidro", [0, yMeio, zLat], [wLat, alt, t], [0, 0, 120], 0, fLateral);
  else [-1, 1].forEach((s, i) => {
    add(`lateral-chapa-${i}`, "Lateral de chapa (em corte)", "lo", [0, yMeio + s * (alt / 2 - B / 2), zLat], [wLat, B, t], [0, 0, 120], 0, fLateral);
    add(`lateral-chapa-${i + 2}`, "Lateral de chapa (em corte)", "lo", [s * (wLat / 2 - B / 2), yMeio, zLat], [B, alt - 2 * B, t], [0, 0, 120], 0, fLateral);
  });

  // Fans inclusos ocupam as posições nesta ordem: traseira, frente (de baixo para cima), topo. Cada posição tem sua âncora.
  const vagas: { ancora: string; id: string; nome: string; p: Vec3; sai: Vec3 }[] = [];
  if (nTras) vagas.push({ ancora: "fan_traseiro", id: "fan-traseiro", nome: "Fan traseiro", p: [C / 2 - t - FAN / 2, A / 2 - 100, 0], sai: [55, 0, 0] });
  for (let i = 0; i < nFrente; i++)
    vagas.push({ ancora: `fan_frontal_${i}`, id: `fan-frontal-${i}`, nome: `Fan frontal ${i + 1}`, p: [xFrente + FAN / 2, yMeio + (i - (nFrente - 1) / 2) * 125, 0], sai: [-55, 0, 0] });
  xTopo.forEach((x, i) => vagas.push({ ancora: `fan_topo_${i}`, id: `fan-topo-${i}`, nome: `Fan do topo ${i + 1}`, p: [x, A / 2 - t - FAN / 2, 0], sai: [0, 55, 0] }));
  vagas.forEach((v, i) => {
    ancoras[v.ancora] = v.p;
    if (i >= (specs.fans_inclusos ?? 0)) return;
    const emY = v.sai[1] !== 0;
    add(v.id, v.nome, "hi", v.p, emY ? [2 * r, FAN, 2 * r] : [FAN, 2 * r, 2 * r], v.sai, 3, "ficha", { tipo: "fan", raio: r, pas: 9, eixo: emY ? "y" : "x" });
  });

  // Gaiola de discos na frente-baixo, atrás dos fans e sob a cobertura: uma bandeja por baia, 3,5" embaixo e 2,5" em cima.
  // O disco deita com o comprimento em x e os conectores para a traseira; a âncora é o centro do piso da baia.
  const baias: Record<string, number> | undefined = specs.baias, fBaia: Fonte = baias ? "ficha" : "estimado";
  if (!baias) estimados.push("baias");
  const gx = xFrente + FAN + 6 + 75, teto = fonteTopo + 8 - t;
  let y = yBase + t;
  for (const [k, pre, passo, nome] of [["3.5", "baia35", 30, 'Baia de 3,5"'], ["2.5", "baia25", 11, 'Baia de 2,5"']] as const)
    for (let i = 0; i < (baias ? baias[k] ?? 0 : 2) && y + passo <= teto; i++, y += passo) {   // ponytail: uma coluna só; baia que não cabe sob a cobertura não é desenhada
      add(`${pre}-${i}`, nome, "mid", [gx, y + 0.5, 0], [150, 1, 105], [0, -30, 0], 5, fBaia);
      ancoras[`${pre}_${i}`] = [gx, y + 1, 0];
    }
  const hGaiola = y - (yBase + t);
  if (hGaiola > 0) [-1, 1].forEach((s) => add(`gaiola${s}`, "Gaiola de discos", "lo", [gx, yBase + t + hGaiola / 2, s * 53], [150, hGaiola, 1], [0, -30, 0], 5, fBaia));

  if (A >= 400) {
    // cobertura da fonte, com um passa-cabo redondo onde cada cabo sobe
    const cx = (FAN + 2) / 2, w = C - 2 * t - FAN - 2, p = L - 2 * t, R = 7;
    const furos = passagens.filter((f) => Math.abs(f.x - cx) < w / 2 - R - 1 && Math.abs(f.z) < p / 2 - R - 1).map((f) => ({ ...f, r: R }));
    add("cobertura", "Cobertura da fonte", "lo", [cx, fonteTopo + 8, 0], [w, t, p], [0, 0, 0], 4, "estimado", { tipo: "placa", furos });
  }

  return { tam: [C, A, L], partes: partes.filter((p) => !ocultar.some((o) => p.id === o || p.id.startsWith(`${o}-`))), estimados, ancoras };
}
