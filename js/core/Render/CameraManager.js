import * as THREE from "three";

/**
 * Third-person follow camera.
 *
 * Two modes, picked per frame the same way Player.update picks between its
 * two movement paths (see Player._updateFlat / _updateOnPlanet):
 *
 *  - FLAT (everywhere in the level): orbits around the world Y axis at a
 *    fixed world-up orientation. Unchanged from the original camera.
 *  - PLANET (inside a GravityField, i.e. on the red sky planet): orbits
 *    around the planet's LOCAL up instead, and keeps itself parked behind
 *    the character's shoulders no matter where on the sphere they are —
 *    including upside down, since camera.up is re-aimed at the local up so
 *    the horizon never flips.
 */
export default class CameraManager {
  constructor(camera) {
    this.camera = camera;

    this.cameraAngleX = 0;
    this.cameraAngleY = Math.PI / 6;
    this.camRotationSpeed = 2.0;
    this.camDistance = 12;

    // 🐉 Riducessimo la velocità di auto-follow per evitare strattoni geometrici
    this.autoFollowSpeed = 1.2;

    // --- PLANET mode rig (see _updateOnPlanet) ---------------------------
    // Fixed framing, deliberately NOT the orbital camDistance/cameraAngleY:
    // up there the camera is locked behind the character (no free orbit),
    // so it needs a single framing that reads the same everywhere on the
    // sphere. Slightly closer and much lower than the flat camera, which
    // is what keeps the planet's horizon in shot instead of aiming down at
    // the ground.
    this.planetDistance = 11;
    this.planetPitch = 0.22;

    // Auto-follow rate for PLANET mode. Much higher than the flat one —
    // the request is a rigid over-the-shoulder lock, and up there the
    // camera is also the horizon reference (see _updateOnPlanet's
    // camera.up), so any noticeable lag reads as the whole world drifting
    // rather than as a lazy camera.
    this.planetFollowSpeed = 8.0;

    // PLANET mode state: the direction (world space, tangent to the
    // planet's surface) pointing from the character TOWARD the camera —
    // i.e. "behind them". Carried across frames and parallel-transported
    // onto each new tangent plane, exactly like Player's own movement basis
    // (see Player._updateOnPlanet), so walking around the sphere rotates it
    // smoothly instead of it being rebuilt from scratch and jumping.
    // Reset to null while off any planet.
    this._planetCamDir = null;
  }

  update(player, inputManager, delta) {
    if (!player || !player.mesh || !inputManager) return;

    // Same "am I on a planet?" test Player.update uses, so the two can
    // never disagree about which mode is active.
    const field = player.physicsEngine?.getActiveGravityField?.(
      player.body?.position || player.mesh.position,
    );

    if (field) {
      this._updateOnPlanet(player, inputManager, delta, field);
    } else {
      this._updateFlat(player, inputManager, delta);
    }
  }

