// Vistas prontas da câmera e régua de folga (docs/superpowers/specs/2026-11-14-vistas-folgas-design.md).
import { type Page, expect, test } from "@playwright/test";
import { abrirCena, criarBuild } from "./apoio";

const cena = (page: Page) => page.getByTestId("cena");
const camera = (page: Page) => page.locator("canvas[data-camera]").getAttribute("data-camera");
/** Espera a câmera parar de andar (a animação de foco dura ~1,2 s). */
const parada = async (page: Page) => { await page.waitForTimeout(1500); return camera(page); };

test.describe("vistas prontas", () => {
  test("vistas mudam a câmera e girar volta para Livre", async ({ page, request }) => {
    const erros = await abrirCena(page, await criarBuild(request));
    const inicial = await parada(page);
    await page.getByTestId("vista-lateral").click();
    await expect(cena(page)).toHaveAttribute("data-vista", "lateral");
    await expect(page.getByTestId("vista-lateral")).toHaveAttribute("aria-pressed", "true");
    expect(await parada(page)).not.toBe(inicial);
    const caixa = (await cena(page).locator("canvas").boundingBox())!;
    await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await page.mouse.down();
    await page.mouse.move(caixa.x + caixa.width / 2 + 120, caixa.y + caixa.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(cena(page)).toHaveAttribute("data-vista", "livre");
    expect(erros).toEqual([]);
  });

  test("Livre volta à posição inicial", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    const inicial = await parada(page);
    await page.getByTestId("vista-topo").click();
    expect(await parada(page)).not.toBe(inicial);
    await page.getByTestId("vista-livre").click();
    expect(await parada(page)).toBe(inicial);
  });

  test("os botões de vista cabem em 390 px", async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrirCena(page, await criarBuild(request));
    for (const v of ["livre", "frente", "lateral", "topo"]) {
      const caixa = (await page.getByTestId(`vista-${v}`).boundingBox())!;
      expect(caixa.x).toBeGreaterThanOrEqual(0);
      expect(caixa.x + caixa.width).toBeLessThanOrEqual(390);
    }
  });
});
