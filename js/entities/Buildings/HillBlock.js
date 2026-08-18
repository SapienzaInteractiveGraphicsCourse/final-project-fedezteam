import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class HillBlock {
  constructor(mesh, physicsEngine, data) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;

    const {
      x = 0,
      y = 0,
      z = 0,
      scaleX = 1.0,
      scaleY = 1.0,
      scaleZ = 1.0,
      scale = 1.0,
      rotationY = 0,
    } = data;

    // Per-axis scale wins if provided, otherwise fall back to uniform `scale`.
    const sX = data.scaleX !== undefined ? scaleX : scale;
    const sY = data.scaleY !== undefined ? scaleY : scale;
    const sZ = data.scaleZ !== undefined ? scaleZ : scale;

    // --- 1. VISUALS ---
    this.mesh.scale.set(sX, sY, sZ);
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = rotationY;

    this.mesh.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // --- 2. PHYSICS (single box collider) ---
    const world = this.physicsEngine?.world || this.physicsEngine;
    if (!world) {
      console.warn(
        `[HillBlock] No physics world available for building at (${x}, ${y}, ${z}). ` +
        `No collider was created.`
      );
      return;
    }

    this.body = new CANNON.Body({
      mass: 0,
      material: this.physicsEngine.defaultMaterial,
    });

    // Hitbox half-extents: 1.0 (X), 0.5 (Y), 1.0 (Z), slightly inset (0.98) to avoid
    // Z-fighting/snagging with neighboring blocks.
    const shape = new CANNON.Box(new CANNON.Vec3(0.98 * sX, 0.5 * sY, 0.98 * sZ));

    // Raise the shape by half its height so it sits flush on the ground.
    this.body.addShape(shape, new CANNON.Vec3(0, 0.5 * sY, 0));

    // --- 3. GLOBAL PLACEMENT ---
    this.body.position.set(x, y, z);

    const quat = new CANNON.Quaternion();
    quat.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotationY);
    this.body.quaternion.copy(quat);

    world.addBody(this.body);
  }
}