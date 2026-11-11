"use client";
// Renderizador único das peças procedurais (lib/peca.ts), em estilo técnico: tons chapados, contorno em tinta escura.
// Clique abre a vista explodida: a peça sai do gabinete pela lateral e as subpeças se afastam escalonadas.
import { Edges } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BoxGeometry, type BufferGeometry, ExtrudeGeometry, type Group, MeshLambertMaterial, Path, Shape } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Caixa, Vec3 } from "@/lib/cena";
import { type Modelo, type Sub, type Tom, progressoExplosao } from "@/lib/peca";

const TINTA = "#0b131c";
const COR: Record<Tom, string> = {
  lo: "#2c3d51", mid: "#3f5671", hi: "#7d93ad", lit: "#dfe8ef",
  pcb: "#2a5241", ouro: "#c8a04c", cobre: "#b9774a", metal: "#9aa7b6", escuro: "#16202b", vidro: "#9fc4e8", trilha: "#4f9273",
};

/** Pá curva: crescente do cubo até a ponta, varrida para trás, no plano xz. */
function geometriaPa(r: number): BufferGeometry {
  const r0 = r * 0.3, r1 = r * 0.95, varre = 0.95, N = 10;
  const pt = (u: number, larg: number) => { const a = -varre * u * u + larg; const rr = r0 + (r1 - r0) * u; return [rr * Math.cos(a), rr * Math.sin(a)] as const; };
  const forma = new Shape();
  for (let i = 0; i <= N; i++) { const [x, y] = pt(i / N, 0); i ? forma.lineTo(x, y) : forma.moveTo(x, y); }
  for (let i = N; i >= 0; i--) { const [x, y] = pt(i / N, 0.5 - 0.12 * (i / N)); forma.lineTo(x, y); }
  return new ExtrudeGeometry(forma.closePath(), { depth: 0.8, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -0.4, 0);
}

function geometriaAletas(s: Sub & { forma: { tipo: "aletas" } }): BufferGeometry {
  const { n, passo, esp } = s.forma;
  const placas = Array.from({ length: n }, (_, i) => s.forma.eixo === "z"
    ? new BoxGeometry(s.tam[0], s.tam[1], esp).translate(0, 0, -s.tam[2] / 2 + passo * (i + 0.5))
    : new BoxGeometry(esp, s.tam[1], s.tam[2]).translate(-s.tam[0] / 2 + passo * (i + 0.5), 0, 0));
  return mergeGeometries(placas);
}

function geometriaGrade(s: Sub & { forma: { tipo: "grade" } }): BufferGeometry {
  const n = s.forma.n, cheio = s.forma.cheio ?? 0.6;
  const cel = s.tam.map((v, i) => v / n[i]), lado = cel.map((v, i) => (n[i] > 1 ? v * cheio : v));
  const caixas: BufferGeometry[] = [];
  for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++)
    caixas.push(new BoxGeometry(lado[0], lado[1], lado[2]).translate(
      -s.tam[0] / 2 + cel[0] * (i + 0.5), -s.tam[1] / 2 + cel[1] * (j + 0.5), -s.tam[2] / 2 + cel[2] * (k + 0.5)));
  return mergeGeometries(caixas);
}

function geometriaPlaca(s: Sub & { forma: { tipo: "placa" } }): BufferGeometry {
  const [w, t, h] = s.tam;
  const forma = new Shape().moveTo(-w / 2, -h / 2).lineTo(w / 2, -h / 2).lineTo(w / 2, h / 2).lineTo(-w / 2, h / 2).closePath();
  // furos em coordenadas da placa (x, -z): a rotação abaixo leva o y do Shape para -z
  for (const f of s.forma.furos) forma.holes.push(new Path().absarc(f.x - s.pos[0], -(f.z - s.pos[2]), f.r, 0, Math.PI * 2, true));
  return new ExtrudeGeometry(forma, { depth: t, bevelEnabled: false, curveSegments: 40 }).rotateX(-Math.PI / 2).translate(0, -t / 2, 0);
}

