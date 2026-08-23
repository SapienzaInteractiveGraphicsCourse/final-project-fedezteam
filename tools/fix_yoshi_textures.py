#!/usr/bin/env python3
"""
fix_yoshi_textures.py — rimette le texture sul Yoshi riggato.

IL PROBLEMA
Il modello riggato (Mounts/yoshi.glb) è uscito dall'export senza texture:
dei suoi 16 materiali solo uno ha ancora una baseColorTexture, gli altri
sono grigio piatto (0.8, 0.8, 0.8). In gioco Yoshi appare bianco. Le UV,
invece, sono tutte sopravvissute (TEXCOORD_0..3 su ogni primitiva), e le
primitive corrispondono una a una a quelle del modello statico originale
(Main_Characters/YoshiGLTF/yoshi.gltf), texture comprese.

COSA FA
Trapianta i materiali dell'originale su quello riggato: per ogni materiale
del target cerca l'omonimo nella sorgente, ne copia la definizione
completa (baseColor, normal map, alphaMode, doubleSided, metallic,
roughness) e incorpora i PNG dentro il .glb, così il file resta
autoconsistente e non si porta dietro dipendenze esterne.

I nomi si corrispondono a meno del suffisso numerico che Blender aggiunge
ai duplicati: "body_m" -> "body_m.001", e i quattro pupilli
"Pupil__m_PupilR[.001-.003]" -> "Pupil__m_PupilR.004[-.007]". Per questo
l'accoppiamento avviene per (nome base, posizione nell'ordine dei
suffissi) e non per stringa esatta.

Non tocca né la geometria né lo scheletro né i pesi: accessor, bufferView
esistenti, skin e nodi restano byte per byte quelli di partenza.

USO
    python3 tools/fix_yoshi_textures.py \
        assets/models/Super_Mario/Mounts/yoshi.glb \
        assets/models/Super_Mario/Main_Characters/YoshiGLTF/yoshi.gltf \
        assets/models/Super_Mario/Mounts/yoshi_textured.glb

Il file di partenza non viene modificato: se un giorno il modello viene
ri-esportato da Blender CON le texture, basta puntare il manifest
direttamente a quello e questo script diventa inutile.
"""

import hashlib
import json
import os
import re
import struct
import sys

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path):
    raw = open(path, "rb").read()
    magic, version, length = struct.unpack_from("<3I", raw, 0)
    if magic != 0x46546C67:
        raise SystemExit(f"{path}: non è un .glb")
    gltf, binary, off = None, b"", 12
    while off < length:
        clen, ctype = struct.unpack_from("<2I", raw, off)
        chunk = raw[off + 8 : off + 8 + clen]
        if ctype == JSON_CHUNK:
            gltf = json.loads(chunk.decode("utf-8"))
        elif ctype == BIN_CHUNK:
            binary = chunk
        off += 8 + clen + ((4 - clen % 4) % 4 if clen % 4 else 0)
    return gltf, bytearray(binary)


def write_glb(path, gltf, binary):
    # Entrambi i chunk vanno allineati a 4 byte: il JSON con spazi, il
    # binario con zeri (glTF 2.0, §4.4.1).
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    binary = bytes(binary) + b"\0" * ((4 - len(binary) % 4) % 4)

    total = 12 + 8 + len(js) + (8 + len(binary) if binary else 0)
    with open(path, "wb") as f:
        f.write(struct.pack("<3I", 0x46546C67, 2, total))
        f.write(struct.pack("<2I", len(js), JSON_CHUNK))
        f.write(js)
        if binary:
            f.write(struct.pack("<2I", len(binary), BIN_CHUNK))
            f.write(binary)
    return total


def base_and_index(name):
    """"body_m.003" -> ("body_m", 3);  "body_m" -> ("body_m", 0)."""
    m = re.match(r"^(.*?)\.(\d{3})$", name or "")
    return (m.group(1), int(m.group(2))) if m else (name or "", 0)


