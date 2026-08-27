import * as THREE from "three";

/**
 * clipFactory.js — hand-builds every character's THREE.AnimationClip objects
 * from quaternion keyframe tracks rather than pre-authored animation files.
 * Since every rig names/orients its bones differently, poses are expressed
 * as WHERE a limb should point (derived from the skeleton's own up/left/
 * forward basis, see characterBasis) rather than hardcoded euler angles.
 */

const DEG = Math.PI / 180;

/** Pose amplitudes, in degrees. Can be tuned live via rebuildRigs(). */
export const POSE = {
  armSpread: 11, // how far the arms rest away from the body
  walkArmSwing: 26,
  walkLegSwing: 24,
  walkKneeBend: 38,
  walkHipsBob: 0.045,

  // Yoshi: legs only (see buildYoshiClips). Shorter stride and less knee
  // bend than Mario's — his legs are stockier.
  yoshiWalkLegSwing: 22,
  yoshiWalkKneeBend: 34,
  yoshiRunLegSwing: 36,
  yoshiRunKneeBend: 58,

  runArmSwing: 45,
  runLegSwing: 40,
  runKneeBend: 65,
  runLean: 12, // forward torso lean
  runHipsBob: 0.07,

  // Classic "Super Mario" jump pose: one arm up, one bent low, front knee
  // tucked, back leg extended — the crossover reads as momentum.
  jumpArmUp: 154, // raised arm; 180 would be perfectly vertical
  jumpArmUpSpread: 34, // how far out to the side, to clear the head
  jumpArmDown: 8, // low arm, slightly forward
  jumpArmDownSpread: 10,
  jumpElbowUp: 8, // the raised arm stays nearly straight
  jumpElbowDown: 85, // the other elbow is bent hard
  jumpFrontThigh: 72, // knee rising in front
  jumpFrontKnee: 100,
  jumpBackThigh: -36, // trailing leg, almost extended
  jumpBackKnee: 18,
  jumpLean: -3, // torso tips slightly back, chest out
  jumpTwist: 12, // torso twists toward the raised arm

  // Bowser's pre-fire-breath wind-up (see Boss/Bowser.js): rocks back, chin
  // up, arms swept behind, knees braced. Held pose, like the jump.
  chargeLean: -22, // spine rocks BACK (negative = away from forward)
  chargeChestLean: -14,
  chargeHeadLean: -20, // chin lifts
  chargeArmSwing: -34, // arms swept behind
  chargeArmSpread: 28, // and held out, away from the shell
  chargeElbow: 46,
  chargeKnee: 20, // braced against the recoil
  chargeHipsDrop: -0.03,
};

// Which bone each limb "hangs from" — used to know which way it's pointing.
const LIMB_CHILD = {
  upperArmL: "foreArmL",
  upperArmR: "foreArmR",
  foreArmL: "handL",
  foreArmR: "handR",
  thighL: "shinL",
  thighR: "shinR",
  shinL: "footL",
  shinR: "footR",
  spine: "chest",
  hips: "spine",
};

// Orthonormal basis (up/left/forward) for the character, derived from its
// skeleton in bind pose — poses below are relative to it, not raw axes.
export function characterBasis(bm) {
  const wp = (role) => bm.get(role).getWorldPosition(new THREE.Vector3());

  // 1. UP — from hips to spine. The most reliable axis of all.
  const up = wp("spine").sub(wp("hips")).normalize();

  // 2. FORWARD — the toe sits in front of the heel, a direct anatomical
  // signal for facing direction, independent of any axis naming convention.
  let forward = null;

  for (const [footRole, toeRole] of [["footL", "toeL"], ["footR", "toeR"]]) {
    if (bm.has(footRole) && bm.has(toeRole)) {
      forward = wp(toeRole).sub(wp(footRole));
      break;
    }
  }

  if (forward && forward.lengthSq() > 1e-8) {
    // Toes also point downward — keep only the horizontal component.
    forward.sub(up.clone().multiplyScalar(forward.dot(up)));
  } else {
    forward = null;
  }

  // 3. Fallback, if the rig has no toe bones: derive it from the shoulders.
  // WATCH THE ORDER — crossVectors(up, leftArms) gives BACKWARD.
  if (!forward || forward.lengthSq() < 1e-8) {
    const leftArms = wp("upperArmL").sub(wp("upperArmR"));
    leftArms.sub(up.clone().multiplyScalar(leftArms.dot(up))).normalize();
    forward = new THREE.Vector3().crossVectors(leftArms, up);
  }
  forward.normalize();

  // 4. LEFT — derived, so the basis is orthonormal and right-handed by
  // construction: left × up = forward, and therefore up × forward = left.
  const left = new THREE.Vector3().crossVectors(up, forward).normalize();

  // Sanity check: computed "left" must point right shoulder -> left one, or
  // the rig's Left/Right bones are mirrored and every pose below is swapped.
  if (bm.has("upperArmL") && bm.has("upperArmR")) {
    const check = wp("upperArmL").sub(wp("upperArmR"));
    if (check.dot(left) < 0) {
      console.warn(
        "[clipFactory] le ossa Left/Right di questo rig sembrano specchiate: " +
          "le pose di destra e sinistra risulteranno invertite.",
      );
    }
  }

  return { up, left, forward };
}

