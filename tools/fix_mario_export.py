#!/usr/bin/env python3
"""
Patch dell'export Blender di Mario:  mario_ok.glb  ->  mario_ok_fixed.glb

    python3 tools/fix_mario_export.py [sorgente.glb] [destinazione.glb]

Da rilanciare a ogni nuovo export finche' Blender continua a produrre gli
stessi tre difetti.

Tre problemi risolti, tutti dentro il .glb (nessuna modifica al codice di gioco):
  1. texture persa   -> reincolla Image_0.jpg (l'atlante gia' usato da mario.gltf)
                        come baseColorTexture del materiale TexMap.001
  2. armatura doppia -> l'export contiene DUE scheletri con gli stessi nomi osso;
                        quello senza mesh manda in confusione BoneMap (vince il
                        primo che incontra nel traverse). Viene tolto dalla scena.
  3. scala/origine   -> il nuovo rig e' 1.43x piu' grande e centrato sull'origine
                        (piedi a y=-1.17). Un nodo radice riporta l'altezza a
                        quella di mario.gltf e i piedi a y=0.
"""
import json, struct, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHARS = os.path.join(BASE, "assets/models/Super_Mario/Main_Characters")
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(CHARS, "mario_ok.glb")
DST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(CHARS, "mario_ok_fixed.glb")
TEX = os.path.join(CHARS, "MarioGLTF/Image_0.jpg")   # l'atlante del Mario originale

# Altezza di riferimento: bbox del mario.gltf originale (piedi y=0, testa y=1.639)
TARGET_HEIGHT = 1.6390000581741333


def read_glb(path):
    d = open(path, "rb").read()
    magic, ver, length = struct.unpack("<III", d[:12])
    assert magic == 0x46546C67, "non e' un GLB"
    off, chunks = 12, []
    while off < length:
        clen, ctype = struct.unpack("<II", d[off:off + 8])
        chunks.append([ctype, d[off + 8:off + 8 + clen]])
        off += 8 + clen
    js = json.loads(chunks[0][1].decode("utf-8"))
    bin_ = chunks[1][1] if len(chunks) > 1 else b""
    return js, bytearray(bin_)


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    bb = bytes(bin_) + b"\0" * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + (8 + len(bb) if bb else 0)
    out = struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(jb), 0x4E4F534A) + jb
    if bb:
        out += struct.pack("<II", len(bb), 0x004E4942) + bb
    open(path, "wb").write(out)
    return total


js, bin_ = read_glb(SRC)
nodes, scene = js["nodes"], js["scenes"][js.get("scene", 0)]

# --- 1. quale radice porta la mesh, quale e' il fantasma -------------------
def subtree(i, acc):
    acc.add(i)
    for c in nodes[i].get("children", []):
        subtree(c, acc)
    return acc

roots = list(scene["nodes"])
with_mesh = [r for r in roots if any("mesh" in nodes[i] for i in subtree(r, set()))]
ghosts = [r for r in roots if r not in with_mesh]
assert len(with_mesh) == 1, f"attese 1 radice con mesh, trovate {with_mesh}"
keep = with_mesh[0]
print(f"radice tenuta : {keep} ({nodes[keep].get('name')})")
for g in ghosts:
    print(f"radice scartata: {g} ({nodes[g].get('name')}) - scheletro senza mesh")

ghost_nodes = set()
for g in ghosts:
    subtree(g, ghost_nodes)

# --- 2. via le animazioni che pilotano lo scheletro fantasma ---------------
before = len(js.get("animations", []))
js["animations"] = [
    a for a in js.get("animations", [])
    if not any(ch["target"]["node"] in ghost_nodes for ch in a["channels"])
]
print(f"animazioni: {before} -> {len(js['animations'])} (le altre muovevano il fantasma)")
if not js["animations"]:
    del js["animations"]

# --- 3. via lo skin inutilizzato (deve restare in coda per non rinumerare) --
used_skins = {n["skin"] for n in nodes if "skin" in n}
while len(js.get("skins", [])) - 1 not in used_skins and len(js.get("skins", [])) > 0:
    dropped = js["skins"].pop()
    print(f"skin rimosso  : {dropped.get('name')} (nessuna mesh lo usa)")

# --- 4. texture: JPEG dentro il BIN, poi bufferView/image/texture ----------
jpg = open(TEX, "rb").read()
bin_ += b"\0" * ((4 - len(bin_) % 4) % 4)   # allineamento a 4 byte
tex_offset = len(bin_)
bin_ += jpg
js["buffers"][0]["byteLength"] = len(bin_) + ((4 - len(bin_) % 4) % 4)

js["bufferViews"].append({"buffer": 0, "byteOffset": tex_offset, "byteLength": len(jpg)})
bv_index = len(js["bufferViews"]) - 1

js.setdefault("images", []).append(
    {"bufferView": bv_index, "mimeType": "image/jpeg", "name": "Image_0"}
)
img_index = len(js["images"]) - 1

js.setdefault("samplers", []).append({"magFilter": 9729, "minFilter": 9987})
smp_index = len(js["samplers"]) - 1

js.setdefault("textures", []).append({"sampler": smp_index, "source": img_index})
tex_index = len(js["textures"]) - 1

body = None
for i, m in enumerate(js["materials"]):
    pbr = m.setdefault("pbrMetallicRoughness", {})
    if "baseColorTexture" not in pbr:
        pbr["baseColorTexture"] = {"index": tex_index}
        body = i
print(f"texture       : Image_0.jpg ({len(jpg)/1024:.0f} KB) -> materiale "
      f"{body} '{js['materials'][body]['name']}'")

# --- 5. nodo radice che rimette scala e piedi a terra ----------------------
# bbox in posa di bind (calcolata a parte: la mesh e' centrata sull'origine)
acc_pos = js["accessors"][js["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
ymin, ymax = acc_pos["min"][1], acc_pos["max"][1]
height = ymax - ymin
s = TARGET_HEIGHT / height
print(f"altezza       : {height:.3f} -> {TARGET_HEIGHT:.3f} (scala {s:.5f}), "
      f"piedi da y={ymin:.3f} a y=0")

nodes.append({
    "name": "MarioRoot",
    "children": [keep],
    "scale": [s, s, s],
    "translation": [0.0, -ymin * s, 0.0],
})
scene["nodes"] = [len(nodes) - 1]

size = write_glb(DST, js, bin_)
print(f"\nscritto {DST} ({size/1024:.0f} KB)")
