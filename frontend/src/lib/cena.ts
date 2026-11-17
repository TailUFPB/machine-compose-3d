// Layout paramétrico da cena 3D: cada peça vira uma caixa dimensionada pela ficha técnica (mm).
// Eixos: X = profundidade (frente -X, traseira +X), Y = altura, Z = largura (lado da placa-mãe em -Z).
import { aioBlocoModelo, aioRadiadorModelo } from "./aio";
import type { Cena, Tipo } from "./api";
import { coolerModelo, cpuModelo } from "./cpu";
import { discoModelo } from "./disco";
import { fonteModelo, gabineteModelo } from "./gabinete";
import { gpuModelo } from "./gpu";
import type { Modelo } from "./peca";
import { DIMM_PASSO, placaMaeModelo } from "./placa";
import { ramModelo } from "./ram";
import { ssdModelo } from "./ssd";

export type Vec3 = [number, number, number];
/**
 * Uma peça posicionada na cena. `id` é o da peça na build (conflitos e legenda usam esse); `chave` é única por caixa,
 * porque uma peça pode ocupar mais de um lugar (water cooler: bloco e radiador). `instala` é o deslocamento, em mm,
 * com que a peça sai do lugar na build explodida. `origem` é campo da ficha → URL.
 * `rot`: rotação do modelo em torno do centro da caixa (Euler em radianos, ordem XYZ como no three.js, só múltiplos
 * de 90°). `pos` e `tam` já estão no mundo (envelope girado); só as subpeças do `modelo` precisam ser giradas.
 */
export interface Caixa {
  id: string; chave: string; tipo: Tipo; nome: string; pos: Vec3; tam: Vec3; cor: string; conflito: boolean; passo: number;
  specs: Record<string, any>; modelo?: Modelo; instala: Vec3; origem: Record<string, string>; rot?: Vec3;
}

const MARGEM = 30, FOLGA = 25;   // FOLGA: distância entre as peças (e delas ao gabinete) na build explodida
const COR: Partial<Record<Tipo, string>> = {
  gabinete: "#8892a6", placa_mae: "#3f8a63", cpu: "#c9ccd1", cooler: "#5b7fbf", memoria: "#a3afc2",
  gpu: "#7d8aa0", fonte: "#8e98aa", armazenamento: "#1f8a70",
};
const soma = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const menos = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Gira `v` por `rot` (Euler XYZ do three.js: aplica Z, depois Y, depois X). Só múltiplos de 90°. */
export function girar(v: Vec3, rot?: Vec3): Vec3 {
  if (!rot) return v;
  const cs = (a: number) => [Math.round(Math.cos(a)), Math.round(Math.sin(a))];
  let [x, y, z] = v, [c, s] = cs(rot[2]);
  [x, y] = [x * c - y * s, x * s + y * c];
  [c, s] = cs(rot[1]); [x, z] = [x * c + z * s, z * c - x * s];
  [c, s] = cs(rot[0]); [y, z] = [y * c - z * s, y * s + z * c];
  return [x + 0, y + 0, z + 0];   // + 0: sem zero negativo
}
/** Ponto do referencial local de uma caixa (âncora, centro de subpeça) no mundo. */
export const noMundo = (c: Pick<Caixa, "pos" | "rot">, p: Vec3): Vec3 => soma(c.pos, girar(p, c.rot));
/** Formato do disco pela ficha: `formato`, ou a interface (SATA sem formato é 2,5"). */
const formato = (specs: Record<string, any>): string => String(specs.formato ?? (specs.interface === "SATA" ? "2.5" : "M.2"));
const ehRadiador = (c: Caixa) => c.chave.endsWith(":radiador");

