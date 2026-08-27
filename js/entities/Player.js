import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { enableShadows } from "../utils/shadows.js";
import AnimationController from "./animation/AnimationController.js";
import { COLLISION_GROUPS } from "../physics/PhysicsEngine.js";

/**
 * Player.js — the player character's movement, physics body and animation
 * state, shared by every playable character via the per-character `stats`
 * object (EntityManager). Two movement paths: _updateFlat (plain ground,
 * used everywhere) and _updateOnPlanet (Mario Galaxy-style spherical
 * gravity, only inside a planet's field — see PhysicsEngine.getActiveGravityField).
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

    // Gates the planet-mode jump SFX/bookkeeping to once per landing (see
    // _updateOnPlanet, a per-frame distance check rather than a collide event).
    this._planetJumpLatched = false;

    // Set from main.js with Yoshi.mount()/dismount(): while true, jump
    // velocity is boosted to clear the y=20 "HillClimb Yoshi" star; 1x everywhere else.
    this.mountedOnYoshi = false;
    // ~1.75x jump velocity -> ~3x jump height (v^2/2g). Clears the ~7.5-unit
    // gap from Passerella Est 3 (y≈7.5) to the Yoshi star at y=15, for either character.
    this.YOSHI_JUMP_BOOST = 1.75;
    // Purely visual seat offset while mounted; Yoshi.update()'s isRidden branch
    // runs after and has the real final say — this only avoids a one-frame glitch.
    this.MOUNT_RIDE_HEIGHT = 0.5;

    // Set from GameLevel.update() (piggybacking on Decorations' existing pond
    // detection); -20% move speed while wading, applied in _updateFlat/_updateOnPlanet.
    this.inPond = false;
    this.POND_SPEED_MULTIPLIER = 0.8;

    enableShadows(this.mesh);

    // Procedural skeletal animation; stays inert (no walk cycle, otherwise
    // unaffected) if the model has no usable skeleton (BoneMap.isUsable).
    this.animation = new AnimationController(this.mesh, {
      // Follows moveSpeed rather than a fixed number, so a faster-walking
      // character isn't stuck in the run cycle at its own walking pace.
      runSpeed: this.moveSpeed * 1.1,
    });
  }

  // Stops the mixer and resets to bind pose when swapping the active character —
  // the model is shared (AssetLoader), so a leftover pose would taint the next spawn.
  disposeAnimation() {
    if (!this.animation) return;
    this.animation.restoreBindPose();
    this.animation.dispose();
    this.animation = null;
  }

  // Places the character in the world: positions the mesh, applies the
  // model's base rotation offset, creates+registers its dynamic body and landing listener.
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

    // Excludes ENEMY (handled by scripted logic in Enemy._checkPlayerContact) and
    // YOSHI (a real collision while mounted was flinging the player through the floor).
    this.body.collisionFilterGroup = COLLISION_GROUPS.PLAYER;
    this.body.collisionFilterMask = -1 & ~COLLISION_GROUPS.ENEMY & ~COLLISION_GROUPS.YOSHI;

    // 3. Collision listener resetting the jump flag on landing. Only used
    // by _updateFlat — _updateOnPlanet uses its own distance check instead (less reliable here).
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

  // Toggled from main.js's Yoshi mount/dismount interaction (see
  // Yoshi.mount()/dismount()). See YOSHI_JUMP_BOOST above for why.
  setMountedOnYoshi(mounted) {
    this.mountedOnYoshi = !!mounted;
  }

  // Set once per frame from GameLevel.update() — see POND_SPEED_MULTIPLIER.
  setInPond(inPond) {
    this.inPond = !!inPond;
  }

  // Per-frame entry point: routes to flat-ground or planet-gravity movement
  // depending on whether the player is inside a planet's gravity field.
  update(delta, input, ui, audio, camera) {
    if (!this.mesh || !this.body) return;

    // Purely additive: everywhere in the normal level this is null and _updateFlat
    // runs unchanged; only inside a gravity field does _updateOnPlanet take over.
    const field = this.physicsEngine?.getActiveGravityField?.(this.body.position);
    if (field) {
      this._updateOnPlanet(delta, input, ui, audio, camera, field);
    } else {
      this._updateFlat(delta, input, ui, audio, camera);
    }
  }

  // Original flat-ground movement, used everywhere except inside a planet's
  // gravity field (see _updateOnPlanet).
  _updateFlat(delta, input, ui, audio, camera) {
    // BUG FIX (leftover planet tilt): _updateOnPlanet sets a full 3D quaternion for
    // curved-surface standing; force pitch/roll back to 0 so returning snaps upright.
    this.mesh.rotation.x = 0;
    this.mesh.rotation.z = 0;

    // Off any planet: forget the parallel-transported surface basis/facing so a
    // later landing starts fresh from the camera, not a stale heading.
    this._planetBasisForward = null;
    this._planetFacing = null;

    const isSprinting =
      input.isPressed("shift") ||
      input.isPressed("shiftleft") ||
      input.isPressed("shiftright");
    const pondMultiplier = this.inPond ? this.POND_SPEED_MULTIPLIER : 1;
    const activeSpeed =
      (isSprinting ? this.moveSpeed * this.sprintMultiplier : this.moveSpeed) * pondMultiplier;

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
      const jumpBoost = this.mountedOnYoshi ? this.YOSHI_JUMP_BOOST : 1;
      this.body.velocity.y = this.jumpVelocity * jumpBoost;
      this.canJump = false;

      if (audio && audio.playSFX) {
        audio.playSFX("jump");
      }
    }

    // Sync mesh to body (sphere-center offset from spawn()), plus MOUNT_RIDE_HEIGHT
    // while mounted so the rider reads as sitting on Yoshi's back rather than overlapping.
    const rideHeight = this.mountedOnYoshi ? this.MOUNT_RIDE_HEIGHT : 0;
    this.mesh.position.set(
      this.body.position.x,
      this.body.position.y - this.radius + rideHeight,
      this.body.position.z,
    );

    // Animation state is derived from the motion already computed above. While
    // mounted, the rider's legs don't animate themselves — forced to idle instead.
    if (this.animation) {
      if (this.mountedOnYoshi) {
        this.animation.update(delta, { speed: 0, verticalVelocity: 0, grounded: true });
      } else {
        const v = this.body.velocity;

        // canJump alone isn't enough to mean "grounded": it stays true while walking
        // off a platform's edge. Vertical velocity resolves that (falling is negative y).
        const grounded = this.canJump && v.y > -2;

        this.animation.update(delta, {
          speed: Math.hypot(v.x, v.z),
          verticalVelocity: v.y,
          grounded,
        });
      }
    }
  }

  // Mario Galaxy-style movement inside a planet's gravity field: input is still
  // camera-relative but projected onto the tangent plane of the planet's local "up".
  _updateOnPlanet(delta, input, ui, audio, camera, field) {
    const isSprinting =
      input.isPressed("shift") ||
      input.isPressed("shiftleft") ||
      input.isPressed("shiftright");
    const pondMultiplier = this.inPond ? this.POND_SPEED_MULTIPLIER : 1;
    const activeSpeed =
      (isSprinting ? this.moveSpeed * this.sprintMultiplier : this.moveSpeed) * pondMultiplier;

    const bodyPos = new THREE.Vector3(
      this.body.position.x,
      this.body.position.y,
      this.body.position.z,
    );
    const up = bodyPos.clone().sub(field.center);
    const distToCenter = up.length();
    if (distToCenter < 0.0001) up.set(0, 1, 0);
    up.normalize();

    // Distance-to-center "am I on the surface?" check, instead of the collide-event
    // used on flat ground — that was unreliable once `up` rotated away from world +Y.
    const surfaceDist = field.radius + this.radius;
    const grounded = distToCenter <= surfaceDist + 0.35;

    const camAngle =
      camera && camera.userData && camera.userData.cameraAngleX !== undefined
        ? camera.userData.cameraAngleX
        : 0;

    // Movement basis on the planet's surface. BUG FIX (dead band near the equator):
    // PARALLEL-TRANSPORT last frame's forward instead of rebuilding it from the camera each frame.
    let camDir = null;
    if (camera && camera.position) {
      camDir = bodyPos.clone().sub(camera.position);
      if (camDir.lengthSq() < 0.0001) camDir = null;
      else camDir.normalize();
    }
    if (!camDir) {
      camDir = new THREE.Vector3(-Math.sin(camAngle), 0, -Math.cos(camAngle));
    }

    const camTangent = camDir.clone().sub(up.clone().multiplyScalar(camDir.dot(up)));
    const camQuality = camTangent.length(); // 0 = fully radial, 1 = fully tangent

    // Parallel-transport the remembered basis onto the current tangent plane.
    let tangentForward = null;
    if (this._planetBasisForward) {
      const transported = this._planetBasisForward
        .clone()
        .sub(up.clone().multiplyScalar(this._planetBasisForward.dot(up)));
      if (transported.lengthSq() > 0.000001) tangentForward = transported.normalize();
    }

    // Steer it toward the camera, proportionally to how trustworthy the
    // camera's own projection currently is (frame-rate independent).
    if (camQuality > 0.25) {
      const camForwardTangent = camTangent.clone().normalize();
      if (!tangentForward) {
        tangentForward = camForwardTangent;
      } else {
        const trust = Math.min(1, (camQuality - 0.25) / 0.35);
        // Kept below CameraManager's own planet follow rate — camera and heading form
        // a loop here, so damping this end turns "hold A and spin" into a gentle curve.
        const blend = trust * (1 - Math.exp(-3.5 * Math.max(delta, 0)));
        const steered = tangentForward.clone().lerp(camForwardTangent, blend);
        // lerp between two nearly opposite vectors can collapse to ~zero — snap to
        // the camera's direction rather than normalizing noise into a random heading.
        tangentForward = steered.lengthSq() > 0.0001
          ? steered.normalize()
          : camForwardTangent;
      }
    }

    // Very first frame on this planet with a fully degenerate camera: any
    // vector perpendicular to `up` will do as a starting heading.
    if (!tangentForward) {
      const seed = Math.abs(up.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      tangentForward = seed.cross(up).normalize();
    }

    this._planetBasisForward = tangentForward.clone();

    // Same handedness as the old flat-ground pair: on flat ground
    // (up = world +Y) forward x up reproduces camRight exactly.
    const tangentRight = tangentForward.clone().cross(up).normalize();

    const moveVec = new THREE.Vector3();
    if (input.isPressed("w") || input.isPressed("arrowup")) moveVec.add(tangentForward);
    if (input.isPressed("s") || input.isPressed("arrowdown")) moveVec.sub(tangentForward);
    if (input.isPressed("a") || input.isPressed("arrowleft")) moveVec.sub(tangentRight);
    if (input.isPressed("d") || input.isPressed("arrowright")) moveVec.add(tangentRight);

    const moveLen = moveVec.length();
    if (moveLen > 0.0001) moveVec.normalize();

    // Split velocity into radial (along up — gravity/jump, left untouched so this
    // never fights PhysicsEngine's pull) and tangential (what input controls).
    const vel = new THREE.Vector3(this.body.velocity.x, this.body.velocity.y, this.body.velocity.z);
    const radialVel = up.clone().multiplyScalar(vel.dot(up));
    const tangentialVel = vel.clone().sub(radialVel);

    const targetTangentialVel = moveVec.clone().multiplyScalar(activeSpeed);
    tangentialVel.add(
      targetTangentialVel.clone().sub(tangentialVel).multiplyScalar(this.control),
    );

    // Stick to the surface: while grounded, zero any outward radial velocity before it
    // can accumulate — fixes an equator "launch" bug from tiny drift compounding frame over frame.
    if (grounded && radialVel.dot(up) > 0) {
      radialVel.set(0, 0, 0);
    }

    const newVel = radialVel.add(tangentialVel);
    this.body.velocity.set(newVel.x, newVel.y, newVel.z);

    // Orients the mesh so local +Y matches the planet's up and it faces the travel
    // direction — a full quaternion, SLERPed rather than snapped to avoid twitching.
    if (moveLen > 0.0001) {
      this._planetFacing = moveVec.clone();
    }
    if (!this._planetFacing) {
      this._planetFacing = tangentForward.clone();
    }

    // Re-project the remembered facing onto the CURRENT tangent plane —
    // after walking a while, the plane has rotated out from under it.
    let facing = this._planetFacing
      .clone()
      .sub(up.clone().multiplyScalar(this._planetFacing.dot(up)));
    if (facing.lengthSq() < 0.0001) {
      facing = tangentForward.clone();
    }
    facing.normalize();
    this._planetFacing = facing.clone();

    const right = new THREE.Vector3().crossVectors(up, facing).normalize();
    const forward = new THREE.Vector3().crossVectors(right, up).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, up, forward);

    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(basis);
    // Same model-forward correction as the flat-ground `modelOffset`, expressed as a
    // rotation about the model's own up axis so it composes with any planet orientation.
    targetQuat.multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        this.modelOffset || 0,
      ),
    );

    const smoothing = 1 - Math.exp(-12 * Math.max(delta, 0));
    this.mesh.quaternion.slerp(targetQuat, smoothing);

    // BUG FIX (double jump SFX on the red planet): `grounded` stays true briefly
    // after a jump, so _planetJumpLatched gates the SFX to once per landing.
    if (!grounded) {
      this._planetJumpLatched = false;
    }

    if ((input.isPressed("space") || input.isPressed(" ")) && grounded) {
      const jumpBoost = this.mountedOnYoshi ? this.YOSHI_JUMP_BOOST : 1;
      const jumpVel = new THREE.Vector3(this.body.velocity.x, this.body.velocity.y, this.body.velocity.z);
      const tangential = jumpVel.clone().sub(up.clone().multiplyScalar(jumpVel.dot(up)));
      const launched = tangential.add(up.clone().multiplyScalar(this.jumpVelocity * jumpBoost));
      this.body.velocity.set(launched.x, launched.y, launched.z);

      if (!this._planetJumpLatched) {
        this._planetJumpLatched = true;
        if (audio && audio.playSFX) {
          audio.playSFX("jump");
        }
      }
    }

    // Sync mesh to body along the local up (feet stay on the curved
    // surface anywhere on it) plus the same MOUNT_RIDE_HEIGHT tweak as _updateFlat.
    const rideHeight = this.mountedOnYoshi ? this.MOUNT_RIDE_HEIGHT : 0;
    const feet = bodyPos
      .clone()
      .sub(up.clone().multiplyScalar(this.radius - rideHeight));
    this.mesh.position.copy(feet);

    // BUG FIX (missing animation on planets): _updateFlat already drove this; this
    // method didn't. Speed/verticalVelocity are measured along local tangent/up axes.
    if (this.animation) {
      if (this.mountedOnYoshi) {
        // Same reasoning as _updateFlat: legs stay in their idle pose while
        // Yoshi is doing the moving.
        this.animation.update(delta, { speed: 0, verticalVelocity: 0, grounded: true });
      } else {
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
  }

  // Current world position, or the origin if the character hasn't spawned yet.
  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}
