import * as THREE from "three";
import BoneMap from "./BoneMap.js";
import { buildCharacterClips } from "./clipFactory.js";

/**
 * AnimationController.js — per-character animation state machine. Owns
 * the AnimationMixer, cross-fades between motion-derived states, and
 * never touches physics/input. Stays silently inert (no error) if the
 * model's skeleton isn't usable (BoneMap.isUsable) — no walk cycle, but
 * the game still works.
 */
export default class AnimationController {
  // opts.buildClips: which clip set to build (default full idle/walk/run/
  // jump/fall; Yoshi passes buildYoshiClips). opts.runSpeed: run threshold.
  constructor(root, opts = {}) {
    this.root = root;

    this._buildClips = opts.buildClips || buildCharacterClips;
    this.mixer = new THREE.AnimationMixer(root);
    this.boneMap = new BoneMap(root);

    this.actions = {};
    this.current = null;

    // While locked, update() advances the mixer but stops picking states
    // from motion — see lock().
    this._locked = false;

    this.enabled = this.boneMap.isUsable;

    this.walkSpeed = opts.walkSpeed ?? 2.0;
    this.runSpeed = opts.runSpeed ?? 12.0;

    if (this.enabled) {
      // Clips read bone WORLD positions in bind pose, so world matrices
      // must be current first.
      root.updateMatrixWorld(true);

      // Snapshot of the resting pose, taken before any animation runs — else
      // rebuild() would treat an animated pose as bind and compound it.
      this._bindPose = [];
      root.traverse((n) => {
        if (n.isBone) {
          this._bindPose.push({
            bone: n,
            quaternion: n.quaternion.clone(),
            position: n.position.clone(),
          });
        }
      });

      this._buildActions();
    }
  }

  // Builds one action per clip; "jump"/"charge" are held poses (play once,
  // clamp on last frame) rather than looping cycles.
  _buildActions() {
    const clips = this._buildClips(this.boneMap);

    for (const [name, clip] of Object.entries(clips)) {
      const action = this.mixer.clipAction(clip);

      if (name === "jump" || name === "charge") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[name] = action;
    }
  }

  // Cross-fades into a named state, fading the previous one out.
  play(name, fade = 0.18) {
    if (!this.enabled) return;

    const next = this.actions[name];
    if (!next || this.current === name) return;

    const prev = this.current ? this.actions[this.current] : null;

    next.reset();
    next.setEffectiveWeight(1);
    next.fadeIn(fade);
    next.play();

    if (prev) prev.fadeOut(fade);

    this.current = name;
  }

  // Picks a state from `motion` ({speed, verticalVelocity, grounded}) and
  // plays it, then advances the mixer by `delta`.
  update(delta, motion) {
    if (!this.enabled) return;

    if (motion && !this._locked) {
      const { speed = 0, verticalVelocity = 0, grounded = true } = motion;

      let state;
      if (!grounded && verticalVelocity > 0.5) state = "jump";
      else if (!grounded && verticalVelocity < -0.5) state = "fall";
      else if (speed > this.runSpeed) state = "run";
      else if (speed > this.walkSpeed) state = "walk";
      else state = "idle";

      this.play(state);

      // Step rate follows real speed so the character never "skates".
      if (state === "walk" || state === "run") {
        const reference = state === "run" ? this.runSpeed : this.walkSpeed * 2.2;
        const ratio = THREE.MathUtils.clamp(speed / reference, 0.55, 1.8);
        this.actions[state].setEffectiveTimeScale(ratio);
      }
    }

    this.mixer.update(delta);
  }

  // Holds one state until unlock(), ignoring update()'s motion pick — used
  // for a game-owned pose (Bowser's wind-up). Safe to call every frame.
  lock(name) {
    if (!this.enabled) return;
    this.play(name);
    this._locked = true;
  }

  // Hands control back to update()'s motion-driven pick.
  unlock() {
    this._locked = false;
  }

  // Resets every bone to its recorded bind pose.
  restoreBindPose() {
    if (!this._bindPose) return;
    for (const s of this._bindPose) {
      s.bone.quaternion.copy(s.quaternion);
      s.bone.position.copy(s.position);
    }
    this.root.updateMatrixWorld(true);
  }

  // Rebuilds every clip after POSE values changed (live tuning). Restores
  // bind pose first so clips aren't computed from an animated skeleton.
  rebuild() {
    if (!this.enabled) return;

    this.mixer.stopAllAction();
    this.restoreBindPose();

    this.actions = {};
    this.current = null;
    this._buildActions();
  }

  // Stops every action and releases the mixer's cache for this root.
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
