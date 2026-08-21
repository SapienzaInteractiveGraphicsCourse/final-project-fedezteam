import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { enableShadows } from "../utils/shadows.js";
import AnimationController from "./animation/AnimationController.js";
import { COLLISION_GROUPS } from "../physics/PhysicsEngine.js";

/**
 * Player.js — the player character's movement, physics body and animation
 * state, shared by every playable character (Mario, Luigi, ...) via the
 * per-character `stats` object passed in by EntityManager.
 *
 * Movement has two code paths: _updateFlat (plain ground movement, used
 * everywhere in the level) and _updateOnPlanet (Mario Galaxy-style
 * spherical gravity, used only inside a planet's gravity field — see
 * PhysicsEngine.getActiveGravityField). update() picks between them each
 * frame; outside of a gravity field, behavior is byte-for-byte identical
 * to before that feature existed.
 */
export default class Player {
  // A 'stats' object is used instead of fixed constants so EntityManager can
  // pass different values per character (see EntityManager.spawnPlayer).
  constructor(mesh, physicsEngine, stats = {}) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;

    // Assign the movement stats, falling back to Mario's default values.
    this.moveSpeed = stats.moveSpeed || 11;
    this.jumpVelocity = stats.jumpVelocity || 18;
    this.control = stats.control || 0.8; // 1.0 = instant stop, lower values = slippery movement.

    this.sprintMultiplier = 1.5;

    this.body = null;
    this.canJump = false;
    this.radius = 1;

    enableShadows(this.mesh);

