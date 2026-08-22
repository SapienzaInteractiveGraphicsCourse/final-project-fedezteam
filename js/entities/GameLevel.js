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
    this.npcs = [];

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

    // Horizontal footprint of every HillBlock platform (block_grass_large/
    // hill/hill_step — see HillBlock.js), computed with the exact same
    // half-extent formula HillBlock uses for its own collider. Read
    // straight from the raw level JSON here (available immediately after
    // loadLevelData above) rather than waiting for buildBuildingsAndNPCs,
    // which doesn't actually build them until further down — passed to
    // spawnFieldProps so its random tree/flower/coin scatter can avoid
    // landing inside one.
    const hillFootprints = (levelData?.hills || []).map((h) => {
      const sX = h.scaleX !== undefined ? h.scaleX : (h.scale ?? 1);
      const sZ = h.scaleZ !== undefined ? h.scaleZ : (h.scale ?? 1);
      return { x: h.x || 0, z: h.z || 0, halfX: 0.98 * sX, halfZ: 0.98 * sZ };
    });

    // Round exclusion zones around every island-side warp star (defined
    // early, purely as coordinates, so it's ready before the tree/rock/
    // bush scatter below runs — the actual spawnWarpStars/spawnZoneSigns
    // calls that use these same spots happen much later in this method).
    // A single generous radius per star (see Decorations._isNearAnyPoint's
    // default) is enough to also cover that star's zone sign, which only
    // sits ~3 units further out — no need to list the signs separately.
    // The red planet's own "spawn" warp star isn't included: it's up on
    // the sky planet, nowhere near where trees/rocks/bushes scatter below.
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

    // Final HillClimb layout: exactly 3 three-platform staircases
    // (level1.json's "hills"). "Scalino" is HillClimb Standard, "Passerella
    // Est" is HillClimb Yoshi, "Passerella Ovest" is coin-trail-only. The
    // old 2-platform staircases ("Base Bassa"/"Cima Alta",
    // "Gradino Nord"/"Altopiano Gigante Nord") and "Passerella Sud" were
    // removed entirely, along with their coin trails, below.
    //
    // STAR REBALANCE: ui.maxStars (5, the win condition) is now made up of
    // exactly the 5 stars named "Stella 1..5" by the quest HUD (see
    // QuestManager): the Red Planet star (below), the HillClimb Yoshi star
    // on Passerella Est (below — the "id" fields are what let QuestManager
    // recognize each one specifically), and Toad's three quest rewards for
    // Kamek/coins/Bowser (spawned dynamically — see main.js). HillClimb
    // Standard's own star was removed (it's the "stella bassa" the quest
    // spec asked to drop — the staircase and its coin trail are unchanged,
    // just no longer end at a star), and Kamek/Bowser no longer drop a
    // star directly at their arenas — see main.js's onDefeated handlers.

    // "Scalino 1/2/3" (level1.json, x=30..50, z=20) — HillClimb Standard.
    // Used to end at a Power Star (50, 8, 20); that star was removed (see
    // STAR REBALANCE above), so this is now a plain coin-trail staircase,
    // same as Passerella Ovest below. The trail's own endpoint (47, 6.8, 20)
    // is left as-is — it was never on the star itself, just a step short of
    // it, so nothing about the trail needs to change now that the star is
    // gone.
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

    // "Passerella Est 1/2/3" (level1.json, x=70..96, z=70) — HillClimb
    // Yoshi: a single Power Star at (96, 15, 70), ~7.5 units above the top
    // platform (y≈7.5) — out of reach of a normal jump for either
    // character, only reachable via Yoshi's boosted jump (see
    // Player.YOSHI_JUMP_BOOST). Originally at y=20 with a second, lower
    // duplicate star also on this platform; per the star-count rebalance
    // both were replaced by this single star, lowered by 5 units.
    //
    // id: "yoshiHighStar" — lets QuestManager recognize THIS star being
    // collected as Fase 2 of the quest HUD ("hatch Yoshi's egg, then use
    // his jump to reach the high star" — see QuestManager.onStarCollected).
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

    // "Passerella Ovest 1/2/3" (level1.json, x=-70..-96, z=45) — plain
    // coin-trail-only staircase, no star.
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

    // Not levelData?.stars anymore (see STAR REBALANCE above) — the low
    // HillClimb Standard star it used to include was removed, and the
    // remaining HillClimb Yoshi star needs its own `id` (see comment on
    // Passerella Est's coin trail above), so it's spawned explicitly here
    // instead of straight from the level JSON.
    await this.collectibles.spawnStars([{ x: 96, y: 15, z: 70, id: "yoshiHighStar" }]);
    await this.collectibles.spawnMushrooms(levelData?.mushrooms);
    await this.collectibles.spawnQuestionMarkBlocks(levelData?.questionMarkBlocks);

    // Kept on the instance (not just awaited-and-discarded) so main.js can
    // look up NPCs by type and register their interactions — e.g. Toad's
    // quest dialogue (see js/interactions/QuestManager.js).
    this.npcs = await this.levelLoader.buildBuildingsAndNPCs(
      levelData?.buildings,
      levelData?.npcs,
      levelData?.hills,
    );
    this.decorations.decorateStructures(levelData?.buildings);

    await this.decorations.spawnGrassField(mainIslandSize);
    this.decorations.spawnRocks(mainIslandSize, undefined, hillFootprints, warpAvoidPoints);
    this.decorations.spawnBushes(mainIslandSize, undefined, hillFootprints, warpAvoidPoints);

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

    // One collectible star on the red planet, a short walk from where the
    // "sky" warp star lands the player (see spawnWarpStars below) — Stella
    // 1 of the 5 that make up ui.maxStars (see STAR REBALANCE above).
    // id: "redPlanetStar" — lets QuestManager recognize THIS specific star
    // being picked up (see Collectibles.update -> onStarCollected(star) and
    // EntityManager.onStarCollected), which is how Fase 1 of the quest HUD
    // detects "reached the Red Planet and collected its star" without
    // touching main.js.
    await this.collectibles.spawnStars([{ x: -254, y: 214, z: 10, id: "redPlanetStar" }]);

    // Mario Galaxy-style warp stars. "sky" sends the player to the red
    // planet; the white star waiting right where they land sends them back
    // to spawn; the two fiery orange ones at the island's edges send them
    // to the separate Kamek obstacle course; the single dark-red one sends
    // them to the separate Bowser obstacle course instead (see
    // Decorations.spawnWarpStars/_updateWarpStars and
    // entities/Level/ObstacleZone.js, wired up from main.js).
    await this.decorations.spawnWarpStars([
      { x: 118, y: 4, z: -30, color: 0xffd54f, target: "sky" }, // -> the red planet
      // Yellow (#FFFF00) instead of white: it's the only warp star that
      // actually sits ON the red planet's surface, and white read as
      // washed-out against it. Only this one warp star's color is
      // changing — the collectible star nearby keeps its own texture (see
      // Collectibles.spawnStars), and every other warp star below is
      // untouched.
      { x: -260, y: 220, z: 0, color: 0xffff00, target: "spawn" }, // next to the red planet's landing spot -> back to spawn
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
