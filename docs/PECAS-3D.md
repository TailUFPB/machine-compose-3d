# Método: peças 3D procedurais

Cada tipo de peça tem um **gerador**: uma função pura que recebe a ficha (`specs`) e devolve um `Modelo`
(`frontend/src/lib/peca.ts`). O renderizador (`components/Peca3D.tsx`) e a vista explodida são os mesmos para
qualquer peça. Prontas: GPU (`lib/gpu.ts`, a referência), placa-mãe (`lib/placa.ts`), memória (`lib/ram.ts`), CPU e cooler a ar (`lib/cpu.ts`), SSD M.2 (`lib/ssd.ts`), fonte e gabinete (`lib/gabinete.ts`).
Também: water cooler (`lib/aio.ts`, bloco e radiador) e discos SATA (`lib/disco.ts`). A montagem, os cabos, a build
explodida, as regiões de conflito e o passo a passo ficam em `lib/cena.ts`.

## Contrato

```ts
gerador(specs) -> { tam: [x, y, z], partes: Sub[], estimados: string[] }
Sub = { id, nome, forma, tom, fonte, pos, tam, explode, ordem }
```

- Tudo em **mm**, no referencial local da peça, centrado no envelope `tam`.
- `fonte` diz de onde vem a medida: `norma` (padrão público), `ficha` (specs do SKU) ou `estimado` (arquétipo).
  O rótulo ao passar o mouse mostra isso; nada estimado se passa por dado real.
- `explode` é o deslocamento na vista explodida; `ordem` escalona a saída.

## Encaixe entre peças (âncoras)

Cada modelo expõe `ancoras`: pontos de encaixe no referencial local (`pcie` na GPU e na placa-mãe, `dimm0`, `cpu`,
`m2`, `pente` na memória). `montarCena` posiciona uma peça fazendo a âncora dela coincidir com a da placa-mãe, em vez
de usar offsets soltos. Peça nova que se prende a outra declara a âncora dos dois lados e ganha um teste de encaixe.

## Passos para uma peça nova

1. **Fontes.** Liste o que a norma fixa (ATX, PCIe CEM, JEDEC, M.2, soquete), o que a ficha traz e o que será estimado.
   Campo que falta na ficha vira regra de estimativa explícita no gerador e entra em `estimados`.
2. **Camadas.** Descreva a peça real como camadas ao longo de um eixo (GPU: backplate · PCB · vão dos componentes ·
   aletas · fans/shroud). Cada camada recebe uma faixa do envelope; as subpeças só ocupam a faixa da sua camada.
3. **Lista de subpeças, nas seis famílias.** Uma peça só parece real quando tem todas:
   | Família | GPU | Exemplos em outras peças |
   |---|---|---|
   | Estrutura | PCB, bracket, backplate | chassi, torre do cooler, carcaça da fonte |
   | Interface (norma) | dedos PCIe com chave, saídas de vídeo, energia | pente da RAM, soquete, conector ATX 24 pinos, M.2 |
   | Função | chip da GPU, VRAM, VRM | slots, chipset, módulos de memória |
   | Térmico | base de cobre, aletas, heatpipes, fans | dissipadores de VRM, radiador, bomba |
   | Fixação | parafusos de retenção e do shroud | standoffs, travas, presilhas |
   | Acabamento | recortes e ventilação do bracket, tampa do shroud | grades, rótulos, vidro |
4. **Formas.** Use as primitivas de `Forma`: `caixa`, `tubo`, `cilindro`, `fan`, `aletas`, `placa` (chapa com furos) e
   `perfil` (polígono extrudado), `curva` (tubo por pontos) e
   `grade` (pinos, contatos e trilhas: toda interface elétrica mostra seus pinos, e todo PCB mostra os barramentos principais).
   Primitiva nova só quando nenhuma combinação dessas resolve, e entra no renderizador, não no gerador.
5. **Tons.** `lo` carcaça, `mid` estrutura secundária, `hi` parte móvel, `lit` um único destaque por peça,
   `pcb`/`ouro`/`cobre`/`metal`/`escuro` para materiais. Sem cor fora dessa paleta.
6. **Contatos.** Subpeças se encostam (flush) ou ficam sobre uma face; nunca se atravessam. Detalhe de superfície
   (recorte, parafuso) fica 0,2–0,4 mm para fora da face, dentro da tolerância do envelope.
7. **Explosão.** Cada camada sai ao longo do eixo das camadas, mais longe quanto mais externa; o núcleo fica parado.
   Subpeças presas a outra (chips no PCB) usam o mesmo `explode` e `ordem` dela.

## Verificação (obrigatória)

Testes em `lib/lib.test.ts`, para cada gerador, com fichas dos extremos do catálogo (menor, maior, mais conectores):

- todas as subpeças cabem no envelope da ficha (folga 0,5 mm);
- `atravessam(modelo)` vazio, exceto contatos de projeto declarados no teste (heatpipe dentro das aletas);
- contagens seguem a ficha (fans, conectores) e a `fonte` de cada subpeça está certa.

Depois, no navegador: montada e explodida, vista de cima, de baixo e de lado, sem erro no console.
Compare com fotos do produto real e anote o que falta por família.

## O que a GPU ainda não tem

Formas curvas ou chanfradas no shroud, heatpipes dobrados até a base, aba superior do bracket, cabo do fan,
rótulos. Campos de ficha que removeriam estimativas: `fans`, `fan_mm`, `backplate`, `saidas` (lista de portas),
`pcb_mm` (PCB mais curto que o cooler).
