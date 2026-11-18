"use client";
// Cena 3D paramétrica (React Three Fiber): build montada, explodida ou passo a passo.
// Conflito físico vira região vermelha com a medida do excesso; a peça em conflito pulsa.
import { Edges, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, type MutableRefObject, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { CatmullRomCurve3, Color, type Group, type InstancedMesh, type Mesh, MeshLambertMaterial, type MeshStandardMaterial, Object3D, Quaternion, TOUCH, TubeGeometry, Vector3 } from "three";
import type { Cena, Folga } from "@/lib/api";
import { type Cabo, type Caixa, DICAS, DIRECAO, type EstadoPasso, type Regiao, type Regua, type SetaAr, type Vec3, VISTA_DA_FOLGA, type Vista, caminhosDoAr, descricaoCena, descricaoFluxo, envelope, reguaDe, estadoPasso, focoDaPrevia, montarCabos, montarCena, posicaoExplodida, regioesDeConflito, setasDoFluxo } from "@/lib/cena";
import { progressoExplosao } from "@/lib/peca";
import { CARENCIA_S, type Escolha, type Nivel, desceAuto, guardarEscolha, lerEscolha, nivelInicial, rotuloQualidade } from "@/lib/qualidade";
import Peca3D from "./Peca3D";

const ESCALA = 1 / 100;   // mm -> unidades da cena
const DURACAO_PASSO = 1.2; // s
const ATRASO = 0.09, DUR = 0.6, FADE = 0.2;   // build explodida (s): escalonamento por passo, duração por peça, sumiço dos cabos
const NEGATIVA = "#ff6b5e";                    // reserva do token --negative
const mm = (v: Vec3) => v.map((x) => x * ESCALA) as Vec3;
const rotDe = (c: Caixa) => (c as Caixa & { rot?: Vec3 }).rot;   // Euler XYZ em torno do centro, quando o layout girar a peça
const semRaio = () => null;

/** Toque (dedo) num objeto que só mostra o nome: marca no pointerdown, avisa no clique e não deixa o toque passar adiante.
 *  `ativo` falso (cabo apagado: o raio do three acerta objeto invisível) deixa o toque seguir para o que está atrás. */
function useToque(onToque: () => void, ativo: () => boolean = () => true) {
  const deDedo = useRef(false);
  return {
    onPointerDown: (e: { pointerType: string }) => { deDedo.current = e.pointerType === "touch"; },
    onClick: (e: { stopPropagation: () => void }) => { if (deDedo.current && ativo()) { e.stopPropagation(); onToque(); } },
  };
}

function Peca({ c, posicao, apagada, onHover, onToque }: { c: Caixa; posicao: (t: number) => Vec3 | null; apagada: boolean; onHover: (n: string | null) => void; onToque: () => void }) {
  const toque = useToque(onToque);
  const ref = useRef<Mesh>(null);
  const gab = c.tipo === "gabinete";
  const transparente = gab || apagada;
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const pos = posicao(clock.elapsedTime);
    m.visible = pos != null;
    if (pos) m.position.set(pos[0] * ESCALA, pos[1] * ESCALA, pos[2] * ESCALA);
    if (c.conflito) (m.material as MeshStandardMaterial).emissiveIntensity = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4);
  });
  return (
    <mesh ref={ref} position={mm(c.pos)} rotation={rotDe(c)} {...toque}
      onPointerOver={(e) => { if (!gab && e.pointerType !== "touch") { e.stopPropagation(); onHover(c.nome); } }} onPointerOut={(e) => { if (e.pointerType !== "touch") onHover(null); }}>
      <boxGeometry args={mm(c.tam)} />
      <meshStandardMaterial key={String(transparente)}   // trocar `transparent` exige material novo
        color={c.conflito ? NEGATIVA : c.cor} emissive={c.conflito ? "#ff2a1a" : "#000000"}
        transparent={transparente} opacity={gab ? 0.1 : apagada ? 0.15 : 1} depthWrite={!transparente} metalness={0.2} roughness={0.6}
      />
      {gab && <Edges color="#8f98a0" />}
    </mesh>
  );
}

/** Cabo (ou mangueira) como tubo sobre os pontos da rota, com um plugue em cada ponta; some e volta com um fade curto. */
function Cabo3D({ c, visivel, reduzido, onHover, onToque }: { c: Cabo; visivel: (t: number) => boolean; reduzido: boolean; onHover: (n: string | null) => void; onToque: () => void }) {
  const geo = useMemo(() => {
    // a curva quase não arredonda, para os trechos ficarem retos
    const curva = new CatmullRomCurve3(c.pontos.map((p) => new Vector3(...mm(p))), false, "catmullrom", 0.08);
    return new TubeGeometry(curva, c.pontos.length * 24, c.raio * ESCALA, 8);
  }, [c]);
  const mat = useMemo(() => new MeshLambertMaterial({ color: c.tipo === "mangueira" ? "#141a22" : c.raio > 2 ? "#5d6f86" : "#c8a04c" }), [c]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);   // o three não libera sozinho o que vai por prop
  const grupo = useRef<Group>(null);
  const toque = useToque(onToque, () => mat.opacity >= 0.5);
  useFrame(({ clock }, dt) => {
    const alvo = visivel(clock.elapsedTime) ? 1 : 0;
    let op = reduzido ? alvo : mat.opacity + (alvo - mat.opacity) * (1 - Math.exp((-dt * 3) / FADE));
    if (Math.abs(alvo - op) < 0.01) op = alvo;
    if (mat.transparent !== op < 1) { mat.transparent = op < 1; mat.needsUpdate = true; }
    mat.opacity = op;
    if (grupo.current) grupo.current.visible = op > 0;
  });
  return (
    <group ref={grupo} {...toque} onPointerOver={(e) => { if (mat.opacity < 0.5 || e.pointerType === "touch") return; e.stopPropagation(); onHover(c.nome); }}
      onPointerOut={(e) => { if (e.pointerType !== "touch") onHover(null); }}>
      <mesh geometry={geo} material={mat} />
      {c.plugues?.map((p, i) => <mesh key={i} position={mm(p.pos)} material={mat}><boxGeometry args={mm(p.tam)} /></mesh>)}
    </group>
  );
}