export function montarCena(cena: Cena): Caixa[] {
  const por = (t: Tipo) => cena.pecas.find((p) => p.tipo === t);
  const emConflito = new Set(cena.conflitos.flatMap((c) => c.itens));
  const ordem = cena.passos.map((p) => p.tipo);
  const caixas: Caixa[] = [];
  const add = (p: Cena["pecas"][number], pos: Vec3, tam: Vec3, modelo?: Modelo, extra: Partial<Caixa> = {}) =>
    caixas.push({ ...p, chave: p.id, instala: [0, 0, 0], origem: p.origem ?? {}, pos, tam, modelo, cor: COR[p.tipo] ?? "#888", conflito: emConflito.has(p.id), passo: Math.max(0, ordem.indexOf(p.tipo)), ...extra });
  /** Posição que faz a âncora `a` do modelo coincidir com o ponto `alvo` do mundo. */
  const sobre = (alvo: Vec3, m: Modelo, a: string, rot?: Vec3): Vec3 => menos(alvo, girar(m.ancoras[a], rot));

  const gab = por("gabinete");
  const gabM = gabineteModelo(gab?.specs ?? {});   // o gabinete fica na origem: as âncoras dele já estão no mundo
  const [C, A, L] = gabM.tam;
  if (gab) add(gab, [0, 0, 0], [C, A, L], gabM);

  // A placa-mãe dá as âncoras; cada peça é posicionada fazendo a âncora dela coincidir com a da placa.
  const mbP = por("placa_mae");
  const mb = placaMaeModelo(mbP?.specs ?? {});
  const [mbW, mbH, mbT] = mb.tam;
  const mbX = C / 2 - MARGEM - mbW / 2;
  const mbY = A / 2 - MARGEM - mbH / 2;
  const mbZ = -L / 2 + 25;                              // face de cima do PCB fica em mbZ - 0,4
  const mbPos: Vec3 = [mbX, mbY, mbZ - 2 + mbT / 2];
  const em = (a: string): Vec3 => soma(mbPos, mb.ancoras[a]);
  if (mbP) add(mbP, mbPos, mb.tam, mb);

  const cpu = por("cpu");
  const cpuM = cpuModelo(cpu?.specs ?? {});
  const cpuPos = sobre(em("cpu"), cpuM, "base");
  if (cpu) add(cpu, cpuPos, cpuM.tam, cpuM);

  const cooler = por("cooler"), aio = cooler?.specs.refrigeracao === "aio";
  if (cooler) {   // base (do cooler a ar ou do bloco do water cooler) apoiada na tampa da CPU
    const m = aio ? aioBlocoModelo(cooler.specs) : coolerModelo(cooler.specs);
    add(cooler, sobre(soma(cpuPos, cpuM.ancoras.topo), m, "base"), m.tam, m);
  }

  const ram = por("memoria");
  if (ram) {
    // 2 módulos em placa de 4 slots vão no 2º e no 4º (canal duplo); senão, lado a lado a partir do 1º
    const slots = mbP?.specs.slots_ram ?? 4, n = ram.specs.modulos ?? 2;
    const alternado = slots >= 4 && n <= 2;
    const m = ramModelo(ram.specs, DIMM_PASSO * (alternado ? 2 : 1));
    const d0 = em("dimm0"), meio = (alternado ? 1 : 0) + (alternado ? 2 : 1) * (n - 1) / 2;
    add(ram, [d0[0] - meio * DIMM_PASSO, d0[1], d0[2] - m.ancoras.pente[2]], m.tam, m);
  }

  // Armazenamento: o primeiro M.2 vai no slot da placa-mãe; discos SATA, cada um na próxima baia do seu tamanho.
  // ponytail: a placa desenhada tem um slot M.2 só e o gabinete, as baias da ficha; o que sobra fica fora da cena.
  const usadas: Record<string, number> = {};
  for (const d of cena.pecas.filter((p) => p.tipo === "armazenamento")) {
    const f = formato(d.specs), sata = f === "2.5" || f === "3.5";
    const n = usadas[f] = (usadas[f] ?? -1) + 1;
    const baia = gabM.ancoras[`baia${f === "3.5" ? 35 : 25}_${n}`];
    if (sata && baia) { const m = discoModelo({ ...d.specs, formato: f }); add(d, sobre(baia, m, "base"), m.tam, m); }
    else if (!sata && n === 0) { const m = ssdModelo(d.specs); add(d, em("m2"), m.tam, m); }
  }

  const gpu = por("gpu");
  if (gpu) {
    // Deitada no slot: comprimento em X, espessura (slots) para baixo em Y, altura para fora da placa-mãe em Z.
    const m = gpuModelo(gpu.specs), slot = em("pcie");
    add(gpu, [C / 2 - MARGEM - m.tam[0] / 2, slot[1] - m.ancoras.pcie[1], slot[2] - m.ancoras.pcie[2]], m.tam, m);
  }

  const psu = por("fonte");
  if (psu) {
    const m = fonteModelo(psu.specs), [pc, pa] = m.tam;   // encostada na traseira, 20 mm acima do chão
    add(psu, [C / 2 - 2 - pc / 2, -A / 2 + 20 + pa / 2, 0], m.tam, m);
  }

  // Radiador do water cooler: a face encosta no painel da frente (bocais para cima) ou do topo (bocais para a traseira).
  const noTopo = cooler?.specs.radiador_posicao === "topo";
  if (cooler && aio) {
    const m = aioRadiadorModelo(cooler.specs), rot: Vec3 = noTopo ? [Math.PI, 0, Math.PI / 2] : [Math.PI, 0, 0];
    const tam = girar(m.tam, rot).map(Math.abs) as Vec3, pos = sobre(gabM.ancoras[noTopo ? "radiador_topo" : "radiador_frente"], m, "face", rot);
    if (noTopo) {   // o topo é mais largo que o radiador: ele vai para o lado do vidro o que for preciso para livrar a placa-mãe e a memória
      const livre = Math.max(-Infinity, ...caixas.filter((c) => c.tipo !== "gabinete" && [0, 1].every((k) => Math.abs(c.pos[k] - pos[k]) < (c.tam[k] + tam[k]) / 2)).map((c) => c.pos[2] + c.tam[2] / 2));
      pos[2] = Math.max(pos[2], Math.min(livre + 8 + tam[2] / 2, L / 2 - 1.5 - tam[2] / 2));
    }
    add(cooler, pos, tam, m, { chave: `${cooler.id}:radiador`, rot });
  }

  // Build explodida: cada peça sai inteira do gabinete pela face por onde é instalada. O que vai na placa-mãe sai pelo
  // lado do vidro (+Z), empilhado na ordem de montagem (o último a entrar fica mais longe); fonte pela traseira, discos
  // pelo lado da bandeja, radiador pela frente ou pelo topo.
  let z = L / 2 + FOLGA;
  for (const t of ["placa_mae", "cpu", "memoria", "armazenamento", "cooler", "gpu"] as Tipo[])
    for (const c of caixas.filter((c) => c.tipo === t && !ehRadiador(c) && !c.modelo?.ancoras.dados)) {
      c.instala = [0, 0, z - (c.pos[2] - c.tam[2] / 2)];
      z += c.tam[2] + FOLGA;
    }
  for (const c of caixas) {
    if (c.tipo === "fonte") c.instala = [C / 2 + FOLGA - (c.pos[0] - c.tam[0] / 2), 0, 0];
    else if (c.modelo?.ancoras.dados) c.instala = [0, 0, -L / 2 - FOLGA - (c.pos[2] + c.tam[2] / 2)];
    else if (ehRadiador(c)) c.instala = noTopo ? [0, A / 2 + FOLGA - (c.pos[1] - c.tam[1] / 2), 0] : [-C / 2 - FOLGA - (c.pos[0] + c.tam[0] / 2), 0, 0];
  }

  const gabCaixa = caixas[0]?.tipo === "gabinete" ? caixas[0] : undefined;
  if (gabCaixa) {
    // o radiador substitui os fans do gabinete na face dele; a GPU tira as tampas dos slots que ocupa
    const g = caixas.find((c) => c.tipo === "gpu");
    const ocultar = [...(aio ? [noTopo ? "fan-topo" : "fan-frontal"] : []),
      ...gabM.partes.filter((s) => g && /^slot-\d$/.test(s.id) && Math.abs(s.pos[1] - g.pos[1]) < g.tam[1] / 2).map((s) => s.id)];
    gabCaixa.modelo = gabineteModelo(gabCaixa.specs, [], ocultar);
    // os cabos definem onde a cobertura da fonte precisa de passa-cabo
    gabCaixa.modelo = gabineteModelo(gabCaixa.specs, montarCabos(caixas).flatMap((c) => (c.passagem ? [c.passagem] : [])), ocultar);
  }
  return caixas;
}

