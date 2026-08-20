import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class PhysicsEngine {
  constructor(options = {}) {
    this.world = new CANNON.World();
    this.world.gravity.set(0, options.gravity || -30, 0);

    this.defaultMaterial = new CANNON.Material("default");

    // Contact material shared by every body: near-zero friction (the
    // character controller handles horizontal movement itself) and no
    // bounce on collision.
    const contactMaterial = new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.defaultMaterial,
      { friction: 0.01, restitution: 0.0 },
    );
    this.world.addContactMaterial(contactMaterial);

    this.fallThreshold = options.fallThreshold || -70;

    // Mario Galaxy-style per-planet gravity (see GravityField.js). Both
    // start empty, so the new loop in update() below is a no-op until
    // something explicitly opts in via registerGravityBody() AND a field is
    // registered via addGravityField() — until then every dynamic body
    // keeps falling under the flat world.gravity exactly as before this
    // feature existed.
    this.gravityFields = [];
    this._gravityBodies = new Set();
  }

  // Registers a planet's gravity well (see Decorations.js's
  // _addPlanetPhysics, which pairs this with a matching static collider).
  addGravityField(field) {
    this.gravityFields.push(field);
  }

  // Opts a dynamic body into planet gravity — currently only called for the
  // player (see EntityManager.spawnPlayer). A body that never registers is
  // completely unaffected by any gravity field, no matter how close it gets.
  registerGravityBody(body) {
    if (body) this._gravityBodies.add(body);
  }

  unregisterGravityBody(body) {
    this._gravityBodies.delete(body);
  }

  // Returns the nearest gravity field whose influenceRadius contains
  // `position` (accepts any {x,y,z} — CANNON.Vec3 or THREE.Vector3 both
  // work), or null if none does. Public so Player.js can ask "am I near a
  // planet?" to pick which movement code path to run.
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

  update(delta) {
    // Additive per-body planet gravity. For every body that opted in via
    // registerGravityBody(), if it's currently inside a field's influence
    // radius, cancel the flat world.gravity contribution that world.step()
    // is about to add for it (below) and substitute a pull toward that
    // field's center instead. A body that isn't registered, or is
    // registered but outside every field right now, is untouched by this
    // loop — flat gravity applies to it exactly as it always has.
    if (this._gravityBodies.size > 0 && this.gravityFields.length > 0) {
      const g = this.world.gravity;

      for (const body of this._gravityBodies) {
        const field = this.getActiveGravityField(body.position);
        if (!field) continue;

        // Cancels the "add gravity to all objects" pass cannon-es'
        // World.internalStep() performs for every DYNAMIC body
        // (f.x += mass*gravity.x, etc.) a moment from now, inside
        // this.world.step() below. body.force is guaranteed to be exactly
        // zero at this point (cleared at the end of the previous step), so
        // this pre-emptive subtraction plus that automatic addition sum to
        // zero, leaving only the radial pull applied right after.
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

  // Invokes onRespawn() when the given position has fallen below the
  // configured void threshold (e.g. the player fell off the level).
  checkVoidFall(playerPosition, onRespawn) {
    if (playerPosition && playerPosition.y < this.fallThreshold) {
      if (onRespawn) onRespawn();
    }
  }
}
