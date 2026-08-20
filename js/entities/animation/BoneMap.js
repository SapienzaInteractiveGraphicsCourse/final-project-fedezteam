/**
 * BoneMap.js — translates a skeleton's real bone names into semantic ROLES
 * (hips, left shoulder, right knee, ...), so the rest of the animation code
 * never has to know which naming convention a given model uses.
 *
 * Every model names its bones its own way:
 *   Mixamo      → "mixamorig:LeftForeArm", "mixamorig:LeftUpLeg"
 *   Koopaling   → "ElbowL_021",            "LegL_03"
 * The animations we write need to say "rotate the left forearm" without
 * caring which of these conventions the loaded model happens to use.
 */

// Reduces a bone name to a comparable form:
//   "mixamorig:LeftForeArm" → "leftforearm"
//   "ElbowL_021"            → "elbowl"
//   "Spine1_011"            → "spine1"
function normalize(name) {
  return String(name)
    .replace(/^.*:/, "") // strip a "mixamorig:" prefix
    // three.js does NOT keep the colon: GLTFLoader runs every name through
    // PropertyBinding.sanitizeNodeName(), which strips [ ] . : / because
    // they're reserved in KeyframeTrack paths. So by load time
    // "mixamorig:Hips" is already "mixamorigHips" and the line above finds
    // nothing to cut — the prefix has to be stripped when fused too.
    .replace(/^mixamorig\d*/i, "")
    // The separator is required: "Spine1_011" → "Spine1", but "Spine2" stays
    // "Spine2". Without it Mixamo's Spine1/Spine2 would both collapse to
    // "spine" and overwrite each other.
    .replace(/[_.\-\s]\d+$/, "") // strip a numeric suffix like "_021"
    .replace(/[_.\-\s]/g, "") // strip any remaining separators
    .toLowerCase();
}

// For each role, the accepted spellings (already normalized).
// Order matters: the first pattern that matches wins.
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

  // Toes aren't needed for animation, only to figure out which way the
  // character is facing: the toe always sits in front of the heel.
  toeL: [/^lefttoebase$/, /^toel$/, /^footlend$/, /^toebasel$/],
  toeR: [/^righttoebase$/, /^toer$/, /^footrend$/, /^toebaser$/],
};

// Roles without which a believable walk cycle can't be built.
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
  // Resolves every ROLES entry against the bones found under `root` and
  // stores the result; see _resolve() below for the matching logic.
  constructor(root) {
    /** @type {Object<string, THREE.Bone>} role → bone */
    this.bones = {};
    /** @type {string[]} every bone name found, for diagnostics */
    this.allBoneNames = [];

    this._resolve(root);
  }

  // Walks the hierarchy collecting bones, then matches each ROLES pattern
  // list against them in order, keeping the first hit per role.
  _resolve(root) {
    const candidates = [];

    root.traverse((node) => {
      // isBone covers real skeletons; the type fallback catches models
      // whose "bones" are just plain Object3D nodes.
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

  // Returns the bone mapped to `role`, or null if this skeleton has none.
  get(role) {
    return this.bones[role] || null;
  }

  // True if `role` was successfully resolved to a bone on this skeleton.
  has(role) {
    return !!this.bones[role];
  }

  // Real bone name for a role — what KeyframeTrack paths actually need.
  nameOf(role) {
    const bone = this.bones[role];
    return bone ? bone.name : null;
  }

  // True if enough bones were found to animate the character at all.
  get isUsable() {
    return ESSENTIAL.every((role) => this.has(role));
  }

  // Logs to the console what was recognized and what wasn't, for debugging
  // a new model's rig. Returns the same value as isUsable.
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
