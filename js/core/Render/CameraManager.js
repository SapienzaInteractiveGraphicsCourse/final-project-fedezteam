export default class CameraManager {
  constructor(camera) {
    this.camera = camera;

    this.cameraAngleX = 0;
    this.cameraAngleY = Math.PI / 6;
    this.camRotationSpeed = 2.0;
    this.camDistance = 12;

    // Auto-follow speed is kept low to avoid abrupt, jarring rotations
    // when the camera realigns itself behind the player.
    this.autoFollowSpeed = 1.2;
  }

  update(player, inputManager, delta) {
    if (!player || !player.mesh || !inputManager) return;

    const playerPos = player.mesh.position;
    const playerRotY = player.currentFacingAngle || 0;

    let isManualControl = false;

    // Manual orbit controls (i/j/k/l): horizontal (j/l) and vertical (i/k).
    if (inputManager.isPressed("j")) { this.cameraAngleX -= this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("l")) { this.cameraAngleX += this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("i")) { this.cameraAngleY -= this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("k")) { this.cameraAngleY += this.camRotationSpeed * delta; isManualControl = true; }

    // Detect whether the player is currently pressing a movement key.
    const isMoving =
        inputManager.isPressed("w") || inputManager.isPressed("arrowup") ||
        inputManager.isPressed("a") || inputManager.isPressed("arrowleft") ||
        inputManager.isPressed("d") || inputManager.isPressed("arrowright") ||
        inputManager.isPressed("s") || inputManager.isPressed("arrowdown");

    const isPressingBack = inputManager.isPressed("s") || inputManager.isPressed("arrowdown");

    // Smoothly auto-align the camera behind the player only while moving
    // forward/sideways (not while walking backwards) and only if the
    // player isn't currently steering the camera manually.
    if (isMoving && !isPressingBack && !isManualControl) {
        const targetAngleX = playerRotY + Math.PI;
        let diff = targetAngleX - this.cameraAngleX;

        // Normalize the angular difference to the shortest path in [-PI, PI].
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

        // Smooth interpolation towards the target angle.
        this.cameraAngleX += diff * this.autoFollowSpeed * delta;
    }

    // Clamp the vertical orbit angle so the camera never flips over the
    // top of the player or dips below a shallow, unusable angle.
    const minAngleY = 0.1;
    const maxAngleY = Math.PI / 2.3;
    this.cameraAngleY = Math.max(minAngleY, Math.min(maxAngleY, this.cameraAngleY));

    // Spherical-to-cartesian conversion for the camera offset around the player.
    const offsetX = this.camDistance * Math.sin(this.cameraAngleX) * Math.cos(this.cameraAngleY);
    const offsetY = this.camDistance * Math.sin(this.cameraAngleY);
    const offsetZ = this.camDistance * Math.cos(this.cameraAngleX) * Math.cos(this.cameraAngleY);

    this.camera.position.set(
      playerPos.x + offsetX,
      playerPos.y + offsetY,
      playerPos.z + offsetZ
    );

    this.camera.lookAt(playerPos.x, playerPos.y + 1.5, playerPos.z);

    // Expose the current horizontal camera angle so other modules (e.g. Player)
    // can compute movement directions relative to the camera.
    this.camera.userData.cameraAngleX = this.cameraAngleX;
  }
}
