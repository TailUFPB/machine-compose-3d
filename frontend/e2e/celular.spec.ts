// Celular na cena 3D (docs/superpowers/specs/2026-11-14-celular-design.md): qualidade Auto/Alta/Leve, toque no lugar
// do hover, 1 dedo rola a página e 2 dedos giram e aproximam.
import { type Page, expect, test } from "@playwright/test";
import { abrirCena, criarBuild } from "./apoio";

const cena = (page: Page) => page.getByTestId("cena");
const CELULAR = { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } };

/** Taxa de quadros por 3 s, como no teste da cena. */
const medir = (page: Page) => page.evaluate(() => new Promise<number>((ok) => {
  let n = 0;
  const t0 = performance.now();
  const quadro = (t: number) => { n++; t - t0 < 3000 ? requestAnimationFrame(quadro) : ok((n * 1000) / (t - t0)); };
  requestAnimationFrame(quadro);
}));

test.describe("qualidade no notebook", () => {
  test("no notebook o Auto fica em Alta", async ({ page, request }) => {
    const erros = await abrirCena(page, await criarBuild(request));
    await expect(cena(page)).toHaveAttribute("data-escolha", "auto");
    await expect(cena(page)).toHaveAttribute("data-qualidade", "alta");
    await expect(page.getByTestId("qualidade-auto")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "Qualidade" })).toContainText("Auto (alta)");
    expect(erros).toEqual([]);
  });

  test("escolher Alta fica guardado", async ({ page, request }) => {
    const id = await criarBuild(request);
    await abrirCena(page, id);
    await page.getByTestId("qualidade-leve").click();
    await expect(cena(page)).toHaveAttribute("data-qualidade", "leve");
    await page.getByTestId("qualidade-alta").click();
    await expect(cena(page)).toHaveAttribute("data-escolha", "alta");
    await abrirCena(page, id);
    await expect(cena(page)).toHaveAttribute("data-escolha", "alta");
    await expect(cena(page)).toHaveAttribute("data-qualidade", "alta");
  });
});

test.describe("celular", () => {
  test.use(CELULAR);

  test("no celular o Auto começa Leve", async ({ page, request }) => {
    const erros = await abrirCena(page, await criarBuild(request));
    await expect(cena(page)).toHaveAttribute("data-qualidade", "leve");
    await expect(page.getByRole("group", { name: "Qualidade" })).toContainText("Auto (leve)");
    expect(erros).toEqual([]);
  });

  test("seletor de qualidade cabe em 390 px", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    for (const q of ["auto", "alta", "leve"]) {
      const caixa = (await page.getByTestId(`qualidade-${q}`).boundingBox())!;
      expect(caixa.x).toBeGreaterThanOrEqual(0);
      expect(caixa.x + caixa.width).toBeLessThanOrEqual(390);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("taxa de quadros no celular em Leve, com CPU 4× mais lenta", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await expect(cena(page)).toHaveAttribute("data-qualidade", "leve");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.waitForTimeout(2000);
    const renderizador = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "desconhecido";
    });
    const parado = await medir(page);
    const caixa = (await cena(page).locator("canvas").boundingBox())!;
    const [cx, cy] = [caixa.x + caixa.width / 2, caixa.y + caixa.height / 2];
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const medindo = medir(page);
    for (let i = 0; i < 150; i++) {
      await page.mouse.move(cx + 120 * Math.sin(i / 12), cy + 40 * Math.sin(i / 20));
      await page.waitForTimeout(16);
    }
    const girando = await medindo;
    await page.mouse.up();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const relato = `celular emulado (Leve, CPU 4×) · renderizador: ${renderizador} · parado: ${parado.toFixed(1)} q/s · girando: ${girando.toFixed(1)} q/s`;
    test.info().annotations.push({ type: "quadros por segundo", description: relato });
    console.log(relato);
    const piso = /swiftshader|llvmpipe|software/i.test(renderizador) ? 10 : 30;
    expect(parado, relato).toBeGreaterThanOrEqual(piso);
    expect(girando, relato).toBeGreaterThanOrEqual(piso);
  });
});
