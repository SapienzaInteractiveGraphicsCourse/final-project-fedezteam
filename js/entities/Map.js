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
      console.warn("Impossibile caricare level1.json, uso dati di fallback.");
    }

    const arenaSize = 100;
    this.playerSpawn = levelData?.playerSpawn || { x: 0, y: 2, z: 0 };
    this.yoshiSpawn = levelData?.yoshiSpawn || { x: 4, y: -0.2, z: 2 };

    // PAVIMENTO
    const textureLoader = new THREE.TextureLoader();
    const grassTexture = textureLoader.load("assets/textures/field/grass2.jpg");

    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.repeat.set(25, 25);
    grassTexture.colorSpace = THREE.SRGBColorSpace;

    const floorGeometry = new THREE.BoxGeometry(arenaSize, 1, arenaSize);
    const floorMaterial = new THREE.MeshStandardMaterial({
      map: grassTexture,
      color: 0xffffff,
      roughness: 1,
    });

    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.position.set(0, -0.9, 0);
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);

    // FISICA
    const groundShape = new CANNON.Box(
      new CANNON.Vec3(arenaSize / 2, 0.5, arenaSize / 2),
    );
    const groundBody = new CANNON.Body({
      mass: 0,
      shape: groundShape,
      position: new CANNON.Vec3(0, -0.5, 0),
      material: this.physicsWorld?.defaultMaterial,
    });

    const world = this.physicsWorld?.world || this.physicsWorld;
    if (world && typeof world.addBody === "function") {
      world.addBody(groundBody);
    }

    // SPAWN ELEMENTI
    await this._spawnDecorations(arenaSize);
    await this._spawnStars(levelData?.stars);
    await this._spawnMushrooms(levelData?.mushrooms);
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

    const step = 8;
    const half = arenaSize / 2 - 5;

    for (let x = -half; x <= half; x += step) {
      for (let z = -half; z <= half; z += step) {
        const offsetX = (Math.random() - 0.5) * 3;
        const offsetZ = (Math.random() - 0.5) * 3;
        const posX = x + offsetX;
        const posZ = z + offsetZ;

        if (flowerGlb && Math.random() > 0.4) {
          const plant = flowerGlb.scene.clone();
          plant.position.set(posX, -0.6, posZ);

          plant.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          this.scene.add(plant);
        }

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
                child.material.forEach(mat => mat.dispose());
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
  }
}
