import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ENDING_MODELS, TEXTURES } from "../../core/Assets/manifest.js";
import { assetUrl } from "../../core/Assets/basePath.js";
import { enableShadows } from "../../utils/shadows.js";
import { normalizeMaterials } from "../../utils/materials.js";

/**
 * EndingZone.js — the epilogue reached after collecting every star: a grass
 * field with Peach's castle and Peach herself, built from
 * assets/levels/peach_castle.json and reached by teleport (see ObstacleZone.js),
 * far out at z ≈ -400. Pure scenery — no lava, no enemies, ringed by
 * invisible walls so falling off the edge is impossible, not just unlikely.
 */

// Perimeter fence dimensions, sized to clear the shared jump apex (5.4 units)
// just enough to be un-hoppable — the real barrier is _buildBoundaryWalls' invisible wall.
const FENCE = {
  depth: 0.8, // thickness of the low wall the railing stands on
  baseHeight: 1.6,
  barHeight: 4.4,
  barSize: 0.16,
  barSpacing: 1.8,
  railHeight: 0.35,
  railDepth: 0.5,
  postEvery: 12, // one stone pillar roughly every N units along each side
  postSize: 1.2,
  postExtra: 0.7, // how far the pillars rise above the railing
  capHeight: 0.4,
  stoneColor: 0xc9c4bb, // the castle's masonry
  metalColor: 0xd9a441, // its gold trim
};

export default class EndingZone {
  // Stores the scene/physics references and resets zone state. Nothing is
  // built yet — call load() to actually populate the zone.
  constructor(scene, physicsEngine) {
    this.scene = scene;
    this.physicsEngine = physicsEngine;
    this.loader = new GLTFLoader();

    // Where the win screen's button drops the player (see main.js's
    // onReachPeach). Stays null if load() failed, telling the caller not to teleport.
    this.entryPoint = null;
    this.castle = null;
    this.peach = null;
  }

  // Fetches the zone's JSON and builds ground/castle/Peach into the scene
  // and physics world. Returns null (entryPoint stays null) if anything essential failed.
  async load(jsonPath = "./assets/levels/peach_castle.json") {
    let data;
    try {
      const res = await fetch(assetUrl(jsonPath));
      data = await res.json();
    } catch (e) {
      console.warn(`[EndingZone] Failed to load ${jsonPath}:`, e);
      return null;
    }

    const ground = data.ground || {
      x: 0,
      y: 6,
      z: -400,
      size: { x: 110, y: 2, z: 140 },
    };
    const groundTop = ground.y + ground.size.y / 2;

    this._buildGround(ground);

    // The visible fence and invisible walls both come from this one
    // perimeter, so a collider can never end up where no fence is visible.
    const perimeter = this._perimeter(ground);
    this._buildFence(perimeter);
    this._buildBoundaryWalls(perimeter, data.wallHeight || 24);

    // Castle first: Peach's placement doesn't depend on it, but loading it
    // first surfaces a failure there before anything else goes wrong.
    this.castle = await this._placeModel(ENDING_MODELS.peachCastle, data.castle, groundTop, {
      collider: true,
    });
    this.peach = await this._placeModel(ENDING_MODELS.peach, data.peach, groundTop, {
      collider: true,
      pose: (model) => this._lowerArms(model),
    });

    this.entryPoint = data.entryPoint || { x: 0, y: groundTop + 2, z: -368 };
    return data;
  }

