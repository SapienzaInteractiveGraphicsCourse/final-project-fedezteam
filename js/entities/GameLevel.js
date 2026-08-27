import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { DRACO_DECODER_PATH, TEXTURES } from "../core/Assets/manifest.js";
import { assetUrl } from "../core/Assets/basePath.js";
import LevelLoader from "./Level/LevelLoader.js";
import Collectibles from "./Level/Collectibles.js";
import Decorations from "./Level/Decorations.js";

/**
 * Loads and owns a playable level as a thin facade over three
 * collaborators: LevelLoader (JSON parsing, platforms, buildings/hills/
 * NPCs), Collectibles (coins/stars/mushrooms/blocks + pickup detection),
 * and Decorations (scenery, sky planets, warp stars, and the red
 * planet's GravityField). Renamed from "Map" to avoid shadowing JS' own.
 */
export default class GameLevel {
  constructor(physicsWorld) {
    this.scene = new THREE.Group();
    this.physicsWorld = physicsWorld;

    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    this.loader.setDRACOLoader(dracoLoader);
    // Only matters for .gltf files with external buffers/textures — the
    // level's own models are all self-contained .glb.
    this.loader.setResourcePath(assetUrl("assets/"));

    this.playerSpawn = null;
    this.yoshiSpawn = null;
    this.npcs = [];

    this.levelLoader = new LevelLoader(this.scene, this.physicsWorld, this.loader);
    this.collectibles = new Collectibles(this.scene, this.physicsWorld, this.loader);
    this.decorations = new Decorations(this.scene, this.physicsWorld, this.loader);
  }