/**
 * `de`/`para` são `id` de peça. `plugues` são as caixas desenhadas nas pontas (centro e tamanho, no mundo), a primeira
 * na ponta de `de`. `passo` é o índice do passo do tutorial em que o cabo é ligado. `tipo` "mangueira" é a do water cooler.
 */
export interface Cabo {
  id: string; nome: string; pontos: Vec3[]; raio: number; de: string; para: string; passagem?: { x: number; z: number };
  tipo?: "cabo" | "mangueira"; plugues?: { pos: Vec3; tam: Vec3 }[]; passo?: number;
}

const PLUGUE = 8;   // comprimento do plugue ao longo do cabo
/** Ponta de cabo: ponto no mundo e envelope do conector (a seção do plugue sai dele). */
type Ponta = { p: Vec3; tam: Vec3 };
/** Plugue: tem a seção do conector e se estende da ponta para o lado de onde o cabo vem. */
function plugue({ p, tam }: Ponta, vizinho: Vec3): { pos: Vec3; tam: Vec3 } {
  const d = menos(vizinho, p), e = [1, 2].reduce((m, k) => (Math.abs(d[k]) > Math.abs(d[m]) ? k : m), 0);
  const pos: Vec3 = [...p], t: Vec3 = [...tam];
  pos[e] += (Math.sign(d[e]) || 1) * PLUGUE / 2;
  t[e] = PLUGUE;
  return { pos, tam: t };
}

