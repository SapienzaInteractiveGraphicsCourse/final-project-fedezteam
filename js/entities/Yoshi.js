import * as THREE from 'three';
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { enableShadows } from "../utils/shadows.js";
import { COLLISION_GROUPS } from "../physics/PhysicsEngine.js";

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

    if (this.mesh) {
      enableShadows(this.mesh);
    }
  }

  setMesh(mesh) {
    this.mesh = mesh;
    enableShadows(this.mesh);
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
  }

  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}
