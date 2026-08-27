/**
 * Single source of truth for every model/texture path used by the game.
 * Every path is resolved through assetUrl() (see basePath.js), so what
 * these constants hold is a full URL that works both served from / and
 * from a /<repo>/ sub-path on GitHub Pages.
 */
import * as THREE from "three";
import { assetUrl } from "./basePath.js";

// Normalizes "textures/" path casing to lowercase on the shared loading
// manager — guards against case-sensitive 404s on GitHub Pages.
THREE.DefaultLoadingManager.setURLModifier((url) => {
  return url.replace(/\/[Tt]extures?(?=\/)/, "/textures");
});

const MODELS_ROOT = assetUrl("assets/models/Super_Mario");

export const CHARACTER_MODELS = {
  mario: `${MODELS_ROOT}/Main_Characters/Mario/mario.glb`,
  luigi: `${MODELS_ROOT}/Main_Characters/Luigi/luigi.glb`,
  // Rigged (Mixamo skeleton) version of the static Yoshi model, with the
  // original's materials re-applied — see tools/fix_yoshi_textures.py.
  yoshi: `${MODELS_ROOT}/Mounts/yoshi_textured.glb`,
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
  // Every Toad House variant shares this same red model file.
  toadHouseRed: `${MODELS_ROOT}/Map/toad_house_red.glb`,
  // Hatches into rideable Yoshi on "Press E" (main.js / InteractionManager).
  yoshiEgg: `${MODELS_ROOT}/Map/yoshi_egg.glb`,
  // Mario Galaxy "launch star" landmark (see Decorations.spawnWarpStars).
  starLaunch: `${MODELS_ROOT}/Map/star_launch.glb`,
  // Sign prop with the Kamek logo overlay, near Kamek's warp stars.
  minecraftSign: `${MODELS_ROOT}/Items/minecraft_sign.glb`,
};

// Peach's ending sequence props; peach.glb is a derived file (converted
// from a format three.js can't read — see fix_specular_glossiness.py).
export const ENDING_MODELS = {
  peachCastle: `${MODELS_ROOT}/Ending/peach_castle.glb`,
  peach: `${MODELS_ROOT}/Ending/peach.glb`,
};

export const ENEMY_MODELS = {
  goomba: `${MODELS_ROOT}/Enemies/goomba.glb`,
  kamek: `${MODELS_ROOT}/Enemies/kamek.glb`,
  bowser: `${MODELS_ROOT}/Enemies/bowser.glb`,
};

// Buildings/hills and NPCs resolve their .glb dynamically from the level
// JSON's "type" field; only the base directories live here.
export const BUILDING_MODEL_DIR = `${MODELS_ROOT}/Map/`;
// Lowercase to match the actual folder on disk (case-sensitive on Pages).
export const NPC_MODEL_DIR = `${MODELS_ROOT}/npc/`;

export const TEXTURES = {
  skyBox: assetUrl("assets/textures/sky/skyBox.png"),
  groundGrass: assetUrl("assets/textures/field/grass2.jpg"),
  colorMap: assetUrl("assets/textures/colormap.png"),
  planetColor: assetUrl("assets/textures/planet/planet_color.png"),
  planetNormal: assetUrl("assets/textures/planet/planet_normal.png"),
  planetRoughness: assetUrl("assets/textures/planet/planet_roughness.png"),
  // Cropped/centered derivative of assets/images/kamek.png (see
  // Decorations.spawnKamekSigns); the original is left untouched.
  kamekLogo: assetUrl("assets/images/kamek_logo.png"),
  // Same treatment as kamekLogo, derived from assets/images/gameover.png.
  gameoverLogo: assetUrl("assets/images/gameover_logo.png"),
  // Procedurally generated (PIL) tileable arena textures — see
  // make_lava_brick.py/make_magic_brick.py and BossArena.js's ARENA_THEMES.
  lavaBrickTexture: assetUrl("assets/images/lava_brick_texture.png"),
  magicBrickTexture: assetUrl("assets/images/magic_brick_texture.png"),
};

export const DRACO_DECODER_PATH =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";