/**
 * Cabos e mangueiras entre os conectores já posicionados. Energia: fonte → placa-mãe (ATX 24, EPS), GPU e discos, por
 * baixo da cobertura da fonte. Cabos finos (fans, painel frontal, dados SATA, bomba): pelo vão atrás da placa-mãe, até
 * a borda dela mais próxima do conector. Só entram no envelope de uma peça na chegada ao próprio conector.
 */
export function montarCabos(caixas: Caixa[]): Cabo[] {
  const de = (t: Tipo) => caixas.find((c) => c.tipo === t && c.modelo && !ehRadiador(c));
  /** Centro da face de uma subpeça no mundo (eixo e sentido da face, no referencial local) e o envelope dela. */
  const face = (c: Caixa, id: string, eixo: 0 | 1 | 2, sentido: 1 | -1): Ponta | null => {
    const s = c.modelo!.partes.find((s) => s.id === id);
    if (!s) return null;
    const v: Vec3 = [...s.pos];
    v[eixo] += (sentido * s.tam[eixo]) / 2;
    return { p: noMundo(c, v), tam: girar(s.tam, c.rot).map(Math.abs) as Vec3 };
  };
  const gab = caixas.find((c) => c.tipo === "gabinete"), psu = de("fonte"), mb = de("placa_mae"), gpu = de("gpu"), cooler = de("cooler");
  const rad = caixas.find((c) => ehRadiador(c) && c.modelo), discos = caixas.filter((c) => c.modelo?.ancoras.dados);
  const cabos: Cabo[] = [];
  const [C, A, L] = gab?.tam ?? [450, 460, 230];
  const zAtras = -L / 2 + 10, zFino = zAtras + 7;   // vão entre a bandeja e o verso da placa-mãe: energia e, mais perto da placa, cabos finos
  const cabo = (id: string, nome: string, a: Caixa, b: Caixa, ini: Ponta, fim: Ponta, meio: Vec3[], extra: Partial<Cabo> = {}) =>
    cabos.push({ id, nome, tipo: "cabo", raio: 1.2, de: a.id, para: b.id, pontos: [ini.p, ...meio, fim.p], passo: Math.max(a.passo, b.passo),
      plugues: [plugue(ini, meio[0] ?? fim.p), plugue(fim, meio.at(-1) ?? ini.p)], ...extra });

  if (psu) {
    const yRun = psu.pos[1] + psu.tam[1] / 2 + 6;   // corre entre o topo da fonte e a cobertura
    const nSaidas = psu.modelo!.partes.filter((s) => /^saida-\d$/.test(s.id)).length;
    let saida = 0;
    const proxima = () => face(psu, `saida-${Math.min(saida++, nSaidas - 1)}`, 0, -1);   // acabaram as saídas: divide a última
    /** Sai da fonte, corre por cima dela até (x, z), sobe pelo passa-cabo e chega ao conector por `chegada`. */
    const energia = (id: string, nome: string, para: Caixa, x: number, z: number, fim: Ponta, chegada: Vec3[]) => {
      const s = proxima();
      if (s) cabo(id, nome, psu, para, s, fim, [[s.p[0] - 25, s.p[1], s.p[2]], [s.p[0] - 25, yRun, s.p[2]], [x, yRun, z], ...chegada], { raio: 3.5, passagem: { x, z } });
    };
    const atx = mb && face(mb, "atx24", 2, 1);
    if (mb && atx) { const [x, y, z] = atx.p; energia("cabo-atx24", "Cabo ATX 24 pinos", mb, x - 20, zAtras, atx, [[x - 20, y, zAtras], [x - 20, y, z + 15], [x, y, z + 15]]); }
    const eps = mb && face(mb, "eps", 2, 1);
    if (mb && eps) {
      const [x, y, z] = eps.p, yTopo = mb.pos[1] + mb.tam[1] / 2 + 10;   // passa por cima da borda da placa
      energia("cabo-eps", "Cabo EPS 8 pinos (CPU)", mb, x, zAtras, eps, [[x, yTopo, zAtras], [x, yTopo, z + 15], [x, y, z + 15]]);
    }
    for (let i = 0; gpu; i++) {
      const g = face(gpu, `energia-${i}`, 2, 1);
      if (!g) break;
      const z = Math.min(g.p[2] + 20, L / 2 - 10);
      energia(`cabo-gpu-${i}`, "Cabo de energia da GPU", gpu, g.p[0], z, g, [[g.p[0], g.p[1], z]]);
    }
    // discos: um cabo SATA de energia com um plugue por disco (todos saem da mesma saída), pelo chão, sob a cobertura
    const s = discos.length ? proxima() : null;
    discos.forEach((d, i) => {
      const e = face(d, "sata-energia", 0, 1);
      if (s && e) cabo(`cabo-sata-energia-${i}`, "Cabo SATA de energia", psu, d, s, e, [[s.p[0] - 25, s.p[1], s.p[2]], [s.p[0] - 25, e.p[1], s.p[2]], [e.p[0] + 15, e.p[1], e.p[2]]], { raio: 2.5 });
    });
  }

  if (mb) {
    const filas = [0, 0];   // cada cabo fino corre numa linha própria ao longo da borda de cima ou de baixo da placa
    /** Cabo fino: `saida` leva da ponta até um ponto livre; dali vai ao vão atrás da placa, corre até a borda mais próxima do conector e entra por cima dele. */
    const fino = (id: string, nome: string, a: Caixa, ini: Ponta, saida: Vec3[], conector: string) => {
      const h = face(mb, conector, 2, 1);
      if (!h) return;
      const cima = h.p[1] > mb.pos[1], y = mb.pos[1] + (cima ? 1 : -1) * (mb.tam[1] / 2 + 5 + 2.2 * (filas[+cima]++ % 8));
      const u = saida.at(-1) ?? ini.p, [x, , z] = h.p;
      cabo(id, nome, a, mb, ini, h, [...saida, [u[0], u[1], zFino], [u[0], y, zFino], [x, y, zFino], [x, y, z + 12], [x, h.p[1], z + 12]]);
    };
    const sys = ["fan-sys0", "fan-sys1", "fan-sys2"].filter((id) => mb.modelo!.partes.some((s) => s.id === id));
    let nFan = 0;   // ponytail: fans além dos conectores dividem um conector (na prática, um divisor)
    const noSys = () => sys[nFan++ % sys.length];
    const SOLTA: Vec3 = [4, 4, 4];   // ponta presa à própria peça (fan, bomba, painel): só um terminal pequeno

    if (gab?.modelo && sys.length) for (const f of gab.modelo.partes.filter((s) => s.forma.tipo === "fan"))
      fino(`cabo-${f.id}`, `Cabo do ${f.nome.toLowerCase()}`, gab, { p: face(gab, f.id, 2, -1)!.p, tam: SOLTA }, [], noSys());
    if (gab?.modelo) {
      const io = gab.modelo.ancoras.painel_io;   // botão e USB do topo: cada cabo desce do seu ponto do painel
      ([["painel", "Cabo do painel frontal (botão e LEDs)", -20], ["usb2", "Cabo do USB frontal", -10], ["audio", "Cabo do áudio frontal", 0]] as const).forEach(([con, nome, dx]) =>
        fino(`cabo-${con}`, nome, gab, { p: [io[0] + dx, io[1], io[2]], tam: [8, 4, 5] }, [[io[0] + dx, io[1] - 8, io[2]]], con));
    }
    discos.slice(0, 2).forEach((d, i) => {   // ponytail: a placa desenhada tem duas portas SATA; do terceiro disco em diante, sem cabo de dados
      const s = face(d, "sata-dados", 0, 1), p = face(mb, i ? "sata1" : "sata-1", 0, -1);
      if (!s || !p) return;
      const x = s.p[0] + 30, xb = mb.pos[0] - mb.tam[0] / 2 - 10 - 6 * i;   // sobe atrás da bandeja e entra pela borda da frente da placa
      cabo(`cabo-sata-dados-${i}`, "Cabo SATA de dados", d, mb, s, p, [[x, s.p[1], s.p[2]], [x, s.p[1], zFino], [x, p.p[1], zFino], [xb, p.p[1], zFino], [xb, p.p[1], p.p[2]]],
        { raio: 2, passagem: { x, z: zFino } });
    });

    const hdr = cooler && face(mb, "fan-cpu", 2, 1);
    const fan = cooler && (face(cooler, "fan-0", 2, -1) ?? face(cooler, "bomba", 1, 1));   // water cooler: quem liga no conector da CPU é a bomba
    if (cooler && fan && hdr) {
      const bomba = cooler.specs.refrigeracao === "aio";
      cabo(bomba ? "cabo-bomba" : "cabo-fan-cpu", bomba ? "Cabo da bomba" : "Cabo do fan da CPU", cooler, mb, { p: fan.p, tam: SOLTA }, hdr, [[hdr.p[0], hdr.p[1], hdr.p[2] + 12]]);
    }
    if (rad && sys.length) for (let i = 0; ; i++) {
      const f = face(rad, `fan-${i}`, 2, 1);   // lado do fan virado para a bandeja
      if (!f) break;
      // no topo o fan fica abaixo da borda da placa: o cabo sobe rente ao radiador antes de ir para trás
      const saida: Vec3[] = rad.rot?.[2] ? [[f.p[0], f.p[1], f.p[2] - 4], [f.p[0], mb.pos[1] + mb.tam[1] / 2 + 5, f.p[2] - 4]] : [];
      fino(`cabo-fan-rad-${i}`, `Cabo do fan ${i + 1} do radiador`, rad, { p: f.p, tam: SOLTA }, saida, noSys());
    }
  }

  // Mangueiras do water cooler: saem do bloco para a traseira, sobem acima do que está na placa-mãe e chegam ao bocal do
  // radiador pela direção em que ele aponta (para cima, na frente; para a traseira, no topo). Cada uma no seu plano.
  if (cooler && rad) {
    const n = girar([0, -1, 0], rad.rot), e = n[0] ? 0 : 1;   // direção e eixo de saída dos bocais do radiador
    const zLivre = Math.max(...caixas.filter((c) => ["placa_mae", "memoria", "cooler"].includes(c.tipo) && !ehRadiador(c)).map((c) => c.pos[2] + c.tam[2] / 2)) + 10;
    const limite = [C / 2 - 8, A / 2 - 10][e];
    for (const k of [0, 1]) {
      const b = face(cooler, `bocal-${k}`, 0, 1), r = face(rad, `bocal-${1 - k}`, 1, -1);
      if (!b || !r) continue;
      const zk = zLivre + 14 * k, x = b.p[0] + 8;
      const q: Vec3 = [...r.p];
      q[e] = Math.min(r.p[e] + 12 + 14 * k, limite);
      const p2: Vec3 = [x, b.p[1], zk];
      p2[e] = q[e];
      cabo(`mangueira-${k}`, "Mangueira do water cooler", cooler, rad, b, r, [[x, b.p[1], b.p[2]], [x, b.p[1], zk], p2, [q[0], q[1], zk], q], { tipo: "mangueira", raio: 6 });
    }
  }
  return cabos;
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

// ---- Contrato da interface (Cena3D).

/** Posição da peça na build explodida: `k` de 0 (montada) a 1 (toda afastada na direção de instalação). */
export function posicaoExplodida(c: Caixa, k: number): Vec3 {
  return [c.pos[0] + c.instala[0] * k, c.pos[1] + c.instala[1] * k, c.pos[2] + c.instala[2] * k];
}

/** Região de um conflito físico no mundo (mm): caixa a destacar e quanto a peça passa do limite (null se não se aplica). */
export interface Regiao { conflitoId: string; centro: Vec3; tam: Vec3; excessoMm: number | null; texto: string }

// Pares que se sobrepõem por projeto (uma peça encaixa na outra): a sobreposição deles não é conflito.
const ENCAIXE = new Set(["cpu|placa_mae", "memoria|placa_mae", "gpu|placa_mae", "armazenamento|placa_mae", "cooler|placa_mae", "cooler|cpu"]);
const encaixam = (a: Caixa, b: Caixa) => a.id === b.id || ENCAIXE.has(`${a.tipo}|${b.tipo}`) || ENCAIXE.has(`${b.tipo}|${a.tipo}`);

/**
 * Só conflitos físicos com região calculável entram; os demais continuam marcados apenas na peça. A região é a fatia
 * da peça que passa da parede do gabinete (excesso = quanto passa) ou a interseção de duas peças do conflito
 * (excesso = menor dimensão da interseção). Com mais de uma no mesmo conflito, fica a de maior excesso.
 */
export function regioesDeConflito(caixas: Caixa[], conflitos: Cena["conflitos"]): Regiao[] {
  const gab = caixas.find((c) => c.tipo === "gabinete");
  return conflitos.flatMap((conf) => {
    const pecas = caixas.filter((c) => c !== gab && conf.itens.includes(c.id));
    const achadas: { centro: Vec3; tam: Vec3; mm: number }[] = [];
    if (gab) for (const c of pecas) for (const k of [0, 1, 2]) for (const s of [-1, 1]) {
      const borda = s * c.pos[k] + c.tam[k] / 2, mm = borda - gab.tam[k] / 2;   // quanto a peça passa da parede `s` do eixo `k`
      if (mm <= 0.5) continue;
      const centro: Vec3 = [...c.pos], tam: Vec3 = [...c.tam];
      tam[k] = Math.min(mm, c.tam[k]);
      centro[k] = s * (borda - tam[k] / 2);
      const outro = -s * c.pos[k] + c.tam[k] / 2 - gab.tam[k] / 2;   // passa também pela parede oposta: a medida é a soma
      achadas.push({ centro, tam, mm: mm + Math.max(0, outro) });
    }
    for (let i = 0; i < pecas.length; i++) for (let j = i + 1; j < pecas.length; j++) {
      const a = pecas[i], b = pecas[j];
      if (encaixam(a, b)) continue;
      const lo = [0, 1, 2].map((k) => Math.max(a.pos[k] - a.tam[k] / 2, b.pos[k] - b.tam[k] / 2)), hi = [0, 1, 2].map((k) => Math.min(a.pos[k] + a.tam[k] / 2, b.pos[k] + b.tam[k] / 2));
      const tam = hi.map((v, k) => v - lo[k]) as Vec3;
      if (tam.every((v) => v > 0.5)) achadas.push({ centro: lo.map((v, k) => v + tam[k] / 2) as Vec3, tam, mm: Math.min(...tam) });
    }
    // Sem sobreposição no desenho, vale o achado: o limite da ficha do gabinete (folga que a geometria não vê).
    // A fatia que excede fica na ponta da frente da GPU (-X) ou no topo do cooler (+Z).
    if (!achadas.length && gab && conf.itens.includes(gab.id)) for (const c of pecas) {
      const [k, s, mm] = c.tipo === "gpu" ? [0, -1, c.tam[0] - (gab.specs.gpu_max_mm ?? Infinity)]
        : c.tipo === "cooler" && c.chave === c.id ? [2, 1, c.tam[2] - (gab.specs.cooler_max_mm ?? Infinity)] : [0, 1, 0];
      if (mm <= 0.5) continue;
      const centro: Vec3 = [...c.pos], tam: Vec3 = [...c.tam];
      tam[k] = Math.min(mm, c.tam[k]);
      centro[k] = c.pos[k] + s * (c.tam[k] / 2 - tam[k] / 2);
      achadas.push({ centro, tam, mm });
    }
    const r = achadas.sort((a, b) => b.mm - a.mm)[0];
    if (!r) return [];
    const excessoMm = Math.round(r.mm);
    return [{ conflitoId: conf.id, centro: r.centro, tam: r.tam, excessoMm, texto: `${conf.descricao} (passa ${excessoMm} mm)`.trim() }];
  });
}

/**
 * Estado da cena num passo do tutorial: por `chave`, posição (null = ainda não entrou) e abertura dos encaixes (0–1);
 * ids dos cabos já ligados. `moveis`: prefixos de id das subpeças móveis a que `encaixe` se aplica (ausente = todas).
 */
export interface EstadoPasso { pecas: Record<string, { pos: Vec3 | null; encaixe: number; moveis?: string[] }>; cabos: string[] }

// O que cada peça abre na placa-mãe ao entrar: alavanca do soquete, travas dos slots de memória, trava do slot PCIe.
const ABRE: Partial<Record<Tipo, string[]>> = { cpu: ["soquete-alavanca"], memoria: ["dimm-"], gpu: ["pcie-0-trava"] };
const NA_PLACA: Tipo[] = ["cpu", "memoria", "armazenamento", "cooler", "gpu"];
const ENTRA = 0.7, LIGA = 0.8;   // fração do passo em que a peça chega ao lugar; a partir de LIGA os cabos do passo aparecem

/**
 * Função pura de (passo, progresso 0–1): avançar e voltar para o mesmo passo dão o mesmo estado. A peça do passo entra
 * pela direção de `instala` com os encaixes abertos e fecha no fim; a placa-mãe abre e fecha junto o encaixe que recebe
 * a peça. Peças de passos futuros ficam com `pos` null, menos a placa-mãe quando algo que vai nela entra antes: ela
 * aparece no lugar desde esse passo e não desliza no dela (a ordem de montagem põe CPU, memória e cooler antes de a
 * placa ir para o gabinete, e sem a placa não há alavanca nem trava para mostrar).
 */
export function estadoPasso(caixas: Caixa[], cabos: Cabo[], passo: number, progresso: number): EstadoPasso {
  const p = Math.min(1, Math.max(0, progresso));
  const falta = Math.pow(1 - Math.min(1, p / ENTRA), 3);          // ease-out: 1 longe, 0 no lugar
  const aberto = 1 - Math.max(0, (p - ENTRA) / (1 - ENTRA));      // 1 enquanto a peça entra, fecha no trecho final
  const naPlaca = caixas.filter((c) => NA_PLACA.includes(c.tipo) && !ehRadiador(c) && !c.modelo?.ancoras.dados).map((c) => c.passo);
  const moveis = caixas.filter((c) => c.passo === passo).flatMap((c) => ABRE[c.tipo] ?? []);
  const pecas: EstadoPasso["pecas"] = {};
  for (const c of caixas) {
    const bancada = c.tipo === "placa_mae" && Math.min(...naPlaca) < c.passo;   // a placa recebe peças antes do passo dela: não entra deslizando
    if (c.tipo === "gabinete" || c.passo < passo || (bancada && Math.min(...naPlaca) <= passo)) pecas[c.chave] = { pos: c.pos, encaixe: 0 };
    else if (c.passo === passo) pecas[c.chave] = { pos: posicaoExplodida(c, falta), encaixe: aberto };
    else pecas[c.chave] = { pos: null, encaixe: 0 };
    if (c.tipo === "placa_mae" && moveis.length && pecas[c.chave].encaixe === 0) Object.assign(pecas[c.chave], { encaixe: aberto, moveis });
  }
  return { pecas, cabos: cabos.filter((c) => (c.passo ?? 0) < passo || ((c.passo ?? 0) === passo && p >= LIGA)).map((c) => c.id) };
}

const LUGAR: Partial<Record<Tipo, string>> = {
  placa_mae: "presa na lateral interna do gabinete", cpu: "no soquete da placa-mãe", memoria: "nos slots ao lado do processador",
  gpu: "no slot PCIe, abaixo do processador", fonte: "no fundo do gabinete, junto à traseira",
};
/** Descrição textual da cena para leitor de tela: peças, onde ficam e conflitos (com a medida, quando há região). */
export function descricaoCena(cena: Cena, caixas: Caixa[], regioes: Regiao[]): string {
  const onde = (p: Cena["pecas"][number]): string => {
    const cs = caixas.filter((c) => c.id === p.id), rad = cs.find(ehRadiador);
    if (!cs.length) return "sem lugar livre na cena";
    if (p.tipo === "gabinete") return "o gabinete";
    if (rad) return `bloco sobre o processador e radiador de ${p.specs.radiador_mm ?? 240} mm ${rad.rot?.[2] ? "no topo" : "na frente"} do gabinete`;
    if (p.tipo === "cooler") return "sobre o processador";
    if (p.tipo === "armazenamento") return cs[0].modelo?.ancoras.dados ? `numa baia de ${formato(p.specs).replace(".", ",")} polegadas, na parte de baixo do gabinete` : "no slot M.2 da placa-mãe";
    return LUGAR[p.tipo] ?? "na cena";
  };
  const pecas = cena.pecas.map((p) => `${p.nome} (${onde(p)})`).join("; ");
  const conflitos = cena.conflitos.map((c) => regioes.find((r) => r.conflitoId === c.id)?.texto ?? c.descricao).filter(Boolean);
  return `Montagem com ${cena.pecas.length} peças: ${pecas}. ` + (conflitos.length ? `${conflitos.length === 1 ? "1 conflito" : `${conflitos.length} conflitos`}: ${conflitos.join("; ")}.` : "Sem conflitos.");
}
