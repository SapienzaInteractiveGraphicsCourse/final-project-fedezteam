import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class PhysicsEngine {
  constructor(options = {}) {
    this.world = new CANNON.World();
    // Aumentiamo leggermente la gravità per renderla più "platformer" (meno fluttuante)
    this.world.gravity.set(0, options.gravity || -30, 0);

    // Creiamo un materiale di base per evitare rimbalzi strani tra player e pavimento
    this.defaultMaterial = new CANNON.Material("default");
    const contactMaterial = new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.defaultMaterial,
      { friction: 0.1, restitution: 0.0 }
    );
    this.world.addContactMaterial(contactMaterial);

    this.fallThreshold = options.fallThreshold || -20;
  }

  // Avanzamento del mondo fisico. Da chiamare ad ogni frame prima di renderizzare
  update(delta) {
    // Cannon.js preferisce un time-step fisso (es. 1/60 di secondo)
    this.world.step(1 / 60, delta, 3);
  }

  // Semplificato: controlla solo se la Y del giocatore scende sotto la soglia
  checkVoidFall(playerPosition, onRespawn) {
    if (playerPosition && playerPosition.y < this.fallThreshold) {
      if (onRespawn) onRespawn();
    }
  }
}