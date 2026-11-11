"use client";
// Cena 3D paramétrica (React Three Fiber): build montada, explodida ou passo a passo.
// Conflito físico vira região vermelha com a medida do excesso; a peça em conflito pulsa.
import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CatmullRomCurve3, type Group, type Mesh, MeshLambertMaterial, type MeshStandardMaterial, TubeGeometry, Vector3 } from "three";
import type { Cena } from "@/lib/api";
import { type Cabo, type Caixa, type EstadoPasso, type Regiao, type Vec3, descricaoCena, estadoPasso, montarCabos, montarCena, posicaoExplodida, regioesDeConflito } from "@/lib/cena";
import { progressoExplosao } from "@/lib/peca";
import Peca3D from "./Peca3D";

const ESCALA = 1 / 100;   // mm -> unidades da cena
const DURACAO_PASSO = 1.2; // s
const ATRASO = 0.09, DUR = 0.6, FADE = 0.2;   // build explodida (s): escalonamento por passo, duração por peça, sumiço dos cabos
const NEGATIVA = "#ff6b5e";                    // reserva do token --negative
const mm = (v: Vec3) => v.map((x) => x * ESCALA) as Vec3;
const rotDe = (c: Caixa) => (c as Caixa & { rot?: Vec3 }).rot;   // Euler XYZ em torno do centro, quando o layout girar a peça
const semRaio = () => null;

