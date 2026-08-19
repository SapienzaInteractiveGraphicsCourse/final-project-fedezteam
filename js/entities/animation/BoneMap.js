/**
 * Traduce i nomi reali delle ossa di uno scheletro in RUOLI semantici
 * (bacino, spalla sinistra, ginocchio destro, ...).
 *
 * Serve perché ogni modello nomina le ossa a modo suo:
 *   Mixamo      → "mixamorig:LeftForeArm", "mixamorig:LeftUpLeg"
 *   Koopaling   → "ElbowL_021",            "LegL_03"
 * Le animazioni che scriviamo devono poter dire "ruota l'avambraccio sinistro"
 * senza sapere quale delle due convenzioni sta usando il modello caricato.
 */

/**
 * Riduce un nome osso a una forma confrontabile:
 *   "mixamorig:LeftForeArm" → "leftforearm"
 *   "ElbowL_021"            → "elbowl"
 *   "Spine1_011"            → "spine1"
 */
function normalize(name) {
  return String(name)
    .replace(/^.*:/, "") // via il prefisso "mixamorig:"
    // ATTENZIONE: three.js NON conserva i due punti. GLTFLoader passa ogni nome
    // per PropertyBinding.sanitizeNodeName(), che cancella i caratteri [ ] . : /
    // perché sono riservati nei percorsi delle KeyframeTrack. Quindi al momento
    // del caricamento "mixamorig:Hips" è già diventato "mixamorigHips" e la
    // riga qui sopra non trova nulla da tagliare: il prefisso va tolto anche
    // quando è attaccato al nome.
    .replace(/^mixamorig\d*/i, "")
    // Il separatore è obbligatorio: "Spine1_011" → "Spine1", ma "Spine2" resta
    // "Spine2". Senza questo vincolo Spine1 e Spine2 di Mixamo collasserebbero
    // entrambi in "spine" e si sovrascriverebbero a vicenda.
    .replace(/[_.\-\s]\d+$/, "") // via il suffisso numerico "_021"
    .replace(/[_.\-\s]/g, "") // via separatori residui
    .toLowerCase();
}

// Per ogni ruolo, le grafie accettate (già normalizzate).
// L'ordine conta: la prima che combacia vince.
const ROLES = {
  hips: [/^hips?$/, /^pelvis$/, /^root$/, /^sklroot$/],
  spine: [/^spine1?$/, /^abdomen$/, /^torso$/],
  chest: [/^spine2$/, /^chest$/, /^upperchest$/],
  head: [/^head$/, /^skull$/],

  shoulderL: [/^leftshoulder$/, /^shoulderl$/, /^clavicle[l]?$/],
  shoulderR: [/^rightshoulder$/, /^shoulderr$/],

  upperArmL: [/^leftarm$/, /^arml$/, /^upperarml$/, /^lupperarm$/],
  upperArmR: [/^rightarm$/, /^armr$/, /^upperarmr$/, /^rupperarm$/],

  foreArmL: [/^leftforearm$/, /^elbowl$/, /^forearml$/, /^lowerarml$/],
  foreArmR: [/^rightforearm$/, /^elbowr$/, /^forearmr$/, /^lowerarmr$/],

  handL: [/^lefthand$/, /^handl$/],
  handR: [/^righthand$/, /^handr$/],

  thighL: [/^leftupleg$/, /^legl$/, /^thighl$/, /^uplegl$/],
  thighR: [/^rightupleg$/, /^legr$/, /^thighr$/, /^uplegr$/],

  shinL: [/^leftleg$/, /^kneel$/, /^shinl$/, /^calfl$/],
  shinR: [/^rightleg$/, /^kneer$/, /^shinr$/, /^calfr$/],

  footL: [/^leftfoot$/, /^footl$/],
  footR: [/^rightfoot$/, /^footr$/],

  // Le punte non servono ad animare, ma a capire da che parte guarda il
  // personaggio: la punta sta sempre davanti al tallone.
  toeL: [/^lefttoebase$/, /^toel$/, /^footlend$/, /^toebasel$/],
  toeR: [/^righttoebase$/, /^toer$/, /^footrend$/, /^toebaser$/],
};

// Ruoli senza i quali non si può animare una camminata credibile.
const ESSENTIAL = [
  "hips",
  "upperArmL",
  "upperArmR",
  "thighL",
  "thighR",
  "shinL",
  "shinR",
];

export default class BoneMap {
  /**
   * @param {THREE.Object3D} root - la scena del GLTF (o qualunque nodo che
   *   contenga le ossa nella sua discendenza)
   */
  constructor(root) {
    /** @type {Object<string, THREE.Bone>} ruolo → osso */
    this.bones = {};
    /** @type {string[]} tutti i nomi osso trovati, per diagnostica */
    this.allBoneNames = [];

    this._resolve(root);
  }

  _resolve(root) {
    const candidates = [];

    root.traverse((node) => {
      // isBone copre gli scheletri veri; il fallback sui nodi con figli serve
      // ai modelli in cui le ossa sono Object3D normali.
      if (node.isBone || node.type === "Bone") {
        candidates.push(node);
        this.allBoneNames.push(node.name);
      }
    });

    for (const [role, patterns] of Object.entries(ROLES)) {
      for (const pattern of patterns) {
        const hit = candidates.find((b) => pattern.test(normalize(b.name)));
        if (hit) {
          this.bones[role] = hit;
          break;
        }
      }
    }
  }

  get(role) {
    return this.bones[role] || null;
  }

  has(role) {
    return !!this.bones[role];
  }

  /** Nome reale dell'osso per un ruolo, che è ciò che serve alle KeyframeTrack. */
  nameOf(role) {
    const bone = this.bones[role];
    return bone ? bone.name : null;
  }

  /** true se ci sono abbastanza ossa per animare il personaggio. */
  get isUsable() {
    return ESSENTIAL.every((role) => this.has(role));
  }

  /** Stampa in console cosa è stato riconosciuto e cosa no. */
  describe(label = "rig") {
    const found = Object.keys(ROLES).filter((r) => this.has(r));
    const missing = Object.keys(ROLES).filter((r) => !this.has(r));
    const missingEssential = ESSENTIAL.filter((r) => !this.has(r));

    console.group(`[BoneMap] ${label} — ${this.allBoneNames.length} ossa`);
    console.log(
      `%c✅ riconosciuti (${found.length}):`,
      "color:#43b047;font-weight:bold",
    );
    found.forEach((r) => console.log(`     ${r.padEnd(12)} → ${this.nameOf(r)}`));

    if (missing.length) {
      console.log(
        `%c⚠️  non trovati (${missing.length}): %c${missing.join(", ")}`,
        "color:#fbd000;font-weight:bold",
        "color:inherit",
      );
    }
    if (missingEssential.length) {
      console.log(
        `%c❌ MANCANO RUOLI ESSENZIALI: ${missingEssential.join(", ")}`,
        "color:#e52521;font-weight:bold",
      );
      console.log("   Nomi osso disponibili:", this.allBoneNames);
    } else {
      console.log(
        "%c→ rig utilizzabile, si può animare.",
        "color:#43b047;font-weight:bold",
      );
    }
    console.groupEnd();

    return this.isUsable;
  }
}
