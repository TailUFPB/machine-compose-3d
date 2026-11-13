import { describe, expect, it } from "vitest";
import { API, type Cena, ehOfertaUnica, linkOferta } from "./api";
import { foraDoGabinete, montarCena, posicaoTutorial } from "./cena";
import { brl, quadroEm } from "./formato";

const gabinete = (gpu_max: number) => ({
  id: "case", tipo: "gabinete" as const, nome: "Gabinete",
  specs: { dimensoes: { c: 376, a: 292, l: 185 }, gpu_max_mm: gpu_max },
});
const gpu = (comp: number) => ({ id: "gpu", tipo: "gpu" as const, nome: "GPU", specs: { comprimento_mm: comp, slots: 2 } });
const mb = { id: "mb", tipo: "placa_mae" as const, nome: "MB", specs: { form_factor: "ITX" } };

describe("montarCena", () => {
  it("dimensiona pela ficha e marca conflito em vermelho", () => {
    const cena: Cena = { pecas: [gabinete(330), mb, gpu(240)], conflitos: [{ id: "x", itens: ["gpu"], descricao: "", severidade: "atencao" }], passos: [] };
    const caixas = montarCena(cena);
    const g = caixas.find((c) => c.id === "gpu")!;
    expect(g.tam[0]).toBe(240);
    expect(g.conflito).toBe(true);
    expect(caixas.find((c) => c.id === "mb")!.conflito).toBe(false);
  });

  it("GPU maior que o gabinete atravessa a parede na geometria", () => {
    const longa = montarCena({ pecas: [gabinete(330), mb, gpu(400)], conflitos: [], passos: [] });
    expect(foraDoGabinete(longa)).toContain("gpu");
    const curta = montarCena({ pecas: [gabinete(330), mb, gpu(240)], conflitos: [], passos: [] });
    expect(foraDoGabinete(curta)).not.toContain("gpu");
  });
});

describe("posicaoTutorial", () => {
  const cena: Cena = { pecas: [gabinete(330), mb, gpu(240)], conflitos: [], passos: [{ tipo: "placa_mae", texto: "" }, { tipo: "gpu", texto: "" }] };
  const [, placa, placaVideo] = montarCena(cena);
  it("esconde passos futuros e anima o atual até a posição final", () => {
    expect(posicaoTutorial(placaVideo, 0, 0.5)).toBeNull();
    expect(posicaoTutorial(placa, 1, 0)).toEqual(placa.pos);
    expect(posicaoTutorial(placaVideo, 1, 1)).toEqual(placaVideo.pos);
    expect(posicaoTutorial(placaVideo, 1, 0)![2]).toBeGreaterThan(placaVideo.pos[2]);
  });
});

describe("quadroEm", () => {
  it("avança na cadência do FPS médio", () => {
    expect(quadroEm(0, 60, 60)).toBe(0);
    expect(quadroEm(1000, 60, 60)).toBe(60);
    expect(quadroEm(1000, 30, 30)).toBe(30);
  });
  it("o quadro do 1% low segura a imagem por mais tempo", () => {
    // 100 FPS médio, 1% low de 20 FPS: o primeiro quadro de cada bloco dura 50 ms
    expect(quadroEm(40, 100, 20)).toBe(0);
    expect(quadroEm(55, 100, 20)).toBe(1);
  });
});

describe("brl", () => {
  it("formata em reais", () => {
    expect(brl(1234.5).replace(/\s/g, " ")).toBe("R$ 1.234,50");
    expect(brl(null)).toBe("sem preço");
  });
});

describe("ofertas e link no clique final", () => {
  it("monta URL de redirecionamento direto no backend para o clique final", () => {
    const href = linkOferta("case-h5-flow", "Mercado Livre", "https://www.google.com/search?tbm=shop&q=NZXT H5 Flow");
    expect(href).toBe(
      `${API}/ofertas/ir?componente_id=case-h5-flow&loja=Mercado+Livre&url=https%3A%2F%2Fwww.google.com%2Fsearch%3Ftbm%3Dshop%26q%3DNZXT+H5+Flow`,
    );
  });

  it("identifica oferta de loja única sem acusar falso positivo em ausência de preço", () => {
    expect(ehOfertaUnica(1)).toBe(true);
    expect(ehOfertaUnica(0)).toBe(false);
    expect(ehOfertaUnica(2)).toBe(false);
    expect(ehOfertaUnica(null)).toBe(false);
  });
});
