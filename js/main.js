import RendererManager from "./core/Render/Renderer.js";
import CameraManager from "./core/Render/CameraManager.js";
import AssetLoader from "./core/Assets/AssetLoader.js";
import { initGameModels } from "./core/Assets/assetConfig.js";
import GameLoop from "./core/GameLoop.js";
import InputManager from "./core/InputManager.js";
import UIManager from "./ui/UIManager.js";
import PhysicsEngine from "./physics/PhysicsEngine.js";
import AudioManager from "./core/Audio/AudioManager.js";
import { initGameAudio } from "./core/Audio/soundConfig.js";
import { getStoredMuteState } from "./utils/storage.js";
import Yoshi from "./entities/Yoshi.js";
import GameLevel from "./entities/GameLevel.js";
import EntityManager from "./entities/EntityManager.js";
import * as THREE from "three";
import CannonDebugger from "https://cdn.jsdelivr.net/npm/cannon-es-debugger@1.0.0/+esm";

import Stats from "three/addons/libs/stats.module.js";
// 1. CORE MODULES

const renderer = new RendererManager("#webgl-canvas");
const cameraManager = new CameraManager(renderer.camera);
const assetLoader = new AssetLoader();
const input = new InputManager();

const physics = new PhysicsEngine({
  gravity: -35,
  fallThreshold: -50,
});



// Wireframe dei collider fisici. SPENTO di default: si accende con F3 oppure
// da console con toggleColliders(). Utile quando si tarano le hitbox delle case,
// ma è costoso (ricostruisce le mesh di ogni shape a ogni frame) e va tenuto
// fuori dal gioco vero.
const debugMeshes = [];
let showColliders = false;

const cannonDebugger = new CannonDebugger(renderer.scene, physics.world, {
  // cannon-es-debugger non gestisce `visible`: ci teniamo i riferimenti alle
  // mesh che crea, così possiamo nasconderle quando si spegne il toggle.
  onInit: (body, mesh) => debugMeshes.push(mesh),
});

function toggleColliders(force) {
  showColliders = force === undefined ? !showColliders : !!force;

  if (showColliders) {
    // Aggiorna subito, altrimenti i wireframe compaiono solo al frame dopo.
    cannonDebugger.update();
  }
  for (const mesh of debugMeshes) mesh.visible = showColliders;

  console.log(`[debug] collider ${showColliders ? "ON" : "OFF"}`);
  return showColliders;
}

// Esposto in console per comodità durante il tuning delle hitbox.
window.toggleColliders = toggleColliders;

window.addEventListener("keydown", (e) => {
  if (e.code === "F3") {
    e.preventDefault(); // in alcuni browser F3 apre "trova successivo"
    toggleColliders();
  }
});

// Contatore prestazioni. Spento di default, si accende con F4.
// Cliccando sul riquadro si cicla tra FPS / MS per frame / memoria.
const stats = new Stats();
stats.dom.style.left = "auto";
stats.dom.style.right = "0"; // a destra, così non copre l'HUD in alto a sinistra
stats.dom.style.display = "none";
document.body.appendChild(stats.dom);

let showStats = false;
function toggleStats(force) {
  showStats = force === undefined ? !showStats : !!force;
  stats.dom.style.display = showStats ? "block" : "none";
  return showStats;
}
window.toggleStats = toggleStats;

window.addEventListener("keydown", (e) => {
  if (e.code === "F4") {
    e.preventDefault();
    toggleStats();
  }
});

// Owns the Player, Yoshi, and the level, and drives their update() each frame.
const entityManager = new EntityManager(
  renderer.scene,
  physics,
  renderer.dirLight,
);
let mapEntity = null;

const ui = new UIManager();
const audio = new AudioManager();
initGameAudio(audio);
ui.setAudio(audio);

// Restore the mute state saved from a previous session, if any.
audio.setMute(getStoredMuteState());

// 2. STATE VARIABLES

// Angle driving the slow orbiting camera shown behind the menu screens.
let menuCameraAngle = 0;

// Raw GLTF models, loaded once and reused whenever a character is spawned.
const rawModels = { mario: null, luigi: null };

