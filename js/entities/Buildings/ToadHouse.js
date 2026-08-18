import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

export default class ToadHouse {
  constructor(mesh, physicsEngine, data) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;
    this.body = null;

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

    // --- 2. PHYSICS SETUP ---
    const world = this.physicsEngine?.world || this.physicsEngine;
    if (!world) {
      // This used to fail silently: if `physicsEngine` was ever undefined/null
      // for this specific call, the house would render but get NO collider,
      // with no error anywhere. This warning is what you were missing.
      console.warn(
        `[ToadHouse] No physics world available for "${data.type || "toad_house"}" ` +
        `at (${x}, ${y}, ${z}). No collider was created — the mesh is purely visual.`
      );
      return;
    }

    this.body = new CANNON.Body({
      mass: 0,
      material: this.physicsEngine.defaultMaterial,
    });

    // 🛠️ PHYSICS SCALE NORMALIZATION
    // This model's .glb has a huge built-in scale, so the JSON `scale` value
    // (e.g. 0.01) is tiny — correct for the mesh, but far too small for the
    // hitbox constants below (which assume scale ≈ 1). We decouple the two:
    // `scale` keeps driving the VISUAL mesh as before, while `physicsScale`
    // drives the collider size only.
    //
    // How to tune PHYSICS_SCALE_FACTOR: it's the ratio between a "normal"
    // scale (~1) and this model's actual JSON scale. If your working JSON
    // scale is 0.01 and you want the collider sized as if scale were ~1,
    // use factor = 1 / 0.01 = 100. Adjust until the green debug cage matches
    // the visible house.
    const PHYSICS_SCALE_FACTOR = 100;
    const physicsScale = scale * PHYSICS_SCALE_FACTOR;

    // 🛠️ CORRECTION OFFSET (tweak these three values if the green debug cage
    // isn't centered on the model).
    const offX = 0.0; // shift right (+) / left (-)
    const offY = 0.0; // raise (+) / lower (-) relative to the ground
    const offZ = 0.0; // shift forward (+) / backward (-)

    // A. LOW BASE (the circular stone platform).
    const baseShape = new CANNON.Box(
      new CANNON.Vec3(4.5 * physicsScale, 0.3 * physicsScale, 4.5 * physicsScale)
    );
    this.body.addShape(
      baseShape,
      new CANNON.Vec3(
        offX * physicsScale,
        (offY + 0.3) * physicsScale,
        offZ * physicsScale
      )
    );

    // B. TALL BLOCK (the mushroom house body + cap).
    const houseShape = new CANNON.Box(
      new CANNON.Vec3(2.8 * physicsScale, 3.5 * physicsScale, 2.8 * physicsScale)
    );
    this.body.addShape(
      houseShape,
      new CANNON.Vec3(
        offX * physicsScale,
        (offY + 4.1) * physicsScale,
        offZ * physicsScale
      )
    );

    // --- 3. GLOBAL PLACEMENT ---
    this.body.position.set(x, y, z);
    const quat = new CANNON.Quaternion();
    quat.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotationY);
    this.body.quaternion.copy(quat);

    world.addBody(this.body);

    // Temporary debug log — remove once you've confirmed every Toad House
    // variant gets a body. Confirms type, position and shape count in one line.
    console.log(
      `[ToadHouse] Collider created for "${data.type || "toad_house"}" ` +
      `at (${x}, ${y}, ${z}), visual scale ${scale}, physics scale ${physicsScale} ` +
      `(factor ${PHYSICS_SCALE_FACTOR}) — ${this.body.shapes.length} shapes.`
    );
  }
}