function Peca({ c, posicao, apagada, onHover }: { c: Caixa; posicao: (t: number) => Vec3 | null; apagada: boolean; onHover: (n: string | null) => void }) {
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
    <mesh ref={ref} position={mm(c.pos)} rotation={rotDe(c)}
      onPointerOver={(e) => { if (!gab) { e.stopPropagation(); onHover(c.nome); } }} onPointerOut={() => onHover(null)}>
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
function Cabo3D({ c, visivel, reduzido, onHover }: { c: Cabo; visivel: (t: number) => boolean; reduzido: boolean; onHover: (n: string | null) => void }) {
  const geo = useMemo(() => {
    // a curva quase não arredonda, para os trechos ficarem retos
    const curva = new CatmullRomCurve3(c.pontos.map((p) => new Vector3(...mm(p))), false, "catmullrom", 0.08);
    return new TubeGeometry(curva, c.pontos.length * 24, c.raio * ESCALA, 8);
  }, [c]);
  const mat = useMemo(() => new MeshLambertMaterial({ color: c.tipo === "mangueira" ? "#141a22" : c.raio > 2 ? "#5d6f86" : "#c8a04c" }), [c]);
  const grupo = useRef<Group>(null);
  useFrame(({ clock }, dt) => {
    const alvo = visivel(clock.elapsedTime) ? 1 : 0;
    let op = reduzido ? alvo : mat.opacity + (alvo - mat.opacity) * (1 - Math.exp((-dt * 3) / FADE));
    if (Math.abs(alvo - op) < 0.01) op = alvo;
    if (mat.transparent !== op < 1) { mat.transparent = op < 1; mat.needsUpdate = true; }
    mat.opacity = op;
    if (grupo.current) grupo.current.visible = op > 0;
  });
  return (
    <group ref={grupo} onPointerOver={(e) => { if (mat.opacity < 0.5) return; e.stopPropagation(); onHover(c.nome); }} onPointerOut={() => onHover(null)}>
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
const ROTULO: Partial<Record<Caixa["tipo"], string>> = { gpu: "GPU", placa_mae: "placa-mãe", memoria: "memória", cpu: "CPU", cooler: "cooler", armazenamento: "armazenamento", fonte: "fonte", gabinete: "gabinete" };
const distanciaDe = (maior: number) => maior * ESCALA * 1.5 + 2.2;
const DE_FORA = 4.5;   // distância mínima ao focar algo dentro do gabinete: a câmera fica do lado de fora do vidro

/** Centro e maior lado do envelope de um conjunto de caixas (mm). */
function envelope(cs: { pos: Vec3; tam: Vec3 }[]): { centro: Vec3; maior: number } {
  const lo = [0, 1, 2].map((i) => Math.min(...cs.map((c) => c.pos[i] - c.tam[i] / 2)));
  const hi = [0, 1, 2].map((i) => Math.max(...cs.map((c) => c.pos[i] + c.tam[i] / 2)));
  return { centro: lo.map((v, i) => (v + hi[i]) / 2) as Vec3, maior: Math.max(...lo.map((v, i) => hi[i] - v)) };
}

/** Leva o alvo da órbita (e a distância da câmera) até o foco por ~1,2 s depois de cada troca; depois solta. `vez` refaz o mesmo foco. */
function Foco({ alvo, distancia, vez = 0 }: { alvo: Vec3; distancia: number; vez?: number }) {
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  const tela = useThree((s) => s.gl.domElement);
  const desde = useRef<{ chave: string; t: number }>({ chave: "", t: 0 });
  const chave = `${alvo.join()}|${distancia}|${vez}`;
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
    tela.dataset.alvo = controls.target.toArray().map((v) => v.toFixed(2)).join();   // onde a câmera olha (teste de navegador)
  });
  return null;
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

export default function Cena3D({ cena }: { cena: Cena }) {
  const caixas = useMemo(() => montarCena(cena), [cena]);
  const cabos = useMemo(() => montarCabos(caixas), [caixas]);
  const regioes = useMemo(() => regioesDeConflito(caixas, cena.conflitos), [caixas, cena]);
  const descricao = useMemo(() => descricaoCena(cena, caixas, regioes), [cena, caixas, regioes]);
  const idDescricao = useId();
  const [tutorial, setTutorial] = useState(false);
  const [passo, setPasso] = useState(0);
  const [explodida, setExplodida] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);   // `chave` da peça aberta
  const [focado, setFocado] = useState<{ id: string; vez: number } | null>(null);   // conflito para onde a câmera foi
  const [hover, setHover] = useState<string | null>(null);
  const reduzido = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
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
  let foco: Vec3 = [0, 0, 0], distancia = CAM_INICIAL.length();
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
  } else if (conflito && !tutorial) {
    const r = regioes.find((x) => x.conflitoId === conflito.id);
    const p = caixas.find((c) => c.tipo !== "gabinete" && conflito.itens.includes(c.id)) ?? caixas.find((c) => conflito.itens.includes(c.id));
    if (r) { foco = mm(r.centro); distancia = Math.max(DE_FORA, distanciaDe(Math.max(...r.tam))); }
    else if (p) { foco = mm(p.pos); distancia = Math.max(DE_FORA, distanciaDe(Math.max(...p.tam))); }
  }

  const aberto = alvo != null;
  const mostraRegioes = !tutorial && !explodida && !aberto;   // as regiões valem para a build montada
  const etiquetas = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {   // Esc fecha a peça aberta; sem peça aberta, desfaz a build explodida
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") aberto ? setAberta(null) : setExplodida(false); };
    addEventListener("keydown", tecla);
    return () => removeEventListener("keydown", tecla);
  }, [aberto]);

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
            {tutorial ? "Ver montada" : "Passo a passo"}
          </button>
          {!tutorial && (
            <button className="btn" data-testid="explodir" aria-pressed={explodida} onClick={() => { setExplodida(!explodida); setAberta(null); setFocado(null); }}>
              Explodir build
            </button>
          )}
          {tutorial && (
            <>
              <button className="btn" data-testid="anterior" onClick={() => setPasso(Math.max(0, passo - 1))} disabled={passo === 0}>Anterior</button>
              <button className="btn" data-testid="proximo" onClick={() => setPasso(Math.min(total - 1, passo + 1))} disabled={passo >= total - 1}>Próximo</button>
            </>
          )}
        </div>
        {cena.conflitos.length > 0 && <span className="pill neg">{cena.conflitos.length} {cena.conflitos.length === 1 ? "conflito" : "conflitos"} em vermelho</span>}
      </div>
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
        <p className="passo" data-testid="passo-texto" aria-live="polite"><strong>Passo {passo + 1} de {total}.</strong> {cena.passos[passo].texto}</p>
      )}
      <div className="cena" data-testid="cena" data-aberta={alvo?.chave ?? ""}>
        {hover && <span className="etiqueta">{hover}</span>}
        {mostraRegioes && regioes.map((r) => medida(r) && (
          <span key={r.conflitoId} ref={(el) => { etiquetas.current[r.conflitoId] = el; }} className="medida" data-testid="medida-cena">{medida(r)}</span>
        ))}
        <Canvas camera={{ position: CAM_INICIAL.toArray(), fov: 45 }} onPointerMissed={() => setAberta(null)}
          onCreated={({ gl }) => {   // a descrição textual fica ligada ao próprio canvas
            gl.domElement.setAttribute("role", "img");
            gl.domElement.setAttribute("aria-label", "Montagem 3D da build");
            gl.domElement.setAttribute("aria-describedby", idDescricao);
          }}>
          <ambientLight intensity={0.9} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} />
          {caixas.map((c) => c.modelo ? (
            <Peca3D key={c.chave} c={c} modelo={c.modelo} escala={ESCALA} aberto={alvo === c} oculta={aberto && alvo !== c && !abreGab}
              reduzido={reduzido} saida={saidaDe(c)} posicao={posicaoDe(c)}
              encaixe={tutorial ? (t) => estadoEm(t).pecas[c.chave]?.encaixe ?? 0 : 0}
              moveis={tutorial ? (t) => estadoEm(t).pecas[c.chave]?.moveis : undefined}
              onClick={() => !tutorial && setAberta(alvo === c ? null : c.chave)} onHover={setHover} />
          ) : (
            <Peca key={c.chave} c={c} posicao={posicaoDe(c)} apagada={aberto && !abreGab} onHover={setHover} />
          ))}
          {cabos.map((c) => <Cabo3D key={c.id} c={c} visivel={caboVisivel(c)} reduzido={reduzido} onHover={setHover} />)}
          {mostraRegioes && regioes.map((r) => <Regiao3D key={r.conflitoId} r={r} cor={negativa} etiqueta={() => etiquetas.current[r.conflitoId] ?? null} />)}
          <OrbitControls makeDefault />
          <Foco alvo={foco} distancia={distancia} vez={focado?.vez} />
        </Canvas>
      </div>
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
