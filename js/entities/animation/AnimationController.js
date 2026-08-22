import * as THREE from "three";
import BoneMap from "./BoneMap.js";
import { buildCharacterClips } from "./clipFactory.js";

/**
 * AnimationController.js — per-character animation state machine.
 *
 * Owns the AnimationMixer, keeps one action per state, and cross-fades
 * between states. The state is inferred from the character's motion: it
 * never touches physics or input, so enabling/disabling it doesn't change
 * how the player is driven in the slightest.
 *
 * If the model's skeleton isn't usable (see BoneMap.isUsable), the whole
 * controller stays inert — the game keeps working exactly as before, just
 * without a walk cycle. That's a deliberately silent failure mode: no
 * console error, no blocked loading screen.
 */
export default class AnimationController {
  // Builds the mixer and BoneMap for `root`, and — if the skeleton is
  // usable — snapshots the bind pose and builds every clip immediately.
  // @param {THREE.Object3D} root - the model's scene graph (must contain the bones)
  // @param {object} [opts]
  // @param {number} [opts.runSpeed] - speed above which the state becomes "run"
  constructor(root, opts = {}) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.boneMap = new BoneMap(root);

    this.actions = {};
    this.current = null;

    // While locked, update() advances the mixer but stops choosing states
    // from the character's motion — see lock().
    this._locked = false;

    // See the file header: an unusable skeleton leaves the controller
    // inert rather than throwing.
    this.enabled = this.boneMap.isUsable;

    this.walkSpeed = opts.walkSpeed ?? 2.0;
    this.runSpeed = opts.runSpeed ?? 12.0;

    if (this.enabled) {
      // Clips are built by reading the bones' WORLD positions/orientations
      // in bind pose, so world matrices must be current first.
      root.updateMatrixWorld(true);

      // Snapshot of the resting pose, taken NOW before any animation has
      // touched the bones. Without it, a later rebuild() would read the
      // ANIMATED pose as if it were the bind pose, and each re-tuning pass
      // would compound deformation on top of the last.
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

  // Builds one AnimationMixer action per clip from clipFactory, marking
  // the held poses as one-shots that stay on their last frame.
  _buildActions() {
    const clips = buildCharacterClips(this.boneMap);

    for (const [name, clip] of Object.entries(clips)) {
      const action = this.mixer.clipAction(clip);

      if (name === "jump" || name === "charge") {
        // Both are held poses rather than cycles: they play once and stay
        // on their last frame. The takeoff would otherwise "bounce" while
        // the character is still airborne, and a boss' wind-up has to sit
        // still for as long as it keeps charging.
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[name] = action;
    }
  }

  // Cross-fades into a named state's action, fading the previous one out.
  // @param {string} name
  // @param {number} [fade] - crossfade duration, in seconds
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

  // Picks the right state from the character's current motion and plays
  // it, then advances the mixer by `delta`.
  // @param {number} delta
  // @param {object} motion
  // @param {number} motion.speed - horizontal speed
  // @param {number} motion.verticalVelocity
  // @param {boolean} motion.grounded
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

      // The step rate follows the real speed, so the character never
      // "skates": slowing down also slows the walk cycle.
      if (state === "walk" || state === "run") {
        const reference = state === "run" ? this.runSpeed : this.walkSpeed * 2.2;
        const ratio = THREE.MathUtils.clamp(speed / reference, 0.55, 1.8);
        this.actions[state].setEffectiveTimeScale(ratio);
      }
    }

    this.mixer.update(delta);
  }

  /**
   * Holds one state on screen until unlock(), ignoring whatever the motion
   * passed to update() would otherwise select.
   *
   * For a pose the game logic owns rather than the character's movement:
   * Bowser's fire-breathing wind-up (see Bowser.js) has to stay put even
   * though he is standing perfectly still while he charges, which the state
   * machine would quite reasonably call "idle". Safe to call every frame —
   * play() ignores a request for the state already running.
   */
  lock(name) {
    if (!this.enabled) return;
    this.play(name);
    this._locked = true;
  }

  // Hands the state back to update()'s motion-driven choice, which
  // cross-fades out of the held pose on the next frame.
  unlock() {
    this._locked = false;
  }

  // Resets every bone back to exactly its recorded bind pose.
  restoreBindPose() {
    if (!this._bindPose) return;
    for (const s of this._bindPose) {
      s.bone.quaternion.copy(s.quaternion);
      s.bone.position.copy(s.position);
    }
    this.root.updateMatrixWorld(true);
  }

  // Rebuilds every clip after POSE values changed (used for live/by-eye
  // tuning). Restores the bind pose first so the new clips aren't computed
  // starting from an already-animated skeleton.
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