  // Original world-up orbit camera — untouched behavior.
  _updateFlat(player, inputManager, delta) {
    // Undo anything _updateOnPlanet may have left behind, so coming back
    // from a planet doesn't keep the view tilted.
    this.camera.up.set(0, 1, 0);
    this._planetCamDir = null;

    const playerPos = player.mesh.position;
    const playerRotY = player.currentFacingAngle || 0;

    let isManualControl = false;

    if (inputManager.isPressed("j")) { this.cameraAngleX -= this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("l")) { this.cameraAngleX += this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("i")) { this.cameraAngleY -= this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("k")) { this.cameraAngleY += this.camRotationSpeed * delta; isManualControl = true; }

    // Controllo movimento
    const isMoving =
        inputManager.isPressed("w") || inputManager.isPressed("arrowup") ||
        inputManager.isPressed("a") || inputManager.isPressed("arrowleft") ||
        inputManager.isPressed("d") || inputManager.isPressed("arrowright") ||
        inputManager.isPressed("s") || inputManager.isPressed("arrowdown");

    const isPressingBack = inputManager.isPressed("s") || inputManager.isPressed("arrowdown");

    // Auto-allineamento fluido solo se ci si muove in avanti o di lato (escludendo la retromarcia)
    if (isMoving && !isPressingBack && !isManualControl) {
        const targetAngleX = playerRotY + Math.PI;
        let diff = targetAngleX - this.cameraAngleX;

        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

        // Interpolazione morbida
        this.cameraAngleX += diff * this.autoFollowSpeed * delta;
    }

    this.cameraAngleY = this._clampPitch(this.cameraAngleY);

    const offsetX = this.camDistance * Math.sin(this.cameraAngleX) * Math.cos(this.cameraAngleY);
    const offsetY = this.camDistance * Math.sin(this.cameraAngleY);
    const offsetZ = this.camDistance * Math.cos(this.cameraAngleX) * Math.cos(this.cameraAngleY);

    this.camera.position.set(
      playerPos.x + offsetX,
      playerPos.y + offsetY,
      playerPos.z + offsetZ
    );

    this.camera.lookAt(playerPos.x, playerPos.y + 1.5, playerPos.z);

    // Esportiamo l'angolo pulito
    this.camera.userData.cameraAngleX = this.cameraAngleX;
  }

  // Shared pitch clamp: keeps the camera from going under the ground or
  // straight overhead, in both modes.
  _clampPitch(angleY) {
    const minAngleY = 0.1;
    const maxAngleY = Math.PI / 2.3;
    return Math.max(minAngleY, Math.min(maxAngleY, angleY));
  }

  /**
   * Follow camera on a walkable planet.
   *
   * The flat camera can't work here: it orbits around world Y and holds
   * world up, so once the character walks past the planet's equator the
   * view ends up sideways and then upside down, and "behind them" stops
   * meaning anything in world-Y terms. This builds the same over-the-
   * shoulder framing in the planet's LOCAL frame instead:
   *
   *   position = player + behind * (d * cos(pitch)) + localUp * (d * sin(pitch))
   *
   * where `behind` is a unit vector tangent to the surface. Because every
   * term is expressed in the local frame, the framing is identical on the
   * top of the planet, on its side and on its underside.
   *
   * `behind` is carried across frames and parallel-transported (its
   * component along the new up is removed, then renormalized) rather than
   * recomputed — on a sphere that's exactly "keep trailing along the same
   * great circle", which is what makes walking around feel continuous
   * instead of the camera snapping every time the surface curves away.
   *
   * The auto-follow is gated exactly like the flat one — it only re-aims
   * while moving, not while reversing, and not while the player is
   * steering with J/L — which is what keeps this from fighting Player's
   * own movement basis (that basis is in turn steered by where the camera
   * is, so an ungated follow would let the two chase each other).
   */
  _updateOnPlanet(player, inputManager, delta, field) {
    const playerPos = player.mesh.position;

    const center = new THREE.Vector3(field.center.x, field.center.y, field.center.z);
    const up = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z).sub(center);
    if (up.lengthSq() < 0.000001) up.set(0, 1, 0);
    up.normalize();

    // Parallel-transport the remembered "behind" direction onto the
    // current tangent plane.
    let behind = null;
    if (this._planetCamDir) {
      const transported = this._planetCamDir
        .clone()
        .sub(up.clone().multiplyScalar(this._planetCamDir.dot(up)));
      if (transported.lengthSq() > 0.000001) behind = transported.normalize();
    }

    // The character's own heading on the surface, maintained by
    // Player._updateOnPlanet. "Behind the shoulders" is the opposite of it.
    const facing = player._planetFacing || player._planetBasisForward || null;
    let targetBehind = null;
    if (facing) {
      const t = facing.clone().sub(up.clone().multiplyScalar(facing.dot(up)));
      if (t.lengthSq() > 0.000001) targetBehind = t.normalize().negate();
    }