// Target direction for a limb, in degrees from "down" — swing positive =
// forward, spread positive = away from the body (derived, not assumed).
function limbDir(basis, swing, spread, side) {
  const d = basis.up.clone().negate(); // starting point: straight down

  // Rotating "down" around LEFT by +θ points backward (swing negated for
  // "forward"); rotating around FORWARD by +θ points left, so spread is +θ/−θ.
  d.applyAxisAngle(basis.left, -swing * DEG);
  d.applyAxisAngle(basis.forward, spread * DEG * (side === "L" ? 1 : -1));

  return d.normalize();
}

// Local rotation to apply to `bone` so its limb points at `dirWorld`. Solves
// q from M·q·ĉ = target (M = bone's world orientation, ĉ = child's local dir).
function offsetToward(bone, child, dirWorld) {
  if (!bone || !child) return new THREE.Quaternion();

  const childLocalDir = child.position.clone();
  if (childLocalDir.lengthSq() < 1e-12) return new THREE.Quaternion();
  childLocalDir.normalize();

  const boneWorldQ = bone.getWorldQuaternion(new THREE.Quaternion());
  const targetLocal = dirWorld
    .clone()
    .applyQuaternion(boneWorldQ.clone().invert())
    .normalize();

  return new THREE.Quaternion().setFromUnitVectors(childLocalDir, targetLocal);
}

// HINGE rotation: bends the bone by `angleDeg` around a world axis, relative
// to its parent's orientation — for elbows/knees, so rotation doesn't compound.
function hingeOffset(bone, axisWorld, angleDeg) {
  const boneWorldQ = bone.getWorldQuaternion(new THREE.Quaternion());
  const axisLocal = axisWorld
    .clone()
    .applyQuaternion(boneWorldQ.clone().invert())
    .normalize();
  return new THREE.Quaternion().setFromAxisAngle(axisLocal, angleDeg * DEG);
}

// Builds a hinge-rotation keyframe track: a list of bend angles (degrees)
// applied via hingeOffset() at each time sample.
function hingeTrack(bm, role, times, anglesDeg, axisWorld) {
  const bone = bm.get(role);
  if (!bone) return null;

  const bind = bone.quaternion.clone();
  const values = [];

  for (const a of anglesDeg) {
    const q = bind.clone().multiply(hingeOffset(bone, axisWorld, a));
    values.push(q.x, q.y, q.z, q.w);
  }

  return new THREE.QuaternionKeyframeTrack(
    `${bone.name}.quaternion`,
    times,
    values,
  );
}

// Builds a quaternion keyframe track for a limb bone from a list of world
// target directions (via offsetToward() at each time sample).
function limbTrack(bm, role, times, dirs) {
  const bone = bm.get(role);
  const child = bm.get(LIMB_CHILD[role]);
  if (!bone || !child) return null;

  const bind = bone.quaternion.clone();
  const values = [];

  for (const dir of dirs) {
    const q = bind.clone().multiply(offsetToward(bone, child, dir));
    values.push(q.x, q.y, q.z, q.w);
  }

  return new THREE.QuaternionKeyframeTrack(
    `${bone.name}.quaternion`,
    times,
    values,
  );
}

