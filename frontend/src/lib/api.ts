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
export interface Preco { min: number | null; med: number | null; max: number | null; confianca: string | null }
export interface Componente {
  id: string; tipo: Tipo; marca: string; modelo: string; nome: string; specs: Record<string, any>; fonte: string;
  compativel: boolean; motivo: string | null; preco: Preco;
}
export interface Proposta { itens: BuildItem[]; achados: Achado[]; tentativas: number; convergiu: boolean; avisos: string[]; custo_estimado: number | null }
export interface Estimativa {
  jogo: string; jogo_nome: string; resolucao: string; preset: string; fps_med: number; fps_min: number; fps_max: number;
  fps_1low: number; tipo: "medido" | "estimado"; confianca: string; gargalo: "cpu" | "gpu" | null; fontes: string[];
  fps_por_mil_reais: number | null;
}
export interface LinhaCompra { componente_id: string; nome: string; quantidade: number; preco_unit: number; subtotal: number; url: string; faixa: [number, number, number]; confianca: string | null }
export interface Troca { de_id: string; para_id: string; de_nome: string; para_nome: string; economia: number; impacto_fps_pct: number | null; texto: string }
export interface Resultado {
  lojas: Record<string, LinhaCompra[]>; total_por_loja: Record<string, number>; total: number; orcamento: number;
  cabe: boolean; diferenca: number; sem_preco: string[]; ja_tenho: string[]; trocas: Troca[]; frete: string;
}
export interface Oferta { loja: string; preco: number; url: string; titulo: string; coletado_em: string }
export interface ResultadoPreco {
  componente_id: string; ofertas: Oferta[]; descartes: { loja: string; titulo: string; motivo: string }[];
  preco_min: number | null; preco_med: number | null; preco_max: number | null; confianca: string | null;
  do_cache: boolean; vencido: boolean; historico: { loja: string; preco: number; coletado_em: string }[];
}
export interface Importacao { itens: BuildItem[]; nao_reconhecidas: string[]; avisos: string[] }
export interface Cena {
  /** `origem`: URL da ficha para os campos de `specs` que vieram de extração (campo → URL). */
  pecas: { id: string; tipo: Tipo; nome: string; specs: Record<string, any>; origem?: Record<string, string> }[];
  conflitos: { id: string; itens: string[]; descricao: string; severidade: Severidade }[];
  passos: { tipo: Tipo; texto: string }[];
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
  saude: () => req<{ ok: boolean; llm: string; dados: string }>("/saude"),
  jogos: () => req<{ jogos: { id: string; nome: string }[]; resolucoes: string[]; preset: string }>("/jogos"),
  builds: () => req<Build[]>("/builds"),
  build: (id: string) => req<Build>(`/builds/${id}`),
  criar: (dados: Pick<Build, "modo" | "orcamento" | "cep" | "objetivos">) => post<Build>("/builds", dados),
  atualizar: (id: string, dados: Pick<Build, "modo" | "orcamento" | "cep" | "objetivos">) =>
    req<Build>(`/builds/${id}`, { method: "PATCH", body: JSON.stringify(dados) }),
  componentes: (tipo: Tipo, buildId: string, todos: boolean) =>
    req<Componente[]>(`/componentes?tipo=${tipo}&build_id=${buildId}&todos=${todos}`),
  catalogo: () => req<Componente[]>("/componentes"),
  adicionar: (id: string, componente_id: string, extra: Partial<BuildItem> = {}) =>
    post<Build>(`/builds/${id}/itens`, { componente_id, ...extra }),
  atualizarItem: (id: string, cid: string, dados: Partial<Pick<BuildItem, "quantidade" | "travado" | "ja_tenho">>) =>
    req<Build>(`/builds/${id}/itens/${cid}`, { method: "PATCH", body: JSON.stringify(dados) }),
  remover: (id: string, cid: string) => req<Build>(`/builds/${id}/itens/${cid}`, { method: "DELETE" }),
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
