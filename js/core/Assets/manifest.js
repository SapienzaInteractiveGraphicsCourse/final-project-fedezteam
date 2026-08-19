/**
 * Single source of truth for every model and texture path used by the
 * game. Every module that needs to load a GLTF model or a texture should
 * import its path from here instead of hardcoding the string inline.
 *
 * Grouped by category:
 *  - CHARACTER_MODELS: playable characters and Yoshi.
 *  - ITEM_MODELS: collectible/interactive props (coins, stars, blocks, ...).
 *  - MAP_MODELS: static scenery props placed by GameLevel (trees, grass, ...).
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
};

export const DRACO_DECODER_PATH =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";
