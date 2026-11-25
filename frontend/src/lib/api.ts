// Cliente da API FastAPI. Tipos espelham backend/app/modelos.py.

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Tipo = "cpu" | "gpu" | "placa_mae" | "memoria" | "armazenamento" | "fonte" | "gabinete" | "cooler" | "extra";
export type Modo = "agente" | "hibrido" | "manual";
export type Severidade = "bloqueante" | "atencao" | "sugestao";

export interface Objetivos { jogos: string[]; resolucao: "1080p" | "1440p"; fps_alvo: number }
export interface BuildItem {
  componente_id: string; quantidade: number; travado: boolean; ja_tenho: boolean;
  origem: "usuario" | "agente"; justificativa: string | null; status_pesquisa: string;
}
export interface Correcao { acao: "trocar" | "adicionar" | "remover"; componente_id: string | null; para_id: string | null }
export interface Achado {
  id: string; agente: string; severidade: Severidade; itens_envolvidos: string[]; descricao: string;
  correcao_sugerida: Correcao | null; fonte_url: string | null; verificado: boolean;
  status: "aberto" | "aplicado" | "ignorado"; impacto_preco: number | null; impacto_fps: string | null; fisico: boolean;
}
export interface Build {
  id: string; modo: Modo; orcamento: number; cep: string; objetivos: Objetivos; usuario: string;
  status: string; itens: BuildItem[]; achados: Achado[];
}
export interface Preco { min: number | null; med: number | null; max: number | null; qtd_lojas: number; confianca: string | null }
export interface Componente {
  id: string; tipo: Tipo; marca: string; modelo: string; nome: string; specs: Record<string, any>; fonte: string;
  compativel: boolean; motivo: string | null; preco: Preco;
}
export interface Proposta { itens: BuildItem[]; achados: Achado[]; tentativas: number; convergiu: boolean; avisos: string[]; custo_estimado: number | null; custo_minimo: number | null }
export interface Estimativa {
  jogo: string; jogo_nome: string; resolucao: string; preset: string; fps_med: number; fps_min: number; fps_max: number;
  fps_1low: number; tipo: "medido" | "estimado"; confianca: string; gargalo: "cpu" | "gpu" | null; fontes: string[];
  fps_por_mil_reais: number | null;
}
export interface LinhaCompra { componente_id: string; nome: string; quantidade: number; preco_unit: number; subtotal: number; preco_ref: number; subtotal_ref: number; url: string; faixa: [number, number, number]; confianca: string | null; qtd_lojas: number }
export interface Troca { de_id: string; para_id: string; de_nome: string; para_nome: string; economia: number; impacto_fps_pct: number | null; texto: string }
export interface AlternativaSemPreco { de_id: string; de_nome: string; para_id: string; para_nome: string; preco_med: number; preco_min: number; qtd_lojas: number }
export interface Resultado {
  lojas: Record<string, LinhaCompra[]>; total_por_loja: Record<string, number>; total: number; total_minimo: number; orcamento: number;
  cabe: boolean; diferenca: number; sem_preco: string[]; alternativas_sem_preco: AlternativaSemPreco[]; ja_tenho: string[]; trocas: Troca[]; frete: string;
}
export interface Oferta { loja: string; preco: number; url: string; titulo: string; coletado_em: string; condicao_pagamento?: "a_vista" | "parcelado" | "desconhecida" }
export interface ConsumoSerper { data: string; usados: number; limite: number; restantes: number }

export function formatarConsumoSerper(consumo?: ConsumoSerper | null): string {
  if (!consumo) return "";
  const sufixo = consumo.restantes <= 0 ? " (limite atingido)" : "";
  return `Créditos Serper hoje: ${consumo.usados}/${consumo.limite}${sufixo}`;
}
export interface ResultadoPreco {
  componente_id: string; ofertas: Oferta[]; descartes: { loja: string; titulo: string; motivo: string }[];
  preco_min: number | null; preco_med: number | null; preco_max: number | null; qtd_lojas: number; confianca: string | null;
  do_cache: boolean; vencido: boolean; historico: { loja: string; preco: number; coletado_em: string }[];
}

export function linkOferta(componenteId: string, loja: string, url: string): string {
  const qs = new URLSearchParams({ componente_id: componenteId, loja, url });
  return `${API}/ofertas/ir?${qs.toString()}`;
}

export function ehOfertaUnica(qtdLojas?: number | null): boolean {
  return qtdLojas === 1;
}
export interface Importacao { itens: BuildItem[]; nao_reconhecidas: string[]; avisos: string[] }
export interface Cena {
  /** `origem`: URL da ficha para os campos de `specs` que vieram de extração (campo → URL). */
  pecas: { id: string; tipo: Tipo; nome: string; specs: Record<string, any>; origem?: Record<string, string> }[];
  conflitos: { id: string; itens: string[]; descricao: string; severidade: Severidade }[];
  passos: { tipo: Tipo; texto: string }[];
  folgas?: Folga[];
  /** Ventoinhas do gabinete com sentido (`backend/app/fluxo.py`); `null` sem gabinete. */
  fluxo?: Fluxo | null;
}

