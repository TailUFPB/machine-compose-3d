"use client";
// Cena 3D paramétrica (React Three Fiber). Peça em conflito pulsa em vermelho; modo tutorial monta passo a passo.
import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CatmullRomCurve3, type Mesh, type MeshStandardMaterial, TubeGeometry, Vector3 } from "three";
import type { Cena } from "@/lib/api";
import { type Cabo, type Caixa, type Vec3, montarCabos, montarCena, posicaoTutorial } from "@/lib/cena";
import Peca3D from "./Peca3D";

const ESCALA = 1 / 100;   // mm -> unidades da cena
const DURACAO_PASSO = 1.2; // s

function Peca({ c, passo, inicio, apagada, onHover }: { c: Caixa; passo: number | null; inicio: number; apagada: boolean; onHover: (n: string | null) => void }) {
  const ref = useRef<Mesh>(null);
  const gab = c.tipo === "gabinete";
  const transparente = gab || apagada;
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
      <meshStandardMaterial key={String(transparente)}   // trocar `transparent` exige material novo
        color={c.conflito ? "#ff6b5e" : c.cor} emissive={c.conflito ? "#ff2a1a" : "#000000"}
        transparent={transparente} opacity={gab ? 0.1 : apagada ? 0.15 : 1} depthWrite={!transparente} metalness={0.2} roughness={0.6}
      />
      {gab && <Edges color="#8f98a0" />}
    </mesh>
  );
}

/** Cabo como tubo sobre os pontos da rota; a curva quase não arredonda, para os trechos ficarem retos. */
function Cabo3D({ c, onHover }: { c: Cabo; onHover: (n: string | null) => void }) {
  const geo = useMemo(() => {
    const curva = new CatmullRomCurve3(c.pontos.map((p) => new Vector3(p[0] * ESCALA, p[1] * ESCALA, p[2] * ESCALA)), false, "catmullrom", 0.08);
    return new TubeGeometry(curva, c.pontos.length * 24, c.raio * ESCALA, 8);
  }, [c]);
  return (
    <mesh geometry={geo} onPointerOver={(e) => { e.stopPropagation(); onHover(c.nome); }} onPointerOut={() => onHover(null)}>
      <meshLambertMaterial color={c.raio > 2 ? "#5d6f86" : "#c8a04c"} />
    </mesh>
  );
}

const CAM_INICIAL = new Vector3(2.4, 1.8, 7);   // de frente para o vidro lateral
const ROTULO: Partial<Record<Caixa["tipo"], string>> = { gpu: "GPU", placa_mae: "placa-mãe", memoria: "memória", cpu: "CPU", cooler: "cooler", armazenamento: "SSD", fonte: "fonte", gabinete: "gabinete" };

