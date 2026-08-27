/**
 * Single source of truth for every model and texture path used by the
 * game. Every module that needs to load a GLTF model or a texture should
 * import its path from here instead of hardcoding the string inline.
 *
 * Grouped by category:
 *  - CHARACTER_MODELS: playable characters and Yoshi.
 *  - ITEM_MODELS: collectible/interactive props (coins, stars, blocks, ...).
 *  - MAP_MODELS: static scenery props placed by GameLevel (trees, grass, ...).
 *  - ENDING_MODELS: Peach and her castle, used by the ending sequence.
 *  - ENEMY_MODELS: enemies spawned via entities/enemies/ (Goomba, Kamek, ...).
 *  - BUILDING_MODEL_DIR / NPC_MODEL_DIR: base directories for models that
 *    are resolved dynamically from the level JSON's "type" field.
 *  - TEXTURES: standalone image textures (skybox, ground, decorative props).
 *
 * Every path here is resolved through assetUrl() (see Assets/basePath.js),
 * so what these constants actually hold is a full URL under the deployment
 * root — the same strings work served from / locally and from
 * /<repo>/ on GitHub Pages. Write the entries themselves as plain relative
 * paths; the resolution is the module's job, not the reader's.
 */
import * as THREE from "three";
import { assetUrl } from "./basePath.js";

// Every model/texture loader in the game (AssetLoader's and GameLevel's
// GLTFLoaders, and every ad-hoc THREE.TextureLoader across Renderer.js,
// Decorations.js, LevelLoader.js, EndingZone.js, BossArena.js) is
// constructed with no manager argument, so all of them share
// THREE.DefaultLoadingManager. Setting the URL modifier once, here, is
// therefore enough to cover every texture request in the game — including
// ones this file never even sees, like a "Textures/colormap.png" URI baked
// directly inside a .glb's own material definition (resolved via
// GameLevel's resourcePath, not through this file at all — see
// block-grass-large.glb, whose exported material referenced the
// capitalized folder name and 404'd on GitHub Pages).
//
// WHY. GitHub Pages is case-sensitive; the folder on disk is lowercase
// "textures/", same convention as its siblings (audio/, images/, levels/,
// models/). Nothing stops a future Blender export, or a stray manual
// rename, from baking in a different casing again — that's exactly what
// happened with the HillBlocks grass texture. Rather than chasing every
// offending reference by hand each time it happens, this normalizes ANY
// casing of that one path segment to the canonical lowercase form before
// the browser ever fetches it, so the actual on-disk folder only has to be
// right in one place for every loader, present and future, to keep
// working — see the matching NPC_MODEL_DIR comment below for the same
// class of bug, hit once already on that folder.
THREE.DefaultLoadingManager.setURLModifier((url) => {
  return url.replace(/\/[Tt]extures?(?=\/)/, "/textures");
});

const MODELS_ROOT = assetUrl("assets/models/Super_Mario");

