import * as THREE from "three";

/**
 * Third-person follow camera, two modes picked per frame like Player's
 * own two movement paths: FLAT orbits world Y with a fixed world-up;
 * PLANET (inside a GravityField) orbits the planet's LOCAL up instead,
 * staying parked behind the character's shoulders anywhere on the sphere.
 */
export default class CameraManager {
  constructor(camera) {
    this.camera = camera;

    this.cameraAngleX = 0;
    this.cameraAngleY = Math.PI / 6;
    this.camRotationSpeed = 2.0;
    this.camDistance = 12;
    this.autoFollowSpeed = 1.2;

    // PLANET mode rig (see _updateOnPlanet): fixed framing, not the
    // orbital camDistance/cameraAngleY, since it's locked behind the character.
    this.planetDistance = 11;
    this.planetPitch = 0.22;

    // Much higher than the flat follow rate: up there the camera is also
    // the horizon reference, so any lag reads as the world drifting.
    this.planetFollowSpeed = 8.0;

    // World-space, tangent-to-surface direction from character toward
    // camera ("behind them"), parallel-transported like Player's own basis.
    this._planetCamDir = null;
  }

  update(player, inputManager, delta) {
    if (!player || !player.mesh || !inputManager) return;

    // Same "am I on a planet?" test Player.update uses, so the two agree.
    const field = player.physicsEngine?.getActiveGravityField?.(
      player.body?.position || player.mesh.position,
    );

    if (field) {
      this._updateOnPlanet(player, inputManager, delta, field);
    } else {
      this._updateFlat(player, inputManager, delta);
    }
  }

  // Original world-up orbit camera — unchanged behavior.
  _updateFlat(player, inputManager, delta) {
    // Undo anything _updateOnPlanet left behind.
    this.camera.up.set(0, 1, 0);
    this._planetCamDir = null;

    const playerPos = player.mesh.position;
    const playerRotY = player.currentFacingAngle || 0;

    let isManualControl = false;

    if (inputManager.isPressed("j")) { this.cameraAngleX -= this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("l")) { this.cameraAngleX += this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("i")) { this.cameraAngleY -= this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("k")) { this.cameraAngleY += this.camRotationSpeed * delta; isManualControl = true; }

    const isMoving =
        inputManager.isPressed("w") || inputManager.isPressed("arrowup") ||
        inputManager.isPressed("a") || inputManager.isPressed("arrowleft") ||
        inputManager.isPressed("d") || inputManager.isPressed("arrowright") ||
        inputManager.isPressed("s") || inputManager.isPressed("arrowdown");

    const isPressingBack = inputManager.isPressed("s") || inputManager.isPressed("arrowdown");

    // Auto-align only while moving forward/sideways, never in reverse or
    // while manually steering with I/J/K/L.
    if (isMoving && !isPressingBack && !isManualControl) {
        const targetAngleX = playerRotY + Math.PI;
        let diff = targetAngleX - this.cameraAngleX;

        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

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

    this.camera.userData.cameraAngleX = this.cameraAngleX;
  }

  // Shared pitch clamp: keeps the camera above ground and below overhead.
  _clampPitch(angleY) {
    const minAngleY = 0.1;
    const maxAngleY = Math.PI / 2.3;
    return Math.max(minAngleY, Math.min(maxAngleY, angleY));
  }

  /**
   * Follow camera on a walkable planet: the flat camera can't work here, so
   * this rebuilds the same over-the-shoulder framing in the planet's LOCAL frame.
   */
  _updateOnPlanet(player, inputManager, delta, field) {
    const playerPos = player.mesh.position;

    const center = new THREE.Vector3(field.center.x, field.center.y, field.center.z);
    const up = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z).sub(center);
    if (up.lengthSq() < 0.000001) up.set(0, 1, 0);
    up.normalize();

    // Parallel-transport the remembered "behind" onto the current tangent plane.
    let behind = null;
    if (this._planetCamDir) {
      const transported = this._planetCamDir
        .clone()
        .sub(up.clone().multiplyScalar(this._planetCamDir.dot(up)));
      if (transported.lengthSq() > 0.000001) behind = transported.normalize();
    }

    // Character's own surface heading (Player._updateOnPlanet); "behind
    // the shoulders" is its opposite.
    const facing = player._planetFacing || player._planetBasisForward || null;
    let targetBehind = null;
    if (facing) {
      const t = facing.clone().sub(up.clone().multiplyScalar(facing.dot(up)));
      if (t.lengthSq() > 0.000001) targetBehind = t.normalize().negate();
    }

    // First frame on the planet: start already parked behind them.
    if (!behind) {
      behind = targetBehind
        ? targetBehind.clone()
        : (Math.abs(up.y) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0)).cross(up).normalize();
    }

    // J/L/I/K are ignored here — this is a locked rig, not a free orbit.
    // cameraAngleY is left untouched for when the player returns to flat ground.

    const isMoving =
      inputManager.isPressed("w") || inputManager.isPressed("arrowup") ||
      inputManager.isPressed("a") || inputManager.isPressed("arrowleft") ||
      inputManager.isPressed("d") || inputManager.isPressed("arrowright") ||
      inputManager.isPressed("s") || inputManager.isPressed("arrowdown");

    const isPressingBack = inputManager.isPressed("s") || inputManager.isPressed("arrowdown");

    if (targetBehind && isMoving && !isPressingBack) {
      // Rotate toward the target around `up` by a bounded step rather
      // than lerping: a straight lerp collapses near-zero on a ~180° turn.
      const cos = Math.max(-1, Math.min(1, behind.dot(targetBehind)));
      let angle = Math.acos(cos);

      if (angle > 0.0001) {
        const sign = up.dot(new THREE.Vector3().crossVectors(behind, targetBehind)) < 0 ? -1 : 1;
        const step = Math.min(angle, this.planetFollowSpeed * delta * Math.max(angle, 0.4));
        behind.applyAxisAngle(up, sign * step).normalize();
      }
    }

    // Re-orthogonalize against `up`: exact rotations, but float error
    // accumulates over a long walk.
    behind.sub(up.clone().multiplyScalar(behind.dot(up)));
    if (behind.lengthSq() < 0.000001) {
      behind = (Math.abs(up.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0)).cross(up).normalize();
    } else {
      behind.normalize();
    }

    this._planetCamDir = behind.clone();

    // Fixed low-angle rig keeps the planet's horizon in shot.
    const camPos = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z)
      .add(behind.clone().multiplyScalar(this.planetDistance * Math.cos(this.planetPitch)))
      .add(up.clone().multiplyScalar(this.planetDistance * Math.sin(this.planetPitch)));

    this.camera.position.copy(camPos);

    // lookAt() resolves roll from camera.up — leaving it at world +Y
    // would tip/flip the view as the local up rotates away from it.
    this.camera.up.copy(up);

    // Aimed above the character's head, tilting toward the horizon
    // instead of staring down at the ground.
    const lookTarget = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z)
      .add(up.clone().multiplyScalar(2.4));
    this.camera.lookAt(lookTarget);

    // Derived from where the camera ended up, so the flat fallback path
    // doesn't snap when switching back to flat ground.
    const flatBehindX = camPos.x - playerPos.x;
    const flatBehindZ = camPos.z - playerPos.z;
    if (Math.abs(flatBehindX) > 0.0001 || Math.abs(flatBehindZ) > 0.0001) {
      this.cameraAngleX = Math.atan2(flatBehindX, flatBehindZ);
    }
    this.camera.userData.cameraAngleX = this.cameraAngleX;
  }
}
