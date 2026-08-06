import * as THREE from 'three';

export default class Yoshi {
  constructor(mesh) {
    this.mesh = mesh;
    this.isRidden = false; // Stato per verificare se Yoshi viene cavalcato
  }

  /**
   * Posiziona Yoshi nella mappa
   */
  spawn(x, y, z) {
    if (!this.mesh) return;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = 0; // Orientato di fronte rispetto allo spawn
  }

  /**
   * Aggiornamento di Yoshi nel Game Loop
   * Accetta facoltativamente input o player senza andare in errore se uno dei due manca
   */
  update(delta, inputOrPlayer, playerRef) {
    if (!this.mesh) return;

    // Gestione flessibile dei parametri (se il secondo argomento è il player)
    const player = playerRef || (inputOrPlayer && inputOrPlayer.mesh ? inputOrPlayer : null);
    const input = (inputOrPlayer && typeof inputOrPlayer.isPressed === 'function') ? inputOrPlayer : null;

    // Piccola animazione d'attesa (Idle): Yoshi galleggia/respira leggermente se non è cavalcato
    if (!this.isRidden) {
      this.mesh.position.y += Math.sin(Date.now() * 0.003) * 0.01;
    }

    // Se Yoshi deve essere controllato da tastiera quando cavalcato
    if (this.isRidden && input) {
      const moveSpeed = 40 * delta;
      
      if (input.isPressed("w") || input.isPressed("arrowup")) {
        this.mesh.position.z -= moveSpeed;
      }
      if (input.isPressed("s") || input.isPressed("arrowdown")) {
        this.mesh.position.z += moveSpeed;
      }
    }
  }

  /**
   * Getter per recuperare la posizione di Yoshi
   */
  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}