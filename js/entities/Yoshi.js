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

    // Correction if Yoshi's model faces a different "forward" than the
    // rider once mounted (see update()'s isRidden branch). 0 until tuned.
    this.modelOffset = 0;

    // Walk/run for his legs (clipFactory's buildYoshiClips). Inert on a
    // model without a usable skeleton (the old static Yoshi).
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

  // (Re)builds the leg animator. Thresholds match the player's own speed
  // (moveSpeed 11, sprint 16.5) since Yoshi moves at the player's pace while ridden.
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

  // Mount/dismount, driven by the "Press E" interaction. Yoshi's body stays
  // a normal dynamic body across both — this is just the isRidden flag flip.
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

    if (this.physicsEngine && this.physicsEngine.world) {
      const shape = new CANNON.Sphere(this.radius);

      // Center raised by `radius` so the GLTF's y=0 origin (the feet)
      // touches the ground.
      this.body = new CANNON.Body({
        mass: 10,
        position: new CANNON.Vec3(x, y + this.radius, z),
        shape: shape,
        material: this.physicsEngine.defaultMaterial,
        fixedRotation: true
      });

      // Excludes the player from Yoshi's own body (see COLLISION_GROUPS.YOSHI
      // in PhysicsEngine.js) — applies whether ridden or not.
      this.body.collisionFilterGroup = COLLISION_GROUPS.YOSHI;
      this.body.collisionFilterMask = -1 & ~COLLISION_GROUPS.PLAYER;

      this.physicsEngine.world.addBody(this.body);
    }
  }

  // Mirror of spawn(): drops the physics body. Used when Yoshi is lost to
  // the void while ridden; the mesh itself is EntityManager's to remove.
  despawn() {
    this.isRidden = false;

    // Bind pose first: the model comes from the shared asset cache, so
    // leaving it mid-stride would hand the next Yoshi a frozen skeleton.
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
      // Ground contact stays Yoshi's own real collision — only X/Z are force-followed
      // onto the player; the jump velocity is mirrored so Space while mounted launches him.
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

      // The rider follows YOSHI's resulting height + seat offset (see
      // Player.MOUNT_RIDE_HEIGHT), overwriting Player.update()'s own result.
      if (player.mesh) {
        player.mesh.position.x = this.mesh.position.x;
        player.mesh.position.z = this.mesh.position.z;
        player.mesh.position.y = this.mesh.position.y + (player.MOUNT_RIDE_HEIGHT || 0);
      }

      // Follows the rider's facing (modelOffset corrects a mismatched
      // "forward" in one place, if Yoshi's model ever needs it).
      if (player.mesh) {
        this.mesh.rotation.y = player.mesh.rotation.y + (this.modelOffset || 0);
      }
    } else if (this.body) {
      // Sync the mesh to the body, subtracting radius so feet touch the floor.
      this.mesh.position.set(
        this.body.position.x,
        this.body.position.y - this.radius,
        this.body.position.z
      );
    }

    this._updateLegs(delta, player);
  }

  // Advances the walk/run cycle from velocity rather than frame-to-frame
  // distance, since the fixed 1/60 physics step would flicker idle/walk otherwise.
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
