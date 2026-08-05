import * as THREE from 'three';

export default class Player {
  constructor(mesh, moveSpeed = 35) {
    this.mesh = mesh;
    this.moveSpeed = moveSpeed;
  }

  /**
   * Imposta la posizione iniziale nello spazio 3D
   */
  spawn(x, y, z) {
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = Math.PI*1.5; // Orientamento frontale (verso -Z)
  }

  /**
   * Aggiorna il movimento orizzontale e il salto
   */
  update(delta, input, physics) {
    if (!this.mesh) return;

    let moved = false;
    let targetRotation = this.mesh.rotation.y;
    const actualMove = this.moveSpeed * delta;

    // Controllo direzioni da InputManager
    if (input.isPressed("w") || input.isPressed("arrowup")) {
      this.mesh.position.z -= actualMove;
      targetRotation = -Math.PI / 2;
      moved = true;
    }
    if (input.isPressed("s") || input.isPressed("arrowdown")) {
      this.mesh.position.z += actualMove;
      targetRotation = Math.PI / 2;
      moved = true;
    }
    if (input.isPressed("a") || input.isPressed("arrowleft")) {
      this.mesh.position.x -= actualMove;
      targetRotation = 0;
      moved = true;
    }
    if (input.isPressed("d") || input.isPressed("arrowright")) {
      this.mesh.position.x += actualMove;
      targetRotation = Math.PI;
      moved = true;
    }

    if (moved) {
      this.mesh.rotation.y = targetRotation;
    }

    // Innesco Salto
    if (input.isPressed("space") || input.isPressed(" ")) {
      physics.jump();
    }

    // Applicazione Fisica (Gravità e Terreno)
    physics.update(this.mesh, delta);
  }

  /**
   * Getter di comodo per recuperare la posizione X, Y, Z
   */
  get position() {
    return this.mesh.position;
  }
}