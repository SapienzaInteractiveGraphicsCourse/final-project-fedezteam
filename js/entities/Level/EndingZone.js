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
    // Invisible walls around the ground's perimeter — see the class doc
    // and _buildBoundaryWalls itself for why. "wallHeight" is optional in
    // the JSON (defaults below) since the ground's x/z size is what
    // actually defines where the walls go.
    this._buildBoundaryWalls(ground, data.wallHeight || 24);

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
   * Four invisible (no mesh, physics-only) walls ringing the ground's
   * perimeter, tall enough that the player can never jump over them — the
   * mirror image of ObstacleZone's fire poles (a visual with no collider):
   * here it's a collider with no visual. This is what actually makes
   * falling into the void impossible in this zone (the ground being one
   * flat slab, by itself, only made it unlikely — walking off any edge was
   * always still possible before this).
   */
  _buildBoundaryWalls(cfg, wallHeight) {
    const world = this.physicsEngine?.world || this.physicsEngine;
    if (!world) return;

    const halfX = cfg.size.x / 2;
    const halfZ = cfg.size.z / 2;
    const groundTop = cfg.y + cfg.size.y / 2;
    const thickness = 2;
    const centerY = groundTop + wallHeight / 2;

    // Each wall is a thin box just outside one edge of the ground, extended
    // past the corners by `thickness` on both ends so the four walls fully
    // close the ring with no gaps at the corners.
    const walls = [
      { x: cfg.x, z: cfg.z - halfZ - thickness / 2, sizeX: cfg.size.x + thickness * 2, sizeZ: thickness }, // north
      { x: cfg.x, z: cfg.z + halfZ + thickness / 2, sizeX: cfg.size.x + thickness * 2, sizeZ: thickness }, // south
      { x: cfg.x - halfX - thickness / 2, z: cfg.z, sizeX: thickness, sizeZ: cfg.size.z + thickness * 2 }, // west
      { x: cfg.x + halfX + thickness / 2, z: cfg.z, sizeX: thickness, sizeZ: cfg.size.z + thickness * 2 }, // east
    ];

    for (const w of walls) {
      world.addBody(
        new CANNON.Body({
          mass: 0,
          shape: new CANNON.Box(new CANNON.Vec3(w.sizeX / 2, wallHeight / 2, w.sizeZ / 2)),
          position: new CANNON.Vec3(w.x, centerY, w.z),
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
