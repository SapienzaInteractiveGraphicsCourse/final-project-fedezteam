import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import BuildingFactory from "./Buildings/BuildingFactory.js";

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
    this.islandHalfSize = 30;

    // Erba suddivisa in chunk: ognuno è una InstancedMesh separata, così three.js
    // può scartarli col frustum culling e noi possiamo spegnere quelli lontani.
    this.grassChunks = [];
    this.grassViewDistance = 60;
  }

  /**
   * Fonde tutte le mesh di un GLB in una sola geometria (con i transform locali
   * già applicati), pronta per essere usata da una InstancedMesh.
   * Restituisce null se il modello non ha mesh o se le geometrie non sono fondibili.
   */
  _mergeGlb(glbScene) {
    // updateMatrixWorld è necessario: il GLB non è mai stato aggiunto alla scena
    // renderizzata, quindi le sue matrici mondo non sono ancora state calcolate.
    glbScene.updateMatrixWorld(true);

    const geometries = [];
    let material = null;

    glbScene.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const geo = child.geometry.clone();
        geo.applyMatrix4(child.matrixWorld);
        geometries.push(geo);
        if (!material) material = child.material;
      }
    });

    if (geometries.length === 0) return null;

    const merged =
      geometries.length === 1
        ? geometries[0]
        : BufferGeometryUtils.mergeGeometries(geometries);

    if (!merged) {
      console.warn("[GameLevel] mergeGeometries fallito (attributi incompatibili).");
      return null;
    }
    return { geometry: merged, material };
  }

  /** Crea una InstancedMesh da una lista di matrici. */
  _buildInstanced(merged, matrices, { castShadow, receiveShadow }) {
    if (!merged || matrices.length === 0) return null;

    const inst = new THREE.InstancedMesh(
      merged.geometry,
      merged.material,
      matrices.length,
    );
    inst.castShadow = castShadow;
    inst.receiveShadow = receiveShadow;

    for (let i = 0; i < matrices.length; i++) inst.setMatrixAt(i, matrices[i]);
    inst.instanceMatrix.needsUpdate = true;
    // Serve a three.js per il frustum culling di tutto il blocco.
    inst.computeBoundingSphere();

    return inst;
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
    this.islandHalfSize = mainIslandSize / 2;

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

    // Palme e fiori sono decorazioni statiche e identiche tra loro: invece di
    // clonare un GLB per ciascuna (una draw call a testa) accumuliamo solo le
    // matrici e alla fine costruiamo una InstancedMesh per tipo.
    // Le monete NO: vanno rimosse singolarmente quando le raccogli.
    const treeMatrices = [];
    const flowerMatrices = [];
    const dummy = new THREE.Object3D();

    for (let x = -half; x <= half; x += step) {
      for (let z = -half; z <= half; z += step) {
        // Skip the central area where buildings/NPCs are placed.
        if (x > -40 && x < 80 && z > -50 && z < 50) continue;

        const posX = x + (Math.random() - 0.5) * 6;
        const posZ = z + (Math.random() - 0.5) * 6;

        if (treeGlb && Math.random() > 0.85) {
          const scale = 0.04 + Math.random() * 0.03;
          dummy.position.set(posX, 0, posZ);
          dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          treeMatrices.push(dummy.matrix.clone());
        } else if (flowerGlb && Math.random() > 0.75) {
          const scale = 0.7 + Math.random() * 0.8;
          dummy.position.set(posX, 0, posZ);
          dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          flowerMatrices.push(dummy.matrix.clone());
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

    if (treeGlb) {
      const merged = this._mergeGlb(treeGlb.scene);

      if (merged) {
        // palm_tree.glb dichiara alphaMode:BLEND, che il GLTFLoader traduce in
        // transparent:true + depthWrite:false. Finché ogni albero era un oggetto
        // a sé three.js li ordinava dal più lontano al più vicino e reggeva; con
        // una sola InstancedMesh sono UN oggetto solo, l'ordinamento non è più
        // possibile e gli alberi dietro finiscono sopra a quelli davanti.
        //
        // Le fronde però non sono traslucide: sono un ritaglio con bordo netto.
        // Con l'alpha test il materiale torna opaco, scrive nel depth buffer e
        // si ordina da solo per-pixel — corretto, e pure più veloce del blending.
        merged.material = merged.material.clone();
        merged.material.transparent = false;
        merged.material.depthWrite = true;
        merged.material.alphaTest = 0.5;
        merged.material.needsUpdate = true;
      }

      const trees = this._buildInstanced(merged, treeMatrices, {
        castShadow: true,
        receiveShadow: true,
      });
      if (trees) this.scene.add(trees);
    }

    if (flowerGlb) {
      const flowers = this._buildInstanced(
        this._mergeGlb(flowerGlb.scene),
        flowerMatrices,
        { castShadow: false, receiveShadow: true },
      );
      if (flowers) this.scene.add(flowers);
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

    // Riusa il modello già caricato in loadLevel(): prima veniva scaricato una
    // seconda volta, identico, per i funghi statici del JSON.
    const mushroomGlb = this.mushroomGlb;

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
      dir: 1, // verso di marcia orizzontale, si inverte ai bordi dell'isola
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
          `assets/models/Super_Mario/npc/${npc.type}.glb`,
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

    const merged = this._mergeGlb(grassGlb.scene);
    if (!merged) return;

    // Materiale scurito, come prima.
    const grassMaterial = merged.material.clone();
    if (grassMaterial.color) grassMaterial.color.multiplyScalar(0.4);
    grassMaterial.roughness = 1;

    const step = 0.9;
    const margin = 18;
    const half = arenaSize / 2 - margin;

    // Prima era UNA sola InstancedMesh da ~45.000 fili (≈15M vertici disegnati
    // ogni frame, perché un singolo oggetto o è tutto dentro il frustum o è
    // tutto fuori). Ora il campo è diviso in chunk quadrati: three.js scarta da
    // solo quelli fuori inquadratura, e update() spegne quelli troppo lontani.
    const CHUNK_SIZE = 24;
    const chunks = new Map();

    const dummy = new THREE.Object3D();

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

          const cx = Math.floor(posX / CHUNK_SIZE);
          const cz = Math.floor(posZ / CHUNK_SIZE);
          const key = cx + "|" + cz;

          let bucket = chunks.get(key);
          if (!bucket) {
            bucket = { matrices: [], cx, cz };
            chunks.set(key, bucket);
          }
          bucket.matrices.push(dummy.matrix.clone());
        }
      }
    }

    for (const bucket of chunks.values()) {
      const inst = this._buildInstanced(
        { geometry: merged.geometry, material: grassMaterial },
        bucket.matrices,
        { castShadow: false, receiveShadow: true },
      );
      if (!inst) continue;

      this.scene.add(inst);
      this.grassChunks.push({
        mesh: inst,
        center: new THREE.Vector3(
          (bucket.cx + 0.5) * CHUNK_SIZE,
          0,
          (bucket.cz + 0.5) * CHUNK_SIZE,
        ),
      });
    }

    console.log(
      `[GameLevel] Erba: ${this.grassChunks.length} chunk, ` +
        `${this.grassChunks.reduce((n, c) => n + c.mesh.count, 0)} fili totali.`,
    );
  }

  update(player, onCoinCollected, onStarCollected, onMushroomCollected) {
    if (!player) return;

    const playerPos = player.position;

    // 0. Erba: spegne i chunk lontani. I fili sono minuscoli (scala ~0.001),
    // oltre qualche decina di unità sono sotto il pixel e non si vedono
    // comunque. Il frustum culling di three.js fa il resto sui chunk laterali.
    if (this.grassChunks.length > 0) {
      const maxDistSq = this.grassViewDistance * this.grassViewDistance;
      for (const chunk of this.grassChunks) {
        const dx = playerPos.x - chunk.center.x;
        const dz = playerPos.z - chunk.center.z;
        chunk.mesh.visible = dx * dx + dz * dz <= maxDistSq;
      }
    }
    const coinRadiusSq = this.coinCollectRadius * this.coinCollectRadius;

    // 1. Coins
    for (const coin of this.coins) {
      if (coin.collected) continue;
      coin.mesh.rotation.y += 0.04;

      const distanceSq = playerPos.distanceToSquared(coin.position);
      if (distanceSq <= coinRadiusSq) {
        coin.collected = true;
        this.scene.remove(coin.mesh);
        // NB: nessun dispose() qui. Ogni moneta è un .clone() del GLB e i cloni
        // CONDIVIDONO geometry e material con l'originale. Chiamare dispose()
        // cancellerebbe i VBO usati anche da tutte le altre monete: three.js li
        // ricrea da solo al frame dopo (quindi non si rompe nulla), ma è lavoro
        // GPU sprecato e la dispose del material forza una ricompilazione dello
        // shader. Le risorse condivise andranno liberate una volta sola, quando
        // si distrugge il livello (oggi il restart ricarica la pagina, quindi
        // ci pensa il browser).
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
        // Il fungo cammina in orizzontale come nell'originale. Prima la velocità
        // era forzata a +3 per sempre: usciva dall'isola, cadeva nel vuoto e
        // restava un corpo fisico vivo all'infinito, spinto verso +X.
        // Ora inverte il verso prima del bordo e viene rimosso se cade comunque.
        const limit = this.islandHalfSize - 3;
        if (shroom.body.position.x > limit) shroom.dir = -1;
        else if (shroom.body.position.x < -limit) shroom.dir = 1;

        shroom.body.velocity.x = 3 * shroom.dir;

        shroom.mesh.position.copy(shroom.body.position);
        shroom.mesh.quaternion.copy(shroom.body.quaternion);
        shroom.position = shroom.mesh.position;

        // Caduto fuori mappa: smaltisci mesh e corpo, altrimenti restano a
        // consumare uno step di fisica per sempre.
        if (shroom.body.position.y < -20) {
          shroom.collected = true;
          this.scene.remove(shroom.mesh);
          const w = this.physicsWorld?.world || this.physicsWorld;
          if (w) w.removeBody(shroom.body);
          continue;
        }
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