import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
// Casing matches the actual folder name ("Buildings", capital B) so the
// import also resolves on case-sensitive hosts such as GitHub Pages.
import BuildingFactory from "../Buildings/BuildingFactory.js";
import { BUILDING_MODEL_DIR, NPC_MODEL_DIR, MAP_MODELS, TEXTURES } from "../../core/Assets/manifest.js";
import { normalizeMaterials } from "../../utils/materials.js";
import NPC from "../NPC.js";

/**
 * Owns everything about the STATIC part of a level: parsing the level JSON,
 * building ground platforms, and spawning buildings/hills/NPCs via
 * BuildingFactory. Extracted out of the former monolithic GameLevel.js.
 *
 * Collectibles (coins/stars/mushrooms/"?" blocks) and purely visual
 * decorations (trees/flowers/grass/sky planet) live in their own modules;
 * see Collectibles.js and Decorations.js.
 */
export default class LevelLoader {
  constructor(scene, physicsWorld, gltfLoader) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.loader = gltfLoader;
  }

  /**
   * Fetches and parses the level JSON. Returns null (with a console warning)
   * if the file is missing or malformed, so callers can fall back to
   * sensible defaults instead of throwing.
   */
  async loadLevelData(levelJsonPath) {
    try {
      const response = await fetch(levelJsonPath);
      return await response.json();
    } catch (e) {
      console.warn("[LevelLoader] Could not load level JSON:", levelJsonPath);
      return null;
    }
  }

  /**
   * Builds one static box (visual mesh + collider) per platform entry.
   * Returns the shared ground texture in case callers want to reuse it.
   */
  buildPlatforms(platformsData = []) {
    const textureLoader = new THREE.TextureLoader();
    const grassTexture = textureLoader.load(TEXTURES.groundGrass);
    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.repeat.set(55, 55);
    grassTexture.colorSpace = THREE.SRGBColorSpace;

    const world = this.physicsWorld?.world || this.physicsWorld;

    platformsData.forEach((plat) => {
      const geo = new THREE.BoxGeometry(plat.size.x, plat.size.y, plat.size.z);
      const mat = new THREE.MeshStandardMaterial({
        map: grassTexture,
        roughness: 0.8,
        // Slightly darken the base texture (it's the single biggest
        // surface on screen, so full brightness here reads as the whole
        // level being overexposed) and cap how strongly it reflects the
        // scene's environment map, same cap used everywhere else via
        // normalizeMaterials — this material is built directly rather
        // than loaded from a GLTF, so it never went through that shared
        // fix.
        color: 0xcccccc,
        envMapIntensity: 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(plat.position.x, plat.position.y, plat.position.z);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scene.add(mesh);

      const halfSize = new CANNON.Vec3(
        plat.size.x / 2,
        plat.size.y / 2,
        plat.size.z / 2,
      );
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(halfSize),
        position: new CANNON.Vec3(
          plat.position.x,
          plat.position.y,
          plat.position.z,
        ),
        material: this.physicsWorld?.defaultMaterial,
      });

      if (world) world.addBody(body);
    });
  }

  // Spawns buildings, hills and NPCs described in the level JSON via BuildingFactory.
  async buildBuildingsAndNPCs(buildingsData = [], npcsData = [], hillsData = []) {
    const worldCheck = this.physicsWorld?.world || this.physicsWorld;
    if (!worldCheck) {
      // If this fires, every structure below is spawned visually but with
      // no collider.
      console.warn(
        "[LevelLoader] physicsWorld is missing — structures will have no collider.",
      );
    }

    // Hills go through the same factory as buildings, just tagged with a
    // default type.
    const allStructures = [
      ...buildingsData,
      ...hillsData.map((h) => ({
        ...h,
        type: h.type || "block_grass_large",
      })),
    ];

    for (const b of allStructures) {
      try {
        let glbPath;

        if (b.type.includes("hill") || b.type === "block_grass_large") {
          glbPath = MAP_MODELS.blockGrassLarge;
        } else if (b.type.includes("toad_house")) {
          // NOTE: every Toad House variant currently shares the same red
          // model file. If "toad_house_blue" appears in the JSON, it will
          // still render red.
          glbPath = MAP_MODELS.toadHouseRed;
        } else {
          glbPath = `${BUILDING_MODEL_DIR}${b.type}.glb`;
        }

        const glb = await this.loader.loadAsync(glbPath);
        const mesh = glb.scene.clone();
        normalizeMaterials(mesh);

        const structureInstance = BuildingFactory.create(
          b.type,
          mesh,
          this.physicsWorld,
          b,
        );

        if (structureInstance) {
          this.scene.add(structureInstance.mesh);
        } else {
          console.warn("[LevelLoader] Structure not added to scene:", b);
        }
      } catch (e) {
        console.warn(`[LevelLoader] Could not load structure: ${b.type}`, e);
      }
    }

    // Returned to the caller (see GameLevel.loadLevel's this.npcs) so
    // main.js can look NPCs up by type and register their interactions
    // (e.g. Toad's quest dialogue) — see js/interactions/.
    const npcInstances = [];

    for (const npc of npcsData) {
      try {
        const glb = await this.loader.loadAsync(`${NPC_MODEL_DIR}${npc.type}.glb`);
        const mesh = glb.scene.clone();
        normalizeMaterials(mesh);

        // BUG FIX (missing NPC collision): a bare mesh here used to mean
        // nothing stopped the player from walking straight through an NPC
        // (Toad, ...) — NPC gives it the same static box-collider treatment
        // ToadHouse.js already uses for its own structure. See NPC.js.
        const instance = new NPC(mesh, this.physicsWorld, npc);
        this.scene.add(instance.mesh);
        npcInstances.push(instance);
      } catch (e) {
        console.warn(`[LevelLoader] Could not load NPC: ${npc.type}.glb`);
      }
    }

    return npcInstances;
  }
}
