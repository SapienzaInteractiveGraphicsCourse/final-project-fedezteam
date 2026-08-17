import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class PhysicsEngine {
  constructor(options = {}) {
    this.world = new CANNON.World();
    this.world.gravity.set(0, options.gravity || -30, 0);

    this.defaultMaterial = new CANNON.Material("default");
    // PhysicsEngine.js
    const contactMaterial = new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.defaultMaterial,
      { friction: 0.01, restitution: 0.0 }, // 👈 Imposta friction a 0.0
    );
    this.world.addContactMaterial(contactMaterial);

    this.fallThreshold = options.fallThreshold || -70;
  }

  update(delta) {
    this.world.step(1 / 60, delta, 3);
  }

  checkVoidFall(playerPosition, onRespawn) {
    if (playerPosition && playerPosition.y < this.fallThreshold) {
      if (onRespawn) onRespawn();
    }
  }
}
