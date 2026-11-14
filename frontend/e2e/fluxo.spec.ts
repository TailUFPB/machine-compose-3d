// Fluxo de ar na cena (docs/superpowers/specs/2026-11-14-fluxo-de-ar-design.md): botão liga setas e partículas,
// some ao explodir ou abrir peça, Esc desliga, pacote de ventoinhas aparece, taxa de quadros com o fluxo ligado.
import { type Page, expect, test } from "@playwright/test";
import { API, abrirCena, criarBuild, qualidade } from "./apoio";

const cena = (page: Page) => page.getByTestId("cena");
const botao = (page: Page) => page.getByTestId("fluxo-ar");

test.describe("fluxo de ar na cena", () => {
  test("botão liga e desliga o fluxo", async ({ page, request }) => {
    const erros = await abrirCena(page, await criarBuild(request));
    await expect(cena(page)).toHaveAttribute("data-fluxo", "off");
    await botao(page).click();
    await expect(cena(page)).toHaveAttribute("data-fluxo", "on");
    await expect(botao(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("descricao-cena")).toContainText("Fluxo de ar:");
    await page.waitForTimeout(1000);
    await botao(page).click();
    await expect(cena(page)).toHaveAttribute("data-fluxo", "off");
    await expect(page.getByTestId("descricao-cena")).not.toContainText("Fluxo de ar:");
    expect(erros).toEqual([]);
  });

  test("fluxo some ao explodir e ao abrir peça", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await botao(page).click();
    await page.getByTestId("explodir").click();
    await expect(cena(page)).toHaveAttribute("data-fluxo", "off");
    await page.getByTestId("explodir").click();
    await botao(page).click();
    await page.locator('[data-testid^="abrir-"]').last().click();
    await expect(cena(page)).toHaveAttribute("data-fluxo", "off");
  });

  test("Esc desliga o fluxo sem fechar nada", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await botao(page).click();
    await page.keyboard.press("Escape");
    await expect(cena(page)).toHaveAttribute("data-fluxo", "off");
    await expect(cena(page)).toHaveAttribute("data-aberta", "");
  });

  test("pacote de ventoinhas aparece na cena", async ({ page, request }) => {
    const id = await criarBuild(request, ["case-h5-flow"]);
    await abrirCena(page, id);
    const antes = await cena(page).getAttribute("data-ventoinhas");
    expect(antes).toBe("1:1");
    expect((await request.post(`${API}/builds/${id}/itens`, { data: { componente_id: "ext-fan-3pack" } })).ok()).toBeTruthy();
    await abrirCena(page, id);
    await expect(cena(page)).toHaveAttribute("data-ventoinhas", "3:2");
  });

  test("botão do fluxo cabe em 390 px", async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrirCena(page, await criarBuild(request));
    const caixa = (await botao(page).boundingBox())!;
    expect(caixa.x).toBeGreaterThanOrEqual(0);
    expect(caixa.x + caixa.width).toBeLessThanOrEqual(390);
  });

  test("taxa de quadros com o fluxo ligado, em Alta", async ({ page, request }) => {
    await qualidade(page, "alta");
    await abrirCena(page, await criarBuild(request));
    await botao(page).click();
    await page.waitForTimeout(2000);
    const renderizador = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "desconhecido";
    });
    const qps = await page.evaluate(() => new Promise<number>((ok) => {
      let n = 0;
      const t0 = performance.now();
      const quadro = (t: number) => { n++; t - t0 < 3000 ? requestAnimationFrame(quadro) : ok((n * 1000) / (t - t0)); };
      requestAnimationFrame(quadro);
    }));
    const relato = `fluxo ligado (Alta) · renderizador: ${renderizador} · ${qps.toFixed(1)} q/s`;
    test.info().annotations.push({ type: "quadros por segundo", description: relato });
    console.log(relato);
    expect(qps, relato).toBeGreaterThanOrEqual(/swiftshader|llvmpipe|software/i.test(renderizador) ? 10 : 30);
  });
});
