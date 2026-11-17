// Cena 3D no navegador: carrega sem erro, abre e fecha peça e build explodida (clique e teclado), conflito leva a câmera,
// passo a passo avança e volta, controles cabem em 390 px e a taxa de quadros fica acima do piso.
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const METAS = { modo: "agente", orcamento: 6000, cep: "", objetivos: { jogos: ["cyberpunk-2077"], resolucao: "1080p", fps_alvo: 60 } };

/** Build fixa do seed: a proposta do agente (sem LLM é determinística), mais as trocas pedidas. */
async function criarBuild(request: APIRequestContext, trocas: string[] = []): Promise<string> {
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
async function abrirCena(page: Page, id: string): Promise<string[]> {
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

const pecas = (page: Page) => page.getByRole("group", { name: "Abrir peça em vista explodida" });

test.describe("build do seed", () => {
  let id: string;
  test.beforeAll(async ({ request }) => { id = await criarBuild(request); });

  test("a cena carrega sem erro e tem descrição textual", async ({ page }) => {
    const erros = await abrirCena(page, id);
    const canvas = page.getByTestId("cena").locator("canvas");
    const descricao = page.locator(`[id="${await canvas.getAttribute("aria-describedby")}"]`);
    await expect(descricao).toHaveText(/\S/);
    await page.waitForTimeout(1500);
    expect(erros).toEqual([]);
  });

  test("abre e fecha a vista explodida de uma peça por clique e por teclado", async ({ page }) => {
    const erros = await abrirCena(page, id);
    const gpu = pecas(page).getByRole("button", { name: "GPU" });
    await gpu.click();
    await expect(gpu).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cena")).not.toHaveAttribute("data-aberta", "");
    await expect(page.getByTestId("dados-peca")).toContainText("Dados desta peça");
    await gpu.click();
    await expect(gpu).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("dados-peca")).toHaveCount(0);

    for (const tecla of ["Enter", "Space"]) {
      await gpu.focus();
      await page.keyboard.press(tecla);
      await expect(gpu).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Escape");
      await expect(gpu).toHaveAttribute("aria-pressed", "false");
    }
    expect(erros).toEqual([]);
  });

  test("Explodir build liga e desliga, e a peça aberta volta para a build explodida", async ({ page }) => {
    const erros = await abrirCena(page, id);
    const explodir = page.getByTestId("explodir");
    await expect(explodir).toHaveText("Explodir build");
    await explodir.click();
    await expect(explodir).toHaveAttribute("aria-pressed", "true");
    await explodir.click();
    await expect(explodir).toHaveAttribute("aria-pressed", "false");

    await explodir.focus();
    await page.keyboard.press("Enter");
    await expect(explodir).toHaveAttribute("aria-pressed", "true");
    const gpu = pecas(page).getByRole("button", { name: "GPU" });
    await gpu.click();
    await expect(gpu).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");   // fecha só a peça
    await expect(gpu).toHaveAttribute("aria-pressed", "false");
    await expect(explodir).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");   // desfaz a build explodida
    await expect(explodir).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(1500);       // a animação de volta roda sem erro
    expect(erros).toEqual([]);
  });

  test("o passo a passo avança e volta", async ({ page }) => {
    const erros = await abrirCena(page, id);
    await page.getByTestId("tutorial").click();
    const texto = page.getByTestId("passo-texto");
    await expect(texto).toContainText("Passo 1 de");
    const primeiro = await texto.textContent();
    await expect(page.getByTestId("anterior")).toBeDisabled();
    await page.getByTestId("proximo").click();
    await expect(texto).toContainText("Passo 2 de");
    await page.getByTestId("proximo").click();
    await expect(texto).toContainText("Passo 3 de");
    await page.getByTestId("anterior").click();
    await page.getByTestId("anterior").click();
    await expect(texto).toHaveText(primeiro!);
    await page.getByTestId("tutorial").click();
    await expect(texto).toHaveCount(0);
    expect(erros).toEqual([]);
  });

  test("os controles cabem em 390 px de largura", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrirCena(page, id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const b of await page.locator('section[aria-label="Cena 3D"] button').all()) {
      const caixa = (await b.boundingBox())!;
      expect(caixa.x).toBeGreaterThanOrEqual(0);
      expect(caixa.x + caixa.width).toBeLessThanOrEqual(390);
    }
  });

  test("taxa de quadros com a build completa, parada e girando", async ({ page }) => {
    await abrirCena(page, id);
    await page.waitForTimeout(2000);   // câmera assentada, malhas compiladas
    const renderizador = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "desconhecido";
    });
    const medir = () => page.evaluate(() => new Promise<number>((ok) => {
      let n = 0;
      const t0 = performance.now();
      const quadro = (t: number) => { n++; t - t0 < 3000 ? requestAnimationFrame(quadro) : ok((n * 1000) / (t - t0)); };
      requestAnimationFrame(quadro);
    }));
    const parado = await medir();
    const caixa = (await page.getByTestId("cena").boundingBox())!;
    const [cx, cy] = [caixa.x + caixa.width / 2, caixa.y + caixa.height / 2];
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    const medindo = medir();
    for (let i = 0; i < 150; i++) {   // ~3 s de arraste em vaivém
      await page.mouse.move(cx + 200 * Math.sin(i / 12), cy + 60 * Math.sin(i / 20));
      await page.waitForTimeout(16);
    }
    const girando = await medindo;
    await page.mouse.up();

    const software = /swiftshader|llvmpipe|software/i.test(renderizador);
    const relato = `renderizador: ${renderizador} · parado: ${parado.toFixed(1)} q/s · girando: ${girando.toFixed(1)} q/s`;
    test.info().annotations.push({ type: "quadros por segundo", description: relato });
    console.log(relato);
    // Piso da spec: 30 q/s num notebook comum, isto é, com GPU. Em renderização por software (CI sem GPU) o número mede
    // a CPU rasterizando, não a cena; ali o limite é 10 q/s, só para pegar uma regressão grosseira.
    const piso = software ? 10 : 30;
    expect(parado, relato).toBeGreaterThanOrEqual(piso);
    expect(girando, relato).toBeGreaterThanOrEqual(piso);
  });
});

