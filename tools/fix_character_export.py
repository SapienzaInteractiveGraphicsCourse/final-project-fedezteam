#!/usr/bin/env python3
"""
Ripara gli export Blender dei personaggi:  <nome>_ok.glb -> <nome>.glb

    python3 tools/fix_character_export.py            # tutti
    python3 tools/fix_character_export.py luigi      # solo uno

Da rilanciare a ogni nuovo export finché Blender continua a produrre gli
stessi difetti. Ne sistema quattro, tutti dentro il .glb, senza toccare una
riga del gioco:

  1. TEXTURE PERSE     l'export non porta dentro nessuna immagine e i materiali
                       restano senza baseColorTexture. Qui vengono riattaccate
                       le immagini originali, materiale per materiale.
  2. RADICI FANTASMA   nella scena resta roba senza mesh (un secondo scheletro
                       con gli stessi nomi di osso, oppure un nodo vuoto tipo
                       "Sketchfab_model"). Uno scheletro doppio manda in
                       confusione BoneMap, che sceglie il primo osso che
                       incontra e finirebbe per animare quello invisibile.
  3. SCALA E ORIGINE   i rig escono con altezze assurde (Luigi 17 unità) e
                       spesso centrati sull'origine invece che coi piedi a
                       terra, mentre Player dà per scontato che l'origine sia
                       ai piedi.
  4. ORIENTAMENTO      Player ruota il modello dando per scontato che il
                       personaggio guardi lungo il suo -X (vedi modelOffset).
                       Luigi guardava lungo +Z: senza correzione cammina di
                       traverso.

I punti 3 e 4 si risolvono con un nodo radice che avvolge tutto: le ossa
stanno dentro, quindi la pelle segue senza sorprese.
"""
import json, os, struct, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(BASE, "assets/models/Super_Mario")

# Per ogni personaggio: da dove, a dove, che immagine va su quale materiale
# (per NOME, perché l'ordine cambia a ogni export), quanto dev'essere alto e
# in che direzione guarda il rig appena uscito da Blender.
#
# Le altezze sono quelle dei modelli originali, così i nuovi entrano al posto
# dei vecchi senza ritoccare né la sfera di collisione né la telecamera.
# Verso in cui deve guardare il modello finito. I due giocabili seguono
# Player.spawn (modelOffset ruota il modello dando per scontato il -X); i
# nemici seguono invece Enemy.update, che fa mesh.rotation.y = atan2(dx, dz),
# cioè dà per scontato che il modello guardi lungo +Z.
TARGET_FACING = (-1, 0, 0)
ENEMY_FACING = (0, 0, 1)

CHARACTERS = {
    "mario": {
        "src": "Main_Characters/Mario/mario_ok.glb",
        "dst": "Main_Characters/Mario/mario.glb",
        "textures": {  # sottostringa del nome materiale -> file immagine
            "TexMap": "Main_Characters/Mario/Image_0.jpg",
        },
        "height": 1.6390000581741333,
        "facing": (-1, 0, 0),  # già giusto: nessuna rotazione
        # Le scarpe: l'isola UV degli stivali sta tutta oltre u=0.5, quindi
        # una faccia dei piedi che legge sotto u=0.25 sta pescando dalla parte
        # sbagliata dell'atlante (faccia, capello, angolo nero). Vedi
        # repaint_stray_faces per il perché si ridipingono invece di toglierle.
        "stray_uv": {"bones": ("Foot", "Toe"), "u_max": 0.25},
    },
    "luigi": {
        "src": "Main_Characters/Luigi/luigi_ok.glb",
        "dst": "Main_Characters/Luigi/luigi.glb",
        "textures": {
            "Body__m_Body": "Main_Characters/Luigi/Image_0.png",
            "Body__m_Eye": "Main_Characters/Luigi/Image_1.png",
        },
        # Le pupille sono mesh SEPARATE che nel modello originale sono
        # invisibili (alpha 0): gli occhi che si vedono sono disegnati su
        # Body__m_Eye. L'export le riporta opache, e senza questo elenco una
        # delle due finisce per mostrare una toppa dell'atlante del corpo
        # spiaccicata sull'occhio.
        "hidden": ["Pupil__m_"],
        "height": 1.7714,
        "facing": (0, 0, 1),  # guarda in +Z: va ruotato per guardare in -X
    },
    # Bowser non è un giocabile: è il boss finale (vedi entities/enemies/
    # Bowser.js). Il rig arriva da Mixamo e porta gli stessi problemi degli
    # altri, più uno suo.
    "bowser": {
        "src": "Enemies/bowser_ok.glb",
        "dst": "Enemies/bowser.glb",
        # TUTTE le 25 texture sono sparite nel passaggio da Mixamo: il file
        # non contiene una sola immagine. Ci sono però ancora tutte dentro il
        # modello che il gioco usava prima — quello senza ossa, messo da parte
        # come bowser_textures.glb — e i 25 materiali si abbinano uno a uno
        # per nome (Blender ha solo aggiunto il suffisso ".001"). Quindi le
        # immagini vengono trapiantate da lì invece che da 25 file sciolti.
        "textures_from": "Enemies/bowser_textures.glb",
        # Dentro c'è "Armature|mixamo.com|Layer0": 2 fotogrammi in 0.067
        # secondi, cioè una T-pose ferma, non un'animazione. Le animazioni
        # vere le costruisce AnimationController dalla posa di riposo.
        "drop_animations": "T-pose ferma di 2 fotogrammi",
        # Enemy.spawn riscala comunque all'altezza del boss, ma tanto vale
        # che il file esca già giusto (vedi targetHeight in Bowser.js).
        "height": 3.4,
        "facing": (0, 0, 1),
        "target_facing": ENEMY_FACING,
    },
}

MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


COMPONENT = {5121: "B", 5123: "H", 5125: "I"}  # unsigned byte / short / int


def _accessor(js, bin_, index):
    """Legge un accessor NON interlacciato (gli export Blender lo sono)."""
    acc = js["accessors"][index]
    bv = js["bufferViews"][acc["bufferView"]]
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    fmt = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}[acc["componentType"]]
    size = struct.calcsize(fmt)
    vals = struct.unpack_from("<" + fmt * (acc["count"] * ncomp), bin_, off)
    return [vals[i * ncomp:(i + 1) * ncomp] for i in range(acc["count"])], acc, off, fmt


def repaint_stray_faces(js, bin_, cfg):
    """Rimette sull'isola giusta dell'atlante le facce con UV sballate.

    Separando i piedi in Blender sono nate facce nuove attorno agli stivali che
    leggono un pezzo qualsiasi della texture: si vedono come schegge color pelle
    e nere nella fessura fra le scarpe. Sono 172 in questo export e ZERO nel
    modello originale, quindi il difetto è dell'export.

    Non si cancellano: sono saldate agli stivali, e toglierle apre buchi neri
    sull'interno (provato). Si RIDIPINGONO, cioè si sposta la loro UV su un
    punto di cuoio, e spariscono confondendosi con la scarpa. I loro vertici
    non sono condivisi con nessuna faccia buona (l'export duplica i vertici
    sulle cuciture UV), quindi riscriverli non tocca nient'altro.
    """
    rule = cfg.get("stray_uv")
    if not rule:
        return

    for mesh in js["meshes"]:
        for pr in mesh["primitives"]:
            att = pr.get("attributes", {})
            if not {"TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"} <= set(att) or "indices" not in pr:
                continue

            uv, uv_acc, uv_off, _ = _accessor(js, bin_, att["TEXCOORD_0"])
            ji, _, _, _ = _accessor(js, bin_, att["JOINTS_0"])
            wt, _, _, _ = _accessor(js, bin_, att["WEIGHTS_0"])
            idx, _, _, _ = _accessor(js, bin_, pr["indices"])
            idx = [i[0] for i in idx]

            skin = js["skins"][0]
            nomi = [js["nodes"][n].get("name", "") for n in skin["joints"]]
            dominante = [nomi[ji[v][max(range(4), key=lambda k: wt[v][k])]] for v in range(len(uv))]
            zona = lambda v: any(b in dominante[v] for b in rule["bones"])

            gruppo, fuori = [], []
            for k in range(0, len(idx) - 2, 3):
                t = idx[k:k + 3]
                if not all(zona(v) for v in t):
                    continue
                u = sum(uv[v][0] for v in t) / 3
                (fuori if u < rule["u_max"] else gruppo).append(t)

            if not fuori:
                continue

            # bersaglio: il punto mediano dell'isola buona (il cuoio dello stivale)
            us = sorted(sum(uv[v][0] for v in t) / 3 for t in gruppo)
            vs = sorted(sum(uv[v][1] for v in t) / 3 for t in gruppo)
            bersaglio = (us[len(us) // 2], vs[len(vs) // 2])

            v_fuori = {v for t in fuori for v in t}
            v_buoni = {v for t in gruppo for v in t}
            condivisi = v_fuori & v_buoni
            if condivisi:
                print(f"  ATTENZIONE    : {len(condivisi)} vertici condivisi, lasciati com'erano")
            for v in sorted(v_fuori - condivisi):
                struct.pack_into("<ff", bin_, uv_off + v * 8, *bersaglio)

            print(f"  UV sballate    : {len(fuori)} facce attorno a {'/'.join(rule['bones'])}"
                  f" riportate sul cuoio {tuple(round(x, 3) for x in bersaglio)}")

def embed_image(js, bin_, data, mime, name):
    """Infila i byte di un'immagine nel .glb e ritorna l'indice della texture."""
    bin_ += b"\0" * ((4 - len(bin_) % 4) % 4)
    js["bufferViews"].append(
        {"buffer": 0, "byteOffset": len(bin_), "byteLength": len(data)}
    )
    bin_ += data
    js.setdefault("images", []).append({
        "bufferView": len(js["bufferViews"]) - 1,
        "mimeType": mime,
        "name": name,
    })
    js.setdefault("samplers", [])
    if not js["samplers"]:
        js["samplers"].append({"magFilter": 9729, "minFilter": 9987})
    js.setdefault("textures", []).append({"sampler": 0, "source": len(js["images"]) - 1})
    return len(js["textures"]) - 1


def donor_textures(path):
    """Legge le baseColorTexture di un altro GLB.

    Serve quando il rig arriva da Mixamo/Sketchfab senza immagini ma esiste
    ancora la versione precedente del modello, non animata, che le ha tutte
    dentro. Ritorna ({nome materiale: indice texture del donatore},
    {indice texture: (byte dell'immagine, mimeType)}).
    """
    js, bin_ = read_glb(path)
    by_material, images = {}, {}
    for mat in js.get("materials", []):
        idx = mat.get("pbrMetallicRoughness", {}).get("baseColorTexture", {}).get("index")
        if idx is None:
            continue
        by_material[mat["name"]] = idx
        if idx not in images:
            img = js["images"][js["textures"][idx]["source"]]
            bv = js["bufferViews"][img["bufferView"]]
            off = bv.get("byteOffset", 0)
            images[idx] = (bytes(bin_[off:off + bv["byteLength"]]),
                           img.get("mimeType", "image/png"))
    return by_material, images


def base_material_name(name):
    """"mesh0000mat.001" -> "mesh0000mat" — Blender numera i doppioni."""
    head, _, tail = name.rpartition(".")
    return head if head and tail.isdigit() else name


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


def y_rotation(frm, to):
    """Quaternione attorno a Y che porta la direzione `frm` su `to`."""
    import math
    a = math.atan2(frm[0], frm[2])
    b = math.atan2(to[0], to[2])
    half = (b - a) / 2.0
    return [0.0, math.sin(half), 0.0, math.cos(half)]


def fix(name, cfg):
    src = os.path.join(MODELS, cfg["src"])
    dst = os.path.join(MODELS, cfg["dst"])
    print(f"\n=== {name}  ({cfg['src']} -> {cfg['dst']})")
    js, bin_ = read_glb(src)
    nodes, scene = js["nodes"], js["scenes"][js.get("scene", 0)]

    # --- 1. radici: si tiene solo quella che porta le mesh ------------------
    def subtree(i, acc):
        acc.add(i)
        for c in nodes[i].get("children", []):
            subtree(c, acc)
        return acc

    roots = list(scene["nodes"])
    keep = [r for r in roots if any("mesh" in nodes[i] for i in subtree(r, set()))]
    ghosts = [r for r in roots if r not in keep]
    assert len(keep) == 1, f"attesa una sola radice con mesh, trovate {keep}"
    keep = keep[0]
    print(f"  radice tenuta  : {nodes[keep].get('name')}")
    ghost_nodes = set()
    for g in ghosts:
        subtree(g, ghost_nodes)
        print(f"  radice scartata: {nodes[g].get('name')} (nessuna mesh)")

    # --- 2. animazioni che pilotavano i fantasmi ---------------------------
    before = len(js.get("animations", []))
    js["animations"] = [
        a for a in js.get("animations", [])
        if not any(c["target"]["node"] in ghost_nodes for c in a["channels"])
    ]
    if before != len(js["animations"]):
        print(f"  animazioni     : {before} -> {len(js['animations'])}")
    if not js["animations"]:
        del js["animations"]

    if cfg.get("drop_animations") and js.get("animations"):
        print(f"  animazioni     : {len(js['animations'])} scartate ({cfg['drop_animations']})")
        del js["animations"]

    used = {n["skin"] for n in nodes if "skin" in n}
    while js.get("skins") and len(js["skins"]) - 1 not in used:
        print(f"  skin rimosso   : {js['skins'].pop().get('name')}")

    # --- 3. texture --------------------------------------------------------
    donor_by_mat, donor_images = ({}, {})
    if cfg.get("textures_from"):
        donor_by_mat, donor_images = donor_textures(os.path.join(MODELS, cfg["textures_from"]))
        print(f"  donatore       : {cfg['textures_from']} "
              f"({len(donor_images)} immagini su {len(donor_by_mat)} materiali)")

    cache = {}
    trapiantate = 0
    for mat in js["materials"]:
        pbr = mat.setdefault("pbrMetallicRoughness", {})

        if any(h in mat["name"] for h in cfg.get("hidden", [])):
            # Stesse impostazioni del file originale: maschera + alpha zero.
            mat["alphaMode"] = "MASK"
            pbr["baseColorFactor"] = [1, 1, 1, 0]
            pbr.pop("baseColorTexture", None)
            print(f"  materiale      : {mat['name']} reso invisibile (come nell'originale)")
            continue

        if "baseColorTexture" in pbr:
            continue

        # Prima strada: l'immagine sta dentro un altro GLB, abbinata per nome
        # del materiale. Una riga per materiale non viene stampata — con 25
        # materiali sarebbe solo rumore — se ne stampa il totale a fine giro.
        donor_idx = donor_by_mat.get(base_material_name(mat["name"]))
        if donor_idx is not None:
            key = ("donor", donor_idx)
            if key not in cache:
                data, mime = donor_images[donor_idx]
                cache[key] = embed_image(js, bin_, data, mime,
                                         base_material_name(mat["name"]))
            pbr["baseColorTexture"] = {"index": cache[key]}
            trapiantate += 1
            continue

        # Seconda strada: un file immagine sul disco, abbinato per
        # sottostringa del nome del materiale.
        rel = next((v for k, v in cfg.get("textures", {}).items() if k in mat["name"]), None)
        if rel is None:
            print(f"  materiale      : {mat['name']} lasciato com'era")
            continue
        if rel not in cache:
            cache[rel] = embed_image(
                js, bin_,
                open(os.path.join(MODELS, rel), "rb").read(),
                MIME[os.path.splitext(rel)[1].lower()],
                os.path.basename(rel),
            )
        pbr["baseColorTexture"] = {"index": cache[rel]}
        print(f"  texture        : {mat['name']} <- {os.path.basename(rel)}")
    if trapiantate:
        print(f"  texture        : {trapiantate} materiali riagganciati al donatore")
    js["buffers"][0]["byteLength"] = len(bin_) + ((4 - len(bin_) % 4) % 4)

    # --- 4. nodo radice: scala, piedi a terra, verso giusto ----------------
    ymin, ymax = 1e9, -1e9
    for n in nodes:
        if "mesh" not in n:
            continue
        for pr in js["meshes"][n["mesh"]]["primitives"]:
            acc = js["accessors"][pr["attributes"]["POSITION"]]
            ymin = min(ymin, acc["min"][1])
            ymax = max(ymax, acc["max"][1])
    s = cfg["height"] / (ymax - ymin)
    root = {
        "name": name.capitalize() + "Root",
        "children": [keep],
        "scale": [s, s, s],
        "translation": [0.0, -ymin * s, 0.0],
    }
    target = tuple(cfg.get("target_facing", TARGET_FACING))
    if tuple(cfg["facing"]) != target:
        root["rotation"] = y_rotation(cfg["facing"], target)
        print(f"  orientamento   : {tuple(cfg['facing'])} -> {target}")
    nodes.append(root)
    scene["nodes"] = [len(nodes) - 1]
    print(f"  altezza        : {ymax - ymin:.3f} -> {cfg['height']:.3f} (scala {s:.5f}),"
          f" piedi da y={ymin:.3f} a y=0")

    repaint_stray_faces(js, bin_, cfg)

    size = write_glb(dst, js, bin_)
    print(f"  scritto        : {cfg['dst']} ({size // 1024} KB)")


if __name__ == "__main__":
    voluti = sys.argv[1:] or list(CHARACTERS)
    for nome in voluti:
        fix(nome, CHARACTERS[nome])
