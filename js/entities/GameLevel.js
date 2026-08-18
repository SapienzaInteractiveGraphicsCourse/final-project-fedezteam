import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import BuildingFactory from "./buildings/BuildingFactory.js";

// Renamed from "Map" to avoid shadowing the native JS Map class,
// and no longer extends EntityManager: it only ever needed a THREE.Group
// to act as its scene container, not any of EntityManager's entity logic.
export default class GameLevel {
  constructor(physicsWorld) {
    this.scene = new THREE.Group();
    this.physicsWorld = physicsWorld;

    this.questionMarkBlocks = [];
    this.mushroomGlb = null;

    this.loader = new GLTFLoader();

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
    );
    this.loader.setDRACOLoader(dracoLoader);
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
      console.warn("[GameLevel] Could not load level JSON:", levelJsonPath);
    }

    this.playerSpawn = levelData?.playerSpawn || { x: 0, y: 2, z: 0 };
    this.yoshiSpawn = levelData?.yoshiSpawn || { x: 5, y: 2, z: -5 };

    // Ground texture shared by every platform.
    const textureLoader = new THREE.TextureLoader();
    const grassTexture = textureLoader.load("assets/textures/field/grass2.jpg");
    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.repeat.set(55, 55);
    grassTexture.colorSpace = THREE.SRGBColorSpace;

    const platformsData = levelData?.platforms || [];
    const world = this.physicsWorld?.world || this.physicsWorld;

    platformsData.forEach((plat) => {
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

    // Preload the mushroom model once, reused by "?" blocks at runtime.
    try {
      this.mushroomGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Items/mushroom.glb",
      );
    } catch (e) {
      console.warn("[GameLevel] mushroom.glb not found.");
    }

    const mainIslandSize = platformsData[0]?.size.x || 60;

    await this._spawnDecorations(mainIslandSize);
    await this._spawnStars(levelData?.stars);
    await this._spawnMushrooms(levelData?.mushrooms);
    await this._spawnQuestionMarkBlocks(levelData?.questionMarkBlocks);
    await this._spawnBuildingsAndNPCs(
      levelData?.buildings,
      levelData?.npcs,
      levelData?.hills,
    );
    await this._spawnGrass(mainIslandSize);
  }

  async _spawnDecorations(arenaSize) {
    let flowerGlb = null,
      coinGlb = null,
      treeGlb = null;

    try {
      flowerGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Map/flower1.glb",
      );
    } catch (e) {}
    try {
      coinGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Items/coin.glb",
      );
    } catch (e) {}
    try {
      treeGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Map/palm_tree.glb",
      );
    } catch (e) {}

    const step = 12;
    const half = arenaSize / 2 - 10;

    for (let x = -half; x <= half; x += step) {
      for (let z = -half; z <= half; z += step) {
        // Skip the central area where buildings/NPCs are placed.
        if (x > -40 && x < 80 && z > -50 && z < 50) continue;

        const posX = x + (Math.random() - 0.5) * 6;
        const posZ = z + (Math.random() - 0.5) * 6;

        if (treeGlb && Math.random() > 0.85) {
          const tree = treeGlb.scene.clone();
          const scale = 0.04 + Math.random() * 0.03;
          tree.scale.set(scale, scale, scale);
          tree.rotation.y = Math.random() * Math.PI * 2;
          tree.position.set(posX, 0, posZ);

          tree.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          this.scene.add(tree);
        } else if (flowerGlb && Math.random() > 0.75) {
          const plant = flowerGlb.scene.clone();
          const scale = 0.7 + Math.random() * 0.8;
          plant.scale.set(scale, scale, scale);
          plant.rotation.y = Math.random() * Math.PI * 2;
          plant.position.set(posX, 0, posZ);

          plant.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = false;
              child.receiveShadow = true;
            }
          });
          this.scene.add(plant);
        } else if (coinGlb && Math.random() > 0.9) {
          const coin = coinGlb.scene.clone();
          coin.scale.set(0.6, 0.6, 0.6);
          coin.position.set(posX, 1.5, posZ);

          coin.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = false;
              child.receiveShadow = false;
            }
          });

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

  async _spawnStars(starPositions) {
    let starGlb = null;
    try {
      starGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Items/star.glb",
      );
    } catch (e) {
      console.warn("[GameLevel] star.glb not found.");
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
        // Fallback primitive if the model failed to load.
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

  async _spawnMushrooms(mushroomPositions) {
    if (!mushroomPositions || mushroomPositions.length === 0) return;

    let mushroomGlb = null;
    try {
      mushroomGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Items/mushroom.glb",
      );
    } catch (e) {
      console.warn("[GameLevel] mushroom.glb not found.");
    }

    mushroomPositions.forEach((pos) => {
      let mushroomMesh;
      if (mushroomGlb) {
        mushroomMesh = mushroomGlb.scene.clone();
        mushroomMesh.scale.set(0.4, 0.4, 0.4);
        mushroomMesh.position.set(pos.x, pos.y, pos.z);
      } else {
        // Fallback primitive: a simple cap + stem.
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

  // Dynamic mushroom spawned at runtime when a "?" block is hit.
  _spawnSingleMushroom(x, y, z) {
    if (!this.mushroomGlb) return;

    const mesh = this.mushroomGlb.scene.clone();
    mesh.scale.set(0.4, 0.4, 0.4);
    mesh.position.set(x, y, z);
    mesh.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    this.scene.add(mesh);

    let body = null;
    const world = this.physicsWorld?.world || this.physicsWorld;
    if (world) {
      const radius = 0.5;
      body = new CANNON.Body({
        mass: 2,
        shape: new CANNON.Sphere(radius),
        position: new CANNON.Vec3(x, y, z),
        material: this.physicsWorld?.defaultMaterial,
        fixedRotation: true,
      });

      body.velocity.set(4, 7, 0);
      world.addBody(body);
    }

    this.mushrooms.push({
      mesh: mesh,
      body: body,
      position: mesh.position,
      collected: false,
    });
  }

  async _spawnQuestionMarkBlocks(positions) {
    let questionMarkGlb = null;
    try {
      questionMarkGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Items/question_mark_block.glb",
      );
    } catch (e) {
      console.warn("[GameLevel] question_mark_block.glb not found.");
    }

    const blocks =
      positions && positions.length > 0
        ? positions
        : [
            { x: -3, y: 4.5, z: 0 },
            { x: 0, y: 4.5, z: 0 },
            { x: 3, y: 4.5, z: 0 },
          ];

    blocks.forEach((pos) => {
      let mesh;
      if (questionMarkGlb) {
        mesh = questionMarkGlb.scene.clone();
        mesh.scale.set(0.0012, 0.0012, 0.0012);
      } else {
        const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
        const mat = new THREE.MeshStandardMaterial({
          color: 0xfbd000,
          roughness: 0.4,
        });
        mesh = new THREE.Mesh(geo, mat);
      }

      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      this.scene.add(mesh);

      const world = this.physicsWorld?.world || this.physicsWorld;
      let body = null;
      if (world) {
        const shape = new CANNON.Box(new CANNON.Vec3(0.75, 0.75, 0.75));
        body = new CANNON.Body({
          mass: 0,
          shape: shape,
          position: new CANNON.Vec3(pos.x, pos.y, pos.z),
          material: this.physicsWorld?.defaultMaterial,
        });
        world.addBody(body);
      }

      this.questionMarkBlocks.push({
        mesh: mesh,
        body: body,
        position: mesh.position,
        isHit: false,
      });
    });
  }

  // Spawns buildings, hills and NPCs described in the level JSON via BuildingFactory.
  async _spawnBuildingsAndNPCs(
    buildingsData = [],
    npcsData = [],
    hillsData = [],
  ) {
    const worldCheck = this.physicsWorld?.world || this.physicsWorld;
    if (!worldCheck) {
      // If this fires, every structure below spawns visually but with no collider.
      console.warn(
        "[GameLevel] physicsWorld is missing — structures will have no collider.",
      );
    }

    // Hills go through the same factory as buildings, just tagged with a default type.
    const allStructures = [
      ...buildingsData,
      ...hillsData.map((h) => ({
        ...h,
        type: h.type || "block_grass_large",
      })),
    ];

    for (const b of allStructures) {
      try {
        let glbPath;

        if (b.type.includes("hill") || b.type === "block_grass_large") {
          glbPath = `assets/models/Super_Mario/Map/block-grass-large.glb`;
        } else if (b.type.includes("toad_house")) {
          // NOTE: every Toad House variant currently shares the same red model
          // file. If "toad_house_blue" appears in the JSON it will still render red.
          glbPath = `assets/models/Super_Mario/Map/toad_house_red.glb`;
        } else {
          glbPath = `assets/models/Super_Mario/Map/${b.type}.glb`;
        }

        const glb = await this.loader.loadAsync(glbPath);
        const mesh = glb.scene.clone();

        const structureInstance = BuildingFactory.create(
          b.type,
          mesh,
          this.physicsWorld,
          b,
        );

        if (structureInstance) {
          this.scene.add(structureInstance.mesh);
        } else {
          console.warn("[GameLevel] Structure not added to scene:", b);
        }
      } catch (e) {
        console.warn(`[GameLevel] Could not load structure: ${b.type}`, e);
      }
    }

    for (const npc of npcsData) {
      try {
        const glb = await this.loader.loadAsync(
          `assets/models/Super_Mario/NPC/${npc.type}.glb`,
        );
        const mesh = glb.scene.clone();

        mesh.scale.set(npc.scale, npc.scale, npc.scale);
        mesh.position.set(npc.x, npc.y, npc.z);

        mesh.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        this.scene.add(mesh);
      } catch (e) {
        console.warn(`[GameLevel] Could not load NPC: ${npc.type}.glb`);
      }
    }
  }

  async _spawnGrass(arenaSize) {
    let grassGlb = null;
    try {
      grassGlb = await this.loader.loadAsync(
        "assets/models/Super_Mario/Map/grass.glb",
      );
    } catch (e) {
      return;
    }

    const geometries = [];
    let grassMaterial = null;

    grassGlb.scene.traverse((child) => {
      if (child.isMesh) {
        const clonedGeo = child.geometry.clone();
        clonedGeo.applyMatrix4(child.matrixWorld);
        geometries.push(clonedGeo);

        if (!grassMaterial) {
          grassMaterial = child.material.clone();
          if (grassMaterial.color) grassMaterial.color.multiplyScalar(0.4);
          grassMaterial.roughness = 1;
        }
      }
    });

    if (geometries.length === 0) return;

    // Merge all grass blades into one instanced mesh for performance.
    const grassGeometry = BufferGeometryUtils.mergeGeometries(geometries);
    const matrices = [];
    const dummy = new THREE.Object3D();

    const step = 0.9;
    const margin = 18;
    const half = arenaSize / 2 - margin;

    for (let x = -half; x <= half; x += step) {
      for (let z = -half; z <= half; z += step) {
        if (Math.random() > 0.2) {
          const posX = x + (Math.random() - 0.5) * step * 0.8;
          const posZ = z + (Math.random() - 0.5) * step * 0.8;

          if (Math.abs(posX) > half || Math.abs(posZ) > half) continue;

          const scale = 0.0004 + Math.random() * 0.0025;

          dummy.position.set(posX, 0, posZ);
          dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
          dummy.scale.set(scale * 3, scale, scale * 3);
          dummy.updateMatrix();

          matrices.push(dummy.matrix.clone());
        }
      }
    }

    const instancedGrass = new THREE.InstancedMesh(
      grassGeometry,
      grassMaterial,
      matrices.length,
    );
    instancedGrass.receiveShadow = true;
    instancedGrass.castShadow = false;

    matrices.forEach((matrix, i) => {
      instancedGrass.setMatrixAt(i, matrix);
    });

    this.scene.add(instancedGrass);
  }

  update(player, onCoinCollected, onStarCollected, onMushroomCollected) {
    if (!player) return;

    const playerPos = player.position;
    const coinRadiusSq = this.coinCollectRadius * this.coinCollectRadius;

    // 1. Coins
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

    // 2. Stars
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

    // 3. Dynamic mushrooms
    for (const shroom of this.mushrooms) {
      if (shroom.collected) continue;

      if (shroom.body) {
        shroom.body.velocity.x = 3;
        shroom.mesh.position.copy(shroom.body.position);
        shroom.mesh.quaternion.copy(shroom.body.quaternion);
        shroom.position = shroom.mesh.position;
      }

      const distance = playerPos.distanceTo(shroom.position);
      if (distance <= 1.8) {
        shroom.collected = true;
        this.scene.remove(shroom.mesh);

        const world = this.physicsWorld?.world || this.physicsWorld;
        if (shroom.body && world) {
          world.removeBody(shroom.body);
        }

        if (onMushroomCollected) onMushroomCollected();
      }
    }

    // 4. "?" blocks
    if (this.questionMarkBlocks) {
      for (const block of this.questionMarkBlocks) {
        if (block.isHit) continue;

        const dx = Math.abs(playerPos.x - block.position.x);
        const dz = Math.abs(playerPos.z - block.position.z);
        const dy = block.position.y - playerPos.y;

        if (dx < 1.2 && dz < 1.2 && dy > 1.2 && dy < 2.8) {
          block.isHit = true;

          // Bump animation: nudge the block up, then back down.
          block.mesh.position.y += 0.25;
          const hitMesh = block.mesh;
          setTimeout(() => {
            hitMesh.position.y -= 0.25;
          }, 100);

          this._spawnSingleMushroom(
            block.position.x,
            block.position.y + 1.2,
            block.position.z,
          );

          this.scene.remove(block.mesh);

          const smoothGeo = new THREE.BoxGeometry(
            block.hitboxX || 1.5,
            block.hitboxY || 1.5,
            block.hitboxZ || 1.5,
          );
          const smoothMat = new THREE.MeshStandardMaterial({
            color: 0x8b5a2b,
            roughness: 0.6,
          });

          const smoothMesh = new THREE.Mesh(smoothGeo, smoothMat);
          smoothMesh.position.copy(block.position);
          smoothMesh.castShadow = true;
          smoothMesh.receiveShadow = true;

          this.scene.add(smoothMesh);
          block.mesh = smoothMesh;
        }
      }
    }
  }
}