import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ENDING_MODELS, TEXTURES } from "../../core/Assets/manifest.js";
import { enableShadows } from "../../utils/shadows.js";
import { normalizeMaterials } from "../../utils/materials.js";

/**
 * EndingZone.js — where the player ends up after collecting every star and
 * pressing "REACH PRINCESS PEACH" on the win screen: a wide grass field
 * with Peach's castle on it and Peach herself waiting in front of the
 * entrance.
 *
 * Built from data (assets/levels/peach_castle.json) and reached by
 * teleport, exactly like the two boss courses — see ObstacleZone.js for the
 * reasoning behind "another far-away corner of the same physics world"
 * rather than a real scene switch. It sits around z = -400, well clear of
 * the island (±120), Kamek's course (x 260..320) and Bowser's (x -300..-230).
 *
 * The difference from ObstacleZone is that this one is scenery, not a
 * course: no lava, no enemies, nothing to lose a life to. The ground is a
 * modestly-sized slab (just enough to comfortably fit the entry point, the
 * castle and Peach — see the "ground"/"wallHeight" fields in the JSON)
 * ringed by invisible boundary walls (see _buildBoundaryWalls) so it's
 * actually impossible to walk off the edge into the void, rather than just
 * unlikely — the run is over at this point, the reward shouldn't be able to
 * kill them.
 *
 * Both models are placed by MEASURING them rather than by trusting numbers
 * in the JSON: each is scaled to the height the level file asks for and
 * then shifted so its base rests exactly on the ground and its footprint is
 * centered on the requested x/z. Peach's model is ~4.8 units tall and the
 * castle only ~1.1, with its origin off to one side — hardcoded offsets
 * would silently break the moment either file is re-exported.
 */
/**
 * Dimensions of the perimeter fence. Its height is set against MARIO's jump
 * and nothing else: he leaves the ground at 18 u/s against a gravity of 30
 * (see EntityManager's per-character stats and PhysicsEngine), so he peaks
 * 18^2 / (2 * 30) = 5.4 units up. The railing tops out at 6.35 and the
 * stone pillars at 7.45 — over it, but only just, which is the point: a
 * fence sized to be un-hoppable rather than sized to loom.
 *
 * Luigi jumps far higher (22 u/s, 8.07 units) and does clear the railing
 * for now. He still can't get out: _buildBoundaryWalls puts an invisible
 * wall on the same line that is several times this tall, so what he hits
 * mid-air is that instead. Whether that's fixed by raising the fence or by
 * bringing his jump back in line is a decision about him, not about here.
 */
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
    // onReachPeach). Stays null if load() failed, which is what tells the
    // caller not to teleport anyone.
    this.entryPoint = null;
    this.castle = null;
    this.peach = null;
  }

  /**
   * Fetches the zone's JSON file and builds the ground, the castle and
   * Peach into the scene and physics world. Returns the parsed data, or
   * null if anything essential failed (logged via console.warn) — in which
   * case entryPoint stays null and the ending teleport is simply skipped.
   */
  async load(jsonPath = "./assets/levels/peach_castle.json") {
    let data;
    try {
      const res = await fetch(jsonPath);
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

    // The visible fence and the invisible walls are both laid out from this
    // one perimeter, so a collider can never end up somewhere other than
    // where the player can see a fence. "wallHeight" is optional in the
    // JSON (default below) since the ground's x/z size is what actually
    // decides where the ring goes.
    const perimeter = this._perimeter(ground);
    this._buildFence(perimeter);
    this._buildBoundaryWalls(perimeter, data.wallHeight || 24);

    // The castle first: Peach's own placement doesn't depend on it (the
    // level file positions her directly), but loading it first means a
    // failure there is reported before anything else goes wrong.
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
  // island's own platforms (see LevelLoader.buildPlatforms), including the
  // slight darkening that keeps a surface this large from reading as
  // overexposed.
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

  /**
   * The single line the whole boundary is built from: the centre line of
   * the fence, pulled half its own thickness inside the ground's edge so
   * the fence stands ON the grass rather than hanging over the drop.
   *
   * Returns the four runs that make up the ring, each with its centre, its
   * length, and which axis it runs along — everything the fence and the
   * colliders need, worked out once.
   */
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

  /**
   * The visible fence: a low stone wall carrying a run of gold railings,
   * with stone pillars at the corners and at intervals along each side.
   *
   * The bars are one InstancedMesh rather than ~250 separate meshes (same
   * treatment the grass gets in Decorations.spawnFieldProps) — it's a
   * single draw call, and the fence is on screen for the whole ending. They
   * also don't cast shadows: at 0.18 units thick each one contributes
   * nothing readable to the shadow map and they are by far the most
   * numerous thing here.
   */
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

  /**
   * The colliders behind the fence: four invisible boxes sitting on the
   * exact same perimeter, each one starting at the fence's inner face and
   * extending outward over the drop, where there is nothing else to get in
   * the way. They are far taller than the fence looks (`wallHeight`), which
   * costs nothing and means no amount of bouncing off scenery can ever put
   * the player on the wrong side of it.
   */
  _buildBoundaryWalls(perimeter, wallHeight) {
    const world = this.physicsEngine?.world || this.physicsEngine;
    if (!world) return;

    const thickness = 4;
    const centerY = perimeter.groundTop + wallHeight / 2;
    // The wall's inner face lines up with the fence's inner face, so the
    // player is stopped right where the stonework is rather than a stride
    // short of it or a stride past it.
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

  /**
   * Peach's model ships in a T-pose (it has a full skeleton but not a single
   * animation), which next to the castle reads as an unfinished import
   * rather than a princess waiting outside her door. This brings her arms
   * down along her sides.
   *
   * The rotation is worked out in WORLD space — "point this bone from where
   * it currently aims to where I want it to aim" — instead of by picking
   * euler angles per joint. Bone local axes are whatever the artist's rig
   * happened to use, so hand-written angles only ever work for one specific
   * model; aiming is the same trick clipFactory's limbDir uses for Mario
   * and Luigi, and it survives a re-export.
   */
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
      // joint down the arm); for the forearm, whatever child the rig gives
      // it — the wrist.
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

  /**
   * Loads one GLB and drops it on the ground at cfg.x/cfg.z, scaled so it
   * ends up cfg.height units tall. Returns the placed Object3D, or null if
   * the file couldn't be loaded.
   *
   * The model is wrapped in a group and the model itself is offset inside
   * it, so the group's position is the honest "where this thing stands"
   * value regardless of where the artist left the model's origin.
   */
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

    // Before any measuring: a T-posed model is wider than the same model
    // standing normally, and that width would end up baked into both the
    // scale and the collider computed below.
    if (pose) pose(model);

    // Measure at scale 1 first, then scale to the requested height.
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = cfg.height && size.y > 0 ? cfg.height / size.y : 1;
    model.scale.setScalar(scale);

    // Re-measure once scaled and shift the model so its footprint is
    // centered on the origin and its base sits at y = 0 — both within the
    // group, so the group can then simply be moved where it belongs.
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
        // One box around the whole building. The towers are narrower than
        // the base so this is generous at the corners, but the alternative
        // (a shape per tower) buys nothing here: there is nothing to do
        // inside the castle, the collider exists only to stop the player
        // from walking through the walls.
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