  async loadLevel(levelJsonPath = "./assets/levels/level1.json") {
    const levelData = await this.levelLoader.loadLevelData(levelJsonPath);

    this.playerSpawn = levelData?.playerSpawn || { x: 0, y: 1, z: 0 };
    this.yoshiSpawn = levelData?.yoshiSpawn || { x: 5, y: 1, z: -5 };

    // So the "spawn" warp star (see spawnWarpStars below) has a destination.
    this.decorations.setSpawnPoint(this.playerSpawn);

    const platformsData = levelData?.platforms || [];
    this.levelLoader.buildPlatforms(platformsData);

    // Preload the mushroom model once, reused by "?" blocks at runtime.
    await this.collectibles.preloadMushroomModel();

    const mainIslandSize = platformsData[0]?.size.x || 60;

    // Footprint of every HillBlock platform, read from the raw JSON before
    // it's built, so the prop scatter below can avoid landing inside one.
    const hillFootprints = (levelData?.hills || []).map((h) => {
      const sX = h.scaleX !== undefined ? h.scaleX : (h.scale ?? 1);
      const sZ = h.scaleZ !== undefined ? h.scaleZ : (h.scale ?? 1);
      return { x: h.x || 0, z: h.z || 0, halfX: 0.98 * sX, halfZ: 0.98 * sZ };
    });

    // Round exclusion zones around each warp star + sign (red planet's
    // own star excluded — it's up on the sky planet, not in this scatter).
    const warpAvoidPoints = [
      { x: 118, z: -30 }, // -> the red planet
      { x: 60, z: 115 }, // -> Kamek's obstacle course (+ its sign)
      { x: -60, z: 115 }, // -> Bowser's obstacle course (+ its sign)
    ];

    await this.decorations.spawnFieldProps(
      mainIslandSize,
      (coinMesh) => this.collectibles.registerCoin(coinMesh),
      hillFootprints,
      warpAvoidPoints,
    );

    // HillClimb: 3 staircases. STAR REBALANCE: Standard's star was removed;
    // ui.maxStars (5) is Red Planet + Yoshi + Kamek/Bowser + Toad's quest.

    // "Scalino 1/2/3" (x=30..50, z=20) — plain coin-trail staircase now
    // that its star is gone; the trail's endpoint is unchanged.
    await this.decorations.spawnCoinTrail(
      [
        { x: 25, y: 2.5, z: 20 },
        { x: 30, y: 3.5, z: 20 },
        { x: 40, y: 5.0, z: 20 },
        { x: 47, y: 6.8, z: 20 },
      ],
      (coinMesh) => this.collectibles.registerCoin(coinMesh),
      { spacing: 2, arcHeight: 0.4 },
    );

    // "Passerella Est 1/2/3" — leads to the Yoshi-only star at (96, 15, 70);
    // id: "yoshiHighStar" is the Yoshi quest's step 2 (see QuestManager).
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

    // "Passerella Ovest 1/2/3" (x=-70..-96, z=45) — coin-trail only, no star.
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

    // Spawned explicitly (not from levelData?.stars) so it can carry its
    // own `id` — see STAR REBALANCE above.
    await this.collectibles.spawnStars([{ x: 96, y: 15, z: 70, id: "yoshiHighStar" }]);
    await this.collectibles.spawnMushrooms(levelData?.mushrooms);
    await this.collectibles.spawnQuestionMarkBlocks(levelData?.questionMarkBlocks);

    // Kept on the instance so main.js can look NPCs up by type and
    // register their interactions (e.g. Toad's quest dialogue).
    this.npcs = await this.levelLoader.buildBuildingsAndNPCs(
      levelData?.buildings,
      levelData?.npcs,
      levelData?.hills,
    );
    this.decorations.decorateStructures(levelData?.buildings);

    await this.decorations.spawnGrassField(mainIslandSize);
    this.decorations.spawnRocks(mainIslandSize, undefined, hillFootprints, warpAvoidPoints);
    this.decorations.spawnBushes(mainIslandSize, undefined, hillFootprints, warpAvoidPoints);

    // Hand-placed decorative ponds, purely visual (no collider/depth).
    this.decorations.spawnPonds([
      { x: 60, z: -60, radius: 7 },
      { x: -60, z: 75, radius: 6 },
      { x: 20, z: 95, radius: 5 },
      { x: -95, z: -70, radius: 6 },
      { x: 95, z: 20, radius: 5 },
    ]);

    // Only the main "red" sky planet is walkable — the blue planet and
    // satellites stay purely decorative.
    this.decorations.spawnSkyPlanet();
    this.decorations.spawnSatellitePlanets();
    this.decorations.spawnBluePlanet();

    // Coins scattered across the red planet's surface, plus its star.
    await this.decorations.spawnPlanetCoins(
      this.decorations.skyPlanet,
      this.decorations.skyPlanetRadius,
      8,
      (coinMesh) => this.collectibles.registerCoin(coinMesh),
    );

    // Stella 1 of 5 — near where the "sky" warp star lands the player.
    // id: "redPlanetStar" lets QuestManager detect this specific pickup.
    await this.collectibles.spawnStars([{ x: -254, y: 214, z: 10, id: "redPlanetStar" }]);

    // Mario Galaxy-style warp stars: "sky" to the red planet, a return
    // star back to spawn, and one each to Kamek's and Bowser's courses.
    await this.decorations.spawnWarpStars([
      { x: 118, y: 4, z: -30, color: 0xffd54f, target: "sky" }, // -> the red planet
      // Yellow, not white: the only warp star actually on the red
      // planet's surface, where white read as washed-out.
      { x: -260, y: 220, z: 0, color: 0xffff00, target: "spawn" }, // -> back to spawn
      { x: 60, y: 4, z: 115, color: 0xff5722, target: "kamek_zone" }, // -> Kamek
      { x: -60, y: 4, z: 115, color: 0xb71c1c, target: "bowser_zone" }, // -> Bowser
    ]);

    // A sign next to each zone warp star with its logo, placed further
    // out so it reads on approach, facing back toward the map center.
    const zoneStars = [
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
          rotationY: Math.atan2(dirX, dirZ) + Math.PI,
          logo,
        };
      }),
    );
  }

  // Per-frame: collectible pickup checks + decoration animation (sky
  // planet spin, satellite orbits, pond wading effect).
  update(delta, player, onCoinCollected, onStarCollected, onMushroomCollected) {
    this.collectibles.update(player, onCoinCollected, onStarCollected, onMushroomCollected);
    this.decorations.update(delta, player);

    // Pond friction: -20% movement speed while wading, piggybacking on the
    // same pond detection Decorations already does for the visual sink effect.
    if (player && player.setInPond) {
      player.setInPond(this.decorations.isPlayerInPond());
    }
  }
}
