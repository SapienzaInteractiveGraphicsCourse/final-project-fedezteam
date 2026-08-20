import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { DRACO_DECODER_PATH, TEXTURES } from "../core/Assets/manifest.js";
import LevelLoader from "./Level/LevelLoader.js";
import Collectibles from "./Level/Collectibles.js";
import Decorations from "./Level/Decorations.js";

/**
 * Loads and owns everything that makes up a playable level. Acts as a thin
 * facade over three collaborators so each concern stays small and testable
 * on its own:
 *  - LevelLoader: level JSON parsing, ground platforms, buildings/hills/NPCs.
 *  - Collectibles: coins, stars, mushrooms, "?" blocks, and pickup detection.
 *  - Decorations: trees, flowers, rocks, bushes, ponds, coin trails, house
 *    surroundings, the instanced grass field, the sky planets (the main
 *    walkable "red" planet + satellites, and a small purely-decorative
 *    blue planet), and the warp stars. Also gives rocks/palm trees a
 *    static collider, applies the pond "wading" effect, and gives the red
 *    planet a static collider plus a GravityField so the player can walk
 *    around it Mario Galaxy-style once warped there, so it needs
 *    physicsWorld like LevelLoader/Collectibles.
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
    this.decorations = new Decorations(this.scene, this.physicsWorld, this.loader);
  }

  async loadLevel(levelJsonPath = "./assets/levels/level1.json") {
    const levelData = await this.levelLoader.loadLevelData(levelJsonPath);

    this.playerSpawn = levelData?.playerSpawn || { x: 0, y: 1, z: 0 };
    this.yoshiSpawn = levelData?.yoshiSpawn || { x: 5, y: 1, z: -5 };

    // So the "spawn" warp star (see spawnWarpStars below) has somewhere to
    // send the player back to.
    this.decorations.setSpawnPoint(this.playerSpawn);

    const platformsData = levelData?.platforms || [];
    this.levelLoader.buildPlatforms(platformsData);

    // Preload the mushroom model once, reused by "?" blocks at runtime.
    await this.collectibles.preloadMushroomModel();

    const mainIslandSize = platformsData[0]?.size.x || 60;

    await this.decorations.spawnFieldProps(mainIslandSize, (coinMesh) =>
      this.collectibles.registerCoin(coinMesh),
    );

    // Curated coin trail guiding the player up the hill staircase in
    // level1.json ("Scalino 1/2/3", around x=30..50, z=20). Hand-placed to
    // match that specific level layout, on top of the random field scatter.
    await this.decorations.spawnCoinTrail(
      [
        { x: 25, y: 2.5, z: 20 },
        { x: 30, y: 3.5, z: 20 },
        { x: 40, y: 5.0, z: 20 },
        { x: 50, y: 7.5, z: 20 },
      ],
      (coinMesh) => this.collectibles.registerCoin(coinMesh),
      { spacing: 2, arcHeight: 0.4 },
    );

    // Same idea as above, one coin trail per new hill staircase added for
    // the "big package" map pass (see level1.json: "Passerella Est/Ovest/
    // Sud"). Heights are hand-tuned to roughly follow each staircase's
    // step tops, ending near that staircase's star.
    await this.decorations.spawnCoinTrail(
      [
        { x: 60, y: 2.3, z: 70 },
        { x: 70, y: 3.5, z: 70 },
        { x: 83, y: 4.9, z: 70 },
        { x: 96, y: 7.5, z: 70 },
      ],
      (coinMesh) => this.collectibles.registerCoin(coinMesh),
      { spacing: 2, arcHeight: 0.4 },
    );
    await this.decorations.spawnCoinTrail(
      [
        { x: -60, y: 2.3, z: 45 },
        { x: -70, y: 3.5, z: 45 },
        { x: -83, y: 4.9, z: 45 },
        { x: -96, y: 7.5, z: 45 },
      ],
      (coinMesh) => this.collectibles.registerCoin(coinMesh),
      { spacing: 2, arcHeight: 0.4 },
    );
    await this.decorations.spawnCoinTrail(
      [
        { x: -15, y: 2.3, z: 80 },
        { x: -15, y: 3.5, z: 90 },
        { x: -15, y: 4.9, z: 103 },
        { x: -15, y: 7.5, z: 116 },
      ],
      (coinMesh) => this.collectibles.registerCoin(coinMesh),
      { spacing: 2, arcHeight: 0.4 },
    );

    await this.collectibles.spawnStars(levelData?.stars);
    await this.collectibles.spawnMushrooms(levelData?.mushrooms);
    await this.collectibles.spawnQuestionMarkBlocks(levelData?.questionMarkBlocks);
    await this.levelLoader.buildBuildingsAndNPCs(
      levelData?.buildings,
      levelData?.npcs,
      levelData?.hills,
    );
    this.decorations.decorateStructures(levelData?.buildings);

    await this.decorations.spawnGrassField(mainIslandSize);
    this.decorations.spawnRocks(mainIslandSize);
    this.decorations.spawnBushes(mainIslandSize);

    // Small decorative ponds, hand-placed to stay clear of buildings, hills
    // and staircases. Purely visual (flat water disc, no collider/depth).
    this.decorations.spawnPonds([
      { x: 60, z: -60, radius: 7 },
      { x: -60, z: 75, radius: 6 },
      { x: 20, z: 95, radius: 5 },
      { x: -95, z: -70, radius: 6 },
      { x: 95, z: 20, radius: 5 },
    ]);

    // Only the main "red" sky planet is walkable (see
    // Decorations._addPlanetPhysics, called from spawnSkyPlanet) — the blue
    // planet and satellites stay purely decorative background dressing.
    this.decorations.spawnSkyPlanet();
    this.decorations.spawnSatellitePlanets();
    this.decorations.spawnBluePlanet();

    // A handful of coins scattered across the red planet's surface, plus
    // one star, both findable while walking around it.
    await this.decorations.spawnPlanetCoins(
      this.decorations.skyPlanet,
      this.decorations.skyPlanetRadius,
      8,
      (coinMesh) => this.collectibles.registerCoin(coinMesh),
    );

    // One collectible star on the red planet too, a short walk from where
    // the "sky" warp star lands the player (see spawnWarpStars below).
    await this.collectibles.spawnStars([{ x: -254, y: 214, z: 10 }]);

    // Mario Galaxy-style warp stars. "sky" sends the player to the red
    // planet; the white star waiting right where they land sends them back
    // to spawn; the two fiery orange ones at the island's edges send them
    // to the separate Kamek obstacle course; the single dark-red one sends
    // them to the separate Bowser obstacle course instead (see
    // Decorations.spawnWarpStars/_updateWarpStars and
    // entities/Level/ObstacleZone.js, wired up from main.js).
    await this.decorations.spawnWarpStars([
      { x: 118, y: 4, z: -30, color: 0xffd54f, target: "sky" }, // -> the red planet
      { x: -260, y: 220, z: 0, color: 0xffffff, target: "spawn" }, // next to the red planet's landing spot -> back to spawn
      // { x: -118, y: 4, z: -80, color: 0xff5722, target: "kamek_zone" }, // -> Kamek's obstacle course
      { x: 60, y: 4, z: 115, color: 0xff5722, target: "kamek_zone" }, // -> Kamek's obstacle course
      { x: -60, y: 4, z: 115, color: 0xb71c1c, target: "bowser_zone" }, // -> Bowser's obstacle course
    ]);

    // A sign next to each warp star above bearing the matching zone's
    // logo, so the destination is clear before stepping on the star. Each
    // sign sits a few units further from the map center than its star (so
    // the player reads it on approach, before reaching the star itself)
    // and faces back toward the center so its face is visible from that
    // approach direction — see Decorations.spawnZoneSigns.
    const zoneStars = [
      // { x: -118, z: -80, logo: TEXTURES.kamekLogo },
      { x: 60, z: 115, logo: TEXTURES.kamekLogo },
      { x: -60, z: 115, logo: TEXTURES.gameoverLogo },
    ];
    await this.decorations.spawnZoneSigns(
      zoneStars.map(({ x, z, logo }) => {
        const dist = Math.hypot(x, z) || 1;
        const dirX = x / dist;
        const dirZ = z / dist;
        return {
          x: x + dirX * 3,
          y: 4,
          z: z + dirZ * 3,
          // Face back toward the map center (the direction a player
          // walking out to the star would be approaching from).
          rotationY: Math.atan2(dirX, dirZ) + Math.PI,
          logo,
        };
      }),
    );
  }

  // Per-frame update: delegates collectible pickup checks and decoration
  // animation (the sky planet's spin, its satellites' orbits, and the
  // pond "wading" effect, which needs the player to check against).
  update(delta, player, onCoinCollected, onStarCollected, onMushroomCollected) {
    this.collectibles.update(player, onCoinCollected, onStarCollected, onMushroomCollected);
    this.decorations.update(delta, player);
  }
}