// Builds a torso/chest keyframe track from forward-lean and twist angles, on
// the CHARACTER's basis axes rather than the bone's own (which vary per rig).
function torsoTrack(bm, role, times, leans, twists, basis) {
  const bone = bm.get(role);
  if (!bone) return null;

  const bind = bone.quaternion.clone();
  const values = [];

  for (let i = 0; i < times.length; i++) {
    // Rotating around "left" by +θ points backward, so leaning forward
    // needs the negated sign.
    const q = bind
      .clone()
      .multiply(hingeOffset(bone, basis.left, -(leans[i] || 0)))
      .multiply(hingeOffset(bone, basis.up, twists[i] || 0));
    values.push(q.x, q.y, q.z, q.w);
  }

  return new THREE.QuaternionKeyframeTrack(
    `${bone.name}.quaternion`,
    times,
    values,
  );
}

// Builds a vertical bob track for the hips. Offsets are FRACTIONS of leg
// length, not absolute units — a raw "0.045" would be invisible otherwise.
function hipsBob(bm, times, fractions) {
  const bone = bm.get("hips");
  if (!bone) return null;

  // Leg length in the skeleton's own units: the sum of the shin's and
  // foot's local translations relative to their parents.
  const shin = bm.get("shinL") || bm.get("shinR");
  const foot = bm.get("footL") || bm.get("footR");
  const legLen =
    (shin ? shin.position.length() : 0) + (foot ? foot.position.length() : 0);
  const unit = legLen > 1e-6 ? legLen : 1;

  const p = bone.position;
  const values = [];
  for (const f of fractions) values.push(p.x, p.y + f * unit, p.z);

  return new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, values);
}

// ------------------------------------------------------------------- CLIP

// Idle pose clip: a slow three-second "breathing" cycle — arms drift open
// and back, the chest expands slightly, and the hips dip on the exhale.
function buildIdle(bm, basis) {
  const t = [0, 1.5, 3];
  const S = POSE.armSpread;

  const tracks = [
    // Arms: not held perfectly still — a slight opening and a hint of
    // backward sway keep the pose alive without reading as an animation.
    limbTrack(bm, "upperArmL", t, [
      limbDir(basis, -1, S, "L"),
      limbDir(basis, -4, S + 2.5, "L"),
      limbDir(basis, -1, S, "L"),
    ]),
    limbTrack(bm, "upperArmR", t, [
      limbDir(basis, -1, S, "R"),
      limbDir(basis, -4, S + 2.5, "R"),
      limbDir(basis, -1, S, "R"),
    ]),

    // Elbows slightly bent forward, with a breathing motion layered on top.
    hingeTrack(bm, "foreArmL", t, [-14, -19, -14], basis.left),
    hingeTrack(bm, "foreArmR", t, [-14, -19, -14], basis.left),

    // Breathing: the chest opens forward and returns.
    torsoTrack(bm, "chest", t, [0, 3, 0], [0, 0, 0], basis),

    // The hips dip slightly on the exhale.
    hipsBob(bm, t, [0, -0.012, 0]),
  ];

  return new THREE.AnimationClip("idle", 3, tracks.filter(Boolean));
}

