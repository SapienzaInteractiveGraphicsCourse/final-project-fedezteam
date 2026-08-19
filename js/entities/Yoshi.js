import * as THREE from 'three';
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { enableShadows } from "../utils/shadows.js";

export default class Yoshi {
  constructor(mesh = null, physicsEngine = null) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;
    this.isRidden = false;
    this.body = null;
    this.radius = 1; // Radius of the spherical collision body.

    if (this.mesh) {
      enableShadows(this.mesh);
    }
  }

  setMesh(mesh) {
    this.mesh = mesh;
    enableShadows(this.mesh);
  }

  spawn(x, y, z) {
    if (!this.mesh) return;

    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = 0;

    // Create the cannon-es physics body.
    if (this.physicsEngine && this.physicsEngine.world) {
      const shape = new CANNON.Sphere(this.radius);

      // The physics sphere's center is raised by 'radius' so the origin at
      // y = 0 in the GLTF model (the feet) touches the ground.
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
      // While being ridden, Yoshi is attached directly to the player.
      this.mesh.position.copy(player.position);
      if (this.body) {
        this.body.position.set(
          player.position.x,
          player.position.y + this.radius, // Small offset to avoid sinking into the ground.
          player.position.z
        );
      }
    } else if (this.body) {
      // Sync the mesh to the physics body, subtracting the radius so the
      // GLTF model's feet stay in contact with the floor.
      this.mesh.position.set(
        this.body.position.x,
        this.body.position.y - this.radius,
        this.body.position.z
      );
    }
  }

  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}
