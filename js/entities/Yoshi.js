import * as THREE from 'three';
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class Yoshi {
  constructor(mesh, physicsEngine) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine; // Ora riceve la gravità
    this.isRidden = false;
    this.body = null;
  }

  spawn(x, y, z) {
    if (!this.mesh) return;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = 0;

    // Creiamo il corpo fisico di Yoshi
    if (this.physicsEngine && this.physicsEngine.world) {
      const shape = new CANNON.Sphere(1);
      this.body = new CANNON.Body({
        mass: 10,
        position: new CANNON.Vec3(x, y, z),
        shape: shape,
        fixedRotation: true
      });
      this.physicsEngine.world.addBody(this.body);
    }
  }

  update(delta, inputOrPlayer, playerRef) {
    if (!this.mesh) return;

    const player = playerRef || (inputOrPlayer && inputOrPlayer.mesh ? inputOrPlayer : null);
    
    if (this.isRidden && player) {
      // Se cavalcato, attacchiamo Yoshi a Mario
      this.mesh.position.copy(player.position);
      if (this.body) this.body.position.copy(player.position);
    } else {
      // Se NON cavalcato, la grafica segue il suo corpo che cade a terra
      if (this.body) {
        this.mesh.position.copy(this.body.position);
      }
    }
  }

  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}