export const CHARACTER_MODELS = {
  mario: `${MODELS_ROOT}/Main_Characters/Mario/mario.glb`,
  luigi: `${MODELS_ROOT}/Main_Characters/Luigi/luigi.glb`,
  // Mounts/, non Main_Characters/YoshiGLTF/: stesso Yoshi (identica bbox,
  // identico orientamento e origine ai piedi), ma con uno scheletro Mixamo
  // completo sopra — che è ciò che gli permette di camminare (vedi
  // entities/Yoshi.js e animation/clipFactory.js's buildYoshiClips).
  //
  // _textured perché l'export del modello riggato ha perso le texture (8
  // materiali su 16 finiti a grigio piatto, Yoshi bianco in gioco) pur
  // conservando tutte le UV: yoshi_textured.glb è il file riggato con
  // sopra ritrapiantati i materiali del modello statico originale e i PNG
  // incorporati — vedi tools/fix_yoshi_textures.py, che lo rigenera.
  // yoshi.glb (quello riggato ma bianco) e la vecchia versione statica
  // restano sul disco, inutilizzati: se un giorno il modello viene
  // ri-esportato da Blender CON le texture, basta puntare qui quel file e
  // lo script non serve più.
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
  // Every Toad House variant currently shares this same red model file
  // (see BuildingFactory / ToadHouse for the collision-side handling).
  toadHouseRed: `${MODELS_ROOT}/Map/toad_house_red.glb`,
  // Yoshi's egg -> mount mechanic: spawned at level1.json's yoshiSpawn
  // point, hatches into the rideable Yoshi on "Press E" — see main.js's
  // startup sequence and js/interactions/InteractionManager.js.
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

// Props of the ending sequence: the place the player is teleported to after
// collecting every star (see entities/Level/EndingZone.js, peach_castle.json).
// peach.glb is a derived file, not the download: the original — kept next to
// it as peach_ok.glb — writes its materials with the retired
// KHR_materials_pbrSpecularGlossiness extension, which three.js r160's
// GLTFLoader has no support for at all, so it imported as a white untextured
// statue. See tools/fix_specular_glossiness.py for the conversion.
export const ENDING_MODELS = {
  peachCastle: `${MODELS_ROOT}/Ending/peach_castle.glb`,
  peach: `${MODELS_ROOT}/Ending/peach.glb`,
};

export const ENEMY_MODELS = {
  goomba: `${MODELS_ROOT}/Enemies/goomba.glb`,
  // Boss waiting at the end of the Kamek obstacle course (see
  // entities/enemies/Kamek.js, kamek_zone.json, main.js).
  kamek: `${MODELS_ROOT}/Enemies/kamek.glb`,
  // Final boss, waiting at the end of the Bowser obstacle course (see
  // entities/enemies/Bowser.js, bowser_zone.json, main.js).
  bowser: `${MODELS_ROOT}/Enemies/bowser.glb`,
};

// Buildings/hills resolve their .glb dynamically from the level JSON's
// "type" field (e.g. "mario_house" -> "mario_house.glb"), and NPCs
// similarly resolve from "npc.type". Only the base directories are
// centralized here; see LevelLoader for the resolution logic.
export const BUILDING_MODEL_DIR = `${MODELS_ROOT}/Map/`;
// Lowercase "npc" because that is what the directory is called on disk.
// macOS hides this kind of mismatch (its filesystem is case-insensitive by
// default) but the Linux box behind GitHub Pages does not: the old
// "NPC/" spelling loaded Toad locally and 404'd in production.
export const NPC_MODEL_DIR = `${MODELS_ROOT}/npc/`;

export const TEXTURES = {
  skyBox: assetUrl("assets/textures/sky/skyBox.png"),
  groundGrass: assetUrl("assets/textures/field/grass2.jpg"),
  colorMap: assetUrl("assets/textures/colormap.png"),
  planetColor: assetUrl("assets/textures/planet/planet_color.png"),
  planetNormal: assetUrl("assets/textures/planet/planet_normal.png"),
  planetRoughness: assetUrl("assets/textures/planet/planet_roughness.png"),
  // Kamek's logo, overlaid as a small plane on the Kamek sign prop (see
  // Decorations.spawnKamekSigns). The source file the user dropped in,
  // assets/images/kamek.png, is actually a JPEG despite the extension (no
  // alpha) and its circular badge sits a few pixels off-center within the
  // square frame. kamek_logo.png is a derived, real PNG made from it:
  // cropped tight and centered on the badge itself and with its gray
  // background keyed out to transparency, so the plane shows a clean,
  // centered circular badge with nothing to visually misalign against the
  // sign's own frame. The original kamek.png is left untouched.
  kamekLogo: assetUrl("assets/images/kamek_logo.png"),
  // Bowser's logo, overlaid on the sign next to the warp stars leading to
  // the Bowser obstacle course — same treatment as kamekLogo above.
  // assets/images/gameover.png is a real PNG that already carries an alpha
  // channel (its Bowser-face mark sits, off-center, on a huge 3840x2160
  // transparent canvas); gameover_logo.png is a derived crop tight around
  // that mark, centered, and downscaled to a sane in-game decal size. The
  // original gameover.png is left untouched.
  gameoverLogo: assetUrl("assets/images/gameover_logo.png"),
  // Procedurally generated (PIL, no external download — see the
  // make_lava_brick.py/make_magic_brick.py generation notes in the boss
  // arena feature's delivery), tileable platform textures for the two boss
  // arenas (see BossArena.js / ARENA_THEMES): dark lava-stone/brick for
  // Bowser's arena, purple magic brick with gold inlay for Kamek's.
  lavaBrickTexture: assetUrl("assets/images/lava_brick_texture.png"),
  magicBrickTexture: assetUrl("assets/images/magic_brick_texture.png"),
};

export const DRACO_DECODER_PATH =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";
