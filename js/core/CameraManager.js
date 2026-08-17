export default class CameraManager {
  constructor(camera) {
    this.camera = camera;

    // Parametri orbitali
    this.cameraAngleX = 0; // Rotazione orizzontale
    this.cameraAngleY = Math.PI / 6; // Rotazione verticale iniziale (~30°)
    this.camRotationSpeed = 2.0; // Velocità di rotazione MANUALE
    this.camDistance = 12; // Distanza dal player

    // 🐉 Velocità con cui la telecamera segue automaticamente le spalle (Effetto Spyro)
    this.autoFollowSpeed = 2.5; 
  }

  // 💡 Nota: Ora passiamo l'intero 'player' invece di 'playerPos' per leggere la sua rotazione
update(player, inputManager, delta) {
    if (!player || !player.mesh || !inputManager) return;

    const playerPos = player.mesh.position;
    const playerRotY = player.currentFacingAngle || 0; 

    let isManualControl = false;

    // 1. Lettura input MANUALE (I, J, K, L)
    if (inputManager.isPressed("j")) { this.cameraAngleX -= this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("l")) { this.cameraAngleX += this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("i")) { this.cameraAngleY -= this.camRotationSpeed * delta; isManualControl = true; }
    if (inputManager.isPressed("k")) { this.cameraAngleY += this.camRotationSpeed * delta; isManualControl = true; }

    // 2. 🐉 EFFETTO SPYRO (Dinamico con controllo dello Scatto)
    let followSpeed = 0;
    
    // Controlliamo se l'utente sta scattando (Shift)
    const isSprinting = 
      inputManager.isPressed("shift") || 
      inputManager.isPressed("shiftleft") || 
      inputManager.isPressed("shiftright");

    // Se corri in AVANTI (W)
    if (inputManager.isPressed("w") || inputManager.isPressed("arrowup")) {
      // ⚡ Scatto: La telecamera scatta velocemente a 5.5 | Camminata: Segue morbida a 2.0
      followSpeed = isSprinting ? 5.5 : 2.0; 
    } 
    // Se corri DI LATO (A, D)
    else if (inputManager.isPressed("a") || inputManager.isPressed("d") || 
             inputManager.isPressed("arrowleft") || inputManager.isPressed("arrowright")) {
      // ⚡ Scatto: Si allinea più in fretta (2.5) | Camminata: Quasi ferma per permettere esplorazione laterale (0.5)
      followSpeed = isSprinting ? 2.5 : 0.5; 
    }

    const isPressingBack = inputManager.isPressed("s") || inputManager.isPressed("arrowdown");

    // Applichiamo la rotazione solo se non premi 'S' e non stai usando i tasti manuali
    if (followSpeed > 0 && !isPressingBack && !isManualControl) {
        const targetAngleX = playerRotY + Math.PI;
        let diff = targetAngleX - this.cameraAngleX;

        // Magia per trovare il giro più corto
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

        this.cameraAngleX += diff * followSpeed * delta;
    }

    // 3. Limita l'angolo verticale per non finire sottoterra
    const minAngleY = 0.1;
    const maxAngleY = Math.PI / 2.3;
    this.cameraAngleY = Math.max(minAngleY, Math.min(maxAngleY, this.cameraAngleY));

    // 4. Calcolo posizione orbitale sferica
    const offsetX = this.camDistance * Math.sin(this.cameraAngleX) * Math.cos(this.cameraAngleY);
    const offsetY = this.camDistance * Math.sin(this.cameraAngleY);
    const offsetZ = this.camDistance * Math.cos(this.cameraAngleX) * Math.cos(this.cameraAngleY);

    // 5. Aggiorna posizione telecamera
    this.camera.position.set(
      playerPos.x + offsetX,
      playerPos.y + offsetY,
      playerPos.z + offsetZ
    );

    // 6. Guarda verso il giocatore
    this.camera.lookAt(playerPos.x, playerPos.y + 1.5, playerPos.z);
  }
}