  // The grass slab everything stands on: same textured-box recipe as the
  // island's own platforms (LevelLoader.buildPlatforms).
  _buildGround(cfg) {
    const grass = new THREE.TextureLoader().load(TEXTURES.groundGrass);
    grass.wrapS = THREE.RepeatWrapping;
    grass.wrapT = THREE.RepeatWrapping;
    grass.repeat.set(40, 40);
    grass.colorSpace = THREE.SRGBColorSpace;

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.size.x, cfg.size.y, cfg.size.z),
      new THREE.MeshStandardMaterial({
        map: grass,
        color: 0xcccccc,
        roughness: 0.8,
        envMapIntensity: 0.4,
      }),
    );
    mesh.position.set(cfg.x, cfg.y, cfg.z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const world = this.physicsEngine?.world || this.physicsEngine;
    if (world) {
      world.addBody(
        new CANNON.Body({
          mass: 0,
          shape: new CANNON.Box(
            new CANNON.Vec3(cfg.size.x / 2, cfg.size.y / 2, cfg.size.z / 2),
          ),
          position: new CANNON.Vec3(cfg.x, cfg.y, cfg.z),
          material: this.physicsEngine?.defaultMaterial,
        }),
      );
    }
  }

  // The line the whole boundary is built from: the fence's centreline, inset half
  // its thickness. Returns the four runs (centre/length/axis) and corners both need.
  _perimeter(cfg) {
    const groundTop = cfg.y + cfg.size.y / 2;
    const inset = FENCE.depth / 2;

    const minX = cfg.x - cfg.size.x / 2 + inset;
    const maxX = cfg.x + cfg.size.x / 2 - inset;
    const minZ = cfg.z - cfg.size.z / 2 + inset;
    const maxZ = cfg.z + cfg.size.z / 2 - inset;

    return {
      groundTop,
      // outX/outZ point away from the middle of the zone: the colliders use
      // them to sit on the outer side of the fence, over the drop.
      runs: [
        { x: cfg.x, z: minZ, length: maxX - minX, axis: "x", outX: 0, outZ: -1 }, // north
        { x: cfg.x, z: maxZ, length: maxX - minX, axis: "x", outX: 0, outZ: 1 }, // south
        { x: minX, z: cfg.z, length: maxZ - minZ, axis: "z", outX: -1, outZ: 0 }, // west
        { x: maxX, z: cfg.z, length: maxZ - minZ, axis: "z", outX: 1, outZ: 0 }, // east
      ],
      corners: [
        { x: minX, z: minZ },
        { x: maxX, z: minZ },
        { x: minX, z: maxZ },
        { x: maxX, z: maxZ },
      ],
    };
  }

  // The visible fence: a low stone wall carrying gold railings, with stone pillars
  // at corners and along each side. Bars are one InstancedMesh (like Decorations' grass).
  _buildFence(perimeter) {
    const stone = new THREE.MeshStandardMaterial({
      color: FENCE.stoneColor,
      roughness: 0.9,
      metalness: 0.0,
      envMapIntensity: 0.4,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: FENCE.metalColor,
      roughness: 0.45,
      metalness: 0.35,
      envMapIntensity: 0.4,
    });

    const { groundTop } = perimeter;
    const baseY = groundTop + FENCE.baseHeight / 2;
    const barY = groundTop + FENCE.baseHeight + FENCE.barHeight / 2;
    const railY = groundTop + FENCE.baseHeight + FENCE.barHeight + FENCE.railHeight / 2;
    const postHeight = FENCE.baseHeight + FENCE.barHeight + FENCE.railHeight + FENCE.postExtra;

    const barMatrices = [];
    const postSpots = [...perimeter.corners];
    const dummy = new THREE.Object3D();

    for (const run of perimeter.runs) {
      const alongX = run.axis === "x";
      // Each run is stretched by the fence's own thickness so neighbouring
      // runs meet at the corners instead of leaving a notch.
      const spanned = run.length + FENCE.depth;

      const base = new THREE.Mesh(
        new THREE.BoxGeometry(
          alongX ? spanned : FENCE.depth,
          FENCE.baseHeight,
          alongX ? FENCE.depth : spanned,
        ),
        stone,
      );
      base.position.set(run.x, baseY, run.z);
      base.castShadow = true;
      base.receiveShadow = true;
      this.scene.add(base);

      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(
          alongX ? spanned : FENCE.railDepth,
          FENCE.railHeight,
          alongX ? FENCE.railDepth : spanned,
        ),
        metal,
      );
      rail.position.set(run.x, railY, run.z);
      rail.castShadow = true;
      this.scene.add(rail);

      // Pillars spread evenly along this run, corners excluded (they were
      // already added above, shared between the two runs that meet there).
      const gaps = Math.max(1, Math.round(run.length / FENCE.postEvery));
      for (let i = 1; i < gaps; i++) {
        const offset = -run.length / 2 + (i * run.length) / gaps;
        postSpots.push({
          x: alongX ? run.x + offset : run.x,
          z: alongX ? run.z : run.z + offset,
        });
      }

      // Bars, skipping any that would end up buried inside a pillar.
      const barCount = Math.floor(run.length / FENCE.barSpacing);
      for (let i = 0; i <= barCount; i++) {
        const offset = -run.length / 2 + (i * run.length) / barCount;
        const bx = alongX ? run.x + offset : run.x;
        const bz = alongX ? run.z : run.z + offset;

        const insidePost = postSpots.some(
          (p) =>
            Math.abs(p.x - bx) < FENCE.postSize / 2 &&
            Math.abs(p.z - bz) < FENCE.postSize / 2,
        );
        if (insidePost) continue;

        dummy.position.set(bx, barY, bz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        barMatrices.push(dummy.matrix.clone());
      }
    }

    const bars = new THREE.InstancedMesh(
      new THREE.BoxGeometry(FENCE.barSize, FENCE.barHeight, FENCE.barSize),
      metal,
      barMatrices.length,
    );
    bars.castShadow = false;
    bars.receiveShadow = false;
    barMatrices.forEach((m, i) => bars.setMatrixAt(i, m));
    this.scene.add(bars);

    // Pillars and their caps get the same instanced treatment as the bars —
    // there are a few dozen of each and they are all identical.
    const posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(FENCE.postSize, postHeight, FENCE.postSize),
      stone,
      postSpots.length,
    );
    const caps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(FENCE.postSize * 1.25, FENCE.capHeight, FENCE.postSize * 1.25),
      stone,
      postSpots.length,
    );
    posts.castShadow = caps.castShadow = true;
    posts.receiveShadow = true;

    postSpots.forEach((spot, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);

      dummy.position.set(spot.x, groundTop + postHeight / 2, spot.z);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);

      dummy.position.set(spot.x, groundTop + postHeight + FENCE.capHeight / 2, spot.z);
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
    });

    this.scene.add(posts);
    this.scene.add(caps);
  }

  // Four invisible boxes on the same perimeter as the fence, far taller than
  // the fence looks — so no amount of bouncing can put the player on the wrong side.
  _buildBoundaryWalls(perimeter, wallHeight) {
    const world = this.physicsEngine?.world || this.physicsEngine;
    if (!world) return;

    const thickness = 4;
    const centerY = perimeter.groundTop + wallHeight / 2;
    // The wall's inner face lines up with the fence's inner face, so the player
    // is stopped right where the stonework is.
    const shift = thickness / 2 - FENCE.depth / 2;

    for (const run of perimeter.runs) {
      const alongX = run.axis === "x";

      // Extended past the corners on both ends so the ring closes with no
      // gaps for the player to slip through diagonally.
      const spanned = run.length + thickness * 2;

      world.addBody(
        new CANNON.Body({
          mass: 0,
          shape: new CANNON.Box(
            new CANNON.Vec3(
              (alongX ? spanned : thickness) / 2,
              wallHeight / 2,
              (alongX ? thickness : spanned) / 2,
            ),
          ),
          position: new CANNON.Vec3(
            run.x + run.outX * shift,
            centerY,
            run.z + run.outZ * shift,
          ),
          material: this.physicsEngine?.defaultMaterial,
        }),
      );
    }
  }

  // Peach's model ships T-posed; brings her arms down along her sides by aiming
  // bones in WORLD space (clipFactory's limbDir trick) so it survives a re-export.
  _lowerArms(model) {
    const bones = {};
    model.traverse((o) => {
      if (!o.isBone) return;
      for (const key of ["ArmL1", "ArmL2", "ArmR1", "ArmR2"]) {
        if (!bones[key] && o.name.startsWith(key)) bones[key] = o;
      }
    });

    // Upper arm down and slightly away from the dress, forearm a touch
    // further in and forward so the hands don't clip through the skirt.
    const aim = [
      ["ArmL1", "ArmL2", [0.3, -1, 0.05]],
      ["ArmR1", "ArmR2", [-0.3, -1, 0.05]],
      ["ArmL2", null, [0.16, -1, 0.22]],
      ["ArmR2", null, [-0.16, -1, 0.22]],
    ];

    model.updateMatrixWorld(true);

    for (const [boneKey, childKey, dir] of aim) {
      const bone = bones[boneKey];
      if (!bone) continue;
      // The bone's own direction is the line from it to its child (the next
      // joint down the arm); for the forearm, the wrist.
      const child = childKey ? bones[childKey] : bone.children.find((c) => c.isBone);
      if (!child) continue;

      this._aimBone(bone, child, new THREE.Vector3(...dir).normalize());
      model.updateMatrixWorld(true);
    }
  }

  // Rotates `bone` so that the direction bone -> child points along `target`
  // (a world-space unit vector), leaving the rest of the skeleton alone.
  _aimBone(bone, child, target) {
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    bone.getWorldPosition(from);
    child.getWorldPosition(to);

    const current = to.sub(from).normalize();
    if (current.lengthSq() === 0) return;

    // World-space correction, then expressed in the parent's space, which
    // is what bone.quaternion is measured in.
    const correction = new THREE.Quaternion().setFromUnitVectors(current, target);
    const world = new THREE.Quaternion();
    bone.getWorldQuaternion(world);

    const parentWorld = new THREE.Quaternion();
    if (bone.parent) bone.parent.getWorldQuaternion(parentWorld);

    bone.quaternion.copy(parentWorld.invert().multiply(correction).multiply(world));
  }

  // Loads one GLB, scales it to cfg.height, and drops it on the ground at cfg.x/z
  // inside a wrapper group (so the group's position is always "where this stands").
  async _placeModel(path, cfg, groundTop, { collider, pose }) {
    if (!cfg) return null;

    let gltf;
    try {
      gltf = await this.loader.loadAsync(path);
    } catch (e) {
      console.warn(`[EndingZone] ${path} not found — skipping.`, e);
      return null;
    }

    const model = gltf.scene;
    normalizeMaterials(model);
    enableShadows(model, { castShadow: true, receiveShadow: true });

    // Before any measuring: a T-posed model is wider than the same model standing
    // normally, and that width would end up baked into the scale and collider.
    if (pose) pose(model);

    // Measure at scale 1 first, then scale to the requested height.
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = cfg.height && size.y > 0 ? cfg.height / size.y : 1;
    model.scale.setScalar(scale);

    // Re-measure once scaled and shift the model so its footprint is centered on
    // the origin and its base sits at y = 0, within the group.
    model.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(model);
    const center = scaled.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -scaled.min.y, -center.z);

    const group = new THREE.Group();
    group.add(model);
    group.position.set(cfg.x, groundTop, cfg.z);
    if (cfg.rotationY) group.rotation.y = cfg.rotationY;
    this.scene.add(group);

    if (collider) {
      const s = scaled.getSize(new THREE.Vector3());
      const world = this.physicsEngine?.world || this.physicsEngine;
      if (world) {
        // One box around the whole building: generous at the corners since the
        // towers are narrower than the base, but a per-tower shape buys nothing here.
        world.addBody(
          new CANNON.Body({
            mass: 0,
            shape: new CANNON.Box(new CANNON.Vec3(s.x / 2, s.y / 2, s.z / 2)),
            position: new CANNON.Vec3(cfg.x, groundTop + s.y / 2, cfg.z),
            material: this.physicsEngine?.defaultMaterial,
          }),
        );
      }
    }

    return group;
  }
}
