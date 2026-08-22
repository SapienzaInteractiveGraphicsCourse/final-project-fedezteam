import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

/**
 * cannon-es collision filter groups/masks (bitmasks — see CANNON.Body's
 * collisionFilterGroup/collisionFilterMask). Used by Player.js and Enemy.js
 * so the player's and every enemy's dynamic bodies never produce a REAL
 * cannon-es collision response against each other, while still colliding
 * normally with everything else (ground, platforms, boss arenas, ...).
 *
 * BUG FIX (continuous bounce on Bowser): before this, player and enemy
 * bodies were both plain dynamic spheres with cannon-es' default group/mask
 * (collide with everything), so every stomp/contact was resolved TWICE —
 * once by the game's own scripted logic (Enemy._onStomped setting
 * player.body.velocity.y directly) and once more by cannon-es' own physics
 * solver pushing the two overlapping dynamic spheres apart. That second,
 * unscripted push is extra force the game never intended, and it's what
 * "accumulo errato della forza di salto di Mario" refers to — it stacked on
 * top of the scripted bounce instead of the scripted bounce being the only
 * thing that happened. Bowser's larger radius (1 vs Kamek's 0.3) meant more
 * overlap and a bigger, more noticeable extra push. Excluding the group
 * pair below makes the scripted stomp/contact code (Enemy._checkPlayerContact)
 * the ONLY thing that ever moves the player in response to an enemy — no
 * separate physics impulse to fight it or accumulate on top of it.
 */
export const COLLISION_GROUPS = {
  GROUND: 1,
  PLAYER: 2,
  ENEMY: 4,
  // BUG FIX (instant fall the moment Yoshi is mounted): while ridden,
  // Yoshi.js repositions his own physics body to sit right on top of the
  // player's every single frame (see Yoshi.update()'s isRidden branch) —
  // with no filter, that's two same-size dynamic/kinematic spheres forced
  // into deep, persistent overlap, and cannon-es' contact solver reacted by
  // shoving the player's body away (through the floor, off the map, ...)
  // to resolve it. Excluding this group from PLAYER's mask (see
  // Player.js's collisionFilterMask) makes that pair never produce a real
  // physics collision at all, exactly like PLAYER/ENEMY above.
  YOSHI: 8,
};

/**
 * PhysicsEngine.js — owns the cannon-es World and steps it every frame.
 *
 * On top of the plain flat-gravity simulation, it layers an optional,
 * additive Mario Galaxy-style per-planet gravity system (see
 * GravityField.js): bodies that opt in via registerGravityBody() get pulled
 * toward the nearest registered gravity field instead of falling straight
 * down, once they're within its influence radius. Nothing here changes for
 * bodies that never opt in, or while no field is in range — they fall under
 * the plain world.gravity exactly as before this feature existed.
 *
 * Also provides checkVoidFall(), the shared "fell off the level" trigger
 * used by both the main island and the separate boss obstacle zones.
 */
export default class PhysicsEngine {
  // Creates the cannon-es world, its shared contact material (near-zero
  // friction — the character controllers handle movement themselves — and
  // no bounce), and the empty gravity-field registry.
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

  // Undoes registerGravityBody — called when a body is being discarded
  // (e.g. the player switching characters).
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

  // Steps the physics world by one frame: first applies the additive
  // per-planet gravity override to every registered body currently inside
  // a field's range, then advances the simulation.
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
