import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
// Casing matches the actual folder name ("Buildings") for case-sensitive hosts.
import BuildingFactory from "../Buildings/BuildingFactory.js";
import { BUILDING_MODEL_DIR, NPC_MODEL_DIR, MAP_MODELS, TEXTURES } from "../../core/Assets/manifest.js";
import { assetUrl } from "../../core/Assets/basePath.js";
import { normalizeMaterials } from "../../utils/materials.js";
import NPC from "../NPC.js";

/**
 * Owns the STATIC part of a level: parsing the level JSON, building ground
 * platforms, and spawning buildings/hills/NPCs via BuildingFactory.
 * Collectibles and decorations live in their own modules (see
 * Collectibles.js, Decorations.js).
 */
export default class LevelLoader {
  constructor(scene, physicsWorld, gltfLoader) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.loader = gltfLoader;
  }

  // Fetches/parses the level JSON. Returns null (with a warning) if
  // missing or malformed, so callers can fall back to sensible defaults.
  async loadLevelData(levelJsonPath) {
    try {
      const response = await fetch(assetUrl(levelJsonPath));
      return await response.json();
    } catch (e) {
      console.warn("[LevelLoader] Could not load level JSON:", levelJsonPath);
      return null;
    }
  }

  // Builds one static box (mesh + collider) per platform entry. Returns
  // nothing; the shared ground texture is built fresh here.
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
        // Darkened and capped envMapIntensity — same fix normalizeMaterials
        // applies to GLTFs, done manually since this isn't loaded from one.
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
          // Every Toad House variant currently shares this same red model.
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

    // Returned so main.js can look NPCs up by type and register their
    // interactions (e.g. Toad's quest dialogue) — see js/interactions/.
    const npcInstances = [];

    for (const npc of npcsData) {
      try {
        const glb = await this.loader.loadAsync(`${NPC_MODEL_DIR}${npc.type}.glb`);
        const mesh = glb.scene.clone();
        normalizeMaterials(mesh);

        // Static box collider (see NPC.js) — without it nothing stopped
        // the player from walking straight through an NPC.
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
