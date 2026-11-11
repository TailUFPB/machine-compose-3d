// Layout paramétrico da cena 3D: cada peça vira uma caixa dimensionada pela ficha técnica (mm).
// Eixos: X = profundidade (frente -X, traseira +X), Y = altura, Z = largura (lado da placa-mãe em -Z).
import type { Cena, Tipo } from "./api";
import { coolerModelo, cpuModelo } from "./cpu";
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
 */
export interface Caixa {
  id: string; chave: string; tipo: Tipo; nome: string; pos: Vec3; tam: Vec3; cor: string; conflito: boolean; passo: number;
  specs: Record<string, any>; modelo?: Modelo; instala: Vec3; origem: Record<string, string>;
}

const MARGEM = 30;
const COR: Partial<Record<Tipo, string>> = {
  gabinete: "#8892a6", placa_mae: "#3f8a63", cpu: "#c9ccd1", cooler: "#5b7fbf", memoria: "#a3afc2",
  gpu: "#7d8aa0", fonte: "#8e98aa", armazenamento: "#1f8a70",
};

export function montarCena(cena: Cena): Caixa[] {
  const por = (t: Tipo) => cena.pecas.find((p) => p.tipo === t);
  const emConflito = new Set(cena.conflitos.flatMap((c) => c.itens));
  const ordem = cena.passos.map((p) => p.tipo);
  const caixas: Caixa[] = [];
  const add = (p: { id: string; tipo: Tipo; nome: string; specs: Record<string, any>; origem?: Record<string, string> }, pos: Vec3, tam: Vec3, modelo?: Modelo) =>
    caixas.push({ ...p, chave: p.id, instala: [0, 0, 0], origem: p.origem ?? {}, pos, tam, modelo, cor: COR[p.tipo] ?? "#888", conflito: emConflito.has(p.id), passo: Math.max(0, ordem.indexOf(p.tipo)) });

  const gab = por("gabinete");
  const d = gab?.specs.dimensoes ?? { c: 450, a: 460, l: 230 };
  const [C, A, L] = [d.c, d.a, d.l];
  if (gab) add(gab, [0, 0, 0], [C, A, L], gabineteModelo(gab.specs));

  // A placa-mãe dá as âncoras; cada peça é posicionada fazendo a âncora dela coincidir com a da placa.
  const mbP = por("placa_mae");
  const mb = placaMaeModelo(mbP?.specs ?? {});
  const [mbW, mbH, mbT] = mb.tam;
  const mbX = C / 2 - MARGEM - mbW / 2;
  const mbY = A / 2 - MARGEM - mbH / 2;
  const mbZ = -L / 2 + 25;                              // face de cima do PCB fica em mbZ - 0,4
  const mbPos: Vec3 = [mbX, mbY, mbZ - 2 + mbT / 2];
  const em = (a: string): Vec3 => [mbPos[0] + mb.ancoras[a][0], mbPos[1] + mb.ancoras[a][1], mbPos[2] + mb.ancoras[a][2]];
  if (mbP) add(mbP, mbPos, mb.tam, mb);

  const cpu = por("cpu");
  const cpuM = cpuModelo(cpu?.specs ?? {});
  const soquete = em("cpu");
  const cpuPos: Vec3 = [soquete[0], soquete[1], soquete[2] - cpuM.ancoras.base[2]];
  if (cpu) add(cpu, cpuPos, cpuM.tam, cpuM);

  const cooler = por("cooler");
  if (cooler?.specs.refrigeracao === "aio") {
    const r = cooler.specs.radiador_mm;
    add(cooler, [-C / 2 + MARGEM + 15, 0, 0], [30, r, 120]);   // radiador na frente (ainda sem modelo)
  } else if (cooler) {
    const m = coolerModelo(cooler.specs);   // base apoiada na tampa da CPU
    add(cooler, [cpuPos[0], cpuPos[1], cpuPos[2] + cpuM.ancoras.topo[2] - m.ancoras.base[2]], m.tam, m);
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

  const ssd = por("armazenamento");
  if (ssd?.specs.interface === "M.2") { const m = ssdModelo(ssd.specs); add(ssd, em("m2"), m.tam, m); }
  else if (ssd) add(ssd, em("m2"), [80, 22, 3]);

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
  // os cabos definem onde a cobertura da fonte precisa de passa-cabo
  const gabCaixa = caixas.find((c) => c.tipo === "gabinete");
  if (gabCaixa) gabCaixa.modelo = gabineteModelo(gabCaixa.specs, montarCabos(caixas).flatMap((c) => (c.passagem ? [c.passagem] : [])));
  return caixas;
}

/**
 * `de`/`para` são `id` de peça. `plugues` são as caixas desenhadas nas pontas (centro e tamanho, no mundo).
 * `passo` é o índice do passo do tutorial em que o cabo é ligado. `tipo` "mangueira" é a do water cooler.
 */
export interface Cabo {
  id: string; nome: string; pontos: Vec3[]; raio: number; de: string; para: string; passagem?: { x: number; z: number };
  tipo?: "cabo" | "mangueira"; plugues?: { pos: Vec3; tam: Vec3 }[]; passo?: number;
}

/** Cabos entre os conectores já posicionados: fonte → placa-mãe (ATX 24, EPS) e GPU; fan do cooler → placa-mãe. */
export function montarCabos(caixas: Caixa[]): Cabo[] {
  const de = (t: Tipo) => caixas.find((c) => c.tipo === t && c.modelo);
  /** Centro da face de uma subpeça no mundo (eixo e sentido da face). */
  const face = (c: Caixa, id: string, eixo: 0 | 1 | 2, sentido: 1 | -1): Vec3 | null => {
    const p = c.modelo!.partes.find((s) => s.id === id);
    if (!p) return null;
    const v: Vec3 = [c.pos[0] + p.pos[0], c.pos[1] + p.pos[1], c.pos[2] + p.pos[2]];
    v[eixo] += (sentido * p.tam[eixo]) / 2;
    return v;
  };
  const gab = caixas.find((c) => c.tipo === "gabinete"), psu = de("fonte"), mb = de("placa_mae"), gpu = de("gpu"), cooler = de("cooler");
  const cabos: Cabo[] = [];
  const L = gab?.tam[2] ?? 230;

  if (psu) {
    const yRun = psu.pos[1] + psu.tam[1] / 2 + 6;   // corre entre o topo da fonte e a cobertura
    let saida = 0;
    /** Sai da fonte, corre por cima dela até (x, z), sobe pelo passa-cabo e chega ao conector por `chegada`. */
    const energia = (id: string, nome: string, para: Caixa, x: number, z: number, chegada: Vec3[]) => {
      const s = face(psu, `saida-${saida++}`, 0, -1);
      if (!s) return;
      cabos.push({ id, nome, raio: 3.5, de: psu.id, para: para.id, passagem: { x, z },
        pontos: [s, [s[0] - 25, s[1], s[2]], [s[0] - 25, yRun, s[2]], [x, yRun, z], ...chegada] });
    };
    const zAtras = -L / 2 + 10;   // vão entre a bandeja e o verso da placa-mãe
    const atx = mb && face(mb, "atx24", 2, 1);
    if (mb && atx) energia("cabo-atx24", "Cabo ATX 24 pinos", mb, atx[0] - 20, zAtras,
      [[atx[0] - 20, atx[1], zAtras], [atx[0] - 20, atx[1], atx[2] + 15], [atx[0], atx[1], atx[2] + 15], atx]);
    const eps = mb && face(mb, "eps", 2, 1);
    if (mb && eps) {
      const yTopo = mb.pos[1] + mb.tam[1] / 2 + 10;   // passa por cima da borda da placa
      energia("cabo-eps", "Cabo EPS 8 pinos (CPU)", mb, eps[0], zAtras, [[eps[0], yTopo, zAtras], [eps[0], yTopo, eps[2] + 15], [eps[0], eps[1], eps[2] + 15], eps]);
    }
    for (let i = 0; gpu; i++) {
      const g = face(gpu, `energia-${i}`, 2, 1);
      if (!g) break;
      const z = Math.min(g[2] + 20, L / 2 - 10);
      energia(`cabo-gpu-${i}`, "Cabo de energia da GPU", gpu, g[0], z, [[g[0], g[1], z], g]);
    }
  }
  const fan = cooler && face(cooler, "fan-0", 2, -1), hdr = mb && face(mb, "fan-cpu-pinos", 2, 1);
  if (cooler && mb && fan && hdr)
    cabos.push({ id: "cabo-fan-cpu", nome: "Cabo do fan da CPU", raio: 1.2, de: cooler.id, para: mb.id, pontos: [fan, [hdr[0], hdr[1], hdr[2] + 12], hdr] });
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

// ---- Contrato da interface (Cena3D). Implementações provisórias: a lógica real entra aqui, sem mudar as assinaturas.

/** Posição da peça na build explodida: `k` de 0 (montada) a 1 (toda afastada na direção de instalação). */
export function posicaoExplodida(c: Caixa, k: number): Vec3 {
  return [c.pos[0] + c.instala[0] * k, c.pos[1] + c.instala[1] * k, c.pos[2] + c.instala[2] * k];
}

/** Região de um conflito físico no mundo (mm): caixa a destacar e quanto a peça passa do limite (null se não se aplica). */
export interface Regiao { conflitoId: string; centro: Vec3; tam: Vec3; excessoMm: number | null; texto: string }

/** Só conflitos físicos com região calculável entram; os demais continuam marcados apenas na peça. */
export function regioesDeConflito(_caixas: Caixa[], _conflitos: Cena["conflitos"]): Regiao[] {
  return [];
}

/** Estado da cena num passo do tutorial: por `chave`, posição (null = ainda não entrou) e abertura dos encaixes (0–1); ids dos cabos já ligados. */
export interface EstadoPasso { pecas: Record<string, { pos: Vec3 | null; encaixe: number }>; cabos: string[] }

/** Função pura de (passo, progresso 0–1): avançar e voltar para o mesmo passo dão o mesmo estado. */
export function estadoPasso(caixas: Caixa[], _cabos: Cabo[], passo: number, progresso: number): EstadoPasso {
  return { pecas: Object.fromEntries(caixas.map((c) => [c.chave, { pos: posicaoTutorial(c, passo, progresso), encaixe: 0 }])), cabos: [] };
}

/** Descrição textual da cena para leitor de tela: peças, onde ficam e conflitos. */
export function descricaoCena(cena: Cena, _caixas: Caixa[], _regioes: Regiao[]): string {
  return `Montagem com ${cena.pecas.length} peças e ${cena.conflitos.length} conflitos.`;
}
