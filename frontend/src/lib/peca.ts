// Contrato comum das peças procedurais. Um gerador por tipo de peça recebe a ficha (specs) e devolve um Modelo:
// subpeças em mm no referencial local, cada uma com tom, origem da medida e deslocamento na vista explodida.
// O renderizador (components/Peca3D.tsx) é o mesmo para qualquer peça. Método completo: docs/PECAS-3D.md.
import type { Vec3 } from "./cena";

export type Tom = "lo" | "mid" | "hi" | "lit" | "pcb" | "ouro" | "cobre" | "metal" | "escuro" | "vidro" | "trilha";
export type Fonte = "norma" | "ficha" | "estimado";
export type Forma =
  | { tipo: "caixa" }
  | { tipo: "tubo"; raio: number }                                    // cilindro com eixo em x
  | { tipo: "cilindro"; raio: number; eixo?: "y" | "z" }              // parafuso, capacitor, bateria (eixo y por padrão)
  | { tipo: "fan"; raio: number; pas: number; eixo?: "x" | "y" }       // gira; eixo y por padrão
  | { tipo: "aletas"; n: number; passo: number; esp: number; eixo?: "x" | "z" }   // placas finas empilhadas (em x por padrão)
  | { tipo: "grade"; n: Vec3; cheio?: number }                        // pinos, contatos e trilhas: n células por eixo, cada uma preenchida em `cheio`
  | { tipo: "placa"; furos: { x: number; z: number; r: number }[] };  // chapa no plano xz com furos redondos

export interface Sub {
  id: string; nome: string; forma: Forma; tom: Tom; fonte: Fonte;
  pos: Vec3; tam: Vec3;   // centro e envelope, em mm
  explode: Vec3;          // deslocamento na vista explodida, em mm
  ordem: number;          // escalonamento da explosão (0 sai primeiro)
}

/** `ancoras`: pontos de encaixe no referencial local; duas peças se encaixam fazendo as âncoras coincidirem. */
export interface Modelo { tam: Vec3; partes: Sub[]; estimados: string[]; ancoras: Record<string, Vec3> }

type Add = (id: string, nome: string, tom: Tom, pos: Vec3, tam: Vec3, explode: Vec3, ordem: number, fonte?: Fonte, forma?: Forma) => void;
/** Atalho dos geradores: empilha subpeças em `partes` (caixa e "estimado" por padrão). */
export const montador = (partes: Sub[]): Add => (id, nome, tom, pos, tam, explode, ordem, fonte = "estimado", forma = { tipo: "caixa" }) => {
  partes.push({ id, nome, forma, tom, fonte, pos, tam, explode, ordem });
};

/** Progresso 0..1 de cada subpeça na explosão: escalonado por `ordem`, invertido ao fechar. */
export function progressoExplosao(ordem: number, max: number, t: number, abrindo: boolean, atraso = 0.07, dur = 0.55): number {
  const k = abrindo ? ordem : max - ordem;
  const u = Math.min(1, Math.max(0, (t - k * atraso) / dur));
  const e = 1 - Math.pow(1 - u, 3);
  return abrindo ? e : 1 - e;
}

/** Pares de subpeças cujos envelopes se atravessam (mais que `folga` mm em todos os eixos). Usado nos testes. */
export function atravessam(m: Modelo, folga = 0.05): [string, string][] {
  const pares: [string, string][] = [];
  for (let i = 0; i < m.partes.length; i++) for (let j = i + 1; j < m.partes.length; j++) {
    const a = m.partes[i], b = m.partes[j];
    if ([0, 1, 2].every((k) => Math.abs(a.pos[k] - b.pos[k]) < (a.tam[k] + b.tam[k]) / 2 - folga)) pares.push([a.id, b.id]);
  }
  return pares;
}
