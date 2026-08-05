import RendererManager from './core/Renderer.js';
import AssetLoader from './core/AssetLoader.js';
import GameLoop from './core/GameLoop.js';
import InputManager from './core/InputManager.js';
import UIManager from './ui/UIManager.js';
import PhysicsEngine from './physics/PhysicsEngine.js';
import Player from './entities/Player.js';
import Yoshi from './entities/Yoshi.js';
import Map from './entities/Map.js';
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

// 2. VARIABILI DI STATO E ENTITÀ
let menuCameraAngle = 0;
const rawModels = { mario: null, luigi: null };
let yoshiEntity = null;
let mapEntity = null;
let player = null;

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
    player = new Player(rawModels[character], 35);
    player.spawn(-20, physics.groundY, 250);
    renderer.scene.add(player.mesh);
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

  if (!player) return;

  // --- AGGIORNAMENTO PLAYER (Input + Movimento + Fisica) ---
  player.update(delta, input, physics);

  // --- TELECAMERA INSEGUIMENTO ---
  renderer.camera.position.x = player.position.x;
  renderer.camera.position.y = player.position.y + 4;
  renderer.camera.position.z = player.position.z + 8;
  renderer.camera.lookAt(player.position.x, player.position.y + 1, player.position.z);
}

// 5. CARICAMENTO BATCH ASSET E AVVIO GAME LOOP
const assetsToLoad = {
  map: 'assets/models/Others/map.glb',
  mario: 'assets/models/Super_Mario/Main_Characters/mario.glb',
  luigi: 'assets/models/Super_Mario/Main_Characters/luigi.glb',
  yoshi: 'assets/models/Super_Mario/Mounts/yoshi_ride.glb'
};

assetLoader.loadAll(assetsToLoad).then((assets) => {
  // Inizializzazione Mappa
  mapEntity = new Map(assets.map, 0.2);
  mapEntity.addToScene(renderer.scene);

  // Inizializzazione Yoshi
  yoshiEntity = new Yoshi(assets.yoshi);
  yoshiEntity.spawn(-20, physics.groundY, 245);
  renderer.scene.add(yoshiEntity.mesh);

  // Preparazione Personaggi
  rawModels.mario = assets.mario;

  const luigiRawModel = assets.luigi;
  const luigiGroup = new THREE.Group();
  luigiRawModel.rotation.y = -Math.PI / 2;
  luigiGroup.add(luigiRawModel);
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
