import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

/**
 * cannon-es collision filter groups/masks. Excludes PLAYER/ENEMY and
 * PLAYER/YOSHI pairs from physics response — resolved by game logic instead.
 */
export const COLLISION_GROUPS = {
  GROUND: 1,
  PLAYER: 2,
  ENEMY: 4,
  YOSHI: 8,
};

/**
 * PhysicsEngine.js — owns the cannon-es World and steps it every frame.
 * Layers an optional, additive Mario Galaxy-style per-planet gravity (see
 * GravityField.js) on top of flat gravity for bodies that opt in via
 * registerGravityBody(). Also provides checkVoidFall().
 */
export default class PhysicsEngine {
  constructor(options = {}) {
    this.world = new CANNON.World();
    this.world.gravity.set(0, options.gravity || -30, 0);

    this.defaultMaterial = new CANNON.Material("default");

    // Shared by every body: near-zero friction (the character controller
    // handles movement itself) and no bounce on collision.
    const contactMaterial = new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.defaultMaterial,
      { friction: 0.01, restitution: 0.0 },
    );
    this.world.addContactMaterial(contactMaterial);

    this.fallThreshold = options.fallThreshold || -70;

    // Both empty until something opts in — until then every body falls
    // under plain world.gravity exactly as before this feature existed.
    this.gravityFields = [];
    this._gravityBodies = new Set();
  }

  // Registers a planet's gravity well (see Decorations._addPlanetPhysics).
  addGravityField(field) {
    this.gravityFields.push(field);
  }

  // Opts a dynamic body into planet gravity (currently only the player).
  registerGravityBody(body) {
    if (body) this._gravityBodies.add(body);
  }

  // Undoes registerGravityBody (e.g. the player switching characters).
  unregisterGravityBody(body) {
    this._gravityBodies.delete(body);
  }

  // Nearest gravity field whose influenceRadius contains `position`
  // ({x,y,z}), or null. Public so Player.js can pick its movement path.
  getActiveGravityField(position) {
    if (!position || this.gravityFields.length === 0) return null;

    let best = null;
    let bestDist = Infinity;

    for (const field of this.gravityFields) {
      const dist = field.distanceTo(position);
      if (dist <= field.influenceRadius && dist < bestDist) {
        best = field;
        bestDist = dist;
      }
    }

    return best;
  }

  // Applies the additive per-planet gravity override, then steps the sim.
  update(delta) {
    // For every opted-in body inside a field's range: cancel the flat
    // gravity world.step() is about to add, substitute a pull to center.
    if (this._gravityBodies.size > 0 && this.gravityFields.length > 0) {
      const g = this.world.gravity;

      for (const body of this._gravityBodies) {
        const field = this.getActiveGravityField(body.position);
        if (!field) continue;

        body.force.x -= body.mass * g.x;
        body.force.y -= body.mass * g.y;
        body.force.z -= body.mass * g.z;

        const dx = field.center.x - body.position.x;
        const dy = field.center.y - body.position.y;
        const dz = field.center.z - body.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const pull = body.mass * field.strength;

        body.force.x += (dx / dist) * pull;
        body.force.y += (dy / dist) * pull;
        body.force.z += (dz / dist) * pull;
      }
    }

    this.world.step(1 / 60, delta, 3);
  }

  // Invokes onRespawn() once `playerPosition` falls below fallThreshold.
  checkVoidFall(playerPosition, onRespawn) {
    if (playerPosition && playerPosition.y < this.fallThreshold) {
      if (onRespawn) onRespawn();
    }
  }
}