const medida = (r?: Regiao) => r?.excessoMm != null ? `passa ${Math.round(r.excessoMm).toLocaleString("pt-BR")} mm` : null;

/** Região do conflito: caixa translúcida com contorno, desenhada por cima de tudo; a etiqueta da medida (HTML, fora do canvas) segue o topo dela. */
function Regiao3D({ r, cor, etiqueta }: { r: Regiao; cor: string; etiqueta: () => HTMLElement | null }) {
  const tam = r.tam.map((v) => Math.max(v, 2)) as Vec3;   // face fina ainda aparece
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const el = etiqueta();
    if (!el) return;
    v.set(r.centro[0], r.centro[1] + tam[1] / 2, r.centro[2]).multiplyScalar(ESCALA).project(camera);
    el.style.visibility = v.z < 1 ? "visible" : "hidden";
    el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -130%)`;
  });
  return (
    <mesh position={mm(r.centro)} renderOrder={10} raycast={semRaio}>
      <boxGeometry args={mm(tam)} />
      <meshBasicMaterial color={cor} transparent opacity={0.35} depthTest={false} depthWrite={false} />
      <Edges color={cor} depthTest={false} renderOrder={11} raycast={semRaio} />
    </mesh>
  );
}

const CAM_INICIAL = new Vector3(2.4, 1.8, 7);   // de frente para o vidro lateral
const NOME_VISTA: Record<Vista, string> = { livre: "Livre", frente: "Frente", lateral: "Lateral", topo: "Topo" };
const ROTULO: Partial<Record<Caixa["tipo"], string>> = { gpu: "GPU", placa_mae: "placa-mãe", memoria: "memória", cpu: "CPU", cooler: "cooler", armazenamento: "armazenamento", fonte: "fonte", gabinete: "gabinete" };
const distanciaDe = (maior: number) => maior * ESCALA * 1.5 + 2.2;
const DE_FORA = 4.5;   // distância mínima ao focar algo dentro do gabinete: a câmera fica do lado de fora do vidro

const NOME_QUALIDADE: Record<Escolha, string> = { auto: "Auto", alta: "Alta", leve: "Leve" };
/** O Auto desceu para Leve nesta visita: vale para as próximas builds também (a cena remonta a cada build). */
let desceuNaVisita = false;

/** Amostra a taxa de quadros a cada 1 s, depois da carência; aba em segundo plano (sem quadros) não conta. */
function Medidor({ onAmostra }: { onAmostra: (qps: number) => void }) {
  const janela = useRef<{ t0: number; n: number } | null>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (t < CARENCIA_S) return;
    const j = janela.current;
    if (!j) { janela.current = { t0: t, n: 0 }; return; }
    j.n++;
    const dt = t - j.t0;
    if (dt < 1) return;
    if (dt < 2) onAmostra(j.n / dt);   // janela esticada = aba parada; descarta
    janela.current = { t0: t, n: 0 };
  });
  return null;
}

/** Leva o alvo da órbita (e a distância da câmera) até o foco por ~1,2 s depois de cada troca; depois solta. `vez` refaz o mesmo foco. */
/** Leva o alvo da órbita (e a distância da câmera) até o foco por ~1,2 s depois de cada troca; depois solta. `vez` refaz o mesmo foco.
 *  Com `direcao` (vista pronta), a câmera também vai para `alvo + direcao × distancia` e encaixa exata no fim.
 *  Arrastar com o mouse interrompe a animação: a câmera nunca puxa de volta enquanto a pessoa gira. */
const COR_AR = { entrada: "#4aa3ff", saida: "#ff9a3c" };
const CIMA = new Vector3(0, 1, 0);

/** Seta de uma ventoinha (haste e ponta), por cima de tudo e sem interceptar clique ou toque. */
function SetaVentoinha({ s }: { s: SetaAr }) {
  const d = new Vector3(...s.dir).normalize();
  const giro = new Quaternion().setFromUnitVectors(CIMA, d);
  const centro = new Vector3(...mm(s.pos)).addScaledVector(d, 0.3);
  return (
    <group position={centro} quaternion={giro} renderOrder={12}>
      <mesh raycast={semRaio} renderOrder={12}><cylinderGeometry args={[0.03, 0.03, 0.4, 8]} /><meshBasicMaterial color={COR_AR[s.sentido]} depthTest={false} transparent opacity={0.9} /></mesh>
      <mesh raycast={semRaio} renderOrder={12} position={[0, 0.27, 0]}><coneGeometry args={[0.1, 0.18, 12]} /><meshBasicMaterial color={COR_AR[s.sentido]} depthTest={false} transparent opacity={0.9} /></mesh>
    </group>
  );
}

/** Partículas do ar andando pelos caminhos (frio na entrada, quente na saída); paradas com movimento reduzido. */
function Particulas({ caminhos, n, parado }: { caminhos: Vec3[][]; n: number; parado: boolean }) {
  const curvas = useMemo(() => caminhos.map((c) => new CatmullRomCurve3(c.map((p) => new Vector3(...mm(p))), false, "catmullrom", 0.3)), [caminhos]);
  const ref = useRef<InstancedMesh>(null);
  const tmp = useMemo(() => new Object3D(), []), cor = useMemo(() => new Color(), []);
  const [frio, quente] = useMemo(() => [new Color(COR_AR.entrada), new Color(COR_AR.saida)], []);
  const posicionar = (agora: number) => {
    const m = ref.current;
    if (!m || !curvas.length) return;
    for (let i = 0; i < n; i++) {
      const k = (i / n + agora * 0.12) % 1;
      tmp.position.copy(curvas[i % curvas.length].getPointAt(k));
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, cor.copy(frio).lerp(quente, k));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  useEffect(() => { posicionar(0); }, [curvas, n]);
  useFrame(({ clock }) => { if (!parado) posicionar(clock.elapsedTime); });
  if (!n || !curvas.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} raycast={semRaio} renderOrder={11}>
      <sphereGeometry args={[0.035, 8, 6]} />
      <meshBasicMaterial depthTest={false} transparent opacity={0.85} />
    </instancedMesh>
  );
}

/** O OrbitControls grava `touch-action: none` no elemento em que escuta (o contêiner de eventos do R3F) ao conectar:
 *  1 dedo precisa rolar a página; 2 dedos são da cena. */
function RolaComUmDedo() {
  const controls = useThree((s) => s.controls);
  const alvo = useThree((s) => s.events.connected) as HTMLElement | undefined;
  const tela = useThree((s) => s.gl.domElement);
  useEffect(() => { for (const el of [alvo, tela]) if (el) el.style.touchAction = "pan-y"; }, [controls, alvo, tela]);
  return null;
}

function Foco({ alvo, distancia, vez = 0, direcao }: { alvo: Vec3; distancia: number; vez?: number | string; direcao?: Vec3 }) {
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void; addEventListener: (e: string, f: () => void) => void; removeEventListener: (e: string, f: () => void) => void } | null;
  const tela = useThree((s) => s.gl.domElement);
  const desde = useRef<{ chave: string; t: number; fim: boolean }>({ chave: "", t: 0, fim: false });
  const chave = `${alvo.join()}|${distancia}|${vez}|${direcao?.join() ?? ""}`;
  const dir = useMemo(() => new Vector3(), []);
  useEffect(() => {
    if (!controls) return;
    const parar = () => { desde.current.fim = true; };
    controls.addEventListener("start", parar);
    return () => controls.removeEventListener("start", parar);
  }, [controls]);
  useFrame(({ camera, clock }, dt) => {
    if (!controls) return;
    const pos = camera.position.toArray().map((v) => v.toFixed(2)).join();   // onde a câmera está (teste de navegador)
    if (tela.dataset.camera !== pos) tela.dataset.camera = pos;
    const alvoAgora = controls.target.toArray().map((v) => v.toFixed(2)).join();   // onde a câmera olha (teste de navegador)
    if (tela.dataset.alvo !== alvoAgora) tela.dataset.alvo = alvoAgora;
    if (desde.current.chave !== chave) desde.current = { chave, t: clock.elapsedTime, fim: false };
    if (desde.current.fim) return;
    const acabou = clock.elapsedTime - desde.current.t > 1.2;
    const k = acabou ? 1 : 1 - Math.exp(-dt * 5);   // no fim encaixa exato (a vista Livre volta à posição inicial)
    controls.target.lerp(new Vector3(...alvo), k);
    if (direcao) dir.set(...direcao).normalize().multiplyScalar(distancia);
    else dir.copy(camera.position).sub(controls.target).normalize().multiplyScalar(distancia);
    camera.position.lerp(dir.add(controls.target), k);
    controls.update();
    if (acabou) desde.current.fim = true;
  });
  return null;
}

const COR_REGUA = { peca: "#dfe8ef", sobra: "#a4d007", justa: "#e8b84a", passa: "#ff6b5e" };   // --text, --positive, --warning, --negative
const TRACO = 8;   // mm das marcas nas pontas

/** Régua de folga: o trecho da peça, o que sobra (ou passa) até o limite, marcas nas pontas e rótulos em mm. */
function Regua3D({ r, estado, etiquetas }: { r: Regua; estado: Folga["estado"]; etiquetas: MutableRefObject<Record<string, HTMLElement | null>> }) {
  const ponto = (mmAoLongo: number, desvio = 0): Vec3 => {
    const p: Vec3 = [...r.inicio];
    p[r.eixo] += r.sentido * mmAoLongo;
    p[1] += desvio;
    return mm(p);
  };
  const ate = Math.min(r.peca_mm, r.limite_mm);
  const resto = estado === "cabe" ? COR_REGUA.sobra : estado === "nao_cabe" ? COR_REGUA.passa : COR_REGUA.justa;
  const marcas = [0, r.peca_mm, r.limite_mm].map((d) => [ponto(d, -TRACO), ponto(d, TRACO)] as [Vec3, Vec3]);
  // rótulos em alturas diferentes: com sobra pequena os três caem quase no mesmo ponto
  const rotulos: [string, number, string][] = [["peca", r.peca_mm / 2, "-130%"], ["resto", (r.peca_mm + r.limite_mm) / 2, "40%"], ["limite", r.limite_mm, "-260%"]];
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [k, d, dy] of rotulos) {
      const el = etiquetas.current[k];
      if (!el) continue;
      v.set(...ponto(d)).project(camera);
      el.style.visibility = v.z < 1 ? "visible" : "hidden";
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, ${dy})`;
    }
  });
  return (
    <group renderOrder={12}>
      <Line points={[ponto(0), ponto(ate)]} color={COR_REGUA.peca} lineWidth={3} depthTest={false} />
      <Line points={[ponto(ate), ponto(Math.max(r.peca_mm, r.limite_mm))]} color={resto} lineWidth={3} depthTest={false} />
      {marcas.map((m, i) => <Line key={i} points={m} color={i === 1 ? COR_REGUA.peca : resto} lineWidth={2} depthTest={false} />)}
    </group>
  );
}

