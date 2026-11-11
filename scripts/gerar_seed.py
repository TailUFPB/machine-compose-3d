"""Gera backend/app/seed.json: catálogo, ofertas, histórico de preço e benchmarks FICTÍCIOS para demo.

Os modelos de peça existem; as fichas são aproximadas; preços e FPS são inventados (fonte "seed:demo").
Rodar: python scripts/gerar_seed.py   (determinístico, semente fixa)
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

rnd = random.Random(42)
SAIDA = Path(__file__).resolve().parent.parent / "backend" / "app" / "seed.json"
FONTE_FICHA = "seed:demo/ficha-tecnica"
FONTE_BENCH = "seed:demo/benchmark"
AGORA = datetime(2026, 11, 9, 12, tzinfo=timezone.utc)

componentes: list[dict] = []


def add(id_, tipo, marca, modelo, preco, **specs):
    componentes.append({"id": id_, "tipo": tipo, "marca": marca, "modelo": modelo,
                        "specs": specs, "fonte": FONTE_FICHA, "_preco": preco})


# --- CPUs: socket, memória, tdp/pico, índice de jogos (9800X3D ~ 110), BIOS mínima por plataforma
cpu = lambda id_, marca, modelo, preco, socket, mem, tdp, pico, idx, nucleos, igpu, box, bios: add(
    id_, "cpu", marca, modelo, preco, socket=socket, memoria=mem, tdp=tdp, potencia_pico=pico, indice=idx,
    nucleos=nucleos, gpu_integrada=igpu, cooler_incluso=box, bios_min=bios)
cpu("r5-5500", "AMD", "Ryzen 5 5500", 520, "AM4", ["DDR4"], 65, 88, 60, 6, False, True, 1)
cpu("r5-5600", "AMD", "Ryzen 5 5600", 690, "AM4", ["DDR4"], 65, 88, 68, 6, False, True, 1)
cpu("r7-5700x3d", "AMD", "Ryzen 7 5700X3D", 1250, "AM4", ["DDR4"], 105, 142, 84, 8, False, False, 3)
cpu("r5-7600", "AMD", "Ryzen 5 7600", 1150, "AM5", ["DDR5"], 65, 88, 82, 6, True, True, 1)
cpu("r5-7600x", "AMD", "Ryzen 5 7600X", 1250, "AM5", ["DDR5"], 105, 142, 85, 6, True, False, 1)
cpu("r7-7700", "AMD", "Ryzen 7 7700", 1650, "AM5", ["DDR5"], 65, 88, 86, 8, True, True, 1)
cpu("r7-7800x3d", "AMD", "Ryzen 7 7800X3D", 2400, "AM5", ["DDR5"], 120, 162, 100, 8, True, False, 1)
cpu("r5-9600x", "AMD", "Ryzen 5 9600X", 1600, "AM5", ["DDR5"], 65, 88, 90, 6, True, False, 3)
cpu("r7-9700x", "AMD", "Ryzen 7 9700X", 2100, "AM5", ["DDR5"], 65, 88, 92, 8, True, False, 3)
cpu("r7-9800x3d", "AMD", "Ryzen 7 9800X3D", 3300, "AM5", ["DDR5"], 120, 162, 110, 8, True, False, 3)
cpu("r9-9900x", "AMD", "Ryzen 9 9900X", 2900, "AM5", ["DDR5"], 120, 162, 93, 12, True, False, 3)
cpu("i5-12400f", "Intel", "Core i5-12400F", 680, "LGA1700", ["DDR4", "DDR5"], 65, 117, 70, 6, False, True, 1)
cpu("i5-13400f", "Intel", "Core i5-13400F", 1050, "LGA1700", ["DDR4", "DDR5"], 65, 148, 75, 10, False, True, 2)
cpu("i5-14600kf", "Intel", "Core i5-14600KF", 1700, "LGA1700", ["DDR4", "DDR5"], 125, 181, 92, 14, False, False, 3)
cpu("i7-14700kf", "Intel", "Core i7-14700KF", 2500, "LGA1700", ["DDR4", "DDR5"], 125, 253, 96, 20, False, False, 3)

# --- GPUs: índice relativo (RTX 5070 = 100), tdp, comprimento, slots, conectores, fator de pico transitório
gpu = lambda id_, marca, modelo, preco, idx, tdp, comp, slots, con, vram, pico: add(
    id_, "gpu", marca, modelo, preco, indice=idx, tdp=tdp, comprimento_mm=comp, slots=slots, conectores=con,
    vram_gb=vram, fator_pico=pico, dimensoes={"c": comp, "a": 120, "l": slots * 20})
gpu("rtx-3050-6g", "NVIDIA", "GeForce RTX 3050 6GB", 1200, 30, 70, 170, 2, {}, 6, 1.4)
gpu("rtx-3060-12g", "NVIDIA", "GeForce RTX 3060 12GB", 1700, 48, 170, 242, 2, {"8pin": 1}, 12, 1.5)
gpu("rtx-4060-8g", "NVIDIA", "GeForce RTX 4060 8GB", 1900, 55, 115, 240, 2, {"8pin": 1}, 8, 1.5)
gpu("rtx-4060ti-8g", "NVIDIA", "GeForce RTX 4060 Ti 8GB", 2500, 66, 160, 245, 2, {"8pin": 1}, 8, 1.5)
gpu("rtx-4060ti-16g", "NVIDIA", "GeForce RTX 4060 Ti 16GB", 3000, 68, 165, 250, 2, {"8pin": 1}, 16, 1.5)
gpu("rtx-4070", "NVIDIA", "GeForce RTX 4070 12GB", 3900, 85, 200, 267, 2, {"8pin": 1}, 12, 1.5)
gpu("rtx-4070s", "NVIDIA", "GeForce RTX 4070 Super 12GB", 4300, 96, 220, 270, 2, {"12V-2x6": 1}, 12, 1.5)
gpu("rtx-4070tis", "NVIDIA", "GeForce RTX 4070 Ti Super 16GB", 5800, 112, 285, 305, 3, {"12V-2x6": 1}, 16, 1.5)
gpu("rtx-4080s", "NVIDIA", "GeForce RTX 4080 Super 16GB", 7600, 135, 320, 340, 3, {"12V-2x6": 1}, 16, 1.5)
gpu("rtx-5060-8g", "NVIDIA", "GeForce RTX 5060 8GB", 2300, 62, 145, 240, 2, {"8pin": 1}, 8, 1.6)
gpu("rtx-5060ti-16g", "NVIDIA", "GeForce RTX 5060 Ti 16GB", 3100, 74, 180, 250, 2, {"8pin": 1}, 16, 1.6)
gpu("rtx-5070", "NVIDIA", "GeForce RTX 5070 12GB", 4500, 100, 250, 280, 2, {"12V-2x6": 1}, 12, 1.6)
gpu("rtx-5070ti", "NVIDIA", "GeForce RTX 5070 Ti 16GB", 6200, 124, 300, 305, 3, {"12V-2x6": 1}, 16, 1.6)
gpu("rx-6600", "AMD", "Radeon RX 6600 8GB", 1350, 46, 132, 190, 2, {"8pin": 1}, 8, 1.8)
gpu("rx-7600", "AMD", "Radeon RX 7600 8GB", 1700, 54, 165, 204, 2, {"8pin": 1}, 8, 1.8)
gpu("rx-7700xt", "AMD", "Radeon RX 7700 XT 12GB", 2900, 76, 245, 270, 2, {"8pin": 2}, 12, 1.8)
gpu("rx-7800xt", "AMD", "Radeon RX 7800 XT 16GB", 3500, 92, 263, 290, 3, {"8pin": 2}, 16, 1.8)
gpu("rx-9070", "AMD", "Radeon RX 9070 16GB", 4400, 108, 220, 290, 3, {"8pin": 2}, 16, 1.8)
gpu("rx-9070xt", "AMD", "Radeon RX 9070 XT 16GB", 5000, 120, 304, 315, 3, {"8pin": 3}, 16, 1.8)
gpu("arc-b580", "Intel", "Arc B580 12GB", 1900, 58, 190, 272, 2, {"8pin": 1}, 12, 1.6)

# --- Placas-mãe: bios_nivel = geração de CPU que a BIOS de fábrica aceita; flashback = atualiza sem CPU
mb = lambda id_, marca, modelo, preco, socket, chipset, mem, ff, wifi, bios, flashback, m2, qvl: add(
    id_, "placa_mae", marca, modelo, preco, socket=socket, chipset=chipset, memoria=mem, slots_ram=4 if ff != "ITX" else 2,
    form_factor=ff, wifi=wifi, bios_nivel=bios, bios_flashback=flashback, m2_slots=m2, qvl_memoria=qvl,
    dimensoes={"ATX": {"c": 305, "a": 244}, "mATX": {"c": 244, "a": 244}, "ITX": {"c": 170, "a": 170}}[ff])
DDR5_QVL = ["ram-fury-d5-16", "ram-fury-d5-32", "ram-lancer-d5-32"]
DDR4_QVL = ["ram-fury-d4-16", "ram-lpx-d4-32"]
mb("mb-a620m-hdv", "ASRock", "A620M-HDV/M.2+", 650, "AM5", "A620", "DDR5", "mATX", False, 2, False, 1, DDR5_QVL)
mb("mb-b650m-a", "ASUS", "Prime B650M-A II", 950, "AM5", "B650", "DDR5", "mATX", False, 2, False, 2, DDR5_QVL)
mb("mb-b650-gx-ax", "Gigabyte", "B650 Gaming X AX", 1250, "AM5", "B650", "DDR5", "ATX", True, 2, True, 3, DDR5_QVL + ["ram-veng-d5-32"])
mb("mb-b850-tomahawk", "MSI", "MAG B850 Tomahawk WiFi", 1900, "AM5", "B850", "DDR5", "ATX", True, 3, True, 4, DDR5_QVL + ["ram-veng-d5-32"])
mb("mb-b650i-strix", "ASUS", "ROG Strix B650E-I Gaming WiFi", 2300, "AM5", "B650E", "DDR5", "ITX", True, 2, True, 2, DDR5_QVL)
mb("mb-b550m-vdh", "MSI", "B550M PRO-VDH", 620, "AM4", "B550", "DDR4", "mATX", False, 2, True, 2, DDR4_QVL)
mb("mb-b550-aorus", "Gigabyte", "B550 Aorus Elite V2", 900, "AM4", "B550", "DDR4", "ATX", False, 3, True, 2, DDR4_QVL)
mb("mb-b760m-d4", "MSI", "PRO B760M-A DDR4", 800, "LGA1700", "B760", "DDR4", "mATX", False, 2, True, 2, DDR4_QVL)
mb("mb-b760-tuf-d5", "ASUS", "TUF Gaming B760-Plus WiFi D5", 1300, "LGA1700", "B760", "DDR5", "ATX", True, 3, True, 3, DDR5_QVL)
mb("mb-z790-ud", "Gigabyte", "Z790 UD", 1500, "LGA1700", "Z790", "DDR5", "ATX", False, 3, True, 3, DDR5_QVL + ["ram-veng-d5-32"])

# --- Memória
ram = lambda id_, marca, modelo, preco, tipo, gb, mods, mhz, alt: add(
    id_, "memoria", marca, modelo, preco, ddr=tipo, capacidade_gb=gb, modulos=mods, velocidade=mhz, altura_mm=alt)
ram("ram-fury-d5-16", "Kingston", "Fury Beast DDR5 16GB (2x8) 5600", 380, "DDR5", 16, 2, 5600, 34)
ram("ram-fury-d5-32", "Kingston", "Fury Beast DDR5 32GB (2x16) 6000", 700, "DDR5", 32, 2, 6000, 34)
ram("ram-lancer-d5-32", "XPG", "Lancer DDR5 32GB (2x16) 6000", 690, "DDR5", 32, 2, 6000, 31)
ram("ram-veng-d5-32", "Corsair", "Vengeance RGB DDR5 32GB (2x16) 6000", 820, "DDR5", 32, 2, 6000, 44)
ram("ram-fury-d4-16", "Kingston", "Fury Beast DDR4 16GB (2x8) 3200", 260, "DDR4", 16, 2, 3200, 34)
ram("ram-lpx-d4-32", "Corsair", "Vengeance LPX DDR4 32GB (2x16) 3200", 480, "DDR4", 32, 2, 3200, 31)

# --- Armazenamento
ssd = lambda id_, marca, modelo, preco, interface, gb: add(id_, "armazenamento", marca, modelo, preco, interface=interface, capacidade_gb=gb)
ssd("ssd-nv3-1t", "Kingston", "NV3 1TB NVMe", 380, "M.2", 1000)
ssd("ssd-sn770-1t", "WD", "Black SN770 1TB NVMe", 450, "M.2", 1000)
ssd("ssd-990pro-2t", "Samsung", "990 Pro 2TB NVMe", 1100, "M.2", 2000)
ssd("ssd-mx500-1t", "Crucial", "MX500 1TB SATA", 390, "SATA", 1000)

# --- Fontes: tier de qualidade (A melhor), ATX 3.x, conectores PCIe nativos
psu = lambda id_, marca, modelo, preco, w, cert, tier, atx3, con, ff="ATX": add(
    id_, "fonte", marca, modelo, preco, potencia_w=w, certificacao=cert, tier=tier, atx3=atx3, conectores=con,
    form_factor=ff, dimensoes={"ATX": {"c": 150, "a": 86, "l": 140}, "SFX": {"c": 125, "a": 63, "l": 100}}[ff])
psu("psu-a550bn", "MSI", "MAG A550BN 550W", 300, 550, "80+ Bronze", "C", False, {"8pin": 2})
psu("psu-cx650", "Corsair", "CX650 650W", 380, 650, "80+ Bronze", "C", False, {"8pin": 2})
psu("psu-core2-750", "XPG", "Core Reactor II 750W", 560, 750, "80+ Gold", "B", False, {"8pin": 3})
psu("psu-a750gl", "MSI", "MAG A750GL PCIE5 750W", 600, 750, "80+ Gold", "B", True, {"12V-2x6": 1, "8pin": 2})
psu("psu-rm850e", "Corsair", "RM850e ATX 3.1 850W", 780, 850, "80+ Gold", "A", True, {"12V-2x6": 1, "8pin": 3})
psu("psu-focus-1000", "Seasonic", "Focus GX-1000 ATX 3.0", 1150, 1000, "80+ Gold", "A", True, {"12V-2x6": 1, "8pin": 4})
psu("psu-sf750", "Corsair", "SF750 SFX 750W", 1100, 750, "80+ Platinum", "A", True, {"12V-2x6": 1, "8pin": 2}, "SFX")

# --- Gabinetes: placas aceitas, folgas, radiadores; gpu_max com radiador frontal ocupando espaço
gab = lambda id_, marca, modelo, preco, ffs, gpu_max, gpu_rad, cooler_max, rads, psu_ff, fans, dim: add(
    id_, "gabinete", marca, modelo, preco, form_factors=ffs, gpu_max_mm=gpu_max, gpu_max_com_radiador_frontal_mm=gpu_rad,
    cooler_max_mm=cooler_max, radiadores=rads, psu_form_factor=psu_ff, fans_inclusos=fans, dimensoes=dim)
gab("case-lancool-216", "Lian Li", "Lancool 216", 650, ["ATX", "mATX", "ITX"], 392, 340, 180, [240, 280, 360], ["ATX"], 3, {"c": 480, "a": 491, "l": 235})
gab("case-h5-flow", "NZXT", "H5 Flow (2024)", 700, ["ATX", "mATX", "ITX"], 365, 305, 165, [240, 280, 360], ["ATX"], 2, {"c": 446, "a": 464, "l": 227})
gab("case-air903", "Montech", "AIR 903 Base", 450, ["ATX", "mATX", "ITX"], 400, 345, 180, [240, 280, 360], ["ATX"], 3, {"c": 487, "a": 474, "l": 230})
gab("case-q300l", "Cooler Master", "MasterBox Q300L", 300, ["mATX", "ITX"], 360, 300, 159, [240], ["ATX"], 1, {"c": 387, "a": 381, "l": 230})
gab("case-nr200p", "Cooler Master", "NR200P", 650, ["ITX"], 330, 330, 155, [240, 280], ["SFX"], 2, {"c": 376, "a": 292, "l": 185})

# --- Coolers: altura (ar) ou radiador (AIO), TDP suportado, folga para RAM (mm) sob o dissipador
clr = lambda id_, marca, modelo, preco, tipo, alt, tdp, ram_max, rad=None: add(
    id_, "cooler", marca, modelo, preco, refrigeracao=tipo, altura_mm=alt, tdp_suportado=tdp, sockets=["AM4", "AM5", "LGA1700"],
    ram_altura_max_mm=ram_max, radiador_mm=rad)
clr("clr-ak400", "DeepCool", "AK400", 180, "ar", 155, 220, 60)
clr("clr-pa120se", "Thermalright", "Peerless Assassin 120 SE", 230, "ar", 155, 245, 42)
clr("clr-nhd15", "Noctua", "NH-D15 G2", 900, "ar", 168, 260, 32)
clr("clr-kraken-240", "NZXT", "Kraken 240", 750, "aio", 52, 260, None, 240)
clr("clr-lf3-360", "Arctic", "Liquid Freezer III 360", 650, "aio", 53, 300, None, 360)

# --- Extras (itens faltantes sugeridos)
ext = lambda id_, modelo, preco, cat: add(id_, "extra", "Diversos", modelo, preco, categoria=cat)
ext("ext-pasta", "Pasta térmica Arctic MX-4 4g", 45, "pasta_termica")
ext("ext-fan-3pack", "Kit 3 ventoinhas 120mm", 120, "ventoinhas")
ext("ext-win11", "Windows 11 Home (licença digital)", 600, "so")
ext("ext-wifi", "Adaptador Wi-Fi 6 PCIe", 150, "wifi")

# --- Jogos: FPS de referência (GPU índice 100, preset Alto) por resolução e teto de CPU (índice 100)
JOGOS = [
    {"id": "cyberpunk-2077", "nome": "Cyberpunk 2077", "gpu_ref": {"1080p": 118, "1440p": 82}, "cpu_ref": 165, "low": 0.74},
    {"id": "cs2", "nome": "Counter-Strike 2", "gpu_ref": {"1080p": 390, "1440p": 290}, "cpu_ref": 520, "low": 0.55},
    {"id": "fortnite", "nome": "Fortnite", "gpu_ref": {"1080p": 210, "1440p": 150}, "cpu_ref": 290, "low": 0.62},
    {"id": "valorant", "nome": "Valorant", "gpu_ref": {"1080p": 560, "1440p": 470}, "cpu_ref": 620, "low": 0.58},
    {"id": "bg3", "nome": "Baldur's Gate 3", "gpu_ref": {"1080p": 140, "1440p": 102}, "cpu_ref": 145, "low": 0.70},
    {"id": "cod-bo6", "nome": "Call of Duty: Black Ops 6", "gpu_ref": {"1080p": 170, "1440p": 128}, "cpu_ref": 240, "low": 0.68},
    {"id": "rdr2", "nome": "Red Dead Redemption 2", "gpu_ref": {"1080p": 125, "1440p": 92}, "cpu_ref": 175, "low": 0.76},
    {"id": "fh5", "nome": "Forza Horizon 5", "gpu_ref": {"1080p": 160, "1440p": 128}, "cpu_ref": 230, "low": 0.80},
    {"id": "wukong", "nome": "Black Myth: Wukong", "gpu_ref": {"1080p": 92, "1440p": 64}, "cpu_ref": 170, "low": 0.78},
    {"id": "marvel-rivals", "nome": "Marvel Rivals", "gpu_ref": {"1080p": 150, "1440p": 108}, "cpu_ref": 220, "low": 0.66},
]
RESOLUCOES = ["1080p", "1440p"]
PRESET = "Alto"

por_id = {c["id"]: c for c in componentes}
gpus = [c for c in componentes if c["tipo"] == "gpu"]
cpus = [c for c in componentes if c["tipo"] == "cpu"]


def fps_modelo(g, c, jogo, res):
    lim_gpu = jogo["gpu_ref"][res] * g["specs"]["indice"] / 100
    lim_cpu = jogo["cpu_ref"] * c["specs"]["indice"] / 100
    return min(lim_gpu, lim_cpu) * 0.97 * rnd.uniform(0.95, 1.05)


benchmarks = []
CPU_TOPO, GPU_TOPO = "r7-9800x3d", "rtx-4080s"
pares = set()
for g in gpus:                      # GPU com CPU topo: perto de limitado pela GPU
    for res in RESOLUCOES:
        if rnd.random() > 0.25:     # parte fica sem medição para exercitar a interpolação
            pares.add((g["id"], CPU_TOPO, res))
for c in cpus:                      # CPU com GPU topo em 1080p: perto de limitado pela CPU
    if rnd.random() > 0.2:
        pares.add((GPU_TOPO, c["id"], "1080p"))
for gid, cid in [("rtx-4060-8g", "r5-5600"), ("rtx-4070s", "r5-7600"), ("rx-7600", "i5-12400f"),
                 ("rx-7800xt", "r7-7800x3d"), ("rtx-5070", "r7-9700x"), ("rtx-3060-12g", "r5-5500")]:
    for res in RESOLUCOES:
        pares.add((gid, cid, res))
for gid, cid, res in sorted(pares):
    for jogo in JOGOS:
        fps = fps_modelo(por_id[gid], por_id[cid], jogo, res)
        benchmarks.append({"gpu_id": gid, "cpu_id": cid, "jogo": jogo["id"], "resolucao": res, "preset": PRESET,
                           "fps_medio": round(fps, 1), "fps_1low": round(fps * jogo["low"] * rnd.uniform(0.95, 1.05), 1),
                           "fonte": FONTE_BENCH, "data": "2026-10-01"})

# --- Ofertas: anúncios brutos por loja (título + preço em texto + URL), com histórico semanal
LOJAS = {"Kabum": "https://www.kabum.com.br/busca/{}", "Pichau": "https://www.pichau.com.br/search?q={}",
         "Terabyte": "https://www.terabyteshop.com.br/busca?str={}", "Mercado Livre": "https://lista.mercadolivre.com.br/{}",
         "Amazon": "https://www.amazon.com.br/s?k={}"}


def brl(v: float) -> str:
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


anuncios, historico = [], []
for c in componentes:
    base = c.pop("_preco")
    lojas = rnd.sample(list(LOJAS), rnd.randint(3, 5))
    titulo = f"{c['marca']} {c['modelo']}"
    slug = titulo.lower().replace(" ", "-").replace("/", "-")
    for loja in lojas:
        fator = rnd.uniform(0.93, 1.12)
        for semana in range(8, -1, -1):   # 8 semanas de histórico; semana 0 = agora
            preco = round(base * fator * (1 + 0.01 * semana) * rnd.uniform(0.99, 1.01), 2)
            data = (AGORA - timedelta(weeks=semana)).isoformat()
            url = LOJAS[loja].format(slug)
            if semana == 0:
                anuncios.append({"componente_id": c["id"], "loja": loja, "titulo": titulo, "preco_texto": brl(preco),
                                 "url": url, "coletado_em": data})
            else:
                historico.append({"componente_id": c["id"], "loja": loja, "preco": preco, "url": url, "coletado_em": data})
    if rnd.random() < 0.15:   # anúncio suspeito (outlier)
        loja = rnd.choice(list(LOJAS))
        anuncios.append({"componente_id": c["id"], "loja": loja, "titulo": titulo + " (lote importado)",
                         "preco_texto": brl(base * 0.3), "url": LOJAS[loja].format(slug), "coletado_em": AGORA.isoformat()})

# produto parecido que NÃO é o mesmo: a checagem precisa recusar
for cid, titulo_errado, preco in [("rtx-4060-8g", "NVIDIA GeForce RTX 4060 Ti 8GB", 2450),
                                   ("ram-fury-d5-32", "Kingston Fury Beast DDR5 16GB (2x8) 6000", 410),
                                   ("rtx-4060ti-16g", "NVIDIA GeForce RTX 4060 Ti 8GB", 2480),
                                   ("rx-9070", "AMD Radeon RX 9070 XT 16GB", 4950)]:
    anuncios.append({"componente_id": cid, "loja": "Mercado Livre", "titulo": titulo_errado, "preco_texto": brl(preco),
                     "url": LOJAS["Mercado Livre"].format(titulo_errado.lower().replace(" ", "-")),
                     "coletado_em": AGORA.isoformat()})

SAIDA.write_text(json.dumps({"aviso": "Dados FICTÍCIOS para demonstração. Fonte: seed:demo.",
                             "componentes": componentes, "jogos": JOGOS, "resolucoes": RESOLUCOES, "preset": PRESET,
                             "benchmarks": benchmarks, "anuncios": anuncios, "historico_precos": historico},
                            ensure_ascii=False, indent=1))
print(f"{len(componentes)} componentes, {len(benchmarks)} benchmarks, {len(anuncios)} anúncios, "
      f"{len(historico)} pontos de histórico -> {SAIDA}")
