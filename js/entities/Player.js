import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class Player {
  // 1. Passiamo un oggetto 'stats' al posto dei valori fissi
  constructor(mesh, physicsEngine, stats = {}) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;

    // Assegniamo le statistiche (con i valori di Mario come default)
    this.moveSpeed = stats.moveSpeed || 11;
    this.jumpVelocity = stats.jumpVelocity || 18;
    this.control = stats.control || 0.8; // 1.0 = stop istantaneo, valori bassi = scivoloso

    this.sprintMultiplier = 1.5;

    this.body = null;
    this.canJump = false;
    this.radius = 1;

    if (this.mesh) {
      this.mesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }
  }

  spawn(x, y, z) {
    if (!this.mesh) return;

    // 1. Setup Three.js (Grafica)
    this.mesh.position.set(x, y, z);

    // 🔄 SALVIAMO L'OFFSET PER CORREGGERE IL MODELLO 3D
    this.modelOffset = Math.PI / 2;
    this.mesh.rotation.y = this.modelOffset;

    // 2. Setup Cannon-es (Fisica)
    const shape = new CANNON.Sphere(this.radius);

    // Alza il centro della sfera di 'radius' affinché l'origine ai piedi (Y=0) tocchi il suolo
    this.body = new CANNON.Body({
      mass: 5,
      position: new CANNON.Vec3(x, y + this.radius, z),
      shape: shape,
      material: this.physicsEngine?.defaultMaterial,
      fixedRotation: true, // Impedisce al personaggio di rotolare
    });

    // 3. Listener per azzerare il salto all'atterraggio
    const contactNormal = new CANNON.Vec3();
    const upAxis = new CANNON.Vec3(0, 1, 0);

    this.body.addEventListener("collide", (e) => {
      e.contact.ni.negate(contactNormal);

      if (contactNormal.dot(upAxis) > 0.5) {
        this.canJump = true;
      }
    });

    if (this.physicsEngine && this.physicsEngine.world) {
      this.physicsEngine.world.addBody(this.body);
    }
  }

  update(delta, input, ui, audio, camera) {
    // 🛡️ FIX 1: Togliamo '!camera' dal blocco critico per evitare che Mario rimanga in aria
    if (!this.mesh || !this.body) return;

    // 1. Calcolo Velocità Attiva (Gestione Sprint)
    const isSprinting =
      input.isPressed("shift") ||
      input.isPressed("shiftleft") ||
      input.isPressed("shiftright");
    const activeSpeed = isSprinting
      ? this.moveSpeed * this.sprintMultiplier
      : this.moveSpeed;

    const moveDirection = new THREE.Vector3(0, 0, 0);

    // 🛡️ FIX 2: Calcoliamo i vettori solo se la telecamera esiste effettivamente
    if (camera) {
      const cameraForward = new THREE.Vector3();
      camera.getWorldDirection(cameraForward);
      cameraForward.y = 0;

      // Prevenzione errori matematici (NaN) se la camera guarda perfettamente in basso
      if (cameraForward.lengthSq() < 0.001) {
        cameraForward.set(0, 0, -1);
      }
      cameraForward.normalize();

      const upVector = new THREE.Vector3(0, 1, 0);
      const cameraRight = new THREE.Vector3()
        .crossVectors(cameraForward, upVector) // ✅ Ordine corretto, calcola la Destra!
        .normalize();

      // 3. Calcolo Direzione di Movimento
      if (input.isPressed("w") || input.isPressed("arrowup")) {
        moveDirection.add(cameraForward);
      }
      if (input.isPressed("s") || input.isPressed("arrowdown")) {
        moveDirection.sub(cameraForward);
      }
      if (input.isPressed("a") || input.isPressed("arrowleft")) {
        moveDirection.sub(cameraRight);
      }
      if (input.isPressed("d") || input.isPressed("arrowright")) {
        moveDirection.add(cameraRight);
      }
    }

    // Normalizziamo
    if (moveDirection.lengthSq() > 0) {
      moveDirection.normalize();
    }

    // 4. Velocità Bersaglio Desiderata
    const targetMoveX = moveDirection.x * activeSpeed;
    const targetMoveZ = moveDirection.z * activeSpeed;

    // ⚡ 5. APPLICAZIONE VELOCITÀ CON INERZIA (LERP) ⚡
    this.body.velocity.x += (targetMoveX - this.body.velocity.x) * this.control;
    this.body.velocity.z += (targetMoveZ - this.body.velocity.z) * this.control;

    // 6. Rotazione del Personaggio
    if (moveDirection.lengthSq() > 0.01) {
      const targetRotation = Math.atan2(moveDirection.x, moveDirection.z);

      // 💡 NUOVO: Salviamo la VERA direzione in cui corre, senza l'errore del modello 3D
      this.currentFacingAngle = targetRotation;

      // 🔄 Sommiamo il nostro offset per compensare il difetto del modello 3D (Solo visivo!)
      this.mesh.rotation.y = targetRotation + (this.modelOffset || 0);
    }

    // 7. Salto
    if ((input.isPressed("space") || input.isPressed(" ")) && this.canJump) {
      this.body.velocity.y = this.jumpVelocity;
      this.canJump = false;

      if (audio && audio.playSFX) {
        audio.playSFX("jump");
      }
    }

    // 8. Sincronizzazione Grafica <-> Fisica (Adesso questa parte viene eseguita sempre!)
    this.mesh.position.set(
      this.body.position.x,
      this.body.position.y - this.radius,
      this.body.position.z,
    );
  }

  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}