/** De onde vêm os dados da peça aberta: campos com ficha do fabricante (link) e itens estimados. */
function DadosPeca({ c }: { c: Caixa }) {
  const porUrl = new Map<string, string[]>();
  for (const [campo, url] of Object.entries(c.origem)) porUrl.set(url, [...(porUrl.get(url) ?? []), campo.replaceAll("_", " ")]);
  const sitio = (u: string) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.host : null; } catch { return null; } };
  const est = c.modelo?.estimados ?? [];
  return (
    <p className="dados-peca" data-testid="dados-peca">
      <strong>Dados desta peça.</strong>{" "}
      {[...porUrl].map(([url, campos]) => (
        <span key={url}>{campos.join(", ")}: {sitio(url) ? <a href={url} target="_blank" rel="noreferrer">ficha do fabricante ({sitio(url)})</a> : "ficha do catálogo"}. </span>
      ))}
      {porUrl.size ? "Demais medidas: ficha do catálogo. " : "Medidas: ficha do catálogo. "}
      {est.length ? `Estimado: ${est.join(", ")}.` : "Nada estimado."}
    </p>
  );
}

/** Sem WebGL (aceleração desligada, GPU bloqueada), o R3F lança ao criar o contexto: mostra um aviso em vez de derrubar a página. */
/** Testa o WebGL antes de montar o Canvas: sem contexto, o three registra console.error (e o overlay do Next o mostra como erro). */
const temWebGL = () => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } };

