"use client";
// Renderizador único das peças procedurais (lib/peca.ts), em estilo técnico: tons chapados, contorno em tinta escura.
// Clique abre a vista explodida: a peça sai do gabinete pela lateral e as subpeças se afastam escalonadas.
// Subpeças que andam juntas na explosão e têm o mesmo tom viram uma malha só (lib/peca.ts: lotes), com um contorno;
// o rótulo de cada subpeça sai da faixa de triângulos atingida.
import { Edges, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, type BufferGeometry, CatmullRomCurve3, CylinderGeometry, EdgesGeometry, ExtrudeGeometry, type Group, Matrix4, MeshLambertMaterial, Path, Shape, TubeGeometry, Vector2, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Caixa, Vec3 } from "../lib/cena";
import { type Forma, type Lote, type Modelo, type Sub, type Tom, lotes, progressoExplosao } from "../lib/peca";

const TINTA = "#0b131c", ZERO: Vec3 = [0, 0, 0];
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

type De<T extends Forma["tipo"]> = Extract<Forma, { tipo: T }>;

function geometriaAletas(tam: Vec3, { n, passo, esp, eixo }: De<"aletas">): BufferGeometry {
  const placas = Array.from({ length: n }, (_, i) => eixo === "z"
    ? new BoxGeometry(tam[0], tam[1], esp).translate(0, 0, -tam[2] / 2 + passo * (i + 0.5))
    : new BoxGeometry(esp, tam[1], tam[2]).translate(-tam[0] / 2 + passo * (i + 0.5), 0, 0));
  return mergeGeometries(placas);
}

function geometriaGrade(tam: Vec3, f: De<"grade">): BufferGeometry {
  const n = f.n, cheio = f.cheio ?? 0.6;
  const cel = tam.map((v, i) => v / n[i]), lado = cel.map((v, i) => (n[i] > 1 ? v * cheio : v));
  const caixas: BufferGeometry[] = [];
  for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++)
    caixas.push(new BoxGeometry(lado[0], lado[1], lado[2]).translate(
      -tam[0] / 2 + cel[0] * (i + 0.5), -tam[1] / 2 + cel[1] * (j + 0.5), -tam[2] / 2 + cel[2] * (k + 0.5)));
  return mergeGeometries(caixas);
}

function geometriaPlaca(s: Sub, f: De<"placa">): BufferGeometry {
  const [w, t, h] = s.tam;
  const forma = new Shape().moveTo(-w / 2, -h / 2).lineTo(w / 2, -h / 2).lineTo(w / 2, h / 2).lineTo(-w / 2, h / 2).closePath();
  // furos em coordenadas da placa (x, -z): a rotação abaixo leva o y do Shape para -z
  for (const u of f.furos) forma.holes.push(new Path().absarc(u.x - s.pos[0], -(u.z - s.pos[2]), u.r, 0, Math.PI * 2, true));
  return new ExtrudeGeometry(forma, { depth: t, bevelEnabled: false, curveSegments: 40 }).rotateX(-Math.PI / 2).translate(0, -t / 2, 0);
}

// O Shape vive em XY e extruda em Z; a troca cíclica de eixos leva a extrusão para x ou y (ordem dos pontos em lib/peca.ts).
const GIRO = {
  x: new Matrix4().makeBasis(new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0)),
  y: new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)),
  z: new Matrix4(),
};
function geometriaPerfil(tam: Vec3, f: De<"perfil">): BufferGeometry {
  const comp = tam["xyz".indexOf(f.eixo)];
  return new ExtrudeGeometry(new Shape(f.pontos.map(([a, b]) => new Vector2(a, b))), { depth: comp, bevelEnabled: false })
    .translate(0, 0, -comp / 2).applyMatrix4(GIRO[f.eixo]);
}

