import * as THREE from 'three';
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { enableShadows } from "../utils/shadows.js";
import { COLLISION_GROUPS } from "../physics/PhysicsEngine.js";
import AnimationController from "./animation/AnimationController.js";
import { buildYoshiClips } from "./animation/clipFactory.js";

export default class Yoshi {
  constructor(mesh = null, physicsEngine = null) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;
    this.isRidden = false;
    this.body = null;
    this.radius = 1; // Radius of the spherical collision body.

    // Correction if Yoshi's own model turns out to face a different
    // "forward" than the rider once mounted rotation-following is actually
    // seen running (see update()'s isRidden branch) — 0 (no correction)
    // until tuned.
    this.modelOffset = 0;

    // Walk/run for his legs — see clipFactory's buildYoshiClips. Stays
    // inert (BoneMap.isUsable === false) on a model without a usable
    // skeleton, which is what the old static Yoshi was.
    this.animation = null;

    if (this.mesh) {
      enableShadows(this.mesh);
      this._buildAnimation();
    }
  }

  setMesh(mesh) {
    this.mesh = mesh;
    enableShadows(this.mesh);
    this._buildAnimation();
  }

  // (Re)builds the leg animator for the current mesh.
  //
  // The thresholds are set against the player's own numbers (moveSpeed 11,
  // sprint 1.5x -> 16.5 — see EntityManager.spawnPlayer), because while
  // ridden Yoshi travels at exactly the player's pace: runSpeed just above
  // 11 is what makes him break into a run when the player sprints, and
  // only then.
  //
  // walkSpeed is not only the idle/walk threshold: AnimationController
  // also uses walkSpeed * 2.2 as the speed at which the walk cycle plays
  // at 1x, and clamps the rate at 1.8x. Left at its default (2.0) Yoshi
  // would spend the whole time pinned to that clamp, his legs whirring at
  // the same rate whether he was creeping or charging; at 3.0 the
  // reference lands at 6.6 and the cycle actually tracks his speed across
  // the range he really moves at.
  _buildAnimation() {
    if (this.animation) this.animation.dispose();
    this.animation = this.mesh
      ? new AnimationController(this.mesh, {
          buildClips: buildYoshiClips,
          walkSpeed: 3.0,
          runSpeed: 11.5,
        })
      : null;
  }

  // Mount/dismount, driven by the "Press E" interaction registered in
  // main.js (see js/interactions/InteractionManager.js). update() above
  // already knows how to follow the player while `isRidden` is true —
  // these just flip that flag; Player.js's own mountedOnYoshi flag (set
  // alongside these, from main.js) is what actually applies the boosted
  // jump while riding.
  //
  // Yoshi's body STAYS a normal DYNAMIC body across mount/dismount (see
  // update()'s isRidden branch): ground contact while ridden is meant to
  // be Yoshi's own real collision with the terrain, not a value copied
  // from the player, so there's no special physics mode to switch into
  // here anymore — mount()/dismount() are just the isRidden flag flip.
  mount() {
    this.isRidden = true;
  }

  dismount() {
    this.isRidden = false;
  }

  spawn(x, y, z) {
    if (!this.mesh) return;

    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = 0;

    // Create the cannon-es physics body.
    if (this.physicsEngine && this.physicsEngine.world) {
      const shape = new CANNON.Sphere(this.radius);

      // The physics sphere's center is raised by 'radius' so the origin at
      // y = 0 in the GLTF model (the feet) touches the ground.
      this.body = new CANNON.Body({
        mass: 10,
        position: new CANNON.Vec3(x, y + this.radius, z),
        shape: shape,
        material: this.physicsEngine.defaultMaterial,
        fixedRotation: true
      });

      // BUG FIX (instant fall on mount): excludes the player from Yoshi's
      // own body — see COLLISION_GROUPS.YOSHI's comment in PhysicsEngine.js.
      // Applies whether ridden or not: even standing next to the player
      // un-mounted, there's no gameplay reason for the two to physically
      // push each other around.
      this.body.collisionFilterGroup = COLLISION_GROUPS.YOSHI;
      this.body.collisionFilterMask = -1 & ~COLLISION_GROUPS.PLAYER;

      this.physicsEngine.world.addBody(this.body);
    }
  }

  // The mirror image of spawn(): drops the physics body this class created
  // and put in the world. Used when Yoshi is lost to the void while being
  // ridden (see EntityManager's void-fall handler), after which he goes
  // back inside his egg and a fresh Yoshi is built on the next hatch.
  //
  // The MESH is deliberately not touched here: it belongs to the shared
  // asset cache and was added to the scene by EntityManager.setYoshi, so
  // taking it out again is EntityManager's job, symmetrically.
  despawn() {
    this.isRidden = false;

    // Bind pose first, then the mixer: the model comes from the shared
    // asset cache (see AssetLoader), so leaving it mid-stride would hand
    // the next Yoshi a skeleton frozen halfway through a step — the same
    // reason Player.disposeAnimation exists.
    if (this.animation) {
      this.animation.restoreBindPose();
      this.animation.dispose();
      this.animation = null;
    }

    if (this.body && this.physicsEngine && this.physicsEngine.world) {
      this.physicsEngine.world.removeBody(this.body);
    }
    this.body = null;
  }

  update(delta, inputOrPlayer, playerRef) {
    if (!this.mesh) return;

    const player = playerRef || (inputOrPlayer && inputOrPlayer.mesh ? inputOrPlayer : null);

    if (this.isRidden && player) {
      // While being ridden, ground contact is YOSHI's, for real — his own
      // DYNAMIC body keeps falling under normal gravity and colliding with
      // the actual terrain every physics step, exactly like when he's not
      // ridden. Only X/Z are force-followed onto the player's own position
      // here (so he goes where the player steers); Y is left alone for
      // cannon-es itself to resolve via that real collision, so if the
      // player's own visual offset (Player.MOUNT_RIDE_HEIGHT) is ever
      // changed, Yoshi simply doesn't move — he's anchored to the ground he
      // is actually standing on, not derived from the player at all.
      //
      // The player's own jump (Player.js sets his body.velocity.y, boosted
      // by YOSHI_JUMP_BOOST while mounted) is mirrored onto Yoshi's
      // velocity.y here so that jump impulse actually launches Yoshi
      // himself under real physics — otherwise pressing Space while
      // mounted would do nothing visible, since it's Yoshi's own height
      // that ends up on screen.
      if (player.body && this.body) {
        this.body.position.x = player.body.position.x;
        this.body.position.z = player.body.position.z;
        this.body.velocity.y = player.body.velocity.y;

        this.mesh.position.set(
          this.body.position.x,
          this.body.position.y - this.radius,
          this.body.position.z,
        );
      } else if (this.body) {
        // Fallback if the player has no physics body yet for some reason.
        this.mesh.position.set(
          this.body.position.x,
          this.body.position.y - this.radius,
          this.body.position.z,
        );
      }

      // The RIDER's mesh, in turn, follows YOSHI's resulting height (plus
      // the fixed "seat" offset) instead of the other way around — see
      // Player.js's MOUNT_RIDE_HEIGHT. Overwritten here, after
      // Player.update() already ran this frame (see EntityManager.update's
      // call order), so this is the one place that actually decides where
      // the rider is drawn while mounted.
      if (player.mesh) {
        player.mesh.position.x = this.mesh.position.x;
        player.mesh.position.z = this.mesh.position.z;
        player.mesh.position.y = this.mesh.position.y + (player.MOUNT_RIDE_HEIGHT || 0);
      }

      // Follow the rider's facing so Yoshi turns together with the player
      // instead of staying frozen at whatever angle he hatched facing.
      // this.modelOffset lets that be corrected in one place if Yoshi's own
      // model turns out to face a different "forward" than Mario/Luigi's
      // once this is actually seen running (can't be verified from here).
      if (player.mesh) {
        this.mesh.rotation.y = player.mesh.rotation.y + (this.modelOffset || 0);
      }
    } else if (this.body) {
      // Sync the mesh to the physics body, subtracting the radius so the
      // GLTF model's feet stay in contact with the floor.
      this.mesh.position.set(
        this.body.position.x,
        this.body.position.y - this.radius,
        this.body.position.z
      );
    }

    this._updateLegs(delta, player);
  }

  /**
   * Advances the walk/run cycle at the speed he is actually travelling.
   *
   * WHICH BODY. While he is being ridden the branch above writes his x/z
   * straight onto his own body every frame to follow the player, so HIS
   * horizontal velocity stays at zero however far he travels — the
   * player's is the real one. Off the saddle nobody is moving him and his
   * own body is the truth again.
   *
   * WHY VELOCITY AND NOT THE DISTANCE BETWEEN FRAMES. Measuring "how far
   * did he move since last frame, divided by delta" looks more direct and
   * is a trap: the physics world runs on a FIXED 1/60 step with an
   * accumulator (see PhysicsEngine.update -> world.step(1/60, delta, 3)),
   * so on a display faster than 60Hz a good half of the frames don't
   * advance the simulation at all. Those frames measure a distance of
   * exactly zero, the state machine reads "standing still", and walk/idle
   * end up alternating frame by frame — every switch calls action.reset()
   * (see AnimationController.play), which restarts the cycle from its
   * first frame and reads on screen as legs frozen mid-step. Velocity is
   * integrated STATE: it keeps its value across the frames that don't
   * step, so it never lies about standing still.
   */
  _updateLegs(delta, player) {
    if (!this.animation) return;

    const source = this.isRidden && player && player.body ? player.body : this.body;
    const speed = source ? Math.hypot(source.velocity.x, source.velocity.z) : 0;

    this.animation.update(delta, { speed });
  }

  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}
