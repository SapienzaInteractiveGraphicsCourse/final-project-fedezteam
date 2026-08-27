import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { enableShadows } from "../utils/shadows.js";

/**
 * NPC.js — mesh + static physics body for a level NPC (Toad, ...), spawned
 * from the level JSON's "npcs" array. Also exposes a plain `position`
 * object so InteractionManager can register a prompt without touching
 * three.js internals.
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

    // Box collider, tunable via hitboxRadius/hitboxHeight (world units).
    // Default scales WITH `scale` so small NPCs don't get oversized colliders.
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
