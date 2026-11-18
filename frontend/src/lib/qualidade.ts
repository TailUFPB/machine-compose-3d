// Qualidade da cena (frente 3, celular): Alta desenha tudo; Leve usa DPR 1 e tira os detalhes finos das peças
// fechadas (subpeças `grade`: pinos, contatos, trilhas). Auto começa Leve no toque e desce para Leve se os quadros caem.
import type { Sub } from "./peca";

export type Escolha = "auto" | "alta" | "leve";
export type Nivel = "alta" | "leve";

export const PISO_QPS = 30;     // piso da spec da #8
export const AMOSTRAS = 3;      // amostras de 1 s seguidas abaixo do piso para o Auto descer
export const CARENCIA_S = 3;    // sem medir logo depois de montar (shaders compilando)
export const CHAVE = "cena-qualidade";

export function nivelInicial(escolha: Escolha, toque: boolean): Nivel {
  return escolha === "auto" ? (toque ? "leve" : "alta") : escolha;
}

/** O Auto desce quando as últimas `AMOSTRAS` taxas (q/s) ficaram todas abaixo do piso. */
export function desceAuto(amostras: number[]): boolean {
  const ultimas = amostras.slice(-AMOSTRAS);
  return ultimas.length === AMOSTRAS && ultimas.every((q) => q < PISO_QPS);
}

export function lerEscolha(): Escolha {
  try {
    const v = globalThis.localStorage?.getItem(CHAVE);
    return v === "alta" || v === "leve" || v === "auto" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function guardarEscolha(e: Escolha): void {
  try { globalThis.localStorage?.setItem(CHAVE, e); } catch { /* sem armazenamento: vale só nesta visita */ }
}

/** Subpeças desenhadas: no Leve, a peça fechada perde as `grade`; aberta, mostra tudo (é a vista de detalhe). */
export function partesVisiveis(partes: Sub[], leve: boolean, aberto: boolean): Sub[] {
  return leve && !aberto ? partes.filter((p) => p.forma.tipo !== "grade") : partes;
}

export function rotuloQualidade(escolha: Escolha, nivel: Nivel): string {
  if (escolha === "auto") return `Auto (${nivel})`;
  return escolha === "alta" ? "Alta" : "Leve";
}
