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
