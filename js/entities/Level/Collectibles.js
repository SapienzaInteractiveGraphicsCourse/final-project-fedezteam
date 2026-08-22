import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { ITEM_MODELS } from "../../core/Assets/manifest.js";
import { enableShadows } from "../../utils/shadows.js";
import { normalizeMaterials } from "../../utils/materials.js";

/**
 * Owns every collectible/interactive prop in the level: coins, stars,
 * mushrooms (both level-authored and the ones spawned dynamically by "?"
 * blocks), and the "?" blocks themselves. Extracted out of the former
 * monolithic GameLevel.js.
 *
 * Coins are visually placed by Decorations (they're scattered together
 * with trees/flowers using the same random layout pass), which calls
 * registerCoin() for every coin mesh it creates; every other collectible
 * type is spawned directly by this class.
 */
export default class Collectibles {
  constructor(scene, physicsWorld, gltfLoader) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.loader = gltfLoader;

    this.coins = [];
    this.coinCollectRadius = 2.5;

    this.stars = [];
    this.starCollectRadius = 2.8;

    this.mushrooms = [];
    this.mushroomCollectRadius = 2.5;

    this.questionMarkBlocks = [];
    this.mushroomGlb = null;

    // undefined = not attempted yet, null = attempted and failed to load —
    // same cache convention as Decorations._loadCoinModel. spawnStars() is
    // called not just once at level load but also at RUNTIME every time a
    // boss (Kamek/Bowser) is defeated, dropping a fresh star (see main.js);
    // without this cache each defeat re-fetched and re-parsed star.glb from
    // scratch, which was the actual cause of the brief stutter on boss
    // defeat.
    this._starGlbCache = undefined;
  }

  // Loads (and caches) the star model — see the comment on _starGlbCache.
  async _loadStarModel() {
    if (this._starGlbCache !== undefined) return this._starGlbCache;

    try {
      this._starGlbCache = await this.loader.loadAsync(ITEM_MODELS.star);
      // Normalized once here — every star clone shares this material by
      // reference, so this covers all of them regardless of which
      // spawnStars() call they came from.
      normalizeMaterials(this._starGlbCache.scene);
    } catch (e) {
      console.warn("[Collectibles] star.glb not found.");
      this._starGlbCache = null;
    }

    return this._starGlbCache;
  }

  // Preloads the mushroom model once, reused both by the static mushroom
  // list and by "?" blocks spawning one dynamically at runtime.
  async preloadMushroomModel() {
    try {
      this.mushroomGlb = await this.loader.loadAsync(ITEM_MODELS.mushroom);
      // Materials are shared by reference across every clone made from
      // this.mushroomGlb.scene (none of the mushroom spawn methods clone
      // materials individually), so normalizing once here is enough.
      normalizeMaterials(this.mushroomGlb.scene);
    } catch (e) {
      console.warn("[Collectibles] mushroom.glb not found.");
    }
  }

  // Registers a coin mesh already added to the scene (see Decorations).
  registerCoin(mesh) {
    this.coins.push({
      mesh,
      position: mesh.position,
      collected: false,
    });
  }

  // Spawns collectible stars either at the positions given by the level
  // JSON, or at a small default layout if none was provided. Also usable at
  // runtime for one-off stars (e.g. the one Kamek drops on defeat — see
  // main.js), since it just appends to this.stars either way.
  async spawnStars(starPositions) {
    const starGlb = await this._loadStarModel();

    const positions = starPositions || [
      { x: -30, y: 2, z: -30 },
      { x: 30, y: 2, z: -30 },
      { x: -30, y: 2, z: 30 },
      { x: 30, y: 2, z: 30 },
      { x: 0, y: 2, z: -40 },
    ];

    // Star size, normalized from the model's own bounding-box height
    // instead of trusting star.glb's raw native scale (it was coming out
    // wildly off — same class of bug as the earlier Goomba/palm-tree
    // sizing issues), so every star reads at a consistent, readable size
    // regardless of the source GLB's native scale.
    const targetHeight = 1.6;

    positions.forEach((pos) => {
      let starMesh;
      if (starGlb) {
        starMesh = starGlb.scene.clone();
        starMesh.scale.set(1, 1, 1);
        starMesh.position.set(0, 0, 0);
        starMesh.updateMatrixWorld(true);

        const bbox = new THREE.Box3().setFromObject(starMesh);
        const nativeHeight = bbox.isEmpty() ? 0 : bbox.max.y - bbox.min.y;
        if (nativeHeight > 0.001) {
          starMesh.scale.setScalar(targetHeight / nativeHeight);
        }

        starMesh.position.set(pos.x, pos.y, pos.z);
      } else {
        // Fallback primitive shown if the model failed to load.
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

      enableShadows(starMesh);
      this.scene.add(starMesh);
      this.stars.push({
        mesh: starMesh,
        position: starMesh.position,
        collected: false,
        // Optional identifier (see QuestManager.onStarCollected) — lets a
        // caller recognize a *specific* star among however many are in the
        // level, without having to compare positions. Only set for the
        // handful of spots that matter to the quest HUD; every other star
        // (the level defaults, boss/Toad rewards, ...) is left id: null and
        // behaves exactly as before.
        id: pos.id || null,
      });
    });
  }

  // Spawns the mushrooms explicitly listed in the level JSON (static
  // pickups, as opposed to the ones dynamically spawned by "?" blocks).
  async spawnMushrooms(mushroomPositions) {
    if (!mushroomPositions || mushroomPositions.length === 0) return;

    let mushroomGlb = this.mushroomGlb;
    if (!mushroomGlb) {
      try {
        mushroomGlb = await this.loader.loadAsync(ITEM_MODELS.mushroom);
        normalizeMaterials(mushroomGlb.scene);
      } catch (e) {
        console.warn("[Collectibles] mushroom.glb not found.");
      }
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
          1, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2,
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

      enableShadows(mushroomMesh);
      this.scene.add(mushroomMesh);
      this.mushrooms.push({
        mesh: mushroomMesh,
        position: mushroomMesh.position,
        collected: false,
      });
    });
  }

  // Dynamic mushroom spawned at runtime when a "?" block is hit; unlike the
  // static ones, it has its own physics body and pops out with an initial
  // velocity.
  _spawnSingleMushroom(x, y, z) {
    if (!this.mushroomGlb) return;

    const mesh = this.mushroomGlb.scene.clone();
    mesh.scale.set(0.4, 0.4, 0.4);
    mesh.position.set(x, y, z);
    enableShadows(mesh);
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
      mesh,
      body,
      position: mesh.position,
      collected: false,
    });
  }

  // Spawns "?" blocks at the given positions (or a small default row),
  // each with a static collider and a flag tracking whether it has been hit.
  async spawnQuestionMarkBlocks(positions) {
    let questionMarkGlb = null;
    try {
      questionMarkGlb = await this.loader.loadAsync(ITEM_MODELS.questionMarkBlock);
      normalizeMaterials(questionMarkGlb.scene);
    } catch (e) {
      console.warn("[Collectibles] question_mark_block.glb not found.");
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
        const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const mat = new THREE.MeshStandardMaterial({
          color: 0xfbd000,
          roughness: 0.05,
        });
        mesh = new THREE.Mesh(geo, mat);
      }

      mesh.position.set(pos.x, pos.y, pos.z);
      enableShadows(mesh);
      this.scene.add(mesh);

      const world = this.physicsWorld?.world || this.physicsWorld;
      let body = null;
      if (world) {
        const shape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
        body = new CANNON.Body({
          mass: 0,
          shape,
          position: new CANNON.Vec3(pos.x, pos.y+0.6, pos.z),
          material: this.physicsWorld?.defaultMaterial,
        });
        world.addBody(body);
      }

      this.questionMarkBlocks.push({
        mesh,
        body,
        position: mesh.position,
        isHit: false,
      });
    });
  }

  // Per-frame update: animates and checks the pickup radius for every
  // collectible type, and handles "?" block hits.
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
        // Every coin is a clone of the same cached coin.glb (see
        // Decorations._loadCoinModel) — .clone() shares the geometry AND
        // material by reference rather than deep-copying them, so ALL
        // coins point at the exact same GPU resources. Disposing them
        // here (as this used to do) freed those buffers out from under
        // every OTHER still-visible coin on the very first pickup, and
        // kept re-disposing the same already-disposed objects on every
        // pickup after that — exactly the kind of GPU churn that shows up
        // as a stutter each time you grab a coin. Removing from the scene
        // is all a single collected coin needs; the shared geometry/
        // material stay alive for the rest.
        this.scene.remove(coin.mesh);
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
        // Pass the star record through (id included) — existing callers
        // that take no arguments are unaffected, since JS just ignores an
        // extra argument they never declared a parameter for.
        if (onStarCollected) onStarCollected(star);
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
    for (const block of this.questionMarkBlocks) {
      if (block.isHit) continue;

      const dx = Math.abs(playerPos.x - block.position.x);
      const dz = Math.abs(playerPos.z - block.position.z);
      const dy = block.position.y - playerPos.y;

      // Hit test: player must be roughly underneath the block and jumping
      // into it (dy in a narrow band above the player's head).
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

        // Replace the "?" block with a plain "used" block once hit.
        const smoothGeo = new THREE.BoxGeometry(
          1, 1, 1
        );
        const smoothMat = new THREE.MeshStandardMaterial({
          color: 0x8b5a2b,
          roughness: 0.6,
        });

        const smoothMesh = new THREE.Mesh(smoothGeo, smoothMat);
        smoothMesh.position.set(block.position.x, block.position.y + 0.3, block.position.z);
        smoothMesh.castShadow = true;
        smoothMesh.receiveShadow = true;

        this.scene.add(smoothMesh);
        block.mesh = smoothMesh;
      }
    }
  }
}