// 3. UI EVENT WIRING

ui.onCharacterSelect((character) => {
  audio.setCharacter(character);
  audio.playSFX("selected");
});

ui.onMuteToggle = (isMuted) => {
  audio.setMute(isMuted);
};

ui.onReturnToMenu = () => {
  // Reloading is the simplest way to reset scene, physics, and UI state at once.
  window.location.reload();
};

ui.onBGMVolumeChange = (volume) => {
  audio.setBGMVolume(volume);
};
ui.onSFXVolumeChange = (volume) => {
  audio.setSFXVolume(volume);
};

// Require a user gesture before audio can play, so BGM starts on click.
ui.onWelcomeStart(() => {
  audio.playBGM();
});

ui.onGameStart(({ character }) => {
  audio.setCharacter(character);

  if (!rawModels[character]) return;

  const spawn = mapEntity?.playerSpawn;

  if (spawn) {
    entityManager.spawnPlayer(
      rawModels[character],
      spawn.x,
      spawn.y,
      spawn.z,
      character,
    );
  } else {
    // Fallback spawn point if the level didn't define one.
    entityManager.spawnPlayer(rawModels[character], 0, 1, 0, character);
  }
});

// 4. GAME LOOP

function updateGame(delta) {
   if (showStats) stats.update();
  // While on a menu screen, only orbit the camera around the scene; nothing
  // else updates (physics, player, entities all stay frozen).
  if (ui.gameState === "MENU_WELCOME" || ui.gameState === "MENU_NAME") {
    menuCameraAngle += 0.2 * delta;
    const radius = 25;
    renderer.camera.position.x = 0 + Math.sin(menuCameraAngle) * radius;
    renderer.camera.position.z = 0 + Math.cos(menuCameraAngle) * radius;
    renderer.camera.position.y = 5;
    renderer.camera.lookAt(0, 1, 0);
    return;
  }

  // Paused or no player yet: skip the update, which also freezes physics
  // since entityManager.update() is what steps the physics world.
  if (ui.isPaused || !entityManager.player) return;

  entityManager.update(delta, input, ui, audio, renderer.camera);
  cameraManager.update(entityManager.player, input, delta);
  if (showColliders) cannonDebugger.update();
}

// Drives the loading bar shown on the initial screen while assets download.
THREE.DefaultLoadingManager.onProgress = function (
  url,
  itemsLoaded,
  itemsTotal,
) {
  const progress = (itemsLoaded / itemsTotal) * 100;

  const loadingBar = document.getElementById("loading-bar");
  const loadingText = document.getElementById("loading-text");

  if (loadingBar) loadingBar.style.width = progress + "%";
  if (loadingText) loadingText.innerText = Math.floor(progress) + "%";
};

// 5. STARTUP SEQUENCE
// Load characters, then the level, then reveal the game and start the loop.

initGameModels(assetLoader)
  .then(async (assets) => {
    mapEntity = new GameLevel(physics);

    // Blocks until every platform, building, and collectible is in the scene.
    await mapEntity.loadLevel("./assets/levels/level1.json");

    entityManager.setMap(mapEntity);

    if (mapEntity.yoshiSpawn) {
      const ySpawn = mapEntity.yoshiSpawn;
      const yoshiEntity = new Yoshi(assets.yoshi, physics);
      yoshiEntity.spawn(ySpawn.x, ySpawn.y, ySpawn.z);
      entityManager.setYoshi(yoshiEntity);
    }

    rawModels.mario = assets.mario;
    rawModels.luigi = assets.luigi;

    // Everything is ready: fade out and hide the loading screen.
    const loadingScreen = document.getElementById("loading-screen");
    if (loadingScreen) {
      loadingScreen.style.opacity = "0";
      setTimeout(() => {
        loadingScreen.style.display = "none";
      }, 500);
    }

    const gameLoop = new GameLoop(renderer, updateGame);
    gameLoop.start();
  })
  .catch((error) => {
    console.error("Error while loading assets:", error);
    const loadingText = document.getElementById("loading-text");
    if (loadingText) loadingText.innerText = "LOADING ERROR";
  });