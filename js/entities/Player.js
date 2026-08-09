import * as THREE from 'three';
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class Player {
  constructor(mesh, physicsEngine, moveSpeed = 11, jumpVelocity = 11) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;
    this.moveSpeed = moveSpeed;           // Velocità di camminata standard
    this.sprintMultiplier = 1.5;         // ⚡ Moltiplicatore per lo scatto (16,5 di velocità)
    this.jumpVelocity = jumpVelocity;
    
    this.body = null;
    this.canJump = false; 
    this.radius = 1; // Raggio della sfera di collisione fisica

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
      fixedRotation: true // Impedisce al personaggio di rotolare
    });

    // 3. Listener per azzerare il salto all'atterraggio
    this.body.addEventListener("collide", (e) => {
      const contactNormal = new CANNON.Vec3();
      e.contact.ni.negate(contactNormal);
      if (contactNormal.dot(new CANNON.Vec3(0, 1, 0)) > 0.5) {
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

    // 1. Rilevamento Input (Assi X e Z)
    if (input.isPressed("w") || input.isPressed("arrowup")) {
      inputZ -= 1;
    }
    if (input.isPressed("s") || input.isPressed("arrowdown")) {
      inputZ += 1;
    }
    if (input.isPressed("a") || input.isPressed("arrowleft")) {
      inputX -= 1;
    }
    if (input.isPressed("d") || input.isPressed("arrowright")) {
      inputX += 1;
    }

    // ⚡ 2. Controllo Tasto Scatto (SHIFT)
    const isSprinting = input.isPressed("shift") || input.isPressed("shiftleft") || input.isPressed("shiftright");
    const activeSpeed = isSprinting ? (this.moveSpeed * this.sprintMultiplier) : this.moveSpeed;

    let moveX = 0;
    let moveZ = 0;

    // 3. Calcolo Direzione e Velocità Diagonale Bilanciata
    if (inputX !== 0 || inputZ !== 0) {
      const isDiagonal = inputX !== 0 && inputZ !== 0;
      
      const diagonalFactor = isDiagonal ? (1.18 / Math.sqrt(2)) : 1;

      moveX = inputX * activeSpeed * diagonalFactor;
      moveZ = inputZ * activeSpeed * diagonalFactor;

      // Rotazione precisa verso la direzione di movimento
      const targetRotation = Math.atan2(inputZ, -inputX);
      this.mesh.rotation.y = targetRotation;
    }

    // 4. Applica Velocità alla Fisica
    this.body.velocity.x = moveX;
    this.body.velocity.z = moveZ;

    // 5. Salto (solo se toccava terra)
    if ((input.isPressed("space") || input.isPressed(" ")) && this.canJump) {
      this.body.velocity.y = this.jumpVelocity;
      this.canJump = false; // Imposta subito a false in modo da bloccare salti ed effetti audio successivi in volo

      // 🔊 Suono riprodotto SOLO quando il salto avviene effettivamente
      if (audio && audio.playSFX) {
        audio.playSFX('jump');
      }
    }

    // 6. Sincronizzazione Grafica <-> Fisica
    this.mesh.position.set(
      this.body.position.x,
      this.body.position.y - (this.radius + 0.3), // Piccolo offset per evitare che il modello affondi nel terreno
      this.body.position.z
    );
  }

  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}