// Painel ao lado da cena 3D: lista da build com hover sincronizado, detalhe da peça (ficha, preço, motivo), remover e
// trocar com prévia na cena antes de aplicar (docs/superpowers/specs/2026-11-13-cena-paineis-design.md).
import { type Page, expect, test } from "@playwright/test";
import { API, abrirCena, criarBuild } from "./apoio";

const GPU = "rtx-5060-8g";   // GPU que o agente escolhe para a build fixa do seed
const painel = (page: Page) => page.getByRole("region", { name: "Peças da build" });
const linha = (page: Page, id: string) => page.getByTestId(`linha-${id}`);

test.describe("painel da build", () => {
  test("hover na linha destaca a peça", async ({ page, request }) => {
    const erros = await abrirCena(page, await criarBuild(request));
    await linha(page, GPU).hover();
    await expect(page.getByTestId("cena")).toHaveAttribute("data-destaque", GPU);
    await expect(linha(page, GPU)).toHaveClass(/ativo/);
    await linha(page, "ssd-nv3-1t").focus();   // teclado também destaca
    await expect(page.getByTestId("cena")).toHaveAttribute("data-destaque", "ssd-nv3-1t");
    expect(erros).toEqual([]);
  });

  test("clicar na linha abre o detalhe com ficha, preço igual ao da Compra e motivo", async ({ page, request }) => {
    const id = await criarBuild(request);
    await abrirCena(page, id);
    await linha(page, GPU).click();
    await expect(page.getByTestId("cena")).toHaveAttribute("data-aberta", GPU);
    const detalhe = page.getByTestId("detalhe-peca");
    await expect(detalhe).toContainText("VRAM");
    await expect(detalhe).toContainText("Por que foi escolhida");
    const precos = await (await request.get(`${API}/builds/${id}/precos`)).json();
    const p = precos.find((x: { componente_id: string }) => x.componente_id === GPU);
    const faixa = page.getByTestId("faixa-preco");
    await expect(faixa).toContainText(p.preco_min.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    await expect(faixa).toContainText(p.preco_max.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    await expect(detalhe.getByRole("link").first()).toHaveAttribute("href", /^https?:/);
    await detalhe.getByRole("button", { name: "Voltar à lista" }).click();
    await expect(page.getByTestId("cena")).toHaveAttribute("data-aberta", "");
  });

  test("remover pede confirmação", async ({ page, request }) => {
    const id = await criarBuild(request);
    await abrirCena(page, id);
    await linha(page, "ssd-nv3-1t").click();
    const remover = page.getByTestId("remover");
    await remover.click();
    await expect(remover).toHaveText("Confirmar remoção");
    await remover.click();
    await expect(linha(page, "ssd-nv3-1t")).toHaveCount(0);
    const build = await (await request.get(`${API}/builds/${id}`)).json();
    expect(build.itens.map((i: { componente_id: string }) => i.componente_id)).not.toContain("ssd-nv3-1t");
  });

  test("peça travada não troca nem remove", async ({ page, request }) => {
    const id = await criarBuild(request);
    await request.patch(`${API}/builds/${id}/itens/${GPU}`, { data: { travado: true } });
    await abrirCena(page, id);
    await linha(page, GPU).click();
    await expect(page.getByTestId("remover")).toBeDisabled();
    await expect(page.getByTestId("trocar")).toBeDisabled();
    await expect(page.getByTestId("detalhe-peca")).toContainText("destrave para trocar");
  });

  test("os controles do painel cabem em 390 px", async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrirCena(page, await criarBuild(request));
    await linha(page, GPU).click();
    for (const b of await painel(page).getByRole("button").all()) {
      const caixa = (await b.boundingBox())!;
      expect(caixa.x).toBeGreaterThanOrEqual(0);
      expect(caixa.x + caixa.width).toBeLessThanOrEqual(390);
    }
  });
});

test.describe("trocar com prévia", () => {
  let id: string;
  const gpuDaBuild = async (request: Parameters<typeof criarBuild>[0]) =>
    (await (await request.get(`${API}/builds/${id}`)).json()).itens.map((i: { componente_id: string }) => i.componente_id);
  /** Abre a GPU no painel, entra em Trocar e liga as incompatíveis (a GPU longa não cabe no NR200P). */
  const trocarGpu = async (page: Page) => {
    await linha(page, GPU).click();
    await page.getByTestId("trocar").click();
    await page.getByTestId("ver-incompativeis").check();
  };
  test.beforeEach(async ({ request }) => { id = await criarBuild(request, ["case-nr200p"]); });

  test("trocar mostra prévia sem gravar", async ({ page, request }) => {
    const erros = await abrirCena(page, id);
    await trocarGpu(page);
    await page.getByTestId("candidata-rtx-4080s").click();
    await expect(page.getByTestId("selo-previa")).toBeVisible();
    await expect(page.getByTestId("cena")).toHaveAttribute("data-previa", "rtx-4080s");
    await expect(page.getByTestId("medida-cena").first()).toBeVisible();
    await expect(page.getByTestId("diferenca-previa")).toContainText("R$");
    await expect(page.getByTestId("descricao-cena")).toContainText("Prévia, não aplicada.");
    expect(await gpuDaBuild(request)).toContain(GPU);
    expect(erros).toEqual([]);
  });

  test("aplicar grava e sai da prévia", async ({ page, request }) => {
    await abrirCena(page, id);
    await trocarGpu(page);
    await page.getByTestId("candidata-rtx-4080s").click();
    await expect(page.getByTestId("selo-previa")).toBeVisible();
    await page.getByRole("button", { name: "Aplicar troca" }).click();
    await expect(page.getByTestId("selo-previa")).toHaveCount(0);
    await expect(page.getByTestId("cena")).toHaveAttribute("data-aberta", "rtx-4080s");
    const ids = await gpuDaBuild(request);
    expect(ids).toContain("rtx-4080s");
    expect(ids).not.toContain(GPU);
  });

  for (const como of ["Cancelar", "Esc"] as const) {
    test(`${como} volta sem gravar`, async ({ page, request }) => {
      await abrirCena(page, id);
      await trocarGpu(page);
      await expect(page.getByTestId("cena")).toHaveAttribute("data-aberta", GPU);
      await page.getByTestId("candidata-rtx-4080s").click();
      await expect(page.getByTestId("selo-previa")).toBeVisible();
      if (como === "Esc") await page.keyboard.press("Escape");
      else await page.getByRole("button", { name: "Cancelar" }).click();
      await expect(page.getByTestId("selo-previa")).toHaveCount(0);
      await expect(page.getByTestId("cena")).toHaveAttribute("data-aberta", GPU);   // a peça aberta não fecha por baixo
      expect(await gpuDaBuild(request)).toContain(GPU);
    });
  }

  test("a última candidata vence mesmo se a primeira responder depois", async ({ page }) => {
    await abrirCena(page, id);
    await trocarGpu(page);
    await page.route("**/cena/previa", async (rota) => {   // a prévia da primeira candidata chega atrasada
      if (rota.request().postDataJSON().para === "rtx-4080s") await new Promise((r) => setTimeout(r, 1500));
      await rota.continue();
    });
    await page.getByTestId("candidata-rtx-4080s").click();
    await page.getByTestId("candidata-rx-7600").click();
    await expect(page.getByTestId("cena")).toHaveAttribute("data-previa", "rx-7600");
    await page.waitForTimeout(2000);   // depois que a resposta atrasada chegou
    await expect(page.getByTestId("cena")).toHaveAttribute("data-previa", "rx-7600");
    await expect(page.getByTestId("candidata-rx-7600")).toHaveAttribute("aria-pressed", "true");
  });

  test("build mudou durante a prévia: a prévia é descartada", async ({ page, request }) => {
    await abrirCena(page, id);
    await trocarGpu(page);
    await page.getByTestId("candidata-rtx-4080s").click();
    await expect(page.getByTestId("selo-previa")).toBeVisible();
    const etapas = page.getByRole("navigation", { name: "Etapas" });
    await etapas.getByRole("link", { name: "Peças" }).click();
    await page.getByRole("row", { name: /NV3/ }).getByRole("button", { name: "Remover" }).click();
    await expect(page.getByRole("row", { name: /NV3/ })).toHaveCount(0);
    await etapas.getByRole("link", { name: "3D" }).click();
    await expect(page.locator("canvas[data-alvo]")).toBeVisible();
    await expect(page.getByTestId("selo-previa")).toHaveCount(0);
    expect(await gpuDaBuild(request)).toContain(GPU);
  });

  test("peça travada não abre Trocar", async ({ page, request }) => {
    await request.patch(`${API}/builds/${id}/itens/${GPU}`, { data: { travado: true } });
    await abrirCena(page, id);
    await linha(page, GPU).click();
    await expect(page.getByTestId("trocar")).toBeDisabled();
  });
});

test.describe("prévia: casos da revisão final", () => {
  let id: string;
  const atrasar = (page: Page, para: string, ms = 1500) => page.route("**/cena/previa", async (rota) => {
    if (rota.request().postDataJSON().para === para) await new Promise((r) => setTimeout(r, ms));
    await rota.continue();
  });
  const trocarGpu = async (page: Page) => {
    await linha(page, GPU).click();
    await page.getByTestId("trocar").click();
    await page.getByTestId("ver-incompativeis").check();
  };
  test.beforeEach(async ({ request }) => { id = await criarBuild(request, ["case-nr200p"]); });

  test("peça que já está na build não aparece como candidata", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request, ["ssd-sn770-1t"]));
    await linha(page, "ssd-nv3-1t").click();
    await page.getByTestId("trocar").click();
    await page.getByTestId("ver-incompativeis").check();
    await expect(page.getByTestId("candidata-ssd-990pro-2t")).toBeVisible();
    await expect(page.getByTestId("candidata-ssd-sn770-1t")).toHaveCount(0);
  });

  test("voltar à lista durante a prévia descarta a prévia", async ({ page }) => {
    await abrirCena(page, id);
    await trocarGpu(page);
    await page.getByTestId("candidata-rtx-4080s").click();
    await expect(page.getByTestId("selo-previa")).toBeVisible();
    await page.getByRole("button", { name: "Voltar à lista" }).click();
    await expect(page.getByTestId("selo-previa")).toHaveCount(0);
  });

  test("Esc enquanto a prévia carrega não fecha a peça aberta", async ({ page }) => {
    await abrirCena(page, id);
    await trocarGpu(page);
    await atrasar(page, "rtx-4080s");
    await page.getByTestId("candidata-rtx-4080s").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("cena")).toHaveAttribute("data-aberta", GPU);
    await expect(page.getByTestId("detalhe-peca")).toBeVisible();
    await page.waitForTimeout(1800);   // a resposta atrasada chega depois do Esc e não pode reabrir a prévia
    await expect(page.getByTestId("selo-previa")).toHaveCount(0);
  });

  test("com a build explodida, a prévia ainda mostra o conflito", async ({ page }) => {
    await abrirCena(page, id);
    await page.getByTestId("explodir").click();
    await trocarGpu(page);
    await page.getByTestId("candidata-rtx-4080s").click();
    await expect(page.getByTestId("selo-previa")).toBeVisible();
    await expect(page.getByTestId("medida-cena").first()).toBeVisible();
  });

  test("Aplicar fica desabilitado enquanto outra candidata carrega", async ({ page }) => {
    await abrirCena(page, id);
    await trocarGpu(page);
    await page.getByTestId("candidata-rtx-4080s").click();
    await expect(page.getByTestId("selo-previa")).toBeVisible();
    await atrasar(page, "rx-7600");
    await page.getByTestId("candidata-rx-7600").click();
    await expect(page.getByRole("button", { name: "Aplicar troca" })).toBeDisabled();
    await expect(page.getByTestId("cena")).toHaveAttribute("data-previa", "rx-7600");
    await expect(page.getByRole("button", { name: "Aplicar troca" })).toBeEnabled();
  });
});
