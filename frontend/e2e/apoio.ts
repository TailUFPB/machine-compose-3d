// Apoio dos testes de navegador: build fixa do seed criada pela API e página aberta na aba 3D.
import { type APIRequestContext, type Page, expect } from "@playwright/test";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const METAS = { modo: "agente", orcamento: 6000, cep: "", objetivos: { jogos: ["cyberpunk-2077"], resolucao: "1080p", fps_alvo: 60 } };

/** Build fixa do seed: a proposta do agente (sem LLM é determinística), mais as trocas pedidas. */
export async function criarBuild(request: APIRequestContext, trocas: string[] = []): Promise<string> {
  const post = async (caminho: string, data: unknown = {}) => {
    const r = await request.post(`${API}${caminho}`, { data });
    expect(r.ok(), `${caminho}: ${r.status()}`).toBeTruthy();
    return r.json();
  };
  const { id } = await post("/builds", METAS);
  const proposta = await post(`/builds/${id}/agente`);
  await post(`/builds/${id}/aplicar`, { itens: proposta.itens });
  for (const componente_id of trocas) await post(`/builds/${id}/itens`, { componente_id });
  return id;
}

/** Abre a página na build pedida, na aba 3D, e devolve os erros de console e de página vistos desde então. */
export async function abrirCena(page: Page, id: string): Promise<string[]> {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") erros.push(`console: ${m.text()}`); });
  await page.goto("/");
  await page.getByLabel("Trocar de build").selectOption(id);
  await page.getByRole("navigation", { name: "Etapas" }).getByRole("link", { name: "3D" }).click();
  await expect(page.getByTestId("cena").locator("canvas")).toBeVisible();
  await expect(page.locator("canvas[data-alvo]")).toBeVisible();   // a câmera já rodou ao menos um quadro
  return erros;
}
