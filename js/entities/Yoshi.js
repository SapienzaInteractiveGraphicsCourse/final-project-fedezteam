import * as THREE from 'three';
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class Yoshi {
  constructor(mesh = null, physicsEngine = null) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;
    this.isRidden = false;
    this.body = null;
    this.radius = 1; // Raggio della sfera fisica di collisione[cite: 1]

    if (this.mesh) {
      this._setupShadows();
    }
  }

  // Attiva ombre su tutte le sotto-mesh del GLTF (YoshiGLTF/yoshi.gltf)
  _setupShadows() {
    if (!this.mesh) return;
    this.mesh.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  setMesh(mesh) {
    this.mesh = mesh;
    this._setupShadows();
  }

  spawn(x, y, z) {
    if (!this.mesh) return;

    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = 0;

    // Creazione corpo fisico Cannon.js
    if (this.physicsEngine && this.physicsEngine.world) {
      const shape = new CANNON.Sphere(this.radius);
      
      // Il centro della sfera fisica viene alzato di 'radius'
      // in modo che l'origine y=0 ai piedi del modello GLTF tocchi il terreno
      this.body = new CANNON.Body({
        mass: 10,
        position: new CANNON.Vec3(x, y + this.radius, z),
        shape: shape,
        material: this.physicsEngine.defaultMaterial,
        fixedRotation: true
      });

      this.physicsEngine.world.addBody(this.body);
    }
  }

  update(delta, inputOrPlayer, playerRef) {
    if (!this.mesh) return;

    const player = playerRef || (inputOrPlayer && inputOrPlayer.mesh ? inputOrPlayer : null);

    if (this.isRidden && player) {
      // Se cavalcato, attacca Yoshi al giocatore
      this.mesh.position.copy(player.position);
      if (this.body) {
        this.body.position.set(
          player.position.x,
          player.position.y + this.radius, // Piccolo offset per evitare che il modello affondi nel terreno
          player.position.z
        );
      }
    } else if (this.body) {
      // Sincronizzazione: sottrae il raggio per mantenere i piedi del GLTF a contatto con il pavimento
      this.mesh.position.set(
        this.body.position.x,
        this.body.position.y - (this.radius + 0.3), // Piccolo offset per evitare che il modello affondi nel terreno
        this.body.position.z
      );
    }
  }

  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}