/** Leva o alvo da órbita (e a distância da câmera) até o foco por ~1,2 s depois de cada troca; depois solta. */
function Foco({ alvo, distancia }: { alvo: Vec3; distancia: number }) {
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  const desde = useRef<{ chave: string; t: number }>({ chave: "", t: 0 });
  const chave = `${alvo.join()}|${distancia}`;
  const dir = useMemo(() => new Vector3(), []);
  useFrame(({ camera, clock }, dt) => {
    if (!controls) return;
    if (desde.current.chave !== chave) desde.current = { chave, t: clock.elapsedTime };
    if (clock.elapsedTime - desde.current.t > 1.2) return;
    const k = 1 - Math.exp(-dt * 5);
    controls.target.lerp(new Vector3(...alvo), k);
    dir.copy(camera.position).sub(controls.target).normalize().multiplyScalar(distancia);
    camera.position.lerp(dir.add(controls.target), k);
    controls.update();
  });
  return null;
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
  const [aberta, setAberta] = useState<string | null>(null);
  const reduzido = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const total = cena.passos.length;
  const cabos = useMemo(() => montarCabos(caixas), [caixas]);
  const gab = caixas.find((c) => c.tipo === "gabinete");
  const modeladas = caixas.filter((c) => c.modelo);
  const alvo = caixas.find((c) => c.id === aberta && c.modelo);
  // sai pela lateral (+Z) até a peça inteira ficar fora do gabinete, com folga
  // o gabinete abre no lugar, com tudo dentro à mostra
  const abreGab = alvo?.tipo === "gabinete";
  const saidaDe = (c: Caixa) => c.tipo === "gabinete" ? 0 : (gab ? gab.tam[2] / 2 : 0) + c.tam[2] / 2 - c.pos[2] + 40;
  const foco: Vec3 = alvo ? [alvo.pos[0] * ESCALA, alvo.pos[1] * ESCALA, (alvo.pos[2] + saidaDe(alvo)) * ESCALA] : [0, 0, 0];
  const distancia = abreGab ? CAM_INICIAL.length() * 1.35 : alvo ? Math.max(...alvo.tam) * ESCALA * 1.5 + 2.2 : CAM_INICIAL.length();

  useEffect(() => setInicio(tempo.current), [passo, tutorial]);

  if (!caixas.length) return <p className="vazio-bloco">Adicione peças para ver a montagem em 3D.</p>;
  return (
    <div>
      <div className="card-topo">
        <div className="acoes">
          <button className="btn" onClick={() => { setTutorial(!tutorial); setPasso(0); setAberta(null); }} aria-pressed={tutorial}>
            {tutorial ? "Ver montada" : "Passo a passo"}
          </button>
          {!tutorial && modeladas.map((c) => (
            <button key={c.id} className="btn" onClick={() => setAberta(aberta === c.id ? null : c.id)} aria-pressed={aberta === c.id}>
              {aberta === c.id ? "Fechar" : "Abrir"} {ROTULO[c.tipo] ?? c.nome}
            </button>
          ))}
          {tutorial && (
            <>
              <button className="btn" onClick={() => setPasso(Math.max(0, passo - 1))} disabled={passo === 0}>Anterior</button>
              <button className="btn" onClick={() => setPasso(Math.min(total - 1, passo + 1))} disabled={passo >= total - 1}>Próximo</button>
            </>
          )}
        </div>
        {cena.conflitos.length > 0 && <span className="pill neg">{cena.conflitos.length} {cena.conflitos.length === 1 ? "conflito" : "conflitos"} em vermelho</span>}
      </div>
      {!tutorial && modeladas.length > 0 && (
        <p className="passo">{alvo ? `Vista explodida: ${alvo.nome}. Passe o mouse nas peças; clique fora para fechar.` : "Clique numa peça detalhada, ou use os botões, para abrir a vista explodida."}</p>
      )}
      {tutorial && total > 0 && (
        <p className="passo"><strong>Passo {passo + 1} de {total}.</strong> {cena.passos[passo].texto}</p>
      )}
      <div className="cena" role="img" aria-label="Montagem 3D da build">
        {hover && <span className="etiqueta">{hover}</span>}
        <Canvas camera={{ position: CAM_INICIAL.toArray(), fov: 45 }} onPointerMissed={() => setAberta(null)}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} />
          <Relogio onTempo={(t) => (tempo.current = t)} />
          {caixas.map((c) => c.modelo ? (
            <Peca3D key={c.id} c={c} modelo={c.modelo} escala={ESCALA} aberto={aberta === c.id} oculta={aberta != null && aberta !== c.id && !abreGab}
              reduzido={reduzido} saida={saidaDe(c)}
              posicao={(t) => tutorial ? posicaoTutorial(c, passo, (t - inicio) / DURACAO_PASSO) : c.pos}
              onClick={() => !tutorial && setAberta(aberta === c.id ? null : c.id)} onHover={setHover} />
          ) : (
            <Peca key={c.id} c={c} passo={tutorial ? passo : null} inicio={inicio} apagada={aberta != null && !abreGab} onHover={setHover} />
          ))}
          {!tutorial && (aberta == null || abreGab) && cabos.map((c) => <Cabo3D key={c.id} c={c} onHover={setHover} />)}
          <OrbitControls makeDefault />
          <Foco alvo={foco} distancia={distancia} />
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
