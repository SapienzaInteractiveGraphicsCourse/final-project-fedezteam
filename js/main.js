import RendererManager from "./core/Renderer.js";
import AssetLoader from "./core/AssetLoad/AssetLoader.js";
import { initGameModels } from "./core/AssetLoad/assetConfig.js";
import GameLoop from "./core/GameLoop.js";
import InputManager from "./core/InputManager.js";
import UIManager from "./ui/UIManager.js";
import PhysicsEngine from "./physics/PhysicsEngine.js";
import AudioManager from "./core/Audio/AudioManager.js";
import { initGameAudio } from "./core/Audio/soundConfig.js";
import Yoshi from "./entities/Yoshi.js";
import Map from "./entities/Map.js";
import EntityManager from "./entities/EntityManager.js";
import * as THREE from "three";

// 1. CORE MODULES
const renderer = new RendererManager("#webgl-canvas");
const assetLoader = new AssetLoader();
const input = new InputManager();
const ui = new UIManager();

const audio = new AudioManager();
initGameAudio(audio);

// All'avvio, applica subito il muto se era stato salvato nel LocalStorage
const initialMuteState = localStorage.getItem("game_is_muted") === "true";
audio.setMute(initialMuteState);

// 1. Ascolta il click sul tasto muto
ui.onMuteToggle = (isMuted) => {
  audio.setMute(isMuted);
};

// 2. Ascolta il click su "Ritorna al Menu" dal menu di pausa
ui.onReturnToMenu = () => {
  // Ricarica la pagina per resettare istantaneamente grafica, memoria e fisica
  window.location.reload();
};

const physics = new PhysicsEngine({
  gravity: -35,
  fallThreshold: -50,
});

const entityManager = new EntityManager(renderer.scene, physics);
let mapEntity = null;

// 2. STATE VARIABLES
let menuCameraAngle = 0;
const rawModels = { mario: null, luigi: null };

// Volume Controls
ui.onBGMVolumeChange = (volume) => {
  audio.setBGMVolume(volume);
};
ui.onSFXVolumeChange = (volume) => {
  audio.setSFXVolume(volume);
};

// On start click, play background music

ui.onWelcomeStart(() => {
  audio.playBGM();
});

//3. UI
ui.onCharacterSelect((character) => {
  audio.setCharacter(character);
  audio.playSFX("selected");
});

ui.onGameStart(({ character }) => {
  audio.setCharacter(character);

  if (!rawModels[character]) return;

  const spawn = mapEntity?.playerSpawn;

  if (spawn) {
    // 👈 Aggiungi 'character' come 5° parametro alla fine![cite: 9]
    entityManager.spawnPlayer(
      rawModels[character],
      spawn.x,
      spawn.y,
      spawn.z,
      character,
    );
  } else {
    // 👈 Aggiungi 'character' anche nel fallback[cite: 9]
    entityManager.spawnPlayer(rawModels[character], 0, 2, 0, character);
  }
});

// 4. GAME LOOP
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

  // If player is dead or game is paused, skip updating entities
  if (ui.isPaused || !entityManager.player) return;

  entityManager.update(delta, input, ui, audio);

  // Camera follows the player behind and slightly above
  const playerPos = entityManager.player.mesh.position;
  renderer.camera.position.x = playerPos.x;
  renderer.camera.position.y = playerPos.y + 4;
  renderer.camera.position.z = playerPos.z + 8;
  renderer.camera.lookAt(playerPos.x, playerPos.y + 1, playerPos.z);
}

// 5. ASSET LOADING
// (GLTF Models)
// assets is the result of the loaded models, which will be used to spawn entities in the game
initGameModels(assetLoader)
  .then(async (assets) => {
    // 💡 Nascondi la schermata di caricamento!
    document.getElementById("loading-screen").style.display = "none";
    // 1. Map loading
    mapEntity = new Map(physics);
    await mapEntity.loadLevel("./assets/levels/level1.json");
    entityManager.setMap(mapEntity);

    // 2. Yoshi Spawn point
    if (mapEntity.yoshiSpawn) {
      const ySpawn = mapEntity.yoshiSpawn;
      const yoshiEntity = new Yoshi(assets.yoshi, physics);
      yoshiEntity.spawn(ySpawn.x, ySpawn.y, ySpawn.z);
      entityManager.setYoshi(yoshiEntity);
    }

    // 3. Assign loaded models to rawModels for later use
    rawModels.mario = assets.mario;
    rawModels.luigi = assets.luigi;

    // 4. Start the game loop
    const gameLoop = new GameLoop(renderer, updateGame);
    gameLoop.start();
  })
  .catch((error) => {
    console.error("Errore durante il caricamento degli asset:", error);
  });
