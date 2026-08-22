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

    // Jump SFX debounce for _updateOnPlanet only (see there) — flat-ground
    // jumping already gets a real one-shot via the "collide" event
    // resetting canJump (see spawn()), but on a planet `grounded` is a
    // continuous per-frame distance check with a tolerance margin, not an
    // event, and the jump velocity there legitimately needs to keep
    // re-applying itself every frame the key is held to actually clear
    // that tolerance zone. This flag gates only the SFX/bookkeeping to
    // once per landing, not the velocity application itself.
    this._planetJumpLatched = false;

    // Set from main.js alongside Yoshi.mount()/dismount() (see the "Premi
    // E" mount interaction) — while true, jump velocity is boosted so the
    // player can clear the y=20 bonus star on "HillClimb Yoshi" that a
    // normal jump can't reach. Everywhere else this is simply 1x, so
    // movement is byte-for-byte unchanged off of Yoshi.
    this.mountedOnYoshi = false;
    // ~1.75x jump velocity -> roughly 1.75x^2 (~3x) jump HEIGHT (v^2/2g).
    // Chosen so a jump from the top of "Passerella Est 3" (around y=7.5)
    // comfortably clears the HillClimb Yoshi star at y=15 (a ~7.5-unit gap,
    // out of reach of either character's normal jump) for both Mario and
    // Luigi's own jumpVelocity, with margin to spare.
    this.YOSHI_JUMP_BOOST = 1.75;
    // Purely visual: while mounted, the rider's own mesh sits this much
    // above (positive) or below (negative) YOSHI's own resulting height —
    // read and applied by Yoshi.update()'s isRidden branch, which is what
    // actually has the final say on the rider's mesh position while
    // mounted (it runs after this class's own mesh sync each frame — see
    // EntityManager.update's call order — and overwrites it). The
    // mesh-sync lines below in _updateFlat/_updateOnPlanet still apply it
    // too, but that's immediately superseded once mounted; kept only so
    // nothing looks wrong for the one frame between mounting and Yoshi's
    // own update running. Ground contact itself is never derived from this
    // value — see Yoshi.js's own comment for why.
    this.MOUNT_RIDE_HEIGHT = 0.5;

    enableShadows(this.mesh);

    // Procedural skeletal animation. If the model has no recognizable
    // skeleton (BoneMap.isUsable === false) the controller stays inert: the
    // character still moves exactly as before, just without a walk cycle.
    this.animation = new AnimationController(this.mesh, {
      // The run threshold FOLLOWS the character's own speed rather than
      // being a fixed number, so a character who walks faster than another
      // one runs can't end up stuck in the run cycle at walking pace. This
      // margin above moveSpeed keeps normal pace a walk and only sprinting
      // (sprintMultiplier, 1.5x) a run.
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
    // jump-force accumulation on Bowser's stomp bounce. Also excludes YOSHI
    // for the same reason (see COLLISION_GROUPS.YOSHI's own comment) — a
    // real collision between the two while mounted is what was flinging the
    // player through the floor the instant Yoshi was mounted.
    this.body.collisionFilterGroup = COLLISION_GROUPS.PLAYER;
    this.body.collisionFilterMask = -1 & ~COLLISION_GROUPS.ENEMY & ~COLLISION_GROUPS.YOSHI;

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

  // Toggled from main.js's Yoshi mount/dismount interaction (see
  // Yoshi.mount()/dismount()). See YOSHI_JUMP_BOOST above for why.
  setMountedOnYoshi(mounted) {
    this.mountedOnYoshi = !!mounted;
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

    // Off any planet: forget the parallel-transported surface basis and
    // facing (see _updateOnPlanet). Landing on a planet later should start
    // its heading fresh from wherever the camera is then, not from a stale
    // one carried over from the last visit — and CameraManager's planet rig
    // reads these two fields directly, so it needs the same reset.
    this._planetBasisForward = null;
    this._planetFacing = null;

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
      const jumpBoost = this.mountedOnYoshi ? this.YOSHI_JUMP_BOOST : 1;
      this.body.velocity.y = this.jumpVelocity * jumpBoost;
      this.canJump = false;

      if (audio && audio.playSFX) {
        audio.playSFX("jump");
      }
    }

    // Sync the visual mesh to the physics body, compensating for the
    // sphere-center offset applied in spawn() — plus, while mounted on
    // Yoshi, the MOUNT_RIDE_HEIGHT tweak above so the rider reads as
    // actually sitting on Yoshi's back instead of overlapping him exactly
    // (see MOUNT_RIDE_HEIGHT's own comment; Yoshi.js follows the player's
    // UNOFFSET body position instead of this mesh, so the two don't
    // compound).
    const rideHeight = this.mountedOnYoshi ? this.MOUNT_RIDE_HEIGHT : 0;
    this.mesh.position.set(
      this.body.position.x,
      this.body.position.y - this.radius + rideHeight,
      this.body.position.z,
    );

    // The animation state is DERIVED from the motion already computed
    // above: the controller never touches velocity or input, so how the
    // character is driven stays exactly the same either way. EXCEPT while
    // mounted on Yoshi: the rider's legs don't walk/run themselves anymore
    // (Yoshi carries him), so speed is forced to 0 and grounded to true —
    // the legs stay in their idle pose instead of cycling a walk/run
    // animation while the two of them move.
    if (this.animation) {
      if (this.mountedOnYoshi) {
        this.animation.update(delta, { speed: 0, verticalVelocity: 0, grounded: true });
      } else {
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

    // ---- Movement basis on the planet's surface -------------------------
    //
    // BUG FIX ("Mario fatica ad andare più sotto" / dead band partway down
    // the planet): this used to rebuild the WASD basis every frame from
    // scratch by projecting the camera's purely HORIZONTAL forward vector
    // (derived from cameraAngleX) onto the tangent plane.
    //
    // The flat-ground camera orbits strictly around world Y and always
    // keeps world up, so that camera-forward vector is always horizontal in
    // world space. Near the planet's top pole `up` is world +Y, perpendicular
    // to it, and the projection is perfectly conditioned. But walking DOWN
    // toward the equator rotates `up` into the horizontal plane too, and
    // once the camera happens to sit roughly along that radial direction —
    // exactly what happens when it's trailing behind Mario as he walks
    // downward — camera-forward becomes nearly PARALLEL to `up`. The
    // projection then collapses toward zero, the old null-fallback swapped
    // in a 90°-rotated axis instead, and W/S stopped meaning "keep going
    // down": that dead band, and the direction flipping through it, is why
    // he only got past it by jumping and jiggling.
    //
    // The fix is to stop rebuilding the basis from scratch each frame.
    // Instead it's PARALLEL-TRANSPORTED: last frame's forward is
    // re-projected onto this frame's tangent plane, which on a sphere is
    // exactly "keep heading along the same great circle". That is always
    // well-defined, has no dead band anywhere on the sphere, and means
    // holding S walks a clean meridian right around the planet without the
    // orientation ever resetting under you.
    //
    // The camera still steers it, just gradually and only while its own
    // projection is well conditioned (`camQuality`, the sine of the angle
    // between the camera direction and `up`) — so turning the camera with
    // J/L re-aims WASD as before, while the degenerate band simply
    // contributes nothing instead of injecting a bogus direction.
    //
    // The camera direction itself is taken from the real camera position
    // (camera -> player) rather than from cameraAngleX: it carries the
    // camera's own height offset, so it stays usable across a much wider
    // band than the purely horizontal version did.
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
    // camera's own projection currently is. Frame-rate independent.
    if (camQuality > 0.25) {
      const camForwardTangent = camTangent.clone().normalize();
      if (!tangentForward) {
        tangentForward = camForwardTangent;
      } else {
        const trust = Math.min(1, (camQuality - 0.25) / 0.35);
        // Rate deliberately kept well BELOW CameraManager's own planet
        // follow rate — the two form a loop up there (the camera locks
        // behind the character's heading, and the heading comes from this
        // basis, which is steered by the camera), so the loop's turn rate
        // is set by whichever end is slower. Damping this end is what
        // turns "hold A and spin on the spot" into a gentle curve.
        const blend = trust * (1 - Math.exp(-3.5 * Math.max(delta, 0)));
        const steered = tangentForward.clone().lerp(camForwardTangent, blend);
        // lerp between two nearly opposite vectors can collapse to ~zero —
        // in that case snap to the camera's direction rather than
        // normalizing numerical noise into a random heading.
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

    // Orient the mesh so its local +Y matches the planet's local up and it
    // faces the direction of travel — the spherical-surface equivalent of
    // the flat-ground `mesh.rotation.y = targetRotation` line, but as a
    // full quaternion since "up" is no longer always world +Y.
    //
    // Two changes over a plain "only rotate while moving, snap instantly"
    // version:
    //  - it runs EVERY frame, not only while moving. Re-orienting only on
    //    input leaves the model frozen at the up-vector of wherever it last
    //    walked while standing still (or being carried), which on a sphere
    //    means visibly leaning over. `_planetFacing` remembers the last
    //    real direction of travel so the facing itself stays put while
    //    idle — only the up-alignment keeps updating.
    //  - it SLERPS toward the target instead of snapping to it. The up
    //    vector rotates continuously as the player walks around the
    //    sphere, and snapping to it every frame made the model twitch
    //    along with every small correction the physics step applied to the
    //    body's position. The smoothing is frame-rate independent
    //    (exponential) and fast enough (~12/s) to still feel immediate.
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
    // Same model-forward correction as the flat-ground `modelOffset`,
    // expressed as a rotation about the model's OWN up axis so it composes
    // correctly with an arbitrary planet orientation.
    targetQuat.multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        this.modelOffset || 0,
      ),
    );

    const smoothing = 1 - Math.exp(-12 * Math.max(delta, 0));
    this.mesh.quaternion.slerp(targetQuat, smoothing);

    // BUG FIX (double jump SFX on the red planet), take 2: `grounded` above
    // stays true for a frame or more after a jump starts (it's a
    // tolerance-padded distance check, not a landing event), so the launch
    // below legitimately NEEDS to keep re-applying itself every one of
    // those frames while the key is held — the "stick to surface" block
    // earlier in this method zeroes any outward radial velocity while
    // `grounded` reads true, so a single one-shot launch gets canceled
    // again before the player has actually cleared the tolerance zone, and
    // with the launch gated to one-shot too that cancellation was never
    // re-applied — this was the "press space, one sound, then can never
    // jump again" regression from gating the whole block instead of just
    // the sound. So: velocity keeps launching every grounded+held frame
    // exactly as before (that repetition is what lets the player actually
    // escape the tolerance zone over 2-3 frames), but `_planetJumpLatched`
    // now gates ONLY the SFX/bookkeeping to once per landing, cleared only
    // once the player has actually left the surface (grounded goes false).
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

    // Sync the mesh to the body along the local up instead of always
    // subtracting from world Y, so the model's feet stay on the planet's
    // curved surface no matter where on it the player is standing — plus
    // the same MOUNT_RIDE_HEIGHT tweak while mounted on Yoshi as
    // _updateFlat.
    const rideHeight = this.mountedOnYoshi ? this.MOUNT_RIDE_HEIGHT : 0;
    const feet = bodyPos
      .clone()
      .sub(up.clone().multiplyScalar(this.radius - rideHeight));
    this.mesh.position.copy(feet);

    // BUG FIX (missing animation on planets): _updateFlat already does this,
    // but this method never called it, so the walk/run/jump/fall cycle never
    // played while on a planet's surface. Speed/verticalVelocity are measured
    // along the LOCAL tangent/up axes instead of world X/Z/Y, since "up" can
    // point in any direction here.
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
