import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class Player {
  // 1. Passiamo un oggetto 'stats' al posto dei valori fissi[cite: 7]
  constructor(mesh, physicsEngine, stats = {}) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;

    // Assegniamo le statistiche (con i valori di Mario come default)
    this.moveSpeed = stats.moveSpeed || 11;
    this.jumpVelocity = stats.jumpVelocity || 18;
    this.control = stats.control || 0.8; // 👈 NUOVO: 1.0 = stop istantaneo, valori bassi = scivoloso

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

      // Usa le variabili pre-allocate invece di usare 'new'
      if (contactNormal.dot(upAxis) > 0.5) {
        this.canJump = true;
      }
    });

    if (this.physicsEngine && this.physicsEngine.world) {
      this.physicsEngine.world.addBody(this.body);
    }
  }

  update(delta, input, audio) {
    if (!this.mesh || !this.body) return;

    let inputX = 0;
    let inputZ = 0;

    // 1. Rilevamento Input (Assi X e Z)[cite: 7]
    if (input.isPressed("w") || input.isPressed("arrowup")) inputZ -= 1;
    if (input.isPressed("s") || input.isPressed("arrowdown")) inputZ += 1;
    if (input.isPressed("a") || input.isPressed("arrowleft")) inputX -= 1;
    if (input.isPressed("d") || input.isPressed("arrowright")) inputX += 1;

    const isSprinting =
      input.isPressed("shift") ||
      input.isPressed("shiftleft") ||
      input.isPressed("shiftright");
    const activeSpeed = isSprinting
      ? this.moveSpeed * this.sprintMultiplier
      : this.moveSpeed;

    let moveX = 0;
    let moveZ = 0;

    // 3. Calcolo Direzione
    if (inputX !== 0 || inputZ !== 0) {
      const isDiagonal = inputX !== 0 && inputZ !== 0;
      const diagonalFactor = isDiagonal ? 1.18 / Math.sqrt(2) : 1;

      moveX = inputX * activeSpeed * diagonalFactor;
      moveZ = inputZ * activeSpeed * diagonalFactor;

      const targetRotation = Math.atan2(inputZ, -inputX);
      this.mesh.rotation.y = targetRotation;
    }

    // ⚡ 4. APPLICAZIONE VELOCITÀ CON INERZIA (LERP) ⚡
    // Invece di settarla direttamente in modo robotico, ammorbidiamo il movimento[cite: 7]
    this.body.velocity.x += (moveX - this.body.velocity.x) * this.control;
    this.body.velocity.z += (moveZ - this.body.velocity.z) * this.control;

    // 5. Salto[cite: 7]
    if ((input.isPressed("space") || input.isPressed(" ")) && this.canJump) {
      this.body.velocity.y = this.jumpVelocity;
      this.canJump = false;

      if (audio && audio.playSFX) {
        audio.playSFX("jump");
      }
    }

    // 6. Sincronizzazione Grafica <-> Fisica[cite: 7]
    this.mesh.position.set(
      this.body.position.x,
      this.body.position.y - this.radius, // Modificato prima per sistemare l'erba
      this.body.position.z,
    );
  }

  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}
