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
        color={c.conflito ? "#ff6b5e" : c.cor} emissive={c.conflito ? "#ff2a1a" : "#000000"}
        transparent={gab} opacity={gab ? 0.1 : 1} depthWrite={!gab} metalness={0.2} roughness={0.6}
      />
      {gab && <Edges color="#8f98a0" />}
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

  if (!caixas.length) return <p className="vazio-bloco">Adicione peças para ver a montagem em 3D.</p>;
  return (
    <div>
      <div className="card-topo">
        <div className="acoes">
          <button className="btn" onClick={() => { setTutorial(!tutorial); setPasso(0); }} aria-pressed={tutorial}>
            {tutorial ? "Ver montada" : "Passo a passo"}
          </button>
          {tutorial && (
            <>
              <button className="btn" onClick={() => setPasso(Math.max(0, passo - 1))} disabled={passo === 0}>Anterior</button>
              <button className="btn" onClick={() => setPasso(Math.min(total - 1, passo + 1))} disabled={passo >= total - 1}>Próximo</button>
            </>
          )}
        </div>
        {cena.conflitos.length > 0 && <span className="pill neg">{cena.conflitos.length} {cena.conflitos.length === 1 ? "conflito" : "conflitos"} em vermelho</span>}
      </div>
      {tutorial && total > 0 && (
        <p className="passo"><strong>Passo {passo + 1} de {total}.</strong> {cena.passos[passo].texto}</p>
      )}
      <div className="cena" role="img" aria-label="Montagem 3D da build">
        {hover && <span className="etiqueta">{hover}</span>}
        <Canvas camera={{ position: [4.2, 2.6, 4.6], fov: 45 }}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} />
          <Relogio onTempo={(t) => (tempo.current = t)} />
          {caixas.map((c) => (
            <Peca key={c.id} c={c} passo={tutorial ? passo : null} inicio={inicio} onHover={setHover} />
          ))}
          <OrbitControls makeDefault />
        </Canvas>
      </div>
      <ul className="legenda" aria-label="Legenda">
        {caixas.filter((c) => c.tipo !== "gabinete").map((c) => (
          <li key={c.id}><i style={{ background: c.conflito ? "#ff6b5e" : c.cor }} />{c.nome}</li>
        ))}
      </ul>
      {cena.conflitos.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {cena.conflitos.map((c) => <p key={c.id} className="achado"><span><span className="pill neg">Conflito</span> {c.descricao}</span></p>)}
        </div>
      )}
    </div>
  );
}
