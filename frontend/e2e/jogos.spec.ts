import { expect, test } from "@playwright/test";

test("cria uma build sem metas de jogos e configura o desempenho depois de montar", async ({ page }) => {
  await page.goto("/#nova");
  await expect(page.getByRole("heading", { name: "Nova build" })).toBeVisible();
  await expect(page.getByLabel("FPS desejado")).toHaveCount(0);
  await expect(page.getByText("Resolução", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Cyberpunk 2077" })).toHaveCount(0);
  await page.getByRole("button", { name: "Criar build" }).click();
  await expect(page.getByRole("heading", { name: /^Build de R\$/ })).not.toContainText("FPS");

  const jogos = page.getByRole("link", { name: "Jogos" });
  await jogos.click();
  await expect(page.getByText(/Adicione processador e placa de vídeo/)).toBeVisible();
  await expect(page.getByRole("form", { name: "Metas de jogos" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ir para Peças" }).click();
  await expect(page).toHaveURL(/#pecas$/);

  await page.getByRole("link", { name: "Resumo" }).click();
  await page.getByRole("button", { name: "Montar com o agente" }).click();
  await page.getByRole("button", { name: "Aplicar na build" }).click();
  await expect(page.getByRole("button", { name: "Montar de novo" })).toBeVisible();
  await page.getByRole("button", { name: "Ver desempenho em jogos" }).click();

  const jogo = page.getByRole("checkbox", { name: "Cyberpunk 2077" });
  await jogo.check();
  await page.getByLabel("Resolução").selectOption("1440p");
  await page.getByLabel("FPS desejado").fill("90");
  await page.getByRole("button", { name: "Ver desempenho", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Cyberpunk 2077" })).toBeVisible();
  await expect(page.getByText(/1440p .* alvo de 90 FPS/)).toBeVisible();
  await expect(page.getByRole("form", { name: "Metas de jogos" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("cell", { name: "Cyberpunk 2077" })).toBeVisible();
  await page.getByRole("button", { name: "Editar jogos e metas" }).click();
  await expect(jogo).toBeChecked();
  await expect(page.getByLabel("FPS desejado")).toHaveValue("90");
  await jogo.uncheck();
  await page.getByRole("button", { name: "Limpar seleção" }).click();
  await expect(page.getByRole("heading", { name: "Desempenho previsto" })).toHaveCount(0);
});
