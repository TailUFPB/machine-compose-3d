export const brl = (v: number | null | undefined) =>
  v == null ? "sem preço" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const SEVERIDADE = { bloqueante: "Bloqueante", atencao: "Atenção", sugestao: "Sugestão" } as const;

export const TIPOS = {
  cpu: "Processador", gpu: "Placa de vídeo", placa_mae: "Placa-mãe", memoria: "Memória", armazenamento: "Armazenamento",
  fonte: "Fonte", gabinete: "Gabinete", cooler: "Cooler", extra: "Extras",
} as const;

/**
 * Demo de fluidez: dado o tempo (ms), devolve o índice do quadro exibido para um jogo que roda a `fps` médio,
 * com 1 em cada 100 quadros demorando o tempo do 1% low (o "engasgo"). A animação só avança quando o índice muda.
 */
export function quadroEm(tMs: number, fps: number, low: number): number {
  const normal = 1000 / Math.max(1, fps);
  const lento = 1000 / Math.max(1, Math.min(low, fps));
  const bloco = 99 * normal + lento;   // 100 quadros
  const eps = 1e-9;   // 1000/30 * 30 não fecha exato em ponto flutuante
  const blocos = Math.floor(tMs / bloco + eps);
  const resto = tMs - blocos * bloco;
  const dentro = resto + eps < lento ? 0 : 1 + Math.floor((resto - lento) / normal + eps);
  return blocos * 100 + Math.min(99, dentro);
}