class SemWebGL extends Component<{ children: ReactNode }, { falhou: boolean }> {
  state = { falhou: typeof document !== "undefined" && !temWebGL() };
  static getDerivedStateFromError() { return { falhou: true }; }
  render() {
    return this.state.falhou
      ? <p className="vazio-bloco" role="alert" data-testid="sem-webgl">Não foi possível iniciar o 3D neste navegador (WebGL indisponível). Ative a aceleração de hardware, ou use a lista de peças e a descrição da montagem.</p>
      : this.props.children;
  }
}

interface Props {
  cena: Cena;
  /** `chave` da peça aberta. Com a prop, a página controla (painel e cena abrem a mesma peça); sem ela, estado local. */
  aberta?: string | null;
  onAberta?: (chave: string | null) => void;
  /** id (componente) da peça acesa pelo hover do painel; `onDestaque` avisa o hover na cena. */
  destaque?: string | null;
  onDestaque?: (componenteId: string | null) => void;
  /** Troca ainda não aplicada: a cena recebida já é a da prévia; `para` é a candidata. */
  previa?: { para: string } | null;
  /** Esc é do painel (prévia aberta ou carregando): a cena não fecha a peça aberta por baixo. */
  escNoPainel?: boolean;
  /** Folga com régua ativa (escolhida no painel): leva a câmera à vista dela e desenha a régua. */
  folga?: Folga | null;
  /** Fluxo de ar ligado (setas e partículas). Com a prop, a página controla (o painel também liga); sem ela, estado local. */
  fluxoLigado?: boolean;
  onFluxo?: (ligado: boolean) => void;
}

