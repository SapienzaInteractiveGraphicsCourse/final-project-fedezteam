import RendererManager from "./core/Renderer.js";
import AssetLoader from "./core/AssetLoader.js";
import GameLoop from "./core/GameLoop.js";
import InputManager from "./core/InputManager.js";
import UIManager from "./ui/UIManager.js";
import PhysicsEngine from "./physics/PhysicsEngine.js";
import Yoshi from "./entities/Yoshi.js";
import Map from "./entities/Map.js";
import EntityManager from "./entities/EntityManager.js";
import * as THREE from "three";

// 1. CREAZIONE MODULI CORE, UI E FISICA
const renderer = new RendererManager("#webgl-canvas");
const assetLoader = new AssetLoader();
const input = new InputManager();
const ui = new UIManager();

// Inizializzazione pulita del motore fisico Cannon-es
const physics = new PhysicsEngine({
  gravity: -35,
  fallThreshold: -20
});

// FIX FONDAMENTALE: Passiamo SIA la scena CHE l'istanza di fisica ad EntityManager
const entityManager = new EntityManager(renderer.scene, physics);
let mapEntity = null; // Riferimento globale per la mappa

// 2. VARIABILI DI STATO E HELPER
let menuCameraAngle = 0;
const rawModels = { mario: null, luigi: null };

function equalizeLuigiScale() {
  if (!rawModels.mario || !rawModels.luigi) return;
  const boxMario = new THREE.Box3().setFromObject(rawModels.mario);
  const marioHeight = boxMario.max.y - boxMario.min.y;

  const boxLuigi = new THREE.Box3().setFromObject(rawModels.luigi);
  const luigiHeight = boxLuigi.max.y - boxLuigi.min.y;

  const scaleFactor = marioHeight / luigiHeight;
  rawModels.luigi.scale.set(scaleFactor, scaleFactor, scaleFactor);
}

// 3. EVENTO AVVIO GIOCO DA MENU UI
ui.onGameStart(({ character }) => {
  if (!rawModels[character]) return;

  // Leggiamo lo spawnPoint caricato dal JSON della mappa
  const spawn = mapEntity?.playerSpawn;

  if (spawn) {
    // Istanziamo il player e lo posizioniamo alle coordinate X, Y, Z del JSON
    entityManager.spawnPlayer(rawModels[character], spawn.x, spawn.y, spawn.z);
  } else {
    // Fallback di default se la mappa non ha un punto di spawn custom
    entityManager.spawnPlayer(rawModels[character], -20, 10, 250);
  }
});

// 4. LOGICA DI AGGIORNAMENTO DEL GIOCO
function updateGame(delta) {
  // Telecamera nei menu
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

  // Aggiornamento entità (il delta e l'input bastano, la fisica è interna a EntityManager)
  entityManager.update(delta, input, ui);

  // Telecamera inseguimento (legge la posizione della mesh sincronizzata con Cannon-es)
  const playerPos = entityManager.player.mesh.position;
  renderer.camera.position.x = playerPos.x;
  renderer.camera.position.y = playerPos.y + 4;
  renderer.camera.position.z = playerPos.z + 8;
  renderer.camera.lookAt(playerPos.x, playerPos.y + 1, playerPos.z);
}

// 5. CARICAMENTO BATCH ASSET E AVVIO GAME LOOP
const assetsToLoad = {
  mario: "assets/models/Super_Mario/Main_Characters/mario.glb",
  luigi: "assets/models/Super_Mario/Main_Characters/luigi.glb",
  yoshi: "assets/models/Super_Mario/Mounts/yoshi_ride.glb",
};

assetLoader
  .loadAll(assetsToLoad)
  .then(async (assets) => {
    // 1. Caricamento della mappa tramite JSON e fisica
    mapEntity = new Map(physics);
    await mapEntity.loadLevel("./assets/levels/level1.json");
    entityManager.setMap(mapEntity);

    // 2. Spawna Yoshi leggendo dal JSON
    if (mapEntity.yoshiSpawn) {
      const ySpawn = mapEntity.yoshiSpawn;
      const yoshiEntity = new Yoshi(assets.yoshi);
      yoshiEntity.spawn(ySpawn.x, ySpawn.y, ySpawn.z);
      entityManager.setYoshi(yoshiEntity);
    }

    // 3. Preparazione Modelli Mario e Luigi
    rawModels.mario = assets.mario;

    const luigiRawModel = assets.luigi;
    const luigiGroup = new THREE.Group();
    luigiRawModel.rotation.y = -Math.PI / 2;
    luigiGroup.add(luigiRawModel);
    rawModels.luigi = luigiGroup;

    equalizeLuigiScale();

    // 4. Avvio definitivo del Game Loop
    const gameLoop = new GameLoop(renderer, updateGame);
    gameLoop.start();
  })
  .catch((error) => {
    console.error("Errore durante il caricamento degli asset:", error);
  });