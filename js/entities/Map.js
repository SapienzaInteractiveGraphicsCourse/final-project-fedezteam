import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import EntityManager from "./EntityManager.js";

export default class Map extends EntityManager {
  constructor(physicsWorld) {
    super(new THREE.Group());
    this.physicsWorld = physicsWorld;
    this.brickBlocks = []; // Array per i blocchi
    this.mushroomGlb = null; // Salviamo il modello per usarlo nei blocchi

    this.loader = new GLTFLoader();
    this.loader.setResourcePath("assets/");

    this.playerSpawn = null;
    this.yoshiSpawn = null;

    this.coins = [];
    this.coinCollectRadius = 2.5;

    this.stars = [];
    this.starCollectRadius = 2.8;

    this.mushrooms = [];
    this.mushroomCollectRadius = 2.5;
  }

async loadLevel(levelJsonPath = "./assets/levels/level1.json") {
    let levelData = null;
    try {
      const response = await fetch(levelJsonPath);
      levelData = await response.json();
    } catch (e) {
      console.warn("Impossibile caricare level1.json");
    }

    // 1. SPAWNS (Dal JSON)
    this.playerSpawn = levelData?.playerSpawn || { x: 0, y: 2, z: 0 };
    this.yoshiSpawn = levelData?.yoshiSpawn || { x: 5, y: 2, z: -5 };

    // 2. TEXTURE ERBA
    const textureLoader = new THREE.TextureLoader();
    const grassTexture = textureLoader.load("assets/textures/field/grass2.jpg");
    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.repeat.set(4, 4);
    grassTexture.colorSpace = THREE.SRGBColorSpace;

    // 3. CREA LE ISOLE DAL JSON
    const platformsData = levelData?.platforms || [];
    const world = this.physicsWorld?.world || this.physicsWorld;

    platformsData.forEach((plat) => {
      // Grafica (Three.js)
      const geo = new THREE.BoxGeometry(plat.size.x, plat.size.y, plat.size.z);
      const mat = new THREE.MeshStandardMaterial({
        map: grassTexture,
        roughness: 0.8,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(plat.position.x, plat.position.y, plat.position.z);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scene.add(mesh);

      // Fisica (Cannon.js)
      const halfSize = new CANNON.Vec3(
        plat.size.x / 2,
        plat.size.y / 2,
        plat.size.z / 2,
      );
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(halfSize),
        position: new CANNON.Vec3(
          plat.position.x,
          plat.position.y,
          plat.position.z,
        ),
        material: this.physicsWorld?.defaultMaterial,
      });

      if (world) world.addBody(body);
    });
    
    // 4. PRE-CARICA IL FUNGO 
    // Lo salviamo in memoria per averlo disponibile quando colpisci i blocchi
    try {
      this.mushroomGlb = await this.loader.loadAsync("assets/models/Super_Mario/Items/mushroom.glb");
    } catch(e) {}

    // 5. METTI MONETE, STELLE, FUNGHI E BLOCCHI SULLA MAPPA
    // Prende la dimensione dell'Isola Principale (es: 60) per spargere monete e fiori senza farli cadere nel vuoto
    const mainIslandSize = platformsData[0]?.size.x || 60;

    // Chiama i generatori una volta sola e nell'ordine corretto
    await this._spawnDecorations(mainIslandSize);
    await this._spawnStars(levelData?.stars);
    await this._spawnMushrooms(levelData?.mushrooms); 
    await this._spawnBrickBlocks(levelData?.brickBlocks); 
  }
  
  /**
   * Spawna i Funghi sulla mappa
   */
  async _spawnMushrooms(mushroomPositions) {
    let mushroomGlb = null;

    try {
      mushroomGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Items/mushroom.glb",
      );
    } catch (e) {
      console.warn(
        "Modello mushroom.glb non trovato. Creo fungo geometrico di fallback.",
      );
    }
    

    const positions = mushroomPositions || [{ x: 10, y: 1.5, z: -10 }];

