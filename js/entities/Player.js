import * as THREE from 'three';
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class Player {
  constructor(mesh, physicsEngine, moveSpeed = 15, jumpVelocity = 15) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;
    this.moveSpeed = moveSpeed;
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

    let moveX = 0;
    let moveZ = 0;
    let targetRotation = this.mesh.rotation.y;
    let moved = false;

    // 1. Gestione Input
    if (input.isPressed("w") || input.isPressed("arrowup")) {
      moveZ -= this.moveSpeed;
      targetRotation = -Math.PI / 2;
      moved = true;
    }
    if (input.isPressed("s") || input.isPressed("arrowdown")) {
      moveZ += this.moveSpeed;
      targetRotation = Math.PI / 2;
      moved = true;
    }
    if (input.isPressed("a") || input.isPressed("arrowleft")) {
      moveX -= this.moveSpeed;
      targetRotation = 0;
      moved = true;
    }
    if (input.isPressed("d") || input.isPressed("arrowright")) {
      moveX += this.moveSpeed;
      targetRotation = Math.PI;
      moved = true;
    }

    // 2. Applica Velocità
    this.body.velocity.x = moveX;
    this.body.velocity.z = moveZ;

    // Aggiorna rotazione grafica
    if (moved) this.mesh.rotation.y = targetRotation;

    // 3. Salto (Si attiva SOLO se il personaggio toccava terra!)
    if ((input.isPressed("space") || input.isPressed(" ")) && this.canJump) {
      this.body.velocity.y = this.jumpVelocity;
      this.canJump = false; // Imposta subito a false in modo da bloccare salti ed effetti audio successivi in volo

      // 🔊 Suono riprodotto SOLO quando il salto avviene effettivamente
      if (audio && audio.playSFX) {
        audio.playSFX('jump');
      }
    }

    // 4. Sincronizzazione Grafica <-> Fisica
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