// Shared shape for both walk and run — only amplitudes/duration differ (cfg
// from buildCharacterClips below). cfg.legsOnly skips arms/torso/hips (Yoshi).
function buildGait(bm, basis, name, duration, cfg) {
  // Five samples: the fifth repeats the first so the cycle closes seamlessly.
  const t = [0, duration * 0.25, duration * 0.5, duration * 0.75, duration];
  const S = POSE.armSpread;

  // Phase 0: left leg forward / left arm back. Phase 0.5: mirrored.
  const legPhase = [1, 0, -1, 0, 1];
  const armPhase = [-1, 0, 1, 0, -1];
  // Knees bend on the RETURN swing, not while the leg is forward — that's
  // what distinguishes a walk from two sticks swinging in unison.
  const kneeL = [0, 0.55, 1, 0.35, 0];
  const kneeR = [1, 0.35, 0, 0.55, 1];

  const dirs = (phases, swing, spread, side) =>
    phases.map((p) => limbDir(basis, swing * p, spread, side));

  const tracks = [
    limbTrack(bm, "thighL", t, dirs(legPhase, cfg.legSwing, 3, "L")),
    limbTrack(bm, "thighR", t, dirs(legPhase.map((p) => -p), cfg.legSwing, 3, "R")),

    // Knees bend BACKWARD relative to the thigh. Rotating around "left" by
    // +θ points backward, so the sign here is positive.
    hingeTrack(bm, "shinL", t, kneeL.map((k) => cfg.kneeBend * k), basis.left),
    hingeTrack(bm, "shinR", t, kneeR.map((k) => cfg.kneeBend * k), basis.left),

    ...(cfg.legsOnly
      ? []
      : [
          limbTrack(bm, "upperArmL", t, dirs(armPhase, cfg.armSwing, S, "L")),
          limbTrack(bm, "upperArmR", t, dirs(armPhase.map((p) => -p), cfg.armSwing, S, "R")),

          // Elbows bend FORWARD (negative sign), with a bit of play that
          // follows the arm's swing.
          hingeTrack(bm, "foreArmL", t, armPhase.map((p) => -(18 + p * 10)), basis.left),
          hingeTrack(bm, "foreArmR", t, armPhase.map((p) => -(18 - p * 10)), basis.left),
        ]),

    // ANKLES: cancels the rotation accumulated by thigh+knee so the sole
    // stays roughly parallel to the ground, plus a small heel-to-toe roll.
    hingeTrack(
      bm, "footL", t,
      legPhase.map((p, i) => cfg.legSwing * p - cfg.kneeBend * kneeL[i] + 6 * p),
      basis.left,
    ),
    hingeTrack(
      bm, "footR", t,
      legPhase.map((p, i) => -cfg.legSwing * p - cfg.kneeBend * kneeR[i] - 6 * p),
      basis.left,
    ),

    ...(cfg.legsOnly
      ? []
      : [
          // Torso: leans forward (while running) and twists opposite the
          // hips, like a real walking gait.
          torsoTrack(
            bm, "spine", t,
            [cfg.lean, cfg.lean, cfg.lean, cfg.lean, cfg.lean],
            [-4, 0, 4, 0, -4],
            basis,
          ),

          // The hips rise and fall TWICE per cycle, once per footstep.
          hipsBob(bm, t, [0, cfg.bob, 0, cfg.bob, 0]),
        ]),
  ];

  return new THREE.AnimationClip(name, duration, tracks.filter(Boolean));
}

// Jump pose clip: three keyframes (takeoff, full pose, hold). LoopOnce +
// clampWhenFinished means the THIRD frame is what's visible mid-flight.
function buildJump(bm, basis) {
  const t = [0, 0.16, 0.42];
  const S = POSE.armSpread;
  const P = POSE;

  // Ankle is a hinge RELATIVE to the shin, so a sensible sole angle means
  // subtracting what the thigh and knee already rotated.
  const ankle = (thigh, knee) => thigh - knee;

  const tracks = [
    // ---- LEGS: left tucked in front, right extended behind -------------
    limbTrack(bm, "thighL", t, [
      limbDir(basis, 0, 3, "L"),
      limbDir(basis, P.jumpFrontThigh, 6, "L"),
      limbDir(basis, P.jumpFrontThigh - 5, 6, "L"),
    ]),
    limbTrack(bm, "thighR", t, [
      limbDir(basis, 0, 3, "R"),
      limbDir(basis, P.jumpBackThigh, 4, "R"),
      limbDir(basis, P.jumpBackThigh + 3, 4, "R"),
    ]),
    hingeTrack(bm, "shinL", t, [0, P.jumpFrontKnee, P.jumpFrontKnee - 6], basis.left),
    hingeTrack(bm, "shinR", t, [0, P.jumpBackKnee, P.jumpBackKnee - 4], basis.left),

    // Toes pointed down — the detail that reads the pose as a leap rather
    // than a fall.
    hingeTrack(
      bm, "footL", t,
      [0, ankle(P.jumpFrontThigh, P.jumpFrontKnee), ankle(P.jumpFrontThigh - 5, P.jumpFrontKnee - 6)],
      basis.left,
    ),
    hingeTrack(
      bm, "footR", t,
      [0, ankle(P.jumpBackThigh, P.jumpBackKnee), ankle(P.jumpBackThigh + 3, P.jumpBackKnee - 4)],
      basis.left,
    ),

    // ---- ARMS: right skyward, left bent low -----------------------------
    // SPREAD SIGN WARNING: positive spread flips past horizontal, so the raised arm negates it.
    limbTrack(bm, "upperArmR", t, [
      limbDir(basis, 0, S, "R"),
      limbDir(basis, P.jumpArmUp, -P.jumpArmUpSpread, "R"),
      limbDir(basis, P.jumpArmUp - 4, -(P.jumpArmUpSpread + 2), "R"),
    ]),
    limbTrack(bm, "upperArmL", t, [
      limbDir(basis, 0, S, "L"),
      limbDir(basis, P.jumpArmDown, P.jumpArmDownSpread, "L"),
      limbDir(basis, P.jumpArmDown + 3, P.jumpArmDownSpread, "L"),
    ]),

    // Elbows: the raised one nearly straight, the low one bent forward
    // (negative sign = forward, same convention as the walk cycle).
    hingeTrack(bm, "foreArmR", t, [-14, -P.jumpElbowUp, -P.jumpElbowUp], basis.left),
    hingeTrack(bm, "foreArmL", t, [-14, -P.jumpElbowDown, -P.jumpElbowDown + 5], basis.left),

    // ---- TORSO: stretches upward and twists toward the raised arm -------
    torsoTrack(
      bm, "spine", t,
      [0, P.jumpLean, P.jumpLean - 2],
      [0, P.jumpTwist, P.jumpTwist],
      basis,
    ),
  ];

  return new THREE.AnimationClip("jump", 0.42, tracks.filter(Boolean));
}

/**
 * Fire-breathing wind-up: a one-shot pose held for the boss's charge
 * duration. The middle keyframe overshoots the final one for a bit of snap.
 */
function buildCharge(bm, basis) {
  const t = [0, 0.34, 0.55];
  const P = POSE;
  const S = POSE.armSpread;

  const tracks = [
    // Torso and head rock back: the actual "taking a breath in".
    torsoTrack(bm, "spine", t, [0, P.chargeLean - 4, P.chargeLean], [0, 0, 0], basis),
    torsoTrack(bm, "chest", t, [0, P.chargeChestLean - 3, P.chargeChestLean], [0, 0, 0], basis),
    torsoTrack(bm, "head", t, [0, P.chargeHeadLean - 4, P.chargeHeadLean], [0, 0, 0], basis),

    // Arms swept back and out, elbows bent — shoulders opening up to make
    // room for the chest.
    limbTrack(bm, "upperArmL", t, [
      limbDir(basis, -1, S, "L"),
      limbDir(basis, P.chargeArmSwing - 5, P.chargeArmSpread, "L"),
      limbDir(basis, P.chargeArmSwing, P.chargeArmSpread, "L"),
    ]),
    limbTrack(bm, "upperArmR", t, [
      limbDir(basis, -1, S, "R"),
      limbDir(basis, P.chargeArmSwing - 5, P.chargeArmSpread, "R"),
      limbDir(basis, P.chargeArmSwing, P.chargeArmSpread, "R"),
    ]),
    hingeTrack(bm, "foreArmL", t, [-14, -P.chargeElbow, -P.chargeElbow], basis.left),
    hingeTrack(bm, "foreArmR", t, [-14, -P.chargeElbow, -P.chargeElbow], basis.left),

    // Knees bent and hips dropped: braced, not standing at ease.
    hingeTrack(bm, "shinL", t, [0, P.chargeKnee, P.chargeKnee], basis.left),
    hingeTrack(bm, "shinR", t, [0, P.chargeKnee, P.chargeKnee], basis.left),
    hipsBob(bm, t, [0, P.chargeHipsDrop, P.chargeHipsDrop]),
  ];

  return new THREE.AnimationClip("charge", 0.55, tracks.filter(Boolean));
}