    positions.forEach((pos) => {
      let mushroomMesh;

      if (mushroomGlb) {
        mushroomMesh = mushroomGlb.scene.clone();
        mushroomMesh.position.set(pos.x, pos.y, pos.z);
      } else {
        // Fallback: Fungo geometrico composto da cappello rosso e gambo bianco
        const group = new THREE.Group();

        const capGeo = new THREE.SphereGeometry(
          1,
          16,
          16,
          0,
          Math.PI * 2,
          0,
          Math.PI / 2,
        );
        const capMat = new THREE.MeshStandardMaterial({ color: 0xe52521 });
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.y = 0.5;

        const stemGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.8, 16);
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.position.y = 0.1;

        group.add(cap);
        group.add(stem);
        mushroomMesh = group;
        mushroomMesh.position.set(pos.x, pos.y, pos.z);
      }

      mushroomMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      this.scene.add(mushroomMesh);
      this.mushrooms.push({
        mesh: mushroomMesh,
        position: mushroomMesh.position,
        collected: false,
      });
    });
  }

  async _spawnStars(starPositions) {
    let starGlb = null;

    try {
      starGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Items/star.glb",
      );
    } catch (e) {
      console.warn(
        "Modello star.glb non trovato. Creo stella geometrica dorata di fallback.",
      );
    }

    const positions = starPositions || [
      { x: -30, y: 2, z: -30 },
      { x: 30, y: 2, z: -30 },
      { x: -30, y: 2, z: 30 },
      { x: 30, y: 2, z: 30 },
      { x: 0, y: 2, z: -40 },
    ];

    positions.forEach((pos) => {
      let starMesh;

      if (starGlb) {
        starMesh = starGlb.scene.clone();
        starMesh.position.set(pos.x, pos.y, pos.z);
      } else {
        const geo = new THREE.OctahedronGeometry(1.2, 0);
        const mat = new THREE.MeshStandardMaterial({
          color: 0xffd700,
          emissive: 0xffa500,
          emissiveIntensity: 0.4,
          metalness: 0.8,
          roughness: 0.2,
        });
        starMesh = new THREE.Mesh(geo, mat);
        starMesh.position.set(pos.x, pos.y + 0.5, pos.z);
      }

      starMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      this.scene.add(starMesh);
      this.stars.push({
        mesh: starMesh,
        position: starMesh.position,
        collected: false,
      });
    });
  }

  async _spawnDecorations(arenaSize) {
    let flowerGlb = null;
    let coinGlb = null;

    try {
      flowerGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Map/flower1.glb",
      );
    } catch (e) {
      console.warn("Modello flower1.glb non trovato, salto le piante.");
    }

    try {
      coinGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Items/coin.glb",
      );
    } catch (e) {
      console.warn("Modello coin.glb non trovato, salto le monete.");
    }

    const step = 5; // 👈 Ridotto da 8 a 5 per avere più densità di oggetti
    const half = arenaSize / 2 - 5;

    for (let x = -half; x <= half; x += step) {
      for (let z = -half; z <= half; z += step) {
        // Aggiungiamo molto più offset per un look organico "a ciuffi"
        const offsetX = (Math.random() - 0.5) * 4;
        const offsetZ = (Math.random() - 0.5) * 4;
        const posX = x + offsetX;
        const posZ = z + offsetZ;

        // Fiori sparsi con scala e rotazione variabile (probabilità aumentata)
        if (flowerGlb && Math.random() > 0.4) {
          const plant = flowerGlb.scene.clone();

          // Randomizza dimensione e rotazione per farli sembrare naturali
          const scale = 0.7 + Math.random() * 0.8; // Variano da 0.7x a 1.5x
          plant.scale.set(scale, scale, scale);
          plant.rotation.y = Math.random() * Math.PI * 2;

          // Posizionati perfettamente sul piano Y = 0 (rimosso il -0.6)[cite: 6]
          plant.position.set(posX, 0, posZ);

          plant.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          this.scene.add(plant);
        }

        // Generazione delle monete[cite: 6]
        if (coinGlb && Math.random() > 0.75) {
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
   * Update con gestione per Monete (ruotano), Stelle (ruotano) e Funghi (STATICI)
   */
  update(player, onCoinCollected, onStarCollected, onMushroomCollected) {
    if (!player) return;

    const playerPos = player.position;
    const coinRadiusSq = this.coinCollectRadius * this.coinCollectRadius;
    // 🪙 1. Monete (Ruotano)
    for (const coin of this.coins) {
      if (coin.collected) continue;

      coin.mesh.rotation.y += 0.04;

      const distanceSq = playerPos.distanceToSquared(coin.position);

      if (distanceSq <= coinRadiusSq) {
        coin.collected = true;
        this.scene.remove(coin.mesh);
        coin.mesh.traverse((child) => {
          if (child.isMesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
        if (onCoinCollected) onCoinCollected();
      }
    }

    // ⭐ 2. Stelle (Ruotano)
    for (const star of this.stars) {
      if (star.collected) continue;

      star.mesh.rotation.y += 0.015;

      const distance = playerPos.distanceTo(star.position);
      if (distance <= this.starCollectRadius) {
        star.collected = true;
        this.scene.remove(star.mesh);
        if (onStarCollected) onStarCollected();
      }
    }

    // 🍄 3. Funghi (NON ruotano)
    for (const shroom of this.mushrooms) {
      if (shroom.collected) continue;

      const distance = playerPos.distanceTo(shroom.position);
      if (distance <= this.mushroomCollectRadius) {
        shroom.collected = true;
        this.scene.remove(shroom.mesh);
        if (onMushroomCollected) onMushroomCollected();
      }
    }
    // 🧱 4. Collisione Testa-Blocco
    for (const block of this.brickBlocks) {
      if (block.isHit) continue; // Se già colpito, ignora

      // Calcola distanza X e Z per vedere se Mario è esattamente sotto il blocco
      const dx = Math.abs(playerPos.x - block.position.x);
      const dz = Math.abs(playerPos.z - block.position.z);

      if (dx < 1.2 && dz < 1.2) {
        // La testa di Mario è circa Y + 2. Il fondo del blocco (lato 2) è circa Y - 1.
        const headY = playerPos.y + 2.0; 
        const blockBottom = block.position.y - 1.0;

        // Se la testa tocca il fondo del blocco saltando verso l'alto
        if (headY > blockBottom && headY < blockBottom + 0.5) {
          block.isHit = true; // Segna come colpito
          
          // Animazione "Balzo" del blocco
          block.mesh.position.y += 0.3;
          setTimeout(() => {
            if (block.mesh) block.mesh.position.y -= 0.3;
          }, 120);

          // Fai comparire il Fungo sopra il blocco!
          this._spawnSingleMushroom(block.position.x, block.position.y + 1.5, block.position.z);
        }
      }
    }
  }
  // 💡 NUOVO METODO: Spawna i blocchi sospesi
  async _spawnBrickBlocks(positions) {
    let brickGlb = null;
    try {
      brickGlb = await this.loader.loadAsync("assets/models/Super_Mario/Map/brick_block.glb");
    } catch (e) {
      console.warn("Modello brick_block.glb non trovato.");
    }

    // Se non ci sono coordinate, ne crea due di default sospesi a Y=4.5
    const blocks = positions || [
      { x: -8, y: 4.5, z: -10 },
      { x: 8, y: 4.5, z: -10 }
    ];

    blocks.forEach((pos) => {
      let mesh;
      if (brickGlb) {
        mesh = brickGlb.scene.clone();
        mesh.scale.set(1.2, 1.2, 1.2); // Scala del blocco
      } else {
        const geo = new THREE.BoxGeometry(2, 2, 2);
        const mat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
        mesh = new THREE.Mesh(geo, mat);
      }
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      // Fisica del blocco (Solido, Mario ci sbatte)
      const shape = new CANNON.Box(new CANNON.Vec3(1, 1, 1));
      const body = new CANNON.Body({
        mass: 0,
        shape: shape,
        position: new CANNON.Vec3(pos.x, pos.y, pos.z),
        material: this.physicsWorld?.defaultMaterial,
      });

      if (this.physicsWorld?.world) this.physicsWorld.world.addBody(body);

      this.brickBlocks.push({
        mesh: mesh,
        body: body,
        position: mesh.position,
        isHit: false // Flag per sapere se è già stato colpito
      });
    });
  }

  // 💡 NUOVO METODO HELPER: Genera un singolo fungo a runtime
  _spawnSingleMushroom(x, y, z) {
    if (!this.mushroomGlb) return;
    const mesh = this.mushroomGlb.scene.clone();
    
    mesh.scale.set(0.4, 0.4, 0.4); // 🍄 RIDIMENSIONAMENTO FUNGO (più piccolo)
    mesh.position.set(x, y, z);
    mesh.traverse((child) => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    
    this.scene.add(mesh);
    this.mushrooms.push({
      mesh: mesh, position: mesh.position, collected: false
    });
  }
}
