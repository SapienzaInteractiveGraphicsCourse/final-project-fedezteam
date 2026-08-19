import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { DRACO_DECODER_PATH } from "../core/Assets/manifest.js";
import LevelLoader from "./Level/LevelLoader.js";
import Collectibles from "./Level/Collectibles.js";
import Decorations from "./Level/Decorations.js";

/**
 * Loads and owns everything that makes up a playable level. Acts as a thin
 * facade over three collaborators so each concern stays small and testable
 * on its own:
 *  - LevelLoader: level JSON parsing, ground platforms, buildings/hills/NPCs.
 *  - Collectibles: coins, stars, mushrooms, "?" blocks, and pickup detection.
 *  - Decorations: trees, flowers, the instanced grass field, the sky planet.
 *
 * Renamed from "Map" to avoid shadowing the native JS Map class.
 */
export default class GameLevel {
  constructor(physicsWorld) {
    this.scene = new THREE.Group();
    this.physicsWorld = physicsWorld;

    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    this.loader.setDRACOLoader(dracoLoader);
    this.loader.setResourcePath("assets/");

    this.playerSpawn = null;
    this.yoshiSpawn = null;

    this.levelLoader = new LevelLoader(this.scene, this.physicsWorld, this.loader);
    this.collectibles = new Collectibles(this.scene, this.physicsWorld, this.loader);
    this.decorations = new Decorations(this.scene, this.loader);
  }

  async loadLevel(levelJsonPath = "./assets/levels/level1.json") {
    const levelData = await this.levelLoader.loadLevelData(levelJsonPath);

    this.playerSpawn = levelData?.playerSpawn || { x: 0, y: 1, z: 0 };
    this.yoshiSpawn = levelData?.yoshiSpawn || { x: 5, y: 1, z: -5 };

    const platformsData = levelData?.platforms || [];
    this.levelLoader.buildPlatforms(platformsData);

    // Preload the mushroom model once, reused by "?" blocks at runtime.
    await this.collectibles.preloadMushroomModel();

    const mainIslandSize = platformsData[0]?.size.x || 60;

    await this.decorations.spawnFieldProps(mainIslandSize, (coinMesh) =>
      this.collectibles.registerCoin(coinMesh),
    );
    await this.collectibles.spawnStars(levelData?.stars);
    await this.collectibles.spawnMushrooms(levelData?.mushrooms);
    await this.collectibles.spawnQuestionMarkBlocks(levelData?.questionMarkBlocks);
    await this.levelLoader.buildBuildingsAndNPCs(
      levelData?.buildings,
      levelData?.npcs,
      levelData?.hills,
    );
    await this.decorations.spawnGrassField(mainIslandSize);

    this.decorations.spawnSkyPlanet();
  }

  // Per-frame update: delegates collectible pickup checks and decoration
  // animation (currently just the sky planet's slow spin).
  update(delta, player, onCoinCollected, onStarCollected, onMushroomCollected) {
    this.collectibles.update(player, onCoinCollected, onStarCollected, onMushroomCollected);
    this.decorations.update(delta);
  }
}