function buildFall(bm, basis) {
  const t = [0, 0.4, 0.8];
  const S = POSE.armSpread;
  const tracks = [
    limbTrack(bm, "thighL", t, [limbDir(basis, 16, 8, "L"), limbDir(basis, 8, 10, "L"), limbDir(basis, 16, 8, "L")]),
    limbTrack(bm, "thighR", t, [limbDir(basis, 8, 10, "R"), limbDir(basis, 16, 8, "R"), limbDir(basis, 8, 10, "R")]),
    hingeTrack(bm, "shinL", t, [32, 22, 32], basis.left),
    hingeTrack(bm, "shinR", t, [22, 32, 22], basis.left),
    // Arms spread wide, flailing slowly.
    limbTrack(bm, "upperArmL", t, [limbDir(basis, 20, 70, "L"), limbDir(basis, 35, 80, "L"), limbDir(basis, 20, 70, "L")]),
    limbTrack(bm, "upperArmR", t, [limbDir(basis, 35, 80, "R"), limbDir(basis, 20, 70, "R"), limbDir(basis, 35, 80, "R")]),
    torsoTrack(bm, "spine", t, [-6, -2, -6], [0, 0, 0], basis),
  ];
  return new THREE.AnimationClip("fall", 0.8, tracks.filter(Boolean));
}

// CONTROL clip: asks every limb to point exactly where it already points. If
// correct this changes nothing; visible deformation means a pipeline bug.
function buildBind(bm, roles = Object.keys(LIMB_CHILD)) {
  const t = [0, 1];
  const tracks = [];

  for (const role of roles) {
    const bone = bm.get(role);
    const child = bm.get(LIMB_CHILD[role]);
    if (!bone || !child) continue;

    // Current WORLD direction of the limb, in bind pose.
    const dir = child
      .getWorldPosition(new THREE.Vector3())
      .sub(bone.getWorldPosition(new THREE.Vector3()))
      .normalize();

    const tr = limbTrack(bm, role, t, [dir, dir]);
    if (tr) tracks.push(tr);
  }

  return new THREE.AnimationClip("bind", 1, tracks);
}

// Roles Yoshi's clips touch: nothing above the hip is asked to move.
const YOSHI_ROLES = ["thighL", "thighR", "shinL", "shinR", "footL", "footR"];

/**
 * Clip set for Yoshi: legs-only walk/run, and an idle that's just his
 * exported pose narrowed to leg roles — arms/torso/head/tail stay untouched.
 */
export function buildYoshiClips(boneMap) {
  const basis = characterBasis(boneMap);

  return {
    idle: buildBind(boneMap, YOSHI_ROLES),
    walk: buildGait(boneMap, basis, "walk", 1.0, {
      legSwing: POSE.yoshiWalkLegSwing,
      kneeBend: POSE.yoshiWalkKneeBend,
      legsOnly: true,
    }),
    run: buildGait(boneMap, basis, "run", 0.62, {
      legSwing: POSE.yoshiRunLegSwing,
      kneeBend: POSE.yoshiRunKneeBend,
      legsOnly: true,
    }),
  };
}

// Entry point: builds the full set of named AnimationClips (bind/idle/walk/
// run/jump/fall) for one character, from its already-resolved BoneMap.
export function buildCharacterClips(boneMap) {
  const basis = characterBasis(boneMap);

  return {
    bind: buildBind(boneMap),
    idle: buildIdle(boneMap, basis),
    walk: buildGait(boneMap, basis, "walk", 1.0, {
      legSwing: POSE.walkLegSwing, armSwing: POSE.walkArmSwing,
      kneeBend: POSE.walkKneeBend, lean: 0, bob: POSE.walkHipsBob,
    }),
    run: buildGait(boneMap, basis, "run", 0.62, {
      legSwing: POSE.runLegSwing, armSwing: POSE.runArmSwing,
      kneeBend: POSE.runKneeBend, lean: POSE.runLean, bob: POSE.runHipsBob,
    }),
    jump: buildJump(boneMap, basis),
    fall: buildFall(boneMap, basis),
    charge: buildCharge(boneMap, basis),
  };
}