/** Geometria de uma subpeça (menos o fan), centrada nela e já na orientação final. */
function geometriaSub(s: Sub): BufferGeometry {
  const f = s.forma;
  switch (f.tipo) {
    case "tubo": return new CylinderGeometry(f.raio, f.raio, s.tam[0], 16).rotateZ(Math.PI / 2);
    case "cilindro": return f.eixo === "z" ? new CylinderGeometry(f.raio, f.raio, s.tam[2], 24).rotateX(Math.PI / 2) : new CylinderGeometry(f.raio, f.raio, s.tam[1], 24);
    case "aletas": return geometriaAletas(s.tam, f);
    case "grade": return geometriaGrade(s.tam, f);
    case "placa": return geometriaPlaca(s, f);
    case "perfil": return geometriaPerfil(s.tam, f);
    case "curva": return new TubeGeometry(new CatmullRomCurve3(f.pontos.map((p) => new Vector3(...p)), false, "catmullrom", 0.25), f.pontos.length * 8, f.raio, 12);
    default: return new BoxGeometry(...s.tam);
  }
}

/** Malha única de um lote: triângulos fundidos, segmentos do contorno e as faixas de triângulos de cada subpeça. */
export function malhaLote(l: Lote) {
  const geos: BufferGeometry[] = [], contorno: number[] = [], faixas: { fim: number; nome: string }[] = [];
  let tri = 0;
  for (const s of l.subs) {
    const g0 = geometriaSub(s), g = (g0.index ? g0.toNonIndexed() : g0).translate(s.pos[0] - l.pos[0], s.pos[1] - l.pos[1], s.pos[2] - l.pos[2]);
    geos.push(g);
    tri += g.attributes.position.count / 3;
    faixas.push({ fim: tri, nome: rotulo(s) });
    if (s.forma.tipo !== "grade") for (const v of new EdgesGeometry(g, 20).attributes.position.array) contorno.push(v);   // pinos e trilhas ficam sem contorno
  }
  return { geo: mergeGeometries(geos), contorno, faixas };
}

