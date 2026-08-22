import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { enableShadows } from "../utils/shadows.js";

/**
 * NPC.js — mesh + static physics body for a level NPC (Toad, ...), spawned
 * from the level JSON's "npcs" array (see LevelLoader.buildBuildingsAndNPCs).
 *
 * BUG FIX (missing Toad collision): NPCs used to be spawned as a bare mesh
 * with no physics body at all — nothing stopped the player from walking
 * straight through Toad. This gives every NPC the same simple box collider
 * ToadHouse.js already uses for its own structure, sized generously enough
 * to cover any of the (currently small, human/toad-scale) NPC models
 * without needing per-type tuning.
 *
 * Also exposes a plain `position` object (independent of `scale`/rotation
 * quirks in `mesh.position`) so InteractionManager can register a prompt at
 * this NPC's location without reaching into three.js internals.
 */
export default class NPC {
  constructor(mesh, physicsEngine, data) {
    this.mesh = mesh;
    this.type = data.type;
    this.data = data;

    const { x = 0, y = 0, z = 0, scale = 1, rotationY = 0 } = data;

    this.mesh.scale.set(scale, scale, scale);
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = rotationY;
    enableShadows(this.mesh);

    this.position = { x, y, z };
    this.body = null;

    const world = physicsEngine?.world || physicsEngine;
    if (!world) {
      console.warn(
        `[NPC] No physics world available for "${this.type}" at (${x}, ${y}, ${z}) — no collider was created.`,
      );
      return;
    }

    // A simple box around the NPC's rough footprint/height — tunable per
    // level-JSON entry via hitboxRadius/hitboxHeight (absolute world units,
    // NOT multiplied by `scale`). Without an explicit override, the default
    // (sized for a roughly human-scale character at scale=1) is scaled down
    // WITH the model's own `scale` instead of applied at face value —
    // otherwise a small NPC like Toad (scale 0.4) would end up wearing a
    // human-sized collider several times taller than its own visible model.
    const radius = data.hitboxRadius ?? 1.0 * scale;
    const height = data.hitboxHeight ?? 2.6 * scale;

    this.body = new CANNON.Body({
      mass: 0,
      material: physicsEngine.defaultMaterial,
    });
    this.body.addShape(
      new CANNON.Box(new CANNON.Vec3(radius, height / 2, radius)),
      new CANNON.Vec3(0, height / 2, 0),
    );
    this.body.position.set(x, y, z);

    const quat = new CANNON.Quaternion();
    quat.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotationY);
    this.body.quaternion.copy(quat);

    world.addBody(this.body);
  }
}