    // Procedural skeletal animation. If the model has no recognizable
    // skeleton (BoneMap.isUsable === false) the controller stays inert: the
    // character still moves exactly as before, just without a walk cycle.
    this.animation = new AnimationController(this.mesh, {
      // The run threshold FOLLOWS the character's speed rather than being a
      // fixed number: Luigi walks at 20, which is faster than Mario runs.
      // A single fixed threshold would leave Luigi always running and never
      // walking — this margin above moveSpeed keeps normal pace as a walk
      // and only sprinting as a run.
      runSpeed: this.moveSpeed * 1.1,
    });
  }

  // Called when the active player character is being swapped out: stops the
  // mixer and resets the skeleton to its rest pose. The model is shared
  // (it comes from AssetLoader), so leaving it in an animated pose would
  // taint the next spawn.
  disposeAnimation() {
    if (!this.animation) return;
    this.animation.restoreBindPose();
    this.animation.dispose();
    this.animation = null;
  }

  // Places the character in the world: positions the mesh, applies the
  // model's base rotation offset, and creates+registers its dynamic
  // physics body along with the landing-detection collision listener.
  spawn(x, y, z) {
    if (!this.mesh) return;

    // 1. Three.js setup (visual mesh).
    this.mesh.position.set(x, y, z);

    // Store the model's base rotation offset, needed because the source
    // GLTF model isn't authored facing the same way as +Z.
    this.modelOffset = Math.PI / 2;
    this.mesh.rotation.y = this.modelOffset;

    // 2. cannon-es setup (physics body).
    const shape = new CANNON.Sphere(this.radius);

    // Raise the sphere's center by 'radius' so the model's origin, at the
    // character's feet (y = 0), touches the ground.
    this.body = new CANNON.Body({
      mass: 5,
      position: new CANNON.Vec3(x, y + this.radius, z),
      shape: shape,
      material: this.physicsEngine?.defaultMaterial,
      fixedRotation: true, // Prevents the character from tumbling/rolling.
    });

    // Collides with everything (ground, platforms, boss arenas, ...) EXCEPT
    // enemy bodies — see COLLISION_GROUPS' own comment in PhysicsEngine.js
    // for why: enemy contact is already fully handled by scripted logic
    // (Enemy._checkPlayerContact), so a real cannon-es collision on top of
    // that was redundant and was the actual source of the erroneous extra
    // jump-force accumulation on Bowser's stomp bounce.
    this.body.collisionFilterGroup = COLLISION_GROUPS.PLAYER;
    this.body.collisionFilterMask = -1 & ~COLLISION_GROUPS.ENEMY;

    // 3. Collision listener used to reset the jump flag on landing. Only
    // used by _updateFlat — _updateOnPlanet has its own distance-based
    // grounded check instead (see there for why: this event-based approach
    // turned out unreliable once "up" rotates away from world +Y).
    const contactNormal = new CANNON.Vec3();
    const worldUpAxis = new CANNON.Vec3(0, 1, 0);

    this.body.addEventListener("collide", (e) => {
      e.contact.ni.negate(contactNormal);

      // Only count it as "landing" if the contact normal points roughly
      // upward, i.e. the player is standing on top of something.
      if (contactNormal.dot(worldUpAxis) > 0.5) {
        this.canJump = true;
      }
    });

    if (this.physicsEngine && this.physicsEngine.world) {
      this.physicsEngine.world.addBody(this.body);
    }
  }

  // Per-frame entry point: routes to the flat-ground or planet-gravity
  // movement code depending on whether the player is currently inside a
  // planet's gravity field.
  update(delta, input, ui, audio, camera) {
    if (!this.mesh || !this.body) return;

    // Mario Galaxy-style planet gravity is purely additive: everywhere in
    // the normal level this returns null (identical to before the feature
    // existed) and _updateFlat runs, byte-for-byte the same movement code
    // that was always here. Only inside a planet's gravity field (see
    // GravityField.js / PhysicsEngine.getActiveGravityField) does the new
    // _updateOnPlanet path take over.
    const field = this.physicsEngine?.getActiveGravityField?.(this.body.position);
    if (field) {
      this._updateOnPlanet(delta, input, ui, audio, camera, field);
    } else {
      this._updateFlat(delta, input, ui, audio, camera);
    }
  }

  // Original flat-ground movement — unchanged from before spherical planet
  // gravity was added. This is the code path used everywhere in the level
  // except while inside a planet's gravity field (see _updateOnPlanet).
  _updateFlat(delta, input, ui, audio, camera) {
    // BUG FIX (leftover planet tilt): _updateOnPlanet sets a full 3D
    // quaternion so the model can stand upright on a curved surface facing
    // any direction — that leaves pitch/roll (rotation.x/z) non-zero. Flat
    // ground only ever wants yaw (rotation.y), so force pitch/roll back to
    // 0 every frame here; otherwise, coming back from a planet, Mario would
    // stay leaning at whatever angle the planet's surface last had him at
    // instead of snapping back upright.
    this.mesh.rotation.x = 0;
    this.mesh.rotation.z = 0;

    const isSprinting =
      input.isPressed("shift") ||
      input.isPressed("shiftleft") ||
      input.isPressed("shiftright");
    const activeSpeed = isSprinting
      ? this.moveSpeed * this.sprintMultiplier
      : this.moveSpeed;

    // Stable horizontal camera angle, used to compute movement directions
    // relative to where the camera is currently looking.
    const camAngle =
      camera && camera.userData && camera.userData.cameraAngleX !== undefined
        ? camera.userData.cameraAngleX
        : 0;

    // Forward/right direction vectors derived from the camera angle.
    const camForwardX = -Math.sin(camAngle);
    const camForwardZ = -Math.cos(camAngle);

    const camRightX = Math.cos(camAngle);
    const camRightZ = -Math.sin(camAngle);

    let moveDirX = 0;
    let moveDirZ = 0;

    if (input.isPressed("w") || input.isPressed("arrowup")) {
      moveDirX += camForwardX;
      moveDirZ += camForwardZ;
    }
    if (input.isPressed("s") || input.isPressed("arrowdown")) {
      moveDirX -= camForwardX;
      moveDirZ -= camForwardZ;
    }
    if (input.isPressed("a") || input.isPressed("arrowleft")) {
      moveDirX -= camRightX;
      moveDirZ -= camRightZ;
    }
    if (input.isPressed("d") || input.isPressed("arrowright")) {
      moveDirX += camRightX;
      moveDirZ += camRightZ;
    }

    // Normalize so diagonal movement isn't faster than axis-aligned movement.
    const moveLen = Math.hypot(moveDirX, moveDirZ);
    if (moveLen > 0.0001) {
      moveDirX /= moveLen;
      moveDirZ /= moveLen;
    }

    const targetMoveX = moveDirX * activeSpeed;
    const targetMoveZ = moveDirZ * activeSpeed;

    // Ease the current velocity towards the target velocity; 'control'
    // determines how sharply the character accelerates/decelerates.
    this.body.velocity.x += (targetMoveX - this.body.velocity.x) * this.control;
    this.body.velocity.z += (targetMoveZ - this.body.velocity.z) * this.control;

    if (moveLen > 0.0001) {
      const targetRotation = Math.atan2(moveDirX, moveDirZ);
      this.currentFacingAngle = targetRotation;
      this.mesh.rotation.y = targetRotation + (this.modelOffset || 0);
    }

    if ((input.isPressed("space") || input.isPressed(" ")) && this.canJump) {
      this.body.velocity.y = this.jumpVelocity;
      this.canJump = false;

      if (audio && audio.playSFX) {
        audio.playSFX("jump");
      }
    }

    // Sync the visual mesh to the physics body, compensating for the
    // sphere-center offset applied in spawn().
    this.mesh.position.set(
      this.body.position.x,
      this.body.position.y - this.radius,
      this.body.position.z,
    );

    // The animation state is DERIVED from the motion already computed
    // above: the controller never touches velocity or input, so how the
    // character is driven stays exactly the same either way.
    if (this.animation) {
      const v = this.body.velocity;

      // canJump alone isn't enough to mean "grounded": it stays true even
      // while walking off the edge of a platform, since no new collision
      // arrives to clear it. Vertical velocity resolves that case — a
      // falling body has negative y velocity.
      const grounded = this.canJump && v.y > -2;

      this.animation.update(delta, {
        speed: Math.hypot(v.x, v.z),
        verticalVelocity: v.y,
        grounded,
      });
    }
  }

  // Mario Galaxy-style movement while inside a planet's gravity field: input
  // is still camera-relative, but projected onto the tangent plane of the
  // planet's local "up" (instead of assuming up is always world +Y), and
  // jumping/the ground-sync offset work along that local up too. Kept as a
  // fully separate method rather than threading conditionals through
  // _updateFlat, so ordinary ground movement stays completely unaffected by
  // this feature.
  _updateOnPlanet(delta, input, ui, audio, camera, field) {
    const isSprinting =
      input.isPressed("shift") ||
      input.isPressed("shiftleft") ||
      input.isPressed("shiftright");
    const activeSpeed = isSprinting
      ? this.moveSpeed * this.sprintMultiplier
      : this.moveSpeed;

    const bodyPos = new THREE.Vector3(
      this.body.position.x,
      this.body.position.y,
      this.body.position.z,
    );
    const up = bodyPos.clone().sub(field.center);
    const distToCenter = up.length();
    if (distToCenter < 0.0001) up.set(0, 1, 0);
    up.normalize();

    // Robust "am I standing on the surface?" check based on actual
    // distance to the planet's center, instead of the cannon-es "collide"
    // event used on flat ground (see spawn()). The event-based approach
    // turned out unreliable here — jumping wouldn't register at all once
    // "up" had rotated away from world +Y, and the resulting instability
    // could launch the player off the surface while walking toward the
    // equator. Distance is well-defined everywhere on the sphere, so this
    // works identically no matter where on it the player is standing.
    const surfaceDist = field.radius + this.radius;
    const grounded = distToCenter <= surfaceDist + 0.35;

    const camAngle =
      camera && camera.userData && camera.userData.cameraAngleX !== undefined
        ? camera.userData.cameraAngleX
        : 0;

    const camForward = new THREE.Vector3(-Math.sin(camAngle), 0, -Math.cos(camAngle));
    const camRight = new THREE.Vector3(Math.cos(camAngle), 0, -Math.sin(camAngle));

    // Flatten the camera-relative axes onto the planet's tangent plane so
    // walking stays flush with its curved surface instead of world-flat.
    // Returns null if the camera is looking almost straight along `up`,
    // where the projection collapses to ~zero length and can't give a
    // reliable direction.
    const projectOnPlane = (v) => {
      const d = v.dot(up);
      const proj = v.clone().sub(up.clone().multiplyScalar(d));
      return proj.lengthSq() > 0.0001 ? proj.normalize() : null;
    };
    let tangentForward = projectOnPlane(camForward);
    let tangentRight = projectOnPlane(camRight);

    // BUG FIX (equator launch): camForward and camRight are always exactly
    // 90° apart, so if one is ~parallel to `up` (projection degenerates),
    // the other is automatically ~orthogonal to it — derive the missing one
    // by rotating the valid one 90° around `up` instead of falling back to
    // the raw, non-tangent camera vector. The old fallback could be up to
    // 100% radial at certain camera angles near the equator (verified
    // numerically), injecting a huge outward-velocity component into what
    // was supposed to be pure surface movement and launching the player
    // off the planet — this is what "salta all'improvviso" was.
    if (!tangentForward) tangentForward = up.clone().cross(tangentRight).normalize();
    if (!tangentRight) tangentRight = tangentForward.clone().cross(up).normalize();

    const moveVec = new THREE.Vector3();
    if (input.isPressed("w") || input.isPressed("arrowup")) moveVec.add(tangentForward);
    if (input.isPressed("s") || input.isPressed("arrowdown")) moveVec.sub(tangentForward);
    if (input.isPressed("a") || input.isPressed("arrowleft")) moveVec.sub(tangentRight);
    if (input.isPressed("d") || input.isPressed("arrowright")) moveVec.add(tangentRight);

    const moveLen = moveVec.length();
    if (moveLen > 0.0001) moveVec.normalize();

    // Split current velocity into "along up" (radial — gravity/jump, left
    // untouched here so this never fights PhysicsEngine's own pull toward
    // the planet) and "along the surface" (tangential — what player input
    // controls), same idea as the flat-ground x/z split but rotated to
    // match this planet's local up instead of assuming up = world Y.
    const vel = new THREE.Vector3(this.body.velocity.x, this.body.velocity.y, this.body.velocity.z);
    const radialVel = up.clone().multiplyScalar(vel.dot(up));
    const tangentialVel = vel.clone().sub(radialVel);

    const targetTangentialVel = moveVec.clone().multiplyScalar(activeSpeed);
    tangentialVel.add(
      targetTangentialVel.clone().sub(tangentialVel).multiplyScalar(this.control),
    );

    // Stick to the surface: while grounded, don't let any outward
    // (away-from-center) radial velocity accumulate. This is what fixes
    // the equator launch bug — without it, tiny outward drift from the
    // contact solver could compound frame over frame the further the
    // player walked from the landing point. A jump (below) explicitly sets
    // its own outward radial velocity after this, so it isn't affected.
    if (grounded && radialVel.dot(up) > 0) {
      radialVel.set(0, 0, 0);
    }

    const newVel = radialVel.add(tangentialVel);
    this.body.velocity.set(newVel.x, newVel.y, newVel.z);

    if (moveLen > 0.0001) {
      // Orient the mesh so its local +Y matches the planet's local up and it
      // faces the movement direction — the spherical-surface equivalent of
      // the flat-ground `mesh.rotation.y = targetRotation` line, but as a
      // full quaternion since "up" is no longer always world +Y. Best
      // effort: the exact facing/roll may need a small tweak once this is
      // visually verified in-browser, since it can't be checked from here.
      const right = new THREE.Vector3().crossVectors(up, moveVec).normalize();
      const forward = new THREE.Vector3().crossVectors(right, up).normalize();
      const basis = new THREE.Matrix4().makeBasis(right, up, forward);
      this.mesh.quaternion.setFromRotationMatrix(basis);
      this.mesh.rotateY(this.modelOffset || 0);
    }

    if ((input.isPressed("space") || input.isPressed(" ")) && grounded) {
      const jumpVel = new THREE.Vector3(this.body.velocity.x, this.body.velocity.y, this.body.velocity.z);
      const tangential = jumpVel.clone().sub(up.clone().multiplyScalar(jumpVel.dot(up)));
      const launched = tangential.add(up.clone().multiplyScalar(this.jumpVelocity));
      this.body.velocity.set(launched.x, launched.y, launched.z);

      if (audio && audio.playSFX) {
        audio.playSFX("jump");
      }
    }

    // Sync the mesh to the body along the local up instead of always
    // subtracting from world Y, so the model's feet stay on the planet's
    // curved surface no matter where on it the player is standing.
    const feet = bodyPos.clone().sub(up.clone().multiplyScalar(this.radius));
    this.mesh.position.copy(feet);

    // BUG FIX (missing animation on planets): _updateFlat already does this,
    // but this method never called it, so the walk/run/jump/fall cycle never
    // played while on a planet's surface. Speed/verticalVelocity are measured
    // along the LOCAL tangent/up axes instead of world X/Z/Y, since "up" can
    // point in any direction here.
    if (this.animation) {
      const finalVel = this.body.velocity;
      const radialSpeed = finalVel.x * up.x + finalVel.y * up.y + finalVel.z * up.z;
      const tangentSpeedSq =
        finalVel.x * finalVel.x + finalVel.y * finalVel.y + finalVel.z * finalVel.z -
        radialSpeed * radialSpeed;

      this.animation.update(delta, {
        speed: Math.sqrt(Math.max(tangentSpeedSq, 0)),
        verticalVelocity: radialSpeed,
        grounded,
      });
    }
  }

  // Current world position, or the origin if the character hasn't spawned yet.
  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}
