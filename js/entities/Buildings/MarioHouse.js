import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import * as THREE from "three";

export default class MarioHouse {
  constructor(mesh, physicsEngine, data) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;

    // Extract data from the level JSON.
    const { x, y, z, scale = 1.0, rotationY = 0 } = data;

    // --- 1. VISUAL SETUP ---
    this.mesh.scale.set(scale, scale, scale);
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = rotationY;

    this.mesh.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // --- 2. PHYSICS SETUP (single compound body) ---
    const world = this.physicsEngine?.world || this.physicsEngine;
    if (!world) {
      console.warn(
        `[MarioHouse] No physics world available for house at (${x}, ${y}, ${z}). ` +
        `No collider was created.`
      );
      return;
    }

    this.body = new CANNON.Body({
      mass: 0, // 0 = static/immovable
      material: this.physicsEngine.defaultMaterial,
    });

    // 🛠️ MANUAL TUNING (local offsets)
    // The 3D model's pivot isn't centered, so these offsets are used to push
    // all hitboxes toward the visual center of the house.
    const offX = -2.0; // depth
    const offY = -3.0; // negative pushes down toward the ground
    const offZ = -1.6; // shifts left/right

    // A. OCTAGONAL PLATFORM (4 rectangles rotated by 45°)
    // "Radius" of the platform (previously a hardcoded 10).
    const baseRadius = 10 * scale;

    // For a regular octagon, the short side is ~41.4% of the long side.
    const baseWidth = baseRadius * 0.414;
    const baseHeight = 0.5 * scale;

    const baseShape = new CANNON.Box(
      new CANNON.Vec3(baseRadius, baseHeight, baseWidth)
    );

    // Create the 4 rotated hitboxes.
    for (let i = 0; i < 4; i++) {
      const angle = i * (Math.PI / 4); // 0°, 45°, 90°, 135° in radians

      const rotQuat = new CANNON.Quaternion();
      rotQuat.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);

      this.body.addShape(
        baseShape,
        // Precomputed center offset.
        new CANNON.Vec3(
          (offX + 2) * scale,
          (offY + 0.4) * scale,
          (offZ + 1.2) * scale
        ),
        rotQuat
      );
    }

    // 🛠️ LENGTH TUNING
    // How much to stretch the house toward the back.
    const stretchX = 2.5;
    // Automatically shift the center back to compensate for the stretch.
    const shiftX = -stretchX;

    // B. HOUSE WALLS (solid blocks)

    // 1. Lower wall base (wider and shorter).
    const lowerWallsShape = new CANNON.Box(
      // stretchX added to the original width.
      new CANNON.Vec3((3.5 + stretchX) * scale, 0.4 * scale, 3.0 * scale)
    );
    this.body.addShape(
      lowerWallsShape,
      // shiftX added to the offset to push it back.
      new CANNON.Vec3(
        (offX + shiftX) * scale,
        (offY + 1.2) * scale,
        offZ * scale
      )
    );

    // 2. Upper main walls.
    const wallsShape = new CANNON.Box(
      // stretchX added to the original width.
      new CANNON.Vec3((2.5 + stretchX) * scale, 2.0 * scale, 2.0 * scale)
    );
    this.body.addShape(
      wallsShape,
      // shiftX added to the offset to push it back.
      new CANNON.Vec3(
        (offX + shiftX) * scale,
        (offY + 2.8) * scale,
        offZ * scale
      )
    );

    // C. STEPS / RAMP (optional, lets Mario walk up smoothly).
    const rampShape = new CANNON.Box(
      new CANNON.Vec3(1.0 * scale, 0.2 * scale, 1.2 * scale)
    );
    const rampQuat = new CANNON.Quaternion();
    rampQuat.setFromEuler(-Math.PI / 6, 0, 0); // tilted downward
    this.body.addShape(
      rampShape,
      new CANNON.Vec3(offX * scale, (offY + 0.2) * scale, (offZ + 3.5) * scale),
      rampQuat
    );

    // --- 3. GLOBAL PLACEMENT ON THE MAP ---
    // Position the body's center at the JSON coordinates.
    this.body.position.set(x, y, z);

    // Apply the JSON rotation to the WHOLE body.
    const houseRot = new CANNON.Quaternion();
    houseRot.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotationY);
    this.body.quaternion.copy(houseRot);

    world.addBody(this.body);
  }
}