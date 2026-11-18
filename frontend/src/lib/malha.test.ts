// Malhas fundidas do renderizador: a geometria de cada subpeça fica no envelope dela e as faixas dão o rótulo certo.
import { Box3, BufferAttribute, BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { malhaLote } from "../components/Peca3D";
import { coolerModelo, cpuModelo } from "./cpu";
import { fonteModelo, gabineteModelo } from "./gabinete";
import { gpuModelo } from "./gpu";
import { lotes } from "./peca";
import { placaMaeModelo } from "./placa";
import { ramModelo } from "./ram";

describe("malhaLote", () => {
  const modelos = [gpuModelo({ dimensoes: { c: 340, a: 120, l: 60 }, conectores: { "8pin": 3 } }), gpuModelo({ dimensoes: { c: 170, a: 120, l: 40 } }),
    placaMaeModelo({ form_factor: "ITX", m2_dissipador: true, portas_traseiras: ["PS/2", "USB-A", "audio"] }),
    gabineteModelo({ fans_inclusos: 3, lateral: "chapa" }), fonteModelo({}), cpuModelo({}), coolerModelo({}), ramModelo({ modulos: 2, altura_mm: 40 })];

  it("cada faixa de triângulos é uma subpeça, dentro do envelope dela (perfil e curva inclusos)", () => {
    for (const m of modelos) for (const l of lotes(m.partes).filter((x) => x.subs[0].forma.tipo !== "fan")) {
      const { geo, faixas, contorno } = malhaLote(l), pos = geo.attributes.position;
      expect(faixas.map((f) => f.nome.replace(/ \((estimado|norma)\)$/, ""))).toEqual(l.subs.map((s) => s.nome));
      expect(faixas.at(-1)!.fim).toBe(pos.count / 3);
      expect(contorno.length % 6).toBe(0);
      l.subs.forEach((s, i) => {
        const ini = (faixas[i - 1]?.fim ?? 0) * 3, fim = faixas[i].fim * 3;
        expect(fim).toBeGreaterThan(ini);
        const caixa = new Box3().setFromBufferAttribute(new BufferAttribute((pos.array as Float32Array).slice(ini * 3, fim * 3), 3));
        const centro = s.pos.map((v, k) => v - l.pos[k]);
        // a curva arredonda as dobras e pode passar um pouco do envelope; as outras formas ficam exatas
        const folga = s.forma.tipo === "curva" ? s.forma.raio : 0.01;
        (["x", "y", "z"] as const).forEach((e, k) => {
          expect([s.id, e, caixa.min[e] >= centro[k] - s.tam[k] / 2 - folga, caixa.max[e] <= centro[k] + s.tam[k] / 2 + folga]).toEqual([s.id, e, true, true]);
          if (s.forma.tipo === "perfil") expect(caixa.max[e] - caixa.min[e]).toBeCloseTo(s.tam[k], 3);   // o perfil preenche o envelope
        });
      });
      expect(geo).toBeInstanceOf(BufferGeometry);
    }
  });
});
