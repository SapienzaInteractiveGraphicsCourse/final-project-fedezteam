import RendererManager from "./core/Renderer.js";
import AssetLoader from "./core/AssetLoader.js";
import GameLoop from "./core/GameLoop.js";
import InputManager from "./core/InputManager.js";
import UIManager from "./ui/UIManager.js";
import PhysicsEngine from "./physics/PhysicsEngine.js";
import AudioManager from "./core/AudioManager.js";
import Yoshi from "./entities/Yoshi.js";
import Map from "./entities/Map.js";
import EntityManager from "./entities/EntityManager.js";
import * as THREE from "three";

// 1. CREAZIONE MODULI CORE
const renderer = new RendererManager("#webgl-canvas");
const assetLoader = new AssetLoader();
const input = new InputManager();
const ui = new UIManager();

// 🔊 Inizializzazione AudioManager e audio
const audio = new AudioManager();
audio.load('bgm', 'assets/audio/overworld_bgm.mp3', true);
audio.load('coin', 'assets/audio/coin_collect.wav');

audio.load('mario_selected', 'assets/audio/mario_selected.wav');
audio.load('luigi_selected', 'assets/audio/luigi_selected.wav');

audio.load('mario_jump1', 'assets/audio/mario_jump1.wav');
audio.load('mario_jump2', 'assets/audio/mario_jump2.wav');
audio.load('mario_fall', 'assets/audio/mario_fall.wav');

audio.load('luigi_jump1', 'assets/audio/luigi_jump1.wav');
audio.load('luigi_jump2', 'assets/audio/luigi_jump2.wav');
audio.load('luigi_fall', 'assets/audio/luigi_fall.wav');

const physics = new PhysicsEngine({
  gravity: -35,
  fallThreshold: -20
});

const entityManager = new EntityManager(renderer.scene, physics);
let mapEntity = null;

// 2. VARIABILI DI STATO
let menuCameraAngle = 0;
const rawModels = { mario: null, luigi: null };

// Callbacks UI
ui.onWelcomeStart(() => {
  audio.playBGM();
});

ui.onCharacterSelect((character) => {
  audio.setCharacter(character);
  audio.playSFX('selected');
});

ui.onGameStart(({ character }) => {
  audio.setCharacter(character);

  if (!rawModels[character]) return;

  const spawn = mapEntity?.playerSpawn;

  if (spawn) {
    entityManager.spawnPlayer(rawModels[character], spawn.x, spawn.y, spawn.z);
  } else {
    entityManager.spawnPlayer(rawModels[character], -20, 10, 250);
  }
});

// 3. LOGICA DI AGGIORNAMENTO
function updateGame(delta) {
  if (ui.gameState === "MENU_WELCOME" || ui.gameState === "MENU_NAME") {
    menuCameraAngle += 0.5 * delta;
    const radius = 25;
    renderer.camera.position.x = 0 + Math.sin(menuCameraAngle) * radius;
    renderer.camera.position.z = 0 + Math.cos(menuCameraAngle) * radius;
    renderer.camera.position.y = 5;
    renderer.camera.lookAt(0, 1, 0);
    return;
  }

  if (!entityManager.player) return;

  entityManager.update(delta, input, ui, audio);

  // Inseguimento Telecamera
  const playerPos = entityManager.player.mesh.position;
  renderer.camera.position.x = playerPos.x;
  renderer.camera.position.y = playerPos.y + 4;
  renderer.camera.position.z = playerPos.z + 8;
  renderer.camera.lookAt(playerPos.x, playerPos.y + 1, playerPos.z);
}

// 4. CARICAMENTO PERCORSI NUOVI MODEL GLTF
const assetsToLoad = {
  mario: "assets/models/Super_Mario/Main_Characters/MarioGLTF/mario.gltf",
  luigi: "assets/models/Super_Mario/Main_Characters/LuigiGLTF/Luigi.gltf",
  yoshi: "assets/models/Super_Mario/Main_Characters/YoshiGLTF/yoshi.gltf",
};

assetLoader
  .loadAll(assetsToLoad)
  .then(async (assets) => {
    // 1. Carica mappa
    mapEntity = new Map(physics);
    await mapEntity.loadLevel("./assets/levels/level1.json");
    entityManager.setMap(mapEntity);

    // 2. Spawna Yoshi con il modello aggiornato
    if (mapEntity.yoshiSpawn) {
      const ySpawn = mapEntity.yoshiSpawn;
      const yoshiEntity = new Yoshi(assets.yoshi, physics);
      yoshiEntity.spawn(ySpawn.x, ySpawn.y, ySpawn.z);
      entityManager.setYoshi(yoshiEntity);
    }

    // 3. Assegna i modelli di Mario e Luigi direttamente
    rawModels.mario = assets.mario;
    rawModels.luigi = assets.luigi;

    // 4. Avvia il loop di gioco
    const gameLoop = new GameLoop(renderer, updateGame);
    gameLoop.start();
  })
  .catch((error) => {
    console.error("Errore durante il caricamento degli asset:", error);
  });