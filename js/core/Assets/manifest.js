/**
 * Single source of truth for every model and texture path used by the
 * game. Every module that needs to load a GLTF model or a texture should
 * import its path from here instead of hardcoding the string inline.
 *
 * Grouped by category:
 *  - CHARACTER_MODELS: playable characters and Yoshi.
 *  - ITEM_MODELS: collectible/interactive props (coins, stars, blocks, ...).
 *  - MAP_MODELS: static scenery props placed by GameLevel (trees, grass, ...).
 *  - ENEMY_MODELS: enemies spawned via entities/enemies/ (Goomba, Kamek, ...).
 *  - BUILDING_MODEL_DIR / NPC_MODEL_DIR: base directories for models that
 *    are resolved dynamically from the level JSON's "type" field.
 *  - TEXTURES: standalone image textures (skybox, ground, decorative props).
 */

const MODELS_ROOT = "assets/models/Super_Mario";

export const CHARACTER_MODELS = {
  mario: `${MODELS_ROOT}/Main_Characters/MarioGLTF/mario.gltf`,
  luigi: `${MODELS_ROOT}/Main_Characters/LuigiGLTF/Luigi.gltf`,
  yoshi: `${MODELS_ROOT}/Main_Characters/YoshiGLTF/yoshi.gltf`,
};

export const ITEM_MODELS = {
  coin: `${MODELS_ROOT}/Items/coin.glb`,
  star: `${MODELS_ROOT}/Items/star.glb`,
  mushroom: `${MODELS_ROOT}/Items/mushroom.glb`,
  questionMarkBlock: `${MODELS_ROOT}/Items/question_mark_block.glb`,
};

export const MAP_MODELS = {
  flower: `${MODELS_ROOT}/Map/flower1.glb`,
  palmTree: `${MODELS_ROOT}/Map/palm_tree.glb`,
  grass: `${MODELS_ROOT}/Map/grass.glb`,
  blockGrassLarge: `${MODELS_ROOT}/Map/block-grass-large.glb`,
  // Every Toad House variant currently shares this same red model file
  // (see BuildingFactory / ToadHouse for the collision-side handling).
  toadHouseRed: `${MODELS_ROOT}/Map/toad_house_red.glb`,
  // Used purely as a decorative "planet" floating in the sky (see
  // Decorations.spawnYoshiEggPlanet), not as a gameplay prop.
  yoshiEgg: `${MODELS_ROOT}/Map/yoshi_egg.glb`,
  // Mario Galaxy-style "launch star", placed at the island's edges (see
  // Decorations.spawnWarpStars). Currently a visual landmark only — no
  // teleport/interaction logic is wired up yet.
  starLaunch: `${MODELS_ROOT}/Map/star_launch.glb`,
  // Small Minecraft "Oak Sign" prop (Mineways export), placed next to the
  // warp stars leading to Kamek's zone with the Kamek logo overlaid on its
  // face — see Decorations.spawnKamekSigns. Lives under Items/ on disk
  // (it was dropped there alongside the other small props) even though
  // it's used purely decoratively like the rest of MAP_MODELS.
  minecraftSign: `${MODELS_ROOT}/Items/minecraft_sign.glb`,
};

export const ENEMY_MODELS = {
  goomba: `${MODELS_ROOT}/Enemies/goomba.glb`,
  // Boss scaffold (see entities/enemies/Kamek.js) — not spawned in any
  // level yet, but preloaded here so it's ready when it is.
  kamek: `${MODELS_ROOT}/Enemies/kamek.glb`,
  // Final boss, waiting at the end of the Bowser obstacle course (see
  // entities/enemies/Bowser.js, level3.json, main.js).
  bowser: `${MODELS_ROOT}/Enemies/bowser.glb`,
};

// Buildings/hills resolve their .glb dynamically from the level JSON's
// "type" field (e.g. "mario_house" -> "mario_house.glb"), and NPCs
// similarly resolve from "npc.type". Only the base directories are
// centralized here; see LevelLoader for the resolution logic.
export const BUILDING_MODEL_DIR = `${MODELS_ROOT}/Map/`;
export const NPC_MODEL_DIR = `${MODELS_ROOT}/NPC/`;

export const TEXTURES = {
  skyBox: "assets/textures/sky/skyBox.png",
  groundGrass: "assets/textures/field/grass2.jpg",
  colorMap: "assets/textures/colormap.png",
  planetColor: "assets/textures/planet/planet_color.png",
  planetNormal: "assets/textures/planet/planet_normal.png",
  planetRoughness: "assets/textures/planet/planet_roughness.png",
  // Kamek's logo, overlaid as a small plane on the Kamek sign prop (see
  // Decorations.spawnKamekSigns). The source file the user dropped in,
  // assets/images/kamek.png, is actually a JPEG despite the extension (no
  // alpha) and its circular badge sits a few pixels off-center within the
  // square frame. kamek_logo.png is a derived, real PNG made from it:
  // cropped tight and centered on the badge itself and with its gray
  // background keyed out to transparency, so the plane shows a clean,
  // centered circular badge with nothing to visually misalign against the
  // sign's own frame. The original kamek.png is left untouched.
  kamekLogo: "assets/images/kamek_logo.png",
  // Bowser's logo, overlaid on the sign next to the warp stars leading to
  // the Bowser obstacle course — same treatment as kamekLogo above.
  // assets/images/gameover.png is a real PNG that already carries an alpha
  // channel (its Bowser-face mark sits, off-center, on a huge 3840x2160
  // transparent canvas); gameover_logo.png is a derived crop tight around
  // that mark, centered, and downscaled to a sane in-game decal size. The
  // original gameover.png is left untouched.
  gameoverLogo: "assets/images/gameover_logo.png",
};

export const DRACO_DECODER_PATH =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";