export default function Cena3D({ cena, aberta: abertaProp, onAberta, destaque = null, onDestaque, previa = null, escNoPainel = false, folga = null, fluxoLigado: fluxoProp, onFluxo }: Props) {
  const [fluxoLocal, setFluxoLocal] = useState(false);
  const fluxoOn = fluxoProp !== undefined ? fluxoProp : fluxoLocal;
  const setFluxo = (v: boolean) => { if (fluxoProp === undefined) setFluxoLocal(v); onFluxo?.(v); };
  const caixas = useMemo(() => montarCena(cena), [cena]);
  const cabos = useMemo(() => montarCabos(caixas), [caixas]);
  const regioes = useMemo(() => regioesDeConflito(caixas, cena.conflitos, cena.folgas), [caixas, cena]);
  const idDescricao = useId();
  const [tutorial, setTutorial] = useState(false);
  const [passo, setPasso] = useState(0);
  const [explodida, setExplodida] = useState(false);
  const [abertaLocal, setAbertaLocal] = useState<string | null>(null);   // `chave` da peça aberta, sem controle de fora
  const aberta = abertaProp !== undefined ? abertaProp : abertaLocal;
  const setAberta = (chave: string | null) => { if (abertaProp === undefined) setAbertaLocal(chave); onAberta?.(chave); };
  const [focado, setFocado] = useState<{ id: string; vez: number } | null>(null);   // conflito para onde a câmera foi
  const [hover, setHover] = useState<string | null>(null);
  // Toque (dedo): o primeiro toque numa peça mostra o nome e acende; o segundo na mesma peça abre
  const [toque, setToque] = useState<{ chave: string; nome: string; peca: string | null } | null>(null);
  // Vista pronta: `pedido` anima a câmera uma vez (vez); arrastar com o mouse volta a "livre" sem animar
  const [vista, setVista] = useState<Vista>("livre");
  const [pedido, setPedido] = useState<{ vista: Vista; vez: number } | null>(null);
  // a vista escolhida vence o foco de um conflito clicado antes (senão o botão marcaria e a câmera não andaria)
  const pedirVista = (v: Vista) => { setVista(v); setFocado(null); setPedido((p) => ({ vista: v, vez: (p?.vez ?? 0) + 1 })); };
  const antesDaRegua = useRef<Vista | null>(null);
  const etiquetasRegua = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {   // régua ligada: vai para a vista da medida; desligada: volta à vista de antes
    if (folga) {
      if (antesDaRegua.current === null) antesDaRegua.current = vista;
      pedirVista(VISTA_DA_FOLGA[folga.id]);
    } else if (antesDaRegua.current !== null) {
      pedirVista(antesDaRegua.current);
      antesDaRegua.current = null;
    }
  }, [folga?.id]);
  const descricao = useMemo(() => {
    const nome = (id: string) => cena.pecas.find((p) => p.id === id)?.nome ?? id;
    const daRegua = folga ? ` Régua: ${nome(folga.peca)} ${folga.tamanho_mm} mm, limite ${folga.limite_mm} mm, ${folga.sobra_mm < 0 ? `passa ${-folga.sobra_mm}` : `sobram ${folga.sobra_mm}`} mm.` : "";
    const doFluxo = fluxoOn && cena.fluxo ? ` ${descricaoFluxo(cena.fluxo)}` : "";
    return (previa ? "Prévia, não aplicada. " : "") + (vista !== "livre" ? `Vista ${NOME_VISTA[vista].toLowerCase()}. ` : "") + descricaoCena(cena, caixas, regioes) + daRegua + doFluxo;
  }, [cena, caixas, regioes, previa, vista, folga, fluxoOn]);
  const reduzido = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const deToque = useMemo(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches, []);
  // Qualidade: escolha guardada no navegador; no Auto, o nível começa pelo tipo de ponteiro e só desce (nunca sobe sozinho)
  const [escolha, setEscolha] = useState<Escolha>(lerEscolha);
  const [nivel, setNivel] = useState<Nivel>(() => (escolha === "auto" && desceuNaVisita ? "leve" : nivelInicial(escolha, deToque)));
  const amostras = useRef<number[]>([]);
  const escolher = (e: Escolha) => {
    setEscolha(e); guardarEscolha(e); amostras.current = [];
    setNivel(e === "auto" && desceuNaVisita ? "leve" : nivelInicial(e, deToque));
  };
  const amostrar = (qps: number) => {
    amostras.current = [...amostras.current.slice(-5), qps];
    if (desceAuto(amostras.current)) { desceuNaVisita = true; setNivel("leve"); }
  };
  const leve = nivel === "leve";
  const ultimoDedo = useRef(false);   // o último toque no canvas foi de dedo (o clique no vazio não traz o tipo em todo navegador)
  const limparToque = () => { if (toque?.peca) onDestaque?.(null); setToque(null); };
  /** Toque numa peça: com ela aberta, só o nome da subpeça; segundo toque na mesma abre (fora do passo a passo). */
  const tocar = (c: Caixa) => (nome: string) => {
    if (aberta === c.chave) { setToque({ chave: c.chave, nome, peca: null }); return; }
    if (toque?.chave === c.chave && !tutorial && !previa) { limparToque(); setAberta(c.chave); return; }   // na prévia, abrir descartaria a prévia
    const peca = c.tipo === "gabinete" ? null : c.id;
    if (peca || toque?.peca) onDestaque?.(peca);
    setToque({ chave: c.chave, nome, peca });
  };
  const tocarNome = (chave: string, nome: string) => () => { if (toque?.peca) onDestaque?.(null); setToque({ chave, nome, peca: null }); };
  const destaqueCor = useMemo(() => (typeof window !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue("--hue").trim()) || "#66c0f4", []);
  /** Hover na cena: etiqueta com o nome e aviso ao painel de qual peça está sob o mouse. */
  const hoverDe = (c: Caixa) => (nome: string | null) => { setHover(nome); onDestaque?.(nome ? c.id : null); };
  const negativa = useMemo(() => (typeof window !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue("--negative").trim()) || NEGATIVA, []);
  const total = cena.passos.length;
  const gab = caixas.find((c) => c.tipo === "gabinete");
  const modeladas = caixas.filter((c) => c.modelo);
  const alvo = modeladas.find((c) => c.chave === aberta);
  const abreGab = alvo?.tipo === "gabinete";   // o gabinete abre no lugar, com tudo dentro à mostra
  const maxPasso = Math.max(0, ...caixas.map((c) => c.passo));

  // Tempo: o estado da cena é função do relógio e do instante da última troca (de passo, ou de montada/explodida).
  const trocaPasso = useRef({ chave: "", t: 0 });
  const trocaExpl = useRef({ ligada: false, t: -1e9 });   // montada "há muito tempo" no primeiro quadro
  const cache = useRef<{ t: number; passo: number; estado: EstadoPasso } | null>(null);
  /** Estado do passo a passo no instante t (uma conta por quadro, repartida entre as peças e os cabos). */
  const estadoEm = (t: number): EstadoPasso => {
    if (trocaPasso.current.chave !== `${tutorial}|${passo}`) trocaPasso.current = { chave: `${tutorial}|${passo}`, t };
    if (cache.current?.t !== t || cache.current.passo !== passo) {
      const progresso = reduzido ? 1 : Math.min(1, (t - trocaPasso.current.t) / DURACAO_PASSO);
      cache.current = { t, passo, estado: estadoPasso(caixas, cabos, passo, progresso) };
    }
    return cache.current.estado;
  };
  /** Tempo desde a última troca montada/explodida. */
  const desdeExpl = (t: number) => {
    if (trocaExpl.current.ligada !== explodida) trocaExpl.current = { ligada: explodida, t };
    return reduzido ? 1e9 : t - trocaExpl.current.t;
  };
  // sai primeiro a última peça montada, depois de os cabos sumirem; na volta, a ordem se desfaz
  const kDe = (c: Caixa, t: number) => progressoExplosao(maxPasso - c.passo, maxPasso, desdeExpl(t) - (explodida ? FADE : 0), explodida, ATRASO, DUR);
  const posicaoDe = (c: Caixa) => (t: number) => tutorial ? estadoEm(t).pecas[c.chave]?.pos ?? null : posicaoExplodida(c, kDe(c, t));
  const caboVisivel = (c: Cabo) => (t: number) => tutorial
    ? estadoEm(t).cabos.includes(c.id)
    : !explodida && desdeExpl(t) > maxPasso * ATRASO + DUR && (!alvo || abreGab);

  // a peça aberta sai pela lateral (+Z) até ficar inteira fora do gabinete, com folga
  const base = (c: Caixa) => (explodida ? posicaoExplodida(c, 1) : c.pos);
  const saidaDe = (c: Caixa) => c.tipo === "gabinete" ? 0 : Math.max(0, (gab ? gab.tam[2] / 2 : 0) + c.tam[2] / 2 - base(c)[2] + 40);

  // Para onde a câmera olha: peça aberta, peça do passo, build explodida, conflito clicado ou a build inteira.
  let foco: Vec3 = [0, 0, 0], distancia = CAM_INICIAL.length(), f: ReturnType<typeof focoDaPrevia> = null;
  let direcao: Vec3 | undefined;
  const doPasso = tutorial ? caixas.filter((c) => c.tipo !== "gabinete" && c.tipo === cena.passos[passo]?.tipo) : [];
  const conflito = cena.conflitos.find((c) => c.id === focado?.id);
  if (alvo) {
    const b = base(alvo);
    foco = mm([b[0], b[1], b[2] + saidaDe(alvo)]);
    distancia = abreGab ? CAM_INICIAL.length() * 1.35 : distanciaDe(Math.max(...alvo.tam));
  } else if (doPasso.length) {
    const e = envelope(doPasso);
    foco = mm(e.centro); distancia = Math.max(DE_FORA, distanciaDe(e.maior));
  } else if (explodida) {
    const e = envelope(caixas.map((c) => ({ pos: posicaoExplodida(c, 1), tam: c.tam })));
    foco = mm(e.centro); distancia = Math.max(distancia, e.maior * ESCALA * 1.25 + 1.6);
  } else if (previa && (f = focoDaPrevia(caixas, regioes, cena.conflitos, previa.para))) {
    foco = mm(f.centro); distancia = Math.max(DE_FORA, distanciaDe(f.maior));
  } else if (conflito && !tutorial) {
    const r = regioes.find((x) => x.conflitoId === conflito.id);
    const p = caixas.find((c) => c.tipo !== "gabinete" && conflito.itens.includes(c.id)) ?? caixas.find((c) => conflito.itens.includes(c.id));
    if (r) { foco = mm(r.centro); distancia = Math.max(DE_FORA, distanciaDe(Math.max(...r.tam))); }
    else if (p) { foco = mm(p.pos); distancia = Math.max(DE_FORA, distanciaDe(Math.max(...p.tam))); }
  }  if (!alvo && !doPasso.length && !explodida && !(previa && f) && !(conflito && !tutorial) && pedido) {
    direcao = pedido.vista === "livre" ? CAM_INICIAL.toArray() as Vec3 : DIRECAO[pedido.vista];   // vista pronta: gabinete inteiro
  }


  const aberto = alvo != null;
  const mostraRegioes = !tutorial && !explodida && !aberto;   // as regiões valem para a build montada
  const regua = folga && mostraRegioes && !previa ? reguaDe(folga, caixas) : null;
  const etiquetas = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {   // Esc fecha a peça aberta; sem peça aberta, desfaz a build explodida
    // na prévia, Esc é do painel (cancela); com o fluxo ligado, o primeiro Esc só desliga o fluxo
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !previa && !escNoPainel) fluxoOn ? setFluxo(false) : aberto ? setAberta(null) : setExplodida(false); };
    addEventListener("keydown", tecla);
    return () => removeEventListener("keydown", tecla);
  }, [aberto, previa, escNoPainel, fluxoOn]);
  // Ligar o fluxo (pelo botão ou pelo painel) monta a build; depois, abrir peça, explodir, passo a passo ou prévia desligam
  useEffect(() => { if (fluxoOn) { setExplodida(false); setTutorial(false); setAberta(null); } }, [fluxoOn]);
  useEffect(() => { if (fluxoOn && (aberto || explodida || tutorial || previa)) setFluxo(false); }, [aberto, explodida, tutorial, previa]);
  const fluxoVisivel = fluxoOn && !aberto && !explodida && !tutorial && !previa;
  const setas = useMemo(() => (fluxoVisivel ? setasDoFluxo(caixas, cena.fluxo) : []), [fluxoVisivel, caixas, cena.fluxo]);
  const caminhos = useMemo(() => (fluxoVisivel ? caminhosDoAr(caixas, cena.fluxo) : []), [fluxoVisivel, caixas, cena.fluxo]);
  useEffect(() => { limparToque(); }, [cena, tutorial, explodida, passo, aberta]);   // o toque não sobrevive à cena mudar
  useEffect(() => {   // a prévia mostra a build montada: explodida e passo a passo escondem as regiões de conflito
    if (previa) { setExplodida(false); setTutorial(false); }
  }, [previa?.para]);

  if (!caixas.length) return <p className="vazio-bloco">Adicione peças para ver a montagem em 3D.</p>;
  const rotulo = (c: Caixa) => {
    const iguais = modeladas.filter((x) => x.tipo === c.tipo);
    const r = ROTULO[c.tipo] ?? c.nome;
    return iguais.length < 2 ? r : new Set(iguais.map((x) => x.nome)).size === iguais.length ? c.nome : `${r} ${iguais.indexOf(c) + 1}`;
  };
  const irAoConflito = (id: string) => { setTutorial(false); setExplodida(false); setAberta(null); setFocado({ id, vez: (focado?.vez ?? 0) + 1 }); };
  return (
    <div>
      <div className="card-topo">
        <div className="acoes">
          <button className="btn" data-testid="tutorial" aria-pressed={tutorial}
            onClick={() => { setTutorial(!tutorial); setPasso(0); setAberta(null); setExplodida(false); setFocado(null); }}>
            Passo a passo
          </button>
          {!tutorial && (
            <button className="btn" data-testid="explodir" aria-pressed={explodida} onClick={() => { setExplodida(!explodida); setAberta(null); setFocado(null); }}>
              Explodir build
            </button>
          )}
          {!tutorial && cena.fluxo && (
            <button className="btn" data-testid="fluxo-ar" aria-pressed={fluxoOn} onClick={() => { const v = !fluxoOn; if (v) { setExplodida(false); setAberta(null); } setFluxo(v); }}>
              Fluxo de ar
            </button>
          )}
          {!tutorial && (
            <div className="vistas" role="group" aria-label="Vista">
              <span aria-hidden>Vista</span>
              {(["livre", "frente", "lateral", "topo"] as const).map((v) => (
                <button key={v} className="btn pequeno" data-testid={`vista-${v}`} aria-pressed={vista === v} onClick={() => pedirVista(v)}>{NOME_VISTA[v]}</button>
              ))}
            </div>
          )}
          {tutorial && (
            <>
              <button className="btn" data-testid="anterior" onClick={() => setPasso(Math.max(0, passo - 1))} disabled={passo === 0}>Anterior</button>
              <button className="btn" data-testid="proximo" onClick={() => setPasso(Math.min(total - 1, passo + 1))} disabled={passo >= total - 1}>Próximo</button>
            </>
          )}
          <div className="vistas" role="group" aria-label="Qualidade">
            <span aria-hidden>Qualidade</span>
            {(["auto", "alta", "leve"] as const).map((q) => (
              <button key={q} className="btn pequeno" data-testid={`qualidade-${q}`} aria-pressed={escolha === q} onClick={() => escolher(q)}>{NOME_QUALIDADE[q]}</button>
            ))}
            {escolha === "auto" && <span className="num">{rotuloQualidade(escolha, nivel)}</span>}
          </div>
        </div>
        {cena.conflitos.length > 0 && <span className="pill neg">{cena.conflitos.length} {cena.conflitos.length === 1 ? "conflito" : "conflitos"} em vermelho</span>}
      </div>
      {deToque && <p className="dica-toque" data-testid="dica-toque">Dois dedos giram e aproximam a cena.</p>}
      {!tutorial && modeladas.length > 0 && (
        <>
          <div className="cena-pecas" role="group" aria-label="Abrir peça em vista explodida">
            <span aria-hidden>Abrir peça</span>
            {modeladas.map((c) => (
              <button key={c.chave} className="btn pequeno" data-testid={`abrir-${c.chave}`} aria-pressed={alvo === c} title={c.nome}
                onClick={() => setAberta(alvo === c ? null : c.chave)}>
                {rotulo(c)}
              </button>
            ))}
          </div>
          <p className="passo" data-testid="dica">
            {alvo ? `Vista explodida: ${alvo.nome}. Passe o mouse nas subpeças; Esc ou clique fora para fechar.`
              : explodida ? "Build explodida: cada peça saiu na direção em que é instalada. Clique numa peça para abrir só ela; Esc volta à montada."
              : "Clique numa peça, ou use os botões acima, para abrir a vista explodida dela."}
          </p>
        </>
      )}
      {tutorial && total > 0 && (
        <p className="passo" data-testid="passo-texto" aria-live="polite"><strong>Passo {passo + 1} de {total}.</strong> {cena.passos[passo]?.texto}</p>
      )}
      <div className="cena" data-testid="cena" data-fluxo={fluxoVisivel ? "on" : "off"} data-ventoinhas={cena.fluxo ? `${cena.fluxo.entrada}:${cena.fluxo.saida}` : ""} data-qualidade={nivel} data-escolha={escolha} data-aberta={alvo?.chave ?? ""} data-destaque={destaque ?? ""} data-previa={previa?.para ?? ""}
        data-vista={vista} data-regua={regua ? folga!.id : ""}>
        {regua && folga && ([
          ["peca", `${ROTULO[cena.pecas.find((p) => p.id === folga.peca)?.tipo ?? "gpu"] ?? "peça"} ${folga.tamanho_mm} mm`, "medida regua"],
          ["resto", folga.sobra_mm < 0 ? `passa ${-folga.sobra_mm} mm` : `sobram ${folga.sobra_mm} mm`, `medida regua ${folga.estado}`],
          ["limite", `cabe ${folga.limite_mm} mm`, "medida regua"],
        ] as const).map(([k, texto, classe]) => (
          <span key={k} ref={(el) => { etiquetasRegua.current[k] = el; }} className={classe} data-testid="regua-medida">{texto}</span>
        ))}
        {(hover ?? toque?.nome) && <span className="etiqueta">{hover ?? toque?.nome}</span>}
        {previa && <span className="selo-previa" data-testid="selo-previa">Prévia: não aplicada</span>}
        {mostraRegioes && regioes.map((r) => medida(r) && (
          <span key={r.conflitoId} ref={(el) => { etiquetas.current[r.conflitoId] = el; }} className="medida" data-testid="medida-cena">{medida(r)}</span>
        ))}
        <SemWebGL><Canvas shadows={leve ? false : "percentage"} dpr={leve ? 1 : [1, 2]} camera={{ position: CAM_INICIAL.toArray(), fov: 45 }} onPointerDown={(e) => { ultimoDedo.current = e.pointerType === "touch"; }}
          onPointerMissed={() => { limparToque(); if (!(previa && ultimoDedo.current)) setAberta(null); }}   // na prévia, o dedo no vazio só apaga o nome
          onCreated={({ gl }) => {   // a descrição textual fica ligada ao próprio canvas
            gl.domElement.setAttribute("role", "img");
            gl.domElement.setAttribute("aria-label", "Montagem 3D da build");
            gl.domElement.setAttribute("aria-describedby", idDescricao);
          }}>
          <hemisphereLight args={["#dbe8ff", "#2a2f3a", 0.8]} />   {/* céu frio em cima, chão escuro embaixo: dá volume às faces */}
          <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow={!leve} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0005}
            shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} shadow-camera-near={1} shadow-camera-far={25} />
          {gab && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, (-gab.tam[1] / 2 - 2) * ESCALA, 0]} receiveShadow raycast={semRaio}>
            <planeGeometry args={[40, 40]} /><shadowMaterial opacity={0.35} />
          </mesh>}   {/* chão invisível: só recebe a sombra do gabinete */}
          <directionalLight position={[-6, 3, -4]} intensity={0.45} />   {/* contraluz fraco: separa a silhueta do fundo */}
          {caixas.map((c) => c.modelo ? (
            <Peca3D key={c.chave} c={c} modelo={c.modelo} escala={ESCALA} aberto={alvo === c} oculta={aberto && alvo !== c && !abreGab}
              reduzido={reduzido} saida={saidaDe(c)} posicao={posicaoDe(c)}
              encaixe={tutorial ? (t) => estadoEm(t).pecas[c.chave]?.encaixe ?? 0 : 0}
              moveis={tutorial ? (t) => estadoEm(t).pecas[c.chave]?.moveis : undefined}
              onClick={() => !tutorial && setAberta(alvo === c ? null : c.chave)} onHover={hoverDe(c)}
              destacada={c.tipo !== "gabinete" && (destaque === c.id || previa?.para === c.id || toque?.chave === c.chave)} corDestaque={destaqueCor} leve={leve}
              onToque={tocar(c)} />
          ) : (
            <Peca key={c.chave} c={c} posicao={posicaoDe(c)} apagada={aberto && !abreGab} onHover={hoverDe(c)} onToque={tocarNome(c.chave, c.nome)} />
          ))}
          {cabos.map((c) => <Cabo3D key={c.id} c={c} visivel={caboVisivel(c)} reduzido={reduzido} onHover={setHover} onToque={tocarNome(c.id, c.nome)} />)}
          {mostraRegioes && regioes.map((r) => <Regiao3D key={r.conflitoId} r={r} cor={negativa} etiqueta={() => etiquetas.current[r.conflitoId] ?? null} />)}
          {/* mexer com o mouse só marca Livre: mudar o pedido mudaria a chave do Foco e reiniciaria a animação (puxão) */}
          {escolha === "auto" && !leve && <Medidor onAmostra={amostrar} />}
          <OrbitControls makeDefault onStart={() => setVista("livre")} touches={{ ONE: undefined, TWO: TOUCH.DOLLY_ROTATE }} />
          <RolaComUmDedo />
          <Foco alvo={foco} distancia={distancia} vez={`${focado?.vez ?? 0}:${direcao ? pedido?.vez ?? 0 : 0}`} direcao={direcao} />
          {regua && folga && <Regua3D r={regua} estado={folga.estado} etiquetas={etiquetasRegua} />}
          {setas.map((s, i) => <SetaVentoinha key={i} s={s} />)}
          {fluxoVisivel && <Particulas caminhos={caminhos} n={leve ? 24 : 60} parado={reduzido} />}
        </Canvas></SemWebGL>
      </div>
      {tutorial && total > 0 && (
        <div className="passo-extra">   {/* abaixo da cena: acima dela empurraria o canvas para baixo */}
          <progress value={passo + 1} max={total} aria-label={`Passo ${passo + 1} de ${total}`} />
          {DICAS[cena.passos[passo]?.tipo] && <p className="dica-passo" data-testid="dica-passo">Dica: {DICAS[cena.passos[passo].tipo]}</p>}
        </div>
      )}
      <p id={idDescricao} className="sr" data-testid="descricao-cena">{descricao}</p>
      {alvo && <DadosPeca c={alvo} />}
      <ul className="legenda" aria-label="Legenda">
        {caixas.filter((c, i) => c.tipo !== "gabinete" && caixas.findIndex((x) => x.id === c.id) === i).map((c) => (
          <li key={c.id}><i style={{ background: c.conflito ? NEGATIVA : c.cor }} />{c.nome}</li>
        ))}
      </ul>
      {cena.conflitos.length > 0 && (
        <ul className="conflitos" aria-label="Conflitos">
          {cena.conflitos.map((c) => {
            const m = medida(regioes.find((r) => r.conflitoId === c.id));
            return (
              <li key={c.id}>
                <button className="conflito" data-testid="conflito" aria-current={focado?.id === c.id ? "true" : undefined}
                  title="Levar a câmera até o conflito" onClick={() => irAoConflito(c.id)}>
                  <span className="pill neg">Conflito</span>
                  <span>{c.descricao}</span>
                  {m && <span className="medida" data-testid="conflito-medida">{m}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