function Fan({ s, mat, spin }: { s: Sub & { forma: { tipo: "fan" } }; mat: (t: Tom) => MeshLambertMaterial; spin: React.RefObject<Group[]> }) {
  const emX = s.forma.eixo === "x";
  const r = s.forma.raio, t = emX ? s.tam[0] : s.tam[1], n = s.forma.pas;
  const pa = useMemo(() => geometriaPa(r), [r]);
  const ud = { nome: rotulo(s) };
  return (
    <group rotation={emX ? [0, 0, -Math.PI / 2] : [0, 0, 0]}>
      <mesh material={mat("lo")} rotation={[Math.PI / 2, 0, 0]} userData={ud}>
        <torusGeometry args={[r, 1.6, 8, 48]} />
        <Edges color={TINTA} threshold={40} />
      </mesh>
      <group ref={(g) => { if (g && !spin.current.includes(g)) spin.current.push(g); }}>
        <mesh material={mat("mid")} userData={ud}>
          <cylinderGeometry args={[r * 0.32, r * 0.32, t * 0.8, 32]} />
          <Edges color={TINTA} threshold={30} />
        </mesh>
        <mesh material={mat("lit")} position={[0, -t * 0.4 - 0.15, 0]} userData={ud}>
          <cylinderGeometry args={[r * 0.22, r * 0.22, 0.3, 32]} />
          <Edges color={TINTA} threshold={30} />
        </mesh>
        {Array.from({ length: n }, (_, i) => (
          <mesh key={i} geometry={pa} material={mat("hi")} rotation={[0, (i / n) * Math.PI * 2, 0]} userData={ud}>
            <Edges color={TINTA} threshold={30} geometry={pa} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

const rotulo = (s: Sub) => s.fonte === "estimado" ? `${s.nome} (estimado)` : s.fonte === "norma" ? `${s.nome} (norma)` : s.nome;

function Parte({ s, mat, spin }: { s: Sub; mat: (t: Tom) => MeshLambertMaterial; spin: React.RefObject<Group[]> }) {
  const geo = useMemo(() => {
    if (s.forma.tipo === "aletas") return geometriaAletas(s as Sub & { forma: { tipo: "aletas" } });
    if (s.forma.tipo === "grade") return geometriaGrade(s as Sub & { forma: { tipo: "grade" } });
    if (s.forma.tipo === "placa") return geometriaPlaca(s as Sub & { forma: { tipo: "placa" } });
    return null;
  }, [s]);
  if (s.forma.tipo === "fan") return <Fan s={s as Sub & { forma: { tipo: "fan" } }} mat={mat} spin={spin} />;
  return (
    <mesh material={mat(s.tom)} {...(geo ? { geometry: geo } : {})} userData={{ nome: rotulo(s) }}
      {...(s.tom === "vidro" ? { raycast: () => null } : {})}   // o vidro não intercepta cliques nas peças de dentro
      rotation={s.forma.tipo === "tubo" ? [0, 0, Math.PI / 2] : s.forma.tipo === "cilindro" && s.forma.eixo === "z" ? [Math.PI / 2, 0, 0] : [0, 0, 0]}>
      {s.forma.tipo === "caixa" && <boxGeometry args={s.tam} />}
      {s.forma.tipo === "tubo" && <cylinderGeometry args={[s.forma.raio, s.forma.raio, s.tam[0], 16]} />}
      {s.forma.tipo === "cilindro" && <cylinderGeometry args={[s.forma.raio, s.forma.raio, s.forma.eixo === "z" ? s.tam[2] : s.tam[1], 24]} />}
      {s.forma.tipo !== "grade" && <Edges color={TINTA} threshold={20} {...(geo ? { geometry: geo } : {})} />}
    </mesh>
  );
}

interface Props {
  c: Caixa; modelo: Modelo; escala: number; aberto: boolean; oculta: boolean; reduzido: boolean;
  posicao: (t: number) => Vec3 | null;   // posição montada (tutorial incluso), em mm
  saida: number;                         // quanto a placa sai do gabinete em +Z quando aberta, em mm
  onClick: () => void; onHover: (n: string | null) => void;
}

export default function Peca3D({ c, modelo, escala, aberto, oculta, reduzido, posicao, saida, onClick, onHover }: Props) {
  const maxOrdem = Math.max(...modelo.partes.map((p) => p.ordem));
  const mats = useMemo(() => {
    const m = {} as Record<Tom, MeshLambertMaterial>;
    for (const t of Object.keys(COR) as Tom[]) m[t] = new MeshLambertMaterial({ color: COR[t], flatShading: true, emissive: "#ff2a1a", emissiveIntensity: 0 });
    Object.assign(m.vidro, { transparent: true, opacity: 0.1, depthWrite: false });
    return m;
  }, []);
  const mat = (t: Tom) => mats[t];
  const raiz = useRef<Group>(null);
  const partes = useRef<(Group | null)[]>([]);
  const spin = useRef<Group[]>([]);
  const mudou = useRef({ aberto: false, t: -1e9 });   // fechada "há muito tempo" no primeiro quadro
  const saidaAtual = useRef(0);

  useFrame(({ clock }, dt) => {
    const g = raiz.current;
    if (!g) return;
    const agora = clock.elapsedTime;
    if (mudou.current.aberto !== aberto) mudou.current = { aberto, t: agora };
    const t = reduzido ? 1e9 : agora - mudou.current.t;

    const base = posicao(agora);
    g.visible = base != null && !oculta;
    if (!base) return;
    // sai do gabinete primeiro, depois as subpeças se afastam
    saidaAtual.current += ((aberto ? saida : 0) - saidaAtual.current) * (reduzido ? 1 : 1 - Math.exp(-dt * 6));
    g.position.set(base[0] * escala, base[1] * escala, (base[2] + saidaAtual.current) * escala);

    modelo.partes.forEach((p, i) => {
      const o = partes.current[i];
      if (!o) return;
      const k = progressoExplosao(p.ordem, maxOrdem, t - (aberto ? 0.35 : 0), aberto);
      o.position.set(p.pos[0] + p.explode[0] * k, p.pos[1] + p.explode[1] * k, p.pos[2] + p.explode[2] * k);
    });
    if (!reduzido) for (const f of spin.current) f.rotation.y += dt * (aberto ? 0.4 : 1.6);
    const pulso = c.conflito && !aberto ? 0.35 + 0.35 * Math.sin(agora * 4) : 0;
    for (const m of Object.values(mats)) m.emissiveIntensity = pulso;
  });

  return (
    <group ref={raiz} scale={escala}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(aberto ? `${c.nome} · ${e.object.userData.nome ?? ""}` : c.nome); }}
      onPointerOut={() => onHover(null)}>
      {modelo.partes.map((p, i) => (
        <group key={p.id} ref={(o) => { partes.current[i] = o; }} position={p.pos}>
          <Parte s={p} mat={mat} spin={spin} />
        </group>
      ))}
    </group>
  );
}
