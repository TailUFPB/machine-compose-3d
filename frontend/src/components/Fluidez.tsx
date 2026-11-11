"use client";
// Cena de demonstração: a bola só avança quando "sai" um novo quadro na cadência do FPS previsto (com o engasgo do 1% low).
import { useEffect, useRef } from "react";
import { quadroEm } from "@/lib/formato";

export default function Fluidez({ fps, low, rotulo }: { fps: number; low: number; rotulo: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    let raf = 0, ultimo = -1;
    const t0 = performance.now();
    const desenhar = (agora: number) => {
      const q = quadroEm(agora - t0, fps, low);
      if (q !== ultimo) {
        ultimo = q;
        const t = (q / fps) % 2;                       // posição no instante do quadro, ida e volta em 2 s
        const x = 32 + (cv.width - 64) * (t < 1 ? t : 2 - t);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = "#66c0f4";
        ctx.beginPath();
        ctx.arc(x, cv.height / 2, 24, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(desenhar);
    };
    raf = requestAnimationFrame(desenhar);
    return () => cancelAnimationFrame(raf);
  }, [fps, low]);
  return (
    <figure className="fluidez" style={{ margin: 0 }}>
      <canvas ref={ref} width={840} height={128} aria-label={`Demonstração de fluidez a ${Math.round(fps)} FPS`} />
      <figcaption><span className="num" style={{ color: "var(--text)" }}>{rotulo}: {Math.round(fps)} FPS</span>, 1% low {Math.round(low)}. Limitado pela taxa do seu monitor.</figcaption>
    </figure>
  );
}
