import * as THREE from 'three';
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class Player {
  // Passiamo il PhysicsEngine nel costruttore per poter inserire il player nel mondo
  constructor(mesh, physicsEngine, moveSpeed = 15, jumpVelocity = 15) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;
    this.moveSpeed = moveSpeed;
    this.jumpVelocity = jumpVelocity;
    
    this.body = null;
    this.canJump = false; // Flag vitale per impedire i doppi salti in aria
  }

  spawn(x, y, z) {
    // 1. Setup Three.js (Grafica)
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = Math.PI * 1.5;

    // 2. Setup Cannon-es (Fisica)
    // Una sfera è ottima per i platformer 3D perché scivola bene sugli spigoli
    const radius = 1; 
    const shape = new CANNON.Sphere(radius);
    
    this.body = new CANNON.Body({
      mass: 5, // Massa > 0 lo rende un oggetto dinamico (soggetto a gravità)
      position: new CANNON.Vec3(x, y, z),
      shape: shape,
      material: this.physicsEngine.defaultMaterial,
      fixedRotation: true // Essenziale: impedisce al giocatore di "rotolare" fisicamente come una palla
    });

    // 3. Listener per atterraggi (reset del salto)
    this.body.addEventListener("collide", (e) => {
      const contactNormal = new CANNON.Vec3();
      e.contact.ni.negate(contactNormal);
      // Se urtiamo qualcosa che punta verso l'alto (Y > 0), siamo sul pavimento
      if (contactNormal.dot(new CANNON.Vec3(0, 1, 0)) > 0.5) {
        this.canJump = true;
      }
    });

    // Inseriamo il corpo nel mondo
    this.physicsEngine.world.addBody(this.body);
  }

  update(delta, input) {
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

    // 2. Applica Velocità (Manteniamo intatta la Y per non interferire con la gravità)
    this.body.velocity.x = moveX;
    this.body.velocity.z = moveZ;

    // Aggiorna la rotazione grafica
    if (moved) this.mesh.rotation.y = targetRotation;

    // 3. Gestione Salto
    if ((input.isPressed("space") || input.isPressed(" ")) && this.canJump) {
      this.body.velocity.y = this.jumpVelocity;
      this.canJump = false;
    }

    // 4. SINCRONIZZAZIONE (Il Core dell'Engine)
    // Copiamo le coordinate calcolate da Cannon.js e le applichiamo al modello 3D
    this.mesh.position.copy(this.body.position);
  }

  get position() {
    return this.mesh.position;
  }
}