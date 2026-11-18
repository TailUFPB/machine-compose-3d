// Celular na cena 3D (docs/superpowers/specs/2026-11-14-celular-design.md): qualidade Auto/Alta/Leve, toque no lugar
// do hover, 1 dedo rola a página e 2 dedos giram e aproximam.
import { type CDPSession, type Page, expect, test } from "@playwright/test";
import { abrirCena, criarBuild } from "./apoio";

const cena = (page: Page) => page.getByTestId("cena");
const CELULAR = { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } };

const etiqueta = (page: Page) => page.locator(".cena .etiqueta");
const linhaAtiva = (page: Page) => page.locator('[data-testid^="linha-"].ativo');
const camera = async (page: Page) => (await page.locator("canvas[data-camera]").getAttribute("data-camera"))!.split(",").map(Number);
const norma = (v: number[]) => Math.hypot(...v);
const canvas = async (page: Page) => (await cena(page).locator("canvas").boundingBox())!;

/** Toca pontos de uma grade 3×3 no canvas até um mostrar o nome (e, com `peca`, acender uma linha do painel: não o gabinete). */
async function tocarAteMostrar(page: Page, peca: boolean): Promise<[number, number]> {
  const c = await canvas(page);
  for (const fy of [0.5, 0.35, 0.65]) for (const fx of [0.5, 0.35, 0.65]) {
    const p: [number, number] = [c.x + c.width * fx, c.y + c.height * fy];
    await page.touchscreen.tap(...p);
    await page.waitForTimeout(150);
    if (await etiqueta(page).isVisible() && (!peca || (await linhaAtiva(page).count()) > 0)) return p;
  }
  throw new Error("nenhum ponto da grade acertou uma peça");
}

