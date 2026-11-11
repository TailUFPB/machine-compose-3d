"use client";
// Cena 3D paramétrica (React Three Fiber). Peça em conflito pulsa em vermelho; modo tutorial monta passo a passo.
import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Mesh, MeshStandardMaterial } from "three";
import type { Cena } from "@/lib/api";
import { type Caixa, montarCena, posicaoTutorial } from "@/lib/cena";

const ESCALA = 1 / 100;   // mm -> unidades da cena
const DURACAO_PASSO = 1.2; // s

function Peca({ c, passo, inicio, onHover }: { c: Caixa; passo: number | null; inicio: number; onHover: (n: string | null) => void }) {
  const ref = useRef<Mesh>(null);
  const gab = c.tipo === "gabinete";
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const pos = passo == null ? c.pos : posicaoTutorial(c, passo, (clock.elapsedTime - inicio) / DURACAO_PASSO);
    m.visible = pos != null;
    if (pos) m.position.set(pos[0] * ESCALA, pos[1] * ESCALA, pos[2] * ESCALA);
    if (c.conflito) (m.material as MeshStandardMaterial).emissiveIntensity = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4);
  });
  return (
    <mesh ref={ref} position={c.pos.map((v) => v * ESCALA) as [number, number, number]}
      onPointerOver={(e) => { if (!gab) { e.stopPropagation(); onHover(c.nome); } }} onPointerOut={() => onHover(null)}>
      <boxGeometry args={c.tam.map((v) => v * ESCALA) as [number, number, number]} />
      <meshStandardMaterial
        color={c.conflito ? "#e53e3e" : c.cor} emissive={c.conflito ? "#ff0000" : "#000000"}
        transparent={gab} opacity={gab ? 0.12 : 1} depthWrite={!gab} metalness={0.2} roughness={0.6}
      />
      {gab && <Edges color="#aab4c8" />}
    </mesh>
  );
}

function Relogio({ onTempo }: { onTempo: (t: number) => void }) {
  useFrame(({ clock }) => onTempo(clock.elapsedTime));
  return null;
}

export default function Cena3D({ cena }: { cena: Cena }) {
  const caixas = useMemo(() => montarCena(cena), [cena]);
  const [tutorial, setTutorial] = useState(false);
  const [passo, setPasso] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const tempo = useRef(0);
  const [inicio, setInicio] = useState(0);
  const total = cena.passos.length;

  useEffect(() => setInicio(tempo.current), [passo, tutorial]);

  if (!caixas.length) return <p className="suave">Adicione peças para ver a montagem em 3D.</p>;
  return (
    <div>
      <div className="linha entre" style={{ marginBottom: 8 }}>
        <div className="linha">
          <button onClick={() => { setTutorial(!tutorial); setPasso(0); }} aria-pressed={tutorial}>
            {tutorial ? "Ver montada" : "Modo tutorial"}
          </button>
          {tutorial && (
            <>
              <button onClick={() => setPasso(Math.max(0, passo - 1))} disabled={passo === 0}>Anterior</button>
              <button onClick={() => setPasso(Math.min(total - 1, passo + 1))} disabled={passo >= total - 1}>Próximo</button>
            </>
          )}
        </div>
        {cena.conflitos.length > 0 && <span className="selo sev-bloqueante">{cena.conflitos.length} conflito(s) em vermelho</span>}
      </div>
      {tutorial && total > 0 && (
        <p><strong>Passo {passo + 1}/{total}:</strong> {cena.passos[passo].texto}</p>
      )}
      <div className="cena" role="img" aria-label="Montagem 3D da build" style={{ position: "relative" }}>
        {hover && <span style={{ position: "absolute", top: 8, left: 8, zIndex: 1, background: "rgba(0,0,0,.7)", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 13 }}>{hover}</span>}
        <Canvas camera={{ position: [4.2, 2.6, 4.6], fov: 45 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} />
          <Relogio onTempo={(t) => (tempo.current = t)} />
          {caixas.map((c) => (
            <Peca key={c.id} c={c} passo={tutorial ? passo : null} inicio={inicio} onHover={setHover} />
          ))}
          <OrbitControls makeDefault />
        </Canvas>
      </div>
      <ul className="linha suave" style={{ listStyle: "none", padding: 0 }} aria-label="Legenda">
        {caixas.filter((c) => c.tipo !== "gabinete").map((c) => (
          <li key={c.id} className="linha"><span style={{ width: 10, height: 10, borderRadius: 2, background: c.conflito ? "#e53e3e" : c.cor, display: "inline-block" }} />{c.nome}</li>
        ))}
      </ul>
      {cena.conflitos.length > 0 && (
        <ul className="suave">
          {cena.conflitos.map((c) => <li key={c.id} className={`sev-${c.severidade}`}>{c.descricao}</li>)}
        </ul>
      )}
    </div>
  );
}
