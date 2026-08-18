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
    if (!this.mesh || !this.body) return;

    const isSprinting =
      input.isPressed("shift") ||
      input.isPressed("shiftleft") ||
      input.isPressed("shiftright");
    const activeSpeed = isSprinting
      ? this.moveSpeed * this.sprintMultiplier
      : this.moveSpeed;

    // Angolo stabile della telecamera
    const camAngle =
      camera && camera.userData && camera.userData.cameraAngleX !== undefined
        ? camera.userData.cameraAngleX
        : 0;

    // Vettori di direzione basati sull'angolo puro
    const camForwardX = -Math.sin(camAngle);
    const camForwardZ = -Math.cos(camAngle);

    const camRightX = Math.cos(camAngle);
    const camRightZ = -Math.sin(camAngle);

    let moveDirX = 0;
    let moveDirZ = 0;

    if (input.isPressed("w") || input.isPressed("arrowup")) {
      moveDirX += camForwardX;
      moveDirZ += camForwardZ;
    }
    if (input.isPressed("s") || input.isPressed("arrowdown")) {
      moveDirX -= camForwardX;
      moveDirZ -= camForwardZ;
    }
    if (input.isPressed("a") || input.isPressed("arrowleft")) {
      moveDirX -= camRightX;
      moveDirZ -= camRightZ;
    }
    if (input.isPressed("d") || input.isPressed("arrowright")) {
      moveDirX += camRightX;
      moveDirZ += camRightZ;
    }

    const moveLen = Math.hypot(moveDirX, moveDirZ);
    if (moveLen > 0.0001) {
      moveDirX /= moveLen;
      moveDirZ /= moveLen;
    }

    const targetMoveX = moveDirX * activeSpeed;
    const targetMoveZ = moveDirZ * activeSpeed;

    // Smorzamento indipendente dal framerate. `control` era applicato una volta
    // per frame, quindi a 144Hz il player accelerava/frenava molto più in fretta
    // che a 60Hz. Questa forma riproduce ESATTAMENTE il vecchio comportamento a
    // 60 fps e lo mantiene identico a qualsiasi refresh rate.
    const t = 1 - Math.pow(1 - this.control, delta * 60);

    this.body.velocity.x += (targetMoveX - this.body.velocity.x) * t;
    this.body.velocity.z += (targetMoveZ - this.body.velocity.z) * t;

    if (moveLen > 0.0001) {
      const targetRotation = Math.atan2(moveDirX, moveDirZ);
      this.currentFacingAngle = targetRotation;
      this.mesh.rotation.y = targetRotation + (this.modelOffset || 0);
    }

    if ((input.isPressed("space") || input.isPressed(" ")) && this.canJump) {
      this.body.velocity.y = this.jumpVelocity;
      this.canJump = false;

      if (audio && audio.playSFX) {
        audio.playSFX("jump");
      }
    }

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
