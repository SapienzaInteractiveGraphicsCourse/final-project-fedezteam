#!/usr/bin/env python3
"""
Converte i materiali specular-glossiness:  <nome>_ok.glb -> <nome>.glb

    python3 tools/fix_specular_glossiness.py          # tutti
    python3 tools/fix_specular_glossiness.py peach    # solo uno

I modelli scaricati da Sketchfab arrivano spesso con i materiali scritti
secondo KHR_materials_pbrSpecularGlossiness, un'estensione glTF ormai
ritirata. Il GLTFLoader di three.js r160 NON la conosce (nel suo sorgente
non compare da nessuna parte): trova materiali senza pbrMetallicRoughness,
usa i valori di default dello standard glTF — bianco, metallico, ruvido — e
ignora del tutto le immagini, che pure sono lì dentro. Il risultato a video
è una statua bianca opaca. È esattamente quello che succedeva a Peach: 12
PNG incorporate nel file e nessun materiale che ne usasse una.

La conversione riscrive solo il JSON del .glb, il blocco binario (immagini,
mesh, ossa) non viene toccato:

    diffuseTexture   -> pbrMetallicRoughness.baseColorTexture
    diffuseFactor    -> pbrMetallicRoughness.baseColorFactor
    metallicFactor   -> 0    (specular nero = non è un metallo)
    roughnessFactor  -> vedi sotto

Sulla rugosità: la formula generica è 1 - glossiness, ma quando il modello
dichiara specularFactor [0,0,0] sta dicendo che la superficie non ha
riflesso speculare per niente, e allora la traduzione fedele è 1 (opaca).
Prendere alla lettera glossiness 1.0 darebbe roughness 0, cioè un lucido a
specchio che nell'originale non c'era.
"""
import json, os, struct, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_ROOT = os.path.join(BASE, "assets/models/Super_Mario/Ending")

# Da dove a dove. I sorgenti restano sul disco così la conversione si può
# rifare da capo se un domani cambia il modello o la versione di three.js.
MODELS = {
    # base_color: vedi convert_material. Peach esce da Sketchfab con un
    # diffuseFactor 0.588 uniforme su tutti e 12 i materiali, cioè un
    # "abbassa la luminosità al 59%" incorporato nel file. Tradotto alla
    # lettera la principessa arriva in gioco color prugna scuro, mentre il
    # suo stesso vetro istoriato sopra il portone del castello è rosa acceso.
    # Nessun altro modello del progetto porta un fattore del genere, quindi
    # qui viene riportato a 1: la texture torna a decidere il colore da sola.
    "peach": {"src": "peach_ok.glb", "dst": "peach.glb", "base_color": [1.0, 1.0, 1.0, 1.0]},
}

EXT = "KHR_materials_pbrSpecularGlossiness"


def read_glb(path):
    d = open(path, "rb").read()
    magic, _, length = struct.unpack("<III", d[:12])
    assert magic == 0x46546C67, f"{path} non è un GLB"
    off, chunks = 12, []
    while off < length:
        clen, ctype = struct.unpack("<II", d[off:off + 8])
        chunks.append(d[off + 8:off + 8 + clen])
        off += 8 + clen
    return json.loads(chunks[0].decode("utf-8")), bytearray(chunks[1])


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    bb = bytes(bin_) + b"\0" * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bb)
    out = struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(jb), 0x4E4F534A) + jb
    out += struct.pack("<II", len(bb), 0x004E4942) + bb
    open(path, "wb").write(out)
    return total


def convert_material(mat, base_color=None):
    """Traduce un singolo materiale. Ritorna True se c'era da tradurre."""
    sg = mat.get("extensions", {}).get(EXT)
    if sg is None:
        return False

    pbr = mat.setdefault("pbrMetallicRoughness", {})

    if "diffuseTexture" in sg:
        pbr["baseColorTexture"] = sg["diffuseTexture"]
    if base_color is not None:
        pbr["baseColorFactor"] = list(base_color)
    elif "diffuseFactor" in sg:
        pbr["baseColorFactor"] = sg["diffuseFactor"]

    pbr["metallicFactor"] = 0.0

    spec = sg.get("specularFactor", [1.0, 1.0, 1.0])
    if max(spec) == 0.0:
        pbr["roughnessFactor"] = 1.0
    else:
        pbr["roughnessFactor"] = round(1.0 - sg.get("glossinessFactor", 1.0), 4)

    del mat["extensions"][EXT]
    if not mat["extensions"]:
        del mat["extensions"]
    return True


def fix(name, cfg):
    src = os.path.join(MODELS_ROOT, cfg["src"])
    dst = os.path.join(MODELS_ROOT, cfg["dst"])
    print(f"\n{name}: {cfg['src']} -> {cfg['dst']}")

    js, bin_ = read_glb(src)

    base_color = cfg.get("base_color")
    convertiti = sum(convert_material(m, base_color) for m in js.get("materials", []))
    print(f"  materiali      : {convertiti} convertiti su {len(js.get('materials', []))}")

    # L'estensione non serve più a nessuno. Toglierla da extensionsRequired è
    # la parte che conta: lasciarla dichiarata come "obbligatoria" quando non
    # lo è più fa emettere al loader un avviso a ogni caricamento.
    for key in ("extensionsUsed", "extensionsRequired"):
        if EXT in js.get(key, []):
            js[key] = [e for e in js[key] if e != EXT]
            if not js[key]:
                del js[key]

    kb = write_glb(dst, js, bin_) // 1024
    print(f"  scritto        : {cfg['dst']} ({kb} KB)")


if __name__ == "__main__":
    voluti = sys.argv[1:] or list(MODELS)
    for n in voluti:
        if n not in MODELS:
            print(f"sconosciuto: {n} (disponibili: {', '.join(MODELS)})")
            continue
        fix(n, MODELS[n])