function Fan({ s, mat, spin }: { s: Sub & { forma: { tipo: "fan" } }; mat: (t: Tom) => MeshLambertMaterial; spin: React.RefObject<Group[]> }) {
  const emX = s.forma.eixo === "x";
  const r = s.forma.raio, t = emX ? s.tam[0] : s.tam[1], n = s.forma.pas;
  const pa = useMemo(() => geometriaPa(r), [r]);
  useEffect(() => () => pa.dispose(), [pa]);
  const ud = { nome: rotulo(s) };
  return (
    <group rotation={emX ? [0, 0, -Math.PI / 2] : [0, 0, 0]}>
      <mesh material={mat("lo")} rotation={[Math.PI / 2, 0, 0]} userData={ud}>
        <torusGeometry args={[r, 1.6, 8, 48]} />
        <Edges color={TINTA} threshold={40} />
      </mesh>
      <group ref={(g) => { if (!g) return; spin.current.push(g); return () => { spin.current = spin.current.filter((x) => x !== g); }; }}>
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

const semRaio = () => null;

function Parte({ l, mat, spin }: { l: Lote; mat: (t: Tom) => MeshLambertMaterial; spin: React.RefObject<Group[]> }) {
  const s = l.subs[0], fan = s.forma.tipo === "fan";
  const m = useMemo(() => (fan ? null : malhaLote(l)), [l, fan]);
  useEffect(() => () => m?.geo.dispose(), [m]);
  if (!m) return <Fan s={s as Sub & { forma: { tipo: "fan" } }} mat={mat} spin={spin} />;
  // o vidro não intercepta cliques nas peças de dentro
  return (
    <mesh geometry={m.geo} material={mat(s.tom)} userData={{ faixas: m.faixas }} {...(s.tom === "vidro" ? { raycast: semRaio } : {})}>
      {m.contorno.length > 0 && <Line segments points={m.contorno} color={TINTA} lineWidth={1} raycast={semRaio} />}
    </mesh>
  );
}

/** Nome da subpeça sob o ponteiro: o da malha, ou o da faixa de triângulos atingida numa malha fundida. */
function nomeEm(e: { object: { userData: Record<string, any> }; faceIndex?: number | null }): string {
  const { nome, faixas } = e.object.userData as { nome?: string; faixas?: { fim: number; nome: string }[] };
  return nome ?? faixas?.find((f) => (e.faceIndex ?? 0) < f.fim)?.nome ?? "";
}

interface Props {
  c: Caixa; modelo: Modelo; escala: number; aberto: boolean; oculta: boolean; reduzido: boolean;
  posicao: (t: number) => Vec3 | null;   // posição montada (tutorial incluso), em mm
  saida: number;                         // quanto a placa sai do gabinete em +Z quando aberta, em mm
  onClick: () => void; onHover: (n: string | null) => void;
  moveis?: (t: number) => string[] | undefined;   // prefixos de id das subpeças a que `encaixe` se aplica; ausente = todas
  encaixe?: number | ((t: number) => number);   // subpeças móveis (travas, alavanca, parafusos): 0 = fechadas (padrão), 1 = abertas
}

export default function Peca3D({ c, modelo, escala, aberto, oculta, reduzido, posicao, saida, onClick, onHover, encaixe = 0, moveis }: Props) {
  const maxOrdem = Math.max(...modelo.partes.map((p) => p.ordem));
  const grupos = useMemo(() => lotes(modelo.partes), [modelo]);
  const mats = useMemo(() => {
    const m = {} as Record<Tom, MeshLambertMaterial>;
    for (const t of Object.keys(COR) as Tom[]) m[t] = new MeshLambertMaterial({ color: COR[t], flatShading: true, emissive: "#ff2a1a", emissiveIntensity: 0 });
    Object.assign(m.vidro, { transparent: true, opacity: 0.1, depthWrite: false });
    return m;
  }, []);
  useEffect(() => () => { for (const m of Object.values(mats)) m.dispose(); }, [mats]);
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

    const base = posicao(agora), encTodas = typeof encaixe === "function" ? encaixe(agora) : encaixe, quais = moveis?.(agora);
    g.visible = base != null && !oculta;
    if (!base) return;
    // sai do gabinete primeiro, depois as subpeças se afastam
    saidaAtual.current += ((aberto ? saida : 0) - saidaAtual.current) * (reduzido ? 1 : 1 - Math.exp(-dt * 6));
    g.position.set(base[0] * escala, base[1] * escala, (base[2] + saidaAtual.current) * escala);

    grupos.forEach((l, i) => {
      const o = partes.current[i];
      if (!o) return;
      const k = progressoExplosao(l.ordem, maxOrdem, t - (aberto ? 0.35 : 0), aberto);
      const enc = !quais || quais.some((q) => l.subs[0].id.startsWith(q)) ? encTodas : 0;
      const d = l.movel?.desloca ?? ZERO, gira = l.movel?.gira;
      o.position.set(l.pos[0] + l.explode[0] * k + d[0] * enc, l.pos[1] + l.explode[1] * k + d[1] * enc, l.pos[2] + l.explode[2] * k + d[2] * enc);
      if (gira) o.rotation.set(gira[0] * enc, gira[1] * enc, gira[2] * enc);
    });
    if (!reduzido) for (const f of spin.current) f.rotation.y += dt * (aberto ? 0.4 : 1.6);
    const pulso = c.conflito && !aberto ? 0.35 + 0.35 * Math.sin(agora * 4) : 0;
    for (const m of Object.values(mats)) m.emissiveIntensity = pulso;
  });

  const passar = (e: Parameters<typeof nomeEm>[0] & { stopPropagation: () => void }) => { e.stopPropagation(); onHover(aberto ? `${c.nome} · ${nomeEm(e)}` : c.nome); };
  return (
    <group ref={raiz} scale={escala} rotation={c.rot}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={passar} onPointerMove={aberto ? passar : undefined}   // numa malha fundida o rótulo muda sem trocar de objeto
      onPointerOut={() => onHover(null)}>
      {grupos.map((l, i) => (
        <group key={l.subs[0].id} ref={(o) => { partes.current[i] = o; }} position={l.pos}>
          <Parte l={l} mat={mat} spin={spin} />
        </group>
      ))}
    </group>
  );
}