/** Dois dedos andando juntos na horizontal (sem pinça), por CDP. */
async function doisDedos(cdp: CDPSession, x: number, y: number, dx: number) {
  const pontos = (d: number) => [{ x: x - 40 + d, y, id: 1 }, { x: x + 40 + d, y, id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pontos(0) });
  for (let i = 1; i <= 12; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pontos((dx * i) / 12) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

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

  test("sem toque, sem dica de toque", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await expect(page.getByTestId("dica-toque")).toHaveCount(0);
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

  test("primeiro toque mostra a peça, o segundo abre", async ({ page, request }) => {
    const erros = await abrirCena(page, await criarBuild(request));
    await page.getByTestId("vista-lateral").click();
    await page.waitForTimeout(1500);
    const p = await tocarAteMostrar(page, true);
    await expect(page.getByTestId("detalhe-peca")).toHaveCount(0);
    await expect(cena(page)).toHaveAttribute("data-aberta", "");
    await page.touchscreen.tap(...p);
    await expect(page.getByTestId("detalhe-peca")).toBeVisible();
    await expect(cena(page)).not.toHaveAttribute("data-aberta", "");
    expect(erros).toEqual([]);
  });

  test("toque no vazio apaga o destaque", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await page.getByTestId("vista-lateral").click();
    await page.waitForTimeout(1500);
    await tocarAteMostrar(page, true);
    const c = await canvas(page);
    await page.touchscreen.tap(c.x + 6, c.y + 6);
    await expect(etiqueta(page)).toHaveCount(0);
    await expect(linhaAtiva(page)).toHaveCount(0);
  });

  test("um dedo rola a página sem girar a cena", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await page.waitForTimeout(1500);
    await cena(page).locator("canvas").scrollIntoViewIfNeeded();
    const antes = await camera(page), rolagem = await page.evaluate(() => scrollY);
    const c = await canvas(page);   // coordenadas na janela: o gesto começa em cima do canvas
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.synthesizeScrollGesture", { x: Math.round(c.x + c.width / 2), y: Math.round(Math.min(c.y + c.height * 0.7, 800)), yDistance: -250, gestureSourceType: "touch", speed: 600 });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(rolagem + 50);
    expect(await camera(page)).toEqual(antes);
  });

  test("dois dedos giram a cena em torno do alvo", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await page.getByTestId("vista-frente").click();
    await cena(page).locator("canvas").scrollIntoViewIfNeeded();   // o gesto precisa cair dentro da janela
    await page.waitForTimeout(1500);
    const antes = await camera(page);
    const alvoAntes = await page.locator("canvas[data-alvo]").getAttribute("data-alvo");
    const c = await canvas(page);
    const cdp = await page.context().newCDPSession(page);
    await doisDedos(cdp, c.x + c.width / 2, c.y + c.height / 2, 120);
    await page.waitForTimeout(300);
    const depois = await camera(page);
    expect(depois).not.toEqual(antes);
    expect(Math.abs(norma(depois) / norma(antes) - 1)).toBeLessThan(0.03);   // mesma distância: não aproximou
    await expect(page.locator("canvas[data-alvo]")).toHaveAttribute("data-alvo", alvoAntes!);   // girou em torno do alvo, não arrastou
    await expect(cena(page)).toHaveAttribute("data-vista", "livre");
    await expect(etiqueta(page)).toHaveCount(0);
    await expect(page.getByTestId("detalhe-peca")).toHaveCount(0);
  });

  test("no passo a passo o toque mostra o nome e não abre", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await page.getByTestId("tutorial").click();
    for (let i = 0; i < 3; i++) await page.getByTestId("proximo").click();
    await page.waitForTimeout(1500);
    const p = await tocarAteMostrar(page, false);
    await page.touchscreen.tap(...p);
    await page.waitForTimeout(300);
    await expect(etiqueta(page)).toBeVisible();
    await expect(cena(page)).toHaveAttribute("data-aberta", "");
  });

  test("cabo ainda não ligado não engole o toque: no passo a passo, o toque acha o mesmo que o mouse", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await page.getByTestId("tutorial").click();
    for (let i = 0; i < 4; i++) await page.getByTestId("proximo").click();   // placa, CPU, cooler e memória no lugar; cabos ainda não
    await page.waitForTimeout(2000);
    const c = await canvas(page);
    const diferentes: string[] = [];
    for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
      const p: [number, number] = [c.x + (c.width * i) / 8, c.y + (c.height * j) / 8];
      await page.touchscreen.tap(c.x + 2, c.y + 2);   // limpa o toque anterior (canto vazio)
      await page.mouse.move(...p);
      await page.waitForTimeout(80);
      const peloMouse = (await etiqueta(page).count()) ? await etiqueta(page).textContent() : null;
      await page.mouse.move(c.x + c.width + 5, c.y - 5);   // mouse sai do canvas
      await page.touchscreen.tap(...p);
      await page.waitForTimeout(80);
      const peloToque = (await etiqueta(page).count()) ? await etiqueta(page).textContent() : null;
      if (peloMouse !== peloToque) diferentes.push(`${i},${j}: mouse ${peloMouse} · toque ${peloToque}`);
    }
    expect(diferentes).toEqual([]);
  });

  test("toque na prévia mostra o nome e não descarta a prévia", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request, ["case-nr200p"]));
    await page.getByTestId("linha-rtx-5060-8g").click();
    await page.getByTestId("trocar").click();
    await page.getByTestId("ver-incompativeis").check();
    await page.getByTestId("candidata-rtx-4080s").click();
    await expect(page.getByTestId("selo-previa")).toBeVisible();
    await cena(page).locator("canvas").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const p = await tocarAteMostrar(page, false);
    await page.touchscreen.tap(...p);   // segundo toque: na prévia não abre
    await page.waitForTimeout(300);
    await expect(page.getByTestId("selo-previa")).toBeVisible();
    const c = await canvas(page);
    await page.touchscreen.tap(c.x + 6, c.y + 6);   // toque no vazio só apaga o nome
    await page.waitForTimeout(300);
    await expect(page.getByTestId("selo-previa")).toBeVisible();
    await expect(cena(page)).toHaveAttribute("data-previa", "rtx-4080s");
  });

  test("abrir outra peça pelos botões apaga o toque anterior", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await page.getByTestId("vista-lateral").click();
    await page.waitForTimeout(1500);
    await tocarAteMostrar(page, true);
    await page.locator('[data-testid^="abrir-"]').last().click();
    await expect(cena(page)).not.toHaveAttribute("data-aberta", "");
    await page.waitForTimeout(300);
    await expect(etiqueta(page)).toHaveCount(0);
    await expect(linhaAtiva(page)).toHaveCount(0);
  });

  test("dica de toque aparece no celular", async ({ page, request }) => {
    await abrirCena(page, await criarBuild(request));
    await expect(page.getByTestId("dica-toque")).toHaveText("Dois dedos giram e aproximam a cena.");
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