test.describe("build com conflito físico", () => {
  let id: string;
  // GPU de 340 mm num gabinete que aceita 330 mm
  test.beforeAll(async ({ request }) => { id = await criarBuild(request, ["case-nr200p", "rtx-4080s"]); });
  const daGpu = (page: Page) => page.getByTestId("conflito").filter({ hasText: "GPU de 340 mm não cabe" });

  test("clicar num conflito da lista leva a câmera até ele", async ({ page }) => {
    const erros = await abrirCena(page, id);
    const canvas = page.getByTestId("cena").locator("canvas");
    await expect(canvas).toHaveAttribute("data-alvo", "0.00,0.00,0.00");   // montada: olha para o centro
    await daGpu(page).click();
    await expect(daGpu(page)).toHaveAttribute("aria-current", "true");
    await expect(canvas).not.toHaveAttribute("data-alvo", "0.00,0.00,0.00");
    // por teclado, de dentro da build explodida: volta à montada e foca
    await page.getByTestId("explodir").click();
    await daGpu(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("explodir")).toHaveAttribute("aria-pressed", "false");
    await expect(daGpu(page)).toHaveAttribute("aria-current", "true");
    expect(erros).toEqual([]);
  });

  test("o conflito mostra a medida do excesso na lista e na cena", async ({ page }) => {
    await abrirCena(page, id);
    await expect(daGpu(page).getByTestId("conflito-medida")).toHaveText(/passa \d+ mm/);
    await expect(page.getByTestId("medida-cena").first()).toHaveText(/passa \d+ mm/);
  });
});
