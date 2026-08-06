import RendererManager from './core/Renderer.js';
import AssetLoader from './core/AssetLoader.js';
import GameLoop from './core/GameLoop.js';
import InputManager from './core/InputManager.js';
import UIManager from './ui/UIManager.js';
import PhysicsEngine from './physics/PhysicsEngine.js';
import Yoshi from './entities/Yoshi.js';
import Map from './entities/Map.js';
import GameObject from './entities/GameObject.js';
import * as THREE from 'three';

// 1. CREAZIONE MODULI CORE, UI E FISICA
const renderer = new RendererManager('#webgl-canvas');
const assetLoader = new AssetLoader();
const input = new InputManager();
const ui = new UIManager();
const physics = new PhysicsEngine({
  gravity: -60,
  jumpStrength: 22,
  groundY: 50
});

// Contenitore unico per la gestione di tutte le entità
const gameObjects = new GameObject(renderer.scene);

// Matrice della mappa a blocchi (0 = burrone/vuoto, 1 = terreno, 2 = blocco ?, 3 = stella)
const levelGrid = [
  [1, 1, 1, 0, 0, 1, 1, 1],
  [1, 1, 1, 0, 0, 1, 2, 1],
  [1, 2, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 3, 1]
];

// 2. VARIABILI DI STATO
let menuCameraAngle = 0;
const rawModels = { mario: null, luigi: null };

// Helper: Pareggia la scala di Luigi a quella di Mario
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
  if (rawModels[character]) {
    // Spawna e registra il giocatore tramite gameObjects
    gameObjects.spawnPlayer(rawModels[character], physics.groundY);
  }
});

// 4. LOGICA DI AGGIORNAMENTO DEL GIOCO (Passata al GameLoop)
function updateGame(delta) {
  // --- TELECAMERA NEI MENU ---
  if (ui.gameState === "MENU_WELCOME" || ui.gameState === "MENU_NAME") {
    menuCameraAngle += 0.5 * delta;
    const radius = 25;
    renderer.camera.position.x = -20 + Math.sin(menuCameraAngle) * radius;
    renderer.camera.position.z = 250 + Math.cos(menuCameraAngle) * radius;
    renderer.camera.position.y = physics.groundY + 10;
    renderer.camera.lookAt(-20, physics.groundY + 2, 250);
    return;
  }

  if (!gameObjects.player) return;

  // --- AGGIORNAMENTO UNIFICATO DI TUTTE LE ENTITÀ ---
  gameObjects.update(delta, input, physics, ui);

  // --- TELECAMERA INSEGUIMENTO ---
  const playerPos = gameObjects.player.position;
  renderer.camera.position.x = playerPos.x;
  renderer.camera.position.y = playerPos.y + 4;
  renderer.camera.position.z = playerPos.z + 8;
  renderer.camera.lookAt(playerPos.x, playerPos.y + 1, playerPos.z);
}

// 5. CARICAMENTO BATCH ASSET E AVVIO GAME LOOP
const assetsToLoad = {
  mario: 'assets/models/Super_Mario/Main_Characters/mario.glb',
  luigi: 'assets/models/Super_Mario/Main_Characters/luigi.glb',
  yoshi: 'assets/models/Super_Mario/Mounts/yoshi_ride.glb'
};

assetLoader.loadAll(assetsToLoad).then((assets) => {
  // Inizializzazione della mappa a blocchi generata tramite matrice
  const mapEntity = new Map(levelGrid, 4, physics.groundY);
  gameObjects.setMap(mapEntity);

  // Inizializzazione e assegnazione Yoshi a GameObject
  const yoshiEntity = new Yoshi(assets.yoshi);
  yoshiEntity.spawn(-20, physics.groundY, 245);
  gameObjects.setYoshi(yoshiEntity);

  // Preparazione Personaggi
  rawModels.mario = assets.mario;

  const luigiRawModel = assets.luigi;
  const luigiGroup = new THREE.Group();
  luigiRawModel.rotation.y = -Math.PI / 2;
  luigiGroup.add(luigiRawModel);
  //rawModels.luigi = luigiGroup;
  rawModels.luigi = luigiGroup;

  equalizeLuigiScale();

  // Avvio definitivo del Game Loop
  const gameLoop = new GameLoop(renderer, updateGame);
  gameLoop.start();

}).catch((error) => {
  console.error('Errore durante il caricamento degli asset:', error);
});


// chiamare una classe gameObject che contiene player, yoshi, map e altre entità del gioco. 
// In questo modo, il game loop può aggiornare tutte le entità in un unico posto, 
// migliorando la gestione dello stato del gioco e la leggibilità del codice.
