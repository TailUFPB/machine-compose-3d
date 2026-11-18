// Teste da cena no navegador (docs/SPEC-VISTA-3D-COMPLETA.md, "Cena no navegador"). Roda contra a API com o seed.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1,          // a página mostra a última build criada: um teste por vez
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1280, height: 900 },
    // WebGL pela GPU da máquina quando houver; sem isso o headless cai em renderização por software
    launchOptions: { args: ["--ignore-gpu-blocklist", "--enable-gpu", process.platform === "darwin" ? "--use-angle=metal" : "--use-gl=angle"] },
  },
  webServer: [
    { command: "uv run uvicorn app.main:app", cwd: "../backend", url: "http://localhost:8000/saude", reuseExistingServer: true, timeout: 120_000 },
    { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
  ],
});
