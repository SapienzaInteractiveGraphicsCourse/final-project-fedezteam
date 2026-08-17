export default class CameraManager {
  constructor(camera) {
    this.camera = camera;

    this.cameraAngleX = 0; 
    this.cameraAngleY = Math.PI / 6; 
    this.camRotationSpeed = 2.0; 
    this.camDistance = 12; 

    // 🐉 Riducessimo la velocità di auto-follow per evitare strattoni geometrici
    this.autoFollowSpeed = 1.2; 
  }

  update(player, inputManager, delta) {
    if (!player || !player.mesh || !inputManager) return;

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

    const minAngleY = 0.1;
    const maxAngleY = Math.PI / 2.3;
    this.cameraAngleY = Math.max(minAngleY, Math.min(maxAngleY, this.cameraAngleY));

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
}