def group_by_base(materials):
    groups = {}
    for i, mat in enumerate(materials):
        base, idx = base_and_index(mat.get("name"))
        groups.setdefault(base, []).append((idx, i))
    for base in groups:
        groups[base].sort()
    return groups


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    target_path, source_path, out_path = sys.argv[1:4]

    target, binary = read_glb(target_path)
    source = json.load(open(source_path))
    source_dir = os.path.dirname(source_path)

    target.setdefault("images", [])
    target.setdefault("samplers", [])
    target.setdefault("textures", [])
    target.setdefault("bufferViews", [])

    # Impronta dei PNG gia' dentro il file di partenza: quell'export ne ha
    # salvati due su cinque, e sono gli stessi byte dell'originale. Riusarli
    # invece di riscriverli evita di trascinarsi dietro un mega di doppioni
    # (e di lasciare immagini orfane nel file).
    existing = {}
    for i, img in enumerate(target.get("images", [])):
        if "bufferView" not in img:
            continue
        bv = target["bufferViews"][img["bufferView"]]
        off = bv.get("byteOffset", 0)
        existing[hashlib.sha1(bytes(binary[off : off + bv["byteLength"]])).hexdigest()] = i

    embedded = {}      # indice immagine sorgente -> indice immagine target
    samplers = {}      # indice sampler sorgente  -> indice sampler target
    textures = {}      # indice texture sorgente  -> indice texture target

    def embed_image(src_index):
        if src_index in embedded:
            return embedded[src_index]
        uri = source["images"][src_index].get("uri")
        if not uri:
            raise SystemExit(f"immagine {src_index} senza uri: non gestita")
        data = open(os.path.join(source_dir, uri), "rb").read()

        already = existing.get(hashlib.sha1(data).hexdigest())
        if already is not None:
            embedded[src_index] = already
            print(f"    {uri} era gia' nel file, riusata")
            return already

        # I bufferView vanno a offset multipli di 4.
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        binary.extend(data)

        target["bufferViews"].append(
            {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        )
        mime = "image/png" if uri.lower().endswith(".png") else "image/jpeg"
        target["images"].append(
            {"bufferView": len(target["bufferViews"]) - 1, "mimeType": mime, "name": uri}
        )
        embedded[src_index] = len(target["images"]) - 1
        print(f"    incorporata {uri} ({len(data) / 1024:.0f} KB)")
        return embedded[src_index]

    def copy_texture(src_index):
        if src_index in textures:
            return textures[src_index]
        tex = source["textures"][src_index]
        entry = {"source": embed_image(tex["source"])}
        if "sampler" in tex:
            s = tex["sampler"]
            if s not in samplers:
                target["samplers"].append(dict(source["samplers"][s]))
                samplers[s] = len(target["samplers"]) - 1
            entry["sampler"] = samplers[s]
        target["textures"].append(entry)
        textures[src_index] = len(target["textures"]) - 1
        return textures[src_index]

    def remap(node):
        """Copia una definizione di materiale rimappando gli indici texture."""
        if isinstance(node, dict):
            out = {}
            for k, v in node.items():
                if k.endswith("Texture") and isinstance(v, dict) and "index" in v:
                    out[k] = dict(v, index=copy_texture(v["index"]))
                else:
                    out[k] = remap(v)
            return out
        if isinstance(node, list):
            return [remap(v) for v in node]
        return node

    src_groups = group_by_base(source["materials"])
    tgt_groups = group_by_base(target["materials"])

    done, skipped = 0, []
    for base, entries in tgt_groups.items():
        src_entries = src_groups.get(base)
        if not src_entries or len(src_entries) != len(entries):
            skipped.append(base)
            continue
        for (_, tgt_i), (_, src_i) in zip(entries, src_entries):
            src_mat = source["materials"][src_i]
            name = target["materials"][tgt_i].get("name")
            print(f"  {name} <- {src_mat.get('name')}")
            target["materials"][tgt_i] = dict(remap(src_mat), name=name)
            done += 1

    target["buffers"][0]["byteLength"] = len(binary)
    total = write_glb(out_path, target, binary)

    print(f"\nmateriali trapiantati: {done}/{len(target['materials'])}")
    if skipped:
        print(f"nessuna corrispondenza per: {', '.join(skipped)}")
    print(f"scritto {out_path} ({total / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