    // First frame on the planet: start already parked behind them rather
    // than swinging into place from wherever the flat camera left off.
    if (!behind) {
      behind = targetBehind
        ? targetBehind.clone()
        : (Math.abs(up.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0)).cross(up).normalize();
    }

    // NOTE: J/L/I/K are deliberately ignored in this mode — the planet
    // camera is a locked over-the-shoulder rig, not a free orbit. They keep
    // working normally the moment the player is back on flat ground (see
    // _updateFlat), and this.cameraAngleY is left untouched here so
    // whatever pitch they had set down there is still waiting for them.

    const isMoving =
      inputManager.isPressed("w") || inputManager.isPressed("arrowup") ||
      inputManager.isPressed("a") || inputManager.isPressed("arrowleft") ||
      inputManager.isPressed("d") || inputManager.isPressed("arrowright") ||
      inputManager.isPressed("s") || inputManager.isPressed("arrowdown");

    const isPressingBack = inputManager.isPressed("s") || inputManager.isPressed("arrowdown");

    if (targetBehind && isMoving && !isPressingBack) {
      // Rotate toward the target around `up` by a bounded step, rather than
      // lerping the vectors: a straight lerp collapses to ~zero when the
      // two are nearly opposite (a 180° turn), which would send the camera
      // through a random heading at exactly the worst moment.
      const cos = Math.max(-1, Math.min(1, behind.dot(targetBehind)));
      let angle = Math.acos(cos);

      if (angle > 0.0001) {
        // Signed: which way around `up` is the shorter turn.
        const sign = up.dot(new THREE.Vector3().crossVectors(behind, targetBehind)) < 0 ? -1 : 1;
        const step = Math.min(angle, this.planetFollowSpeed * delta * Math.max(angle, 0.4));
        behind.applyAxisAngle(up, sign * step).normalize();
      }
    }

    // Re-orthogonalize against `up` once more before use: the rotations
    // above are exact, but accumulated float error over a long walk isn't.
    behind.sub(up.clone().multiplyScalar(behind.dot(up)));
    if (behind.lengthSq() < 0.000001) {
      behind = (Math.abs(up.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0)).cross(up).normalize();
    } else {
      behind.normalize();
    }

    this._planetCamDir = behind.clone();

    // Fixed rig, not the orbital pitch: a locked camera needs a framing
    // that's the same every time you arrive, and a low angle is what lets
    // the planet's horizon stay in shot as you walk over the curve.
    const camPos = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z)
      .add(behind.clone().multiplyScalar(this.planetDistance * Math.cos(this.planetPitch)))
      .add(up.clone().multiplyScalar(this.planetDistance * Math.sin(this.planetPitch)));

    this.camera.position.copy(camPos);

    // Critical on a sphere: lookAt() resolves the roll from camera.up, so
    // leaving it at world +Y would tip the view over as soon as the local
    // up rotated away from it — and flip it outright on the underside.
    this.camera.up.copy(up);

    // Aimed a little above the character's head rather than at it, which
    // tilts the frame up toward the horizon (the framing in the reference
    // screenshot) instead of staring down at the ground in front of him.
    const lookTarget = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z)
      .add(up.clone().multiplyScalar(2.4));
    this.camera.lookAt(lookTarget);

    // Player._updateOnPlanet prefers the real camera position over this
    // angle (see its movement-basis comment), but the flat path and the
    // fallback there still read it — keep it roughly meaningful by
    // deriving it from where the camera actually ended up, so switching
    // back to flat ground doesn't snap the view.
    const flatBehindX = camPos.x - playerPos.x;
    const flatBehindZ = camPos.z - playerPos.z;
    if (Math.abs(flatBehindX) > 0.0001 || Math.abs(flatBehindZ) > 0.0001) {
      this.cameraAngleX = Math.atan2(flatBehindX, flatBehindZ);
    }
    this.camera.userData.cameraAngleX = this.cameraAngleX;
  }
}