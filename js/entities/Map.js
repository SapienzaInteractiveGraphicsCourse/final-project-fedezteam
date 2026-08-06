import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import EntityManager from "./EntityManager.js";

export default class Map extends EntityManager {
  constructor(physicsWorld) {
    super(new THREE.Group());
    this.physicsWorld = physicsWorld;
    this.loader = new GLTFLoader();
    this.loader.setResourcePath("assets/");

    this.playerSpawn = null;
    this.yoshiSpawn = null;

    this.coins = [];
    this.coinCollectRadius = 2.5;
  }

  async loadLevel() {
    // -------------------------------------------------------------
    // 1. IMPOSTAZIONI MAPPA E SPAWN
    // -------------------------------------------------------------
    const arenaSize = 100; // Dimensioni del pavimento (100x100 unità)
    this.playerSpawn = { x: 0, y: 2, z: 0 };
    this.yoshiSpawn = { x: 4, y: -0.2, z: 2 };

    // -------------------------------------------------------------
    // 2. PAVIMENTO UNICO THREE.JS + TEXTURE ERBA (grass.png)
    // -------------------------------------------------------------
    const textureLoader = new THREE.TextureLoader();

    // Carica la texture .png
    const grassTexture = textureLoader.load("assets/textures/grass.png");

    // Configura la ripetizione direttamente sulla texture
    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.repeat.set(25, 25); // Regola questo numero per ingrandire o rimpicciolire i fili d'erba
    grassTexture.colorSpace = THREE.SRGBColorSpace;

    const floorGeometry = new THREE.BoxGeometry(arenaSize, 1, arenaSize);
    const floorMaterial = new THREE.MeshStandardMaterial({
      map: grassTexture, // Passa direttamente la texture: Three.js la aggiornerà appena caricata
      color: 0xffffff, // Imposta bianco per mostrare i colori originali di grass.png
      roughness: 0.9,
    });

    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.position.set(0, -0.9, 0);
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);

    // -------------------------------------------------------------
    // 3. COLLISIONE FISICA (Cannon.js)
    // -------------------------------------------------------------
    // CANNON.Box prende le "semidimensioni" (halfExtents)
    const groundShape = new CANNON.Box(
      new CANNON.Vec3(arenaSize / 2, 0.5, arenaSize / 2),
    );
    const groundBody = new CANNON.Body({
      mass: 0, // Mass = 0 rende il terreno fisso e inamovibile
      shape: groundShape,
      position: new CANNON.Vec3(0, -0.5, 0), // Stessa identica posizione della mesh
      material: this.physicsWorld?.defaultMaterial,
    });

    const world = this.physicsWorld?.world || this.physicsWorld;
    if (world && typeof world.addBody === "function") {
      world.addBody(groundBody);
    }

    // -------------------------------------------------------------
    // 4. SPAWN DI PIANTE / FIORI E MONETE
    // -------------------------------------------------------------
    await this._spawnDecorations(arenaSize);

    // -------------------------------------------------------------
    // 5. PREPARAZIONE MURI DI CONFINE (Opzionale)
    // -------------------------------------------------------------
    // scommenta questa riga quando vorrai attivare i muri attorno all'arena:
    // this._createBoundaryWalls(arenaSize);
  }

  /**
   * Spawna piantine/fiori e monete ciclicamente sulla mappa
   */
  async _spawnDecorations(arenaSize) {
    let flowerGlb = null;
    let coinGlb = null;

    try {
      // Carica il modello del fiore o della pianta se presente
      flowerGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Map/flower1.glb",
      );
    } catch (e) {
      console.warn("Modello flower1.glb non trovato, salto le piante.");
    }

    try {
      // Carica il modello della moneta
      coinGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Items/coin.glb",
      );
    } catch (e) {
      console.warn("Modello coin.glb non trovato, salto le monete.");
    }

    const step = 8; // Distanza tra le decorazioni
    const half = arenaSize / 2 - 5;

    for (let x = -half; x <= half; x += step) {
      for (let z = -half; z <= half; z += step) {
        // Piccola variazione casuale sulla posizione per un effetto naturale
        const offsetX = (Math.random() - 0.5) * 3;
        const offsetZ = (Math.random() - 0.5) * 3;
        const posX = x + offsetX;
        const posZ = z + offsetZ;

        // Spawna una piantina/fiore
        if (flowerGlb && Math.random() > 0.4) {
          const plant = flowerGlb.scene.clone();

          // ➔ MODIFICA QUI: Imposta y a -0.15 (o -0.2) invece di 0
          plant.position.set(posX, -0.15, posZ);

          plant.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          this.scene.add(plant);
        }

        // Spawna una moneta ogni tanto (alzata a y = 1.5)
        if (coinGlb && Math.random() > 0.7) {
          const coin = coinGlb.scene.clone();
          coin.position.set(posX, 1.5, posZ);
          this.scene.add(coin);

          this.coins.push({
            mesh: coin,
            position: coin.position,
            collected: false,
          });
        }
      }
    }
  }

  /**
   * Crea i 4 muri trasparenti/invisibili o visibili per delimitare la mappa
   */
  _createBoundaryWalls(arenaSize) {
    const wallHeight = 10;
    const wallThickness = 2;
    const halfSize = arenaSize / 2;

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.5, // Imposta a 1.0 se li vuoi opachi o a 0 se li vuoi invisibili
    });

    const positions = [
      { x: 0, z: -halfSize, width: arenaSize, depth: wallThickness }, // Nord
      { x: 0, z: halfSize, width: arenaSize, depth: wallThickness }, // Sud
      { x: -halfSize, z: 0, width: wallThickness, depth: arenaSize }, // Ovest
      { x: halfSize, z: 0, width: wallThickness, depth: arenaSize }, // Est
    ];

    positions.forEach((p) => {
      // Visuale Three.js
      const wallGeo = new THREE.BoxGeometry(p.width, wallHeight, p.depth);
      const wallMesh = new THREE.Mesh(wallGeo, wallMaterial);
      wallMesh.position.set(p.x, wallHeight / 2, p.z);
      this.scene.add(wallMesh);

      // Fisica Cannon.js
      const wallShape = new CANNON.Box(
        new CANNON.Vec3(p.width / 2, wallHeight / 2, p.depth / 2),
      );
      const wallBody = new CANNON.Body({
        mass: 0,
        shape: wallShape,
        position: new CANNON.Vec3(p.x, wallHeight / 2, p.z),
      });

      const world = this.physicsWorld?.world || this.physicsWorld;
      if (world && typeof world.addBody === "function") {
        world.addBody(wallBody);
      }
    });
  }

  /**
   * Logica di raccolta monete
   */
  update(player, onCoinCollected) {
    if (!player || this.coins.length === 0) return;

    const playerPos = player.position;

    for (const coin of this.coins) {
      if (coin.collected) continue;

      const distance = playerPos.distanceTo(coin.position);
      if (distance <= this.coinCollectRadius) {
        coin.collected = true;
        this.scene.remove(coin.mesh);
        if (onCoinCollected) onCoinCollected();
      }
    }
  }
}
