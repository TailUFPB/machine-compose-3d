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

/** Valor redondo para orçamentos e rótulos ("R$ 7.000"). */
export const brlRedondo = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Nome legível de uma build, no lugar do id: "R$ 7.000 · 1080p a 90 FPS". */
export const rotuloBuild = (b: { orcamento: number; objetivos: { resolucao: string; fps_alvo: number } }) =>
  `${brlRedondo(b.orcamento)} · ${b.objetivos.resolucao} a ${b.objetivos.fps_alvo} FPS`;

export const MODOS = {
  agente: { nome: "Agente", texto: "O agente escolhe todas as peças." },
  hibrido: { nome: "Híbrido", texto: "Você trava algumas peças, o agente completa." },
  manual: { nome: "Manual", texto: "Você escolhe peça por peça; o agente só sugere." },
} as const;
