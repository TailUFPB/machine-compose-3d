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

test.describe("folgas no painel", () => {
  const GPU = "rtx-5060-8g";   // GPU da build fixa do seed
  const folga = (page: Page, id: string) => page.getByTestId(`folga-${id}`);

  test("clicar numa folga leva à vista e desenha a régua", async ({ page, request }) => {
    const erros = await abrirCena(page, await criarBuild(request));
    await expect(folga(page, "gpu")).toContainText("sobram");
    await expect(folga(page, "gpu")).toContainText("mm");
    await folga(page, "gpu").click();
    await expect(cena(page)).toHaveAttribute("data-regua", "gpu");
    await expect(cena(page)).toHaveAttribute("data-vista", "lateral");
    await expect(page.getByTestId("regua-medida").first()).toBeVisible();
    await expect(page.getByTestId("descricao-cena")).toContainText("Régua:");
    await folga(page, "gpu").click();
    await expect(cena(page)).toHaveAttribute("data-regua", "");
    expect(erros).toEqual([]);
  });

  test("Esc tira só a régua e volta à vista de antes", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await page.getByTestId("vista-topo").click();
    await folga(page, "gpu").click();
    await expect(cena(page)).toHaveAttribute("data-vista", "lateral");
    await page.keyboard.press("Escape");
    await expect(cena(page)).toHaveAttribute("data-regua", "");
    await expect(cena(page)).toHaveAttribute("data-vista", "topo");
  });

  test("folga que não cabe aparece com o excesso", async ({ page, request }) => {
    const id = await criarBuild(request, ["case-nr200p"]);
    await request.post(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/builds/${id}/trocar`, { data: { de: GPU, para: "rtx-4080s" } });
    await abrirCena(page, id);
    await expect(folga(page, "gpu")).toContainText("passa 10 mm");
    await expect(folga(page, "gpu")).toHaveClass(/nao_cabe/);
  });

  test("régua some ao abrir uma peça", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await folga(page, "gpu").click();
    await expect(cena(page)).toHaveAttribute("data-regua", "gpu");
    await page.getByTestId(`linha-${GPU}`).click();
    await expect(cena(page)).toHaveAttribute("data-regua", "");
    await page.getByRole("button", { name: "Voltar à lista" }).click();
    await expect(folga(page, "gpu")).toHaveAttribute("aria-pressed", "false");
  });

  test("prévia mostra a folga que muda", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request, ["case-nr200p"]));
    await page.getByTestId(`linha-${GPU}`).click();
    await page.getByTestId("trocar").click();
    await page.getByTestId("ver-incompativeis").check();
    await page.getByTestId("candidata-rtx-4080s").click();
    await expect(page.getByTestId("diferenca-previa")).toContainText("GPU: sobram 90 mm → passa 10 mm");
  });
});