export interface Ventoinha { vaga: "frente" | "topo" | "traseira"; indice: number; sentido: "entrada" | "saida"; origem: "gabinete" | "pacote" | "radiador" }
/** Fluxo de ar medido pela ficha. `calor_w` = TDP da CPU + GPU; `recomendadas` é estimativa (uma a cada 150 W, mínimo 2). */
export interface Fluxo {
  ventoinhas: Ventoinha[]; entrada: number; saida: number; pressao: "positiva" | "equilibrada" | "negativa"; calor_w: number; recomendadas: number;
}

/** Folga medida pela ficha (`backend/app/folgas.py`): `sobra_mm` negativo = passa do limite. */
export interface Folga {
  id: "gpu" | "cooler" | "memoria" | "fonte"; peca: string; limite_de: string; tamanho_mm: number; limite_mm: number;
  sobra_mm: number; estado: "cabe" | "justa" | "ajuste" | "nao_cabe"; dica: string | null;
}

/** Cena de uma troca ainda não aplicada (`POST /builds/{id}/cena/previa`). `diferenca_preco`: null sem preço com fonte. */
export type CenaPrevia = Cena & { diferenca_preco: number | null };

export class ErroApi extends Error {
  constructor(public status: number, public detalhe: any) {
    super(typeof detalhe === "string" ? detalhe : detalhe?.mensagem ?? `erro ${status}`);
  }
}

async function req<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${caminho}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!r.ok) {
    const corpo = await r.json().catch(() => ({}));
    throw new ErroApi(r.status, corpo.detail ?? corpo);
  }
  return r.json() as Promise<T>;
}

const post = <T,>(c: string, corpo?: unknown) => req<T>(c, { method: "POST", body: JSON.stringify(corpo ?? {}) });

export const api = {
  saude: () => req<{ ok: boolean; llm: string; busca?: string; dados: string; consumo_serper?: ConsumoSerper }>("/saude"),
  consumo: () => req<ConsumoSerper>("/precos/consumo"),
  jogos: () => req<{ jogos: { id: string; nome: string }[]; resolucoes: string[]; preset: string }>("/jogos"),
  builds: () => req<Build[]>("/builds"),
  build: (id: string) => req<Build>(`/builds/${id}`),
  criar: (dados: Pick<Build, "modo" | "orcamento" | "cep"> & Partial<Pick<Build, "objetivos">>) => post<Build>("/builds", dados),
  atualizar: (id: string, dados: Partial<Pick<Build, "modo" | "orcamento" | "cep" | "objetivos">>) =>
    req<Build>(`/builds/${id}`, { method: "PATCH", body: JSON.stringify(dados) }),
  componentes: (tipo: Tipo, buildId: string, todos: boolean) =>
    req<Componente[]>(`/componentes?tipo=${tipo}&build_id=${buildId}&todos=${todos}`),
  catalogo: () => req<Componente[]>("/componentes"),
  adicionar: (id: string, componente_id: string, extra: Partial<BuildItem> = {}) =>
    post<Build>(`/builds/${id}/itens`, { componente_id, ...extra }),
  atualizarItem: (id: string, cid: string, dados: Partial<Pick<BuildItem, "quantidade" | "travado" | "ja_tenho">>) =>
    req<Build>(`/builds/${id}/itens/${cid}`, { method: "PATCH", body: JSON.stringify(dados) }),
  remover: (id: string, cid: string) => req<Build>(`/builds/${id}/itens/${cid}`, { method: "DELETE" }),
  trocarSemPreco: (id: string, deId: string, paraId: string) =>
    post<Build>(`/builds/${id}/trocar`, { de: deId, para: paraId }),
  revisar: (id: string) => post<Build>(`/builds/${id}/revisar`),
  importar: (id: string, texto: string, ja_tenho: boolean) => post<Importacao>(`/builds/${id}/importar`, { texto, ja_tenho }),
  agente: (id: string) => post<Proposta>(`/builds/${id}/agente`),
  aplicar: (id: string, corpo: { proposta?: boolean; achado_id?: string; itens?: BuildItem[] }) => post<Build>(`/builds/${id}/aplicar`, corpo),
  ignorar: (id: string, achado: string) => post<Build>(`/builds/${id}/achados/${encodeURIComponent(achado)}/ignorar`),
  precos: (id: string) => req<ResultadoPreco[]>(`/builds/${id}/precos`),
  fps: (id: string) => req<Estimativa[]>(`/builds/${id}/fps`),
  comparar: (a: string, b: string, resolucao: string) =>
    req<{ a: Estimativa[]; b: Estimativa[]; custo_a: number; custo_b: number }>(`/comparar?a=${a}&b=${b}&resolucao=${resolucao}`),
  resultado: (id: string) => req<Resultado>(`/builds/${id}/resultado`),
  cena: (id: string) => req<Cena>(`/builds/${id}/cena`),
  trocar: (id: string, de: string, para: string) => post<Build>(`/builds/${id}/trocar`, { de, para }),
  previa: (id: string, de: string, para: string) => post<CenaPrevia>(`/builds/${id}/cena/previa`, { de, para }),
  async exportar(id: string, override = false, confirmacao = ""): Promise<Blob> {
    const r = await fetch(`${API}/builds/${id}/exportar`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ override, confirmacao }),
    });
    if (!r.ok) throw new ErroApi(r.status, (await r.json().catch(() => ({}))).detail);
    return r.blob();
  },
};
