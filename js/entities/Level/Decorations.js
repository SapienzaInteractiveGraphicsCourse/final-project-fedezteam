import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { ITEM_MODELS, MAP_MODELS, TEXTURES } from "../../core/Assets/manifest.js";
import { enableShadows } from "../../utils/shadows.js";
import { normalizeMaterials } from "../../utils/materials.js";
import GravityField from "../../physics/GravityField.js";

/**
 * Owns every purely visual, non-collectible prop in the level: trees, flowers,
 * rocks, bushes, ponds, instanced grass, house surroundings, the sky planets
 * (a walkable "red" planet + satellites, plus a decorative blue one), and warp
 * stars. Coins are scattered here too (via onCoinSpawned). Rocks, palm trees and
 * the red planet get physics bodies; the red planet also gets a GravityField.
 */
export default class Decorations {
  constructor(scene, physicsWorld, gltfLoader) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.loader = gltfLoader;
    this.skyPlanet = null;
    this.satellites = [];
    this.ponds = [];
    this.warpStars = [];

    // Blocchi del prato + distanza di vista corrente — vedi
    // spawnGrassField/_updateGrassChunks. Ogni voce e' { mesh, x, z }.
    this.grassChunks = [];
    this.grassViewDistance = Decorations.GRASS_VIEW_DISTANCE;
    // Filled in from outside (setSpawnPoint/setKamekZoneEntry/
    // setBowserZoneEntry) so warp stars targeting those names have a destination.
    this.spawnPoint = null;
    this.kamekZoneEntry = null;
    this.bowserZoneEntry = null;
    // Optional UIManager reference (see setUI), used only for the "get off
    // Yoshi" warning in _updateWarpStars. Null by default.
    this.ui = null;
    this._yoshiWarpWarningActive = false;
    // Smoothed 0..1-ish sink depth applied to the player's mesh while
    // standing inside a pond's footprint (see _updateWaterWading).
    this._waterSinkDepth = 0;
    // Whether the player is currently inside a pond's footprint — set by
    // _updateWaterWading, read by isPlayerInPond() for the movement slowdown.
    this._insidePond = false;
    // undefined = not attempted yet, null = attempted and failed to load.
    this._coinGlbCache = undefined;
    // Same convention, for star_launch.glb — also spawned at RUNTIME on
    // every boss defeat, so this cache avoids re-fetching/re-parsing it each time.
    this._starLaunchGlbCache = undefined;

    // BUG FIX (boss-defeat/warp-star micro-freeze): a fixed light pool created up
    // front, since `new THREE.PointLight()` per spawn forces a shader recompile (the stutter).
    this._warpLightPool = [];
    for (let i = 0; i < Decorations.WARP_LIGHT_POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 14, 2); // intensity 0 = off/unused
      scene.add(light);
      this._warpLightPool.push(light);
    }
    this._warpLightPoolIndex = 0;
  }

  // Hands out the next free light from the pool (see constructor), growing
  // it on the spot (accepting the recompile pooling avoids) only if exhausted.
  _nextWarpLight() {
    if (this._warpLightPoolIndex >= this._warpLightPool.length) {
      console.warn(
        "[Decorations] warp light pool exhausted — creating an extra light " +
          "(may cause a brief stutter). Consider raising Decorations.WARP_LIGHT_POOL_SIZE.",
      );
      const light = new THREE.PointLight(0xffffff, 0, 14, 2);
      this.scene.add(light);
      this._warpLightPool.push(light);
    }
    return this._warpLightPool[this._warpLightPoolIndex++];
  }

  // Loads (and caches) the warp star model — see the comment on
  // _starLaunchGlbCache.
  async _loadStarLaunchModel() {
    if (this._starLaunchGlbCache !== undefined) return this._starLaunchGlbCache;

    try {
      this._starLaunchGlbCache = await this.loader.loadAsync(MAP_MODELS.starLaunch);
      // Normalized once here — every tinted clone (see _tintModel) keeps
      // this same fixed texture reference, covering every warp star.
      normalizeMaterials(this._starLaunchGlbCache.scene);
    } catch (e) {
      console.warn("[Decorations] star_launch.glb not found — skipping warp stars.");
      this._starLaunchGlbCache = null;
    }

    return this._starLaunchGlbCache;
  }

  // Loads (and caches) the coin model, shared by every method that scatters
  // coins so the GLTF is only fetched once regardless of caller count.
  async _loadCoinModel() {
    if (this._coinGlbCache !== undefined) return this._coinGlbCache;

    try {
      this._coinGlbCache = await this.loader.loadAsync(ITEM_MODELS.coin);
      // Normalized once — every coin clone below shares this material by
      // reference (see utils/materials.js: coins rendered near-black without it).
      normalizeMaterials(this._coinGlbCache.scene);
    } catch (e) {
      this._coinGlbCache = null;
    }

    return this._coinGlbCache;
  }

  // Scatters trees, flowers and loose coins across the island, avoiding the central
  // buildings/NPCs area, HillBlock platforms and warp star zones (hillFootprints/avoidPoints).
  async spawnFieldProps(arenaSize, onCoinSpawned, hillFootprints = [], avoidPoints = []) {
    let flowerGlb = null,
      treeGlb = null;

    try {
      flowerGlb = await this.loader.loadAsync(MAP_MODELS.flower);
      normalizeMaterials(flowerGlb.scene);
    } catch (e) {}
    const coinGlb = await this._loadCoinModel();
    try {
      treeGlb = await this.loader.loadAsync(MAP_MODELS.palmTree);
      normalizeMaterials(treeGlb.scene);
    } catch (e) {}

    const step = 12;
    const half = arenaSize / 2 - 10;
    const world = this.physicsWorld?.world || this.physicsWorld;

    for (let x = -half; x <= half; x += step) {
      for (let z = -half; z <= half; z += step) {
        // Skip the central area where buildings/NPCs are placed.
        if (x > -40 && x < 80 && z > -50 && z < 50) continue;

        const posX = x + (Math.random() - 0.5) * 6;
        const posZ = z + (Math.random() - 0.5) * 6;

        // BUG FIX (palm trees spawning inside HillBlock platforms): skip
        // this cell if the jittered position falls inside/near a hill's real footprint.
        if (this._isInsideHillFootprint(posX, posZ, hillFootprints)) continue;

        // ...or on top of (or right next to) a warp star/its sign.
        if (this._isNearAnyPoint(posX, posZ, avoidPoints)) continue;

        if (treeGlb && Math.random() > 0.85) {
          const tree = treeGlb.scene.clone();
          // Wider scale range (was a narrow 0.04-0.07 band) so trees don't
          // all read as the same cookie-cutter size next to each other.
          const scale = 0.035 + Math.random() * 0.045;
          tree.scale.set(scale, scale, scale);
          tree.rotation.y = Math.random() * Math.PI * 2;
          // Small random lean instead of perfectly upright, for a less
          // artificial/grid-planted look.
          tree.rotation.x = (Math.random() - 0.5) * 0.08;
          tree.rotation.z = (Math.random() - 0.5) * 0.08;
          tree.position.set(posX, 0, posZ);
          // Bake the transform into matrixWorld so the bounding box below
          // measures the tree as it will actually appear.
          tree.updateMatrixWorld(true);

          enableShadows(tree);
          this.scene.add(tree);

          // Box collider sized from the tree's real bounding box (trees vary ~2.3x
          // in scale); footprint stays a fixed "trunk" size since fronds spread wider.
          if (world) {
            const TRUNK_HALF_WIDTH = 0.5;
            const bbox = new THREE.Box3().setFromObject(tree);

            let halfHeight = 2.5;
            let centerY = halfHeight;
            if (!bbox.isEmpty() && isFinite(bbox.min.y) && isFinite(bbox.max.y)) {
              halfHeight = Math.max(1, (bbox.max.y - bbox.min.y) / 2);
              centerY = bbox.min.y + halfHeight;
            }

            const body = new CANNON.Body({
              mass: 0,
              shape: new CANNON.Box(
                new CANNON.Vec3(TRUNK_HALF_WIDTH, halfHeight, TRUNK_HALF_WIDTH),
              ),
              position: new CANNON.Vec3(posX, centerY, posZ),
              material: this.physicsWorld?.defaultMaterial,
            });
            world.addBody(body);
          }
        } else if (flowerGlb && Math.random() > 0.75) {
          const plant = flowerGlb.scene.clone();
          const scale = 0.6 + Math.random() * 1.0;
          plant.scale.set(scale, scale, scale);
          plant.rotation.y = Math.random() * Math.PI * 2;
          plant.rotation.x = (Math.random() - 0.5) * 0.06;
          plant.rotation.z = (Math.random() - 0.5) * 0.06;
          plant.position.set(posX, 0, posZ);

          enableShadows(plant, { castShadow: false, receiveShadow: true });
          this.scene.add(plant);
        } else if (coinGlb && Math.random() > 0.9) {
          const coin = coinGlb.scene.clone();
          coin.scale.set(0.6, 0.6, 0.6);
          coin.position.set(posX, 1.5, posZ);

          enableShadows(coin, { castShadow: false, receiveShadow: false });
          this.scene.add(coin);

          if (onCoinSpawned) onCoinSpawned(coin);
        }
      }
    }
  }

  // Builds an instanced grass field covering the island, merging every
  // grass blade into a single draw call for performance.
  async spawnGrassField(arenaSize) {
    let grassGlb = null;
    try {
      grassGlb = await this.loader.loadAsync(MAP_MODELS.grass);
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

    // PERFORMANCE: split into chunks rather than one InstancedMesh (~45k blades) so
    // three.js can frustum-cull per chunk; _updateGrassChunks() also hides far chunks.
    const chunks = new Map();
    for (const matrix of matrices) {
      const cx = Math.floor(matrix.elements[12] / Decorations.GRASS_CHUNK_SIZE);
      const cz = Math.floor(matrix.elements[14] / Decorations.GRASS_CHUNK_SIZE);
      const key = `${cx},${cz}`;
      let bucket = chunks.get(key);
      if (!bucket) chunks.set(key, (bucket = []));
      bucket.push(matrix);
    }

    for (const [key, bucket] of chunks) {
      const chunk = new THREE.InstancedMesh(grassGeometry, grassMaterial, bucket.length);
      chunk.receiveShadow = true;
      chunk.castShadow = false;

      bucket.forEach((matrix, i) => chunk.setMatrixAt(i, matrix));
      // Computed now rather than left for three.js's first-frame default,
      // so that cost lands during loading instead of during gameplay.
      chunk.computeBoundingSphere();

      const [cx, cz] = key.split(",").map(Number);
      this.grassChunks.push({
        mesh: chunk,
        x: (cx + 0.5) * Decorations.GRASS_CHUNK_SIZE,
        z: (cz + 0.5) * Decorations.GRASS_CHUNK_SIZE,
      });

      this.scene.add(chunk);
    }
  }

  // Hides grass chunks beyond grassViewDistance (frustum culling handles off-screen
  // ones already). Uses the player's position rather than the camera's — close enough.
  _updateGrassChunks(player) {
    if (!this.grassChunks.length) return;

    const pos = player?.mesh?.position || player?.position;
    if (!pos) return;

    const limit = this.grassViewDistance * this.grassViewDistance;
    for (const chunk of this.grassChunks) {
      const dx = chunk.x - pos.x;
      const dz = chunk.z - pos.z;
      chunk.mesh.visible = dx * dx + dz * dz <= limit;
    }
  }

  // World-unit distance beyond which grass stops being drawn; QualityManager
  // lowers this under low fps (see core/Render/QualityManager.js).
  setGrassViewDistance(distance) {
    this.grassViewDistance = Math.max(10, distance);
  }

  // Places a smooth coin trail along waypoints, optionally arcing upward mid-segment
  // — guides the player toward a point of interest beyond the random scatter.
  async spawnCoinTrail(waypoints, onCoinSpawned, { spacing = 2.2, arcHeight = 0 } = {}) {
    const coinGlb = await this._loadCoinModel();
    if (!coinGlb || !waypoints || waypoints.length < 2) return;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i];
      const b = waypoints[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const steps = Math.max(1, Math.round(length / spacing));

      // Skip step 0 for every segment after the first so shared waypoints
      // don't get a duplicate coin.
      const startStep = i === 0 ? 0 : 1;

      for (let s = startStep; s <= steps; s++) {
        const t = s / steps;
        const coin = coinGlb.scene.clone();
        coin.scale.set(0.6, 0.6, 0.6);
        coin.position.set(
          a.x + dx * t,
          a.y + dy * t + Math.sin(t * Math.PI) * arcHeight,
          a.z + dz * t,
        );

        enableShadows(coin, { castShadow: false, receiveShadow: false });
        this.scene.add(coin);

        if (onCoinSpawned) onCoinSpawned(coin);
      }
    }
  }

  // Builds one low-poly rock mesh: an icosahedron with each vertex nudged randomly
  // along its own radial direction — a faceted silhouette, no external model needed.
  _createRockGeometry(radius) {
    const geometry = new THREE.IcosahedronGeometry(radius, 0);
    const posAttr = geometry.attributes.position;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      vertex.fromBufferAttribute(posAttr, i);
      const jitter = 0.75 + Math.random() * 0.5; // 0.75-1.25x per vertex
      vertex.multiplyScalar(jitter);
      posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    geometry.computeVertexNormals();
    return geometry;
  }

  // Rocks scatter around the rim, merged into one draw call. Shared by every
  // scatter method: true if (x, z) is inside/near a HillBlock's real footprint.
  _isInsideHillFootprint(x, z, hillFootprints = [], clearance = 2) {
    for (const h of hillFootprints) {
      if (
        x >= h.x - h.halfX - clearance &&
        x <= h.x + h.halfX + clearance &&
        z >= h.z - h.halfZ - clearance &&
        z <= h.z + h.halfZ + clearance
      ) {
        return true;
      }
    }
    return false;
  }

  // Same idea as _isInsideHillFootprint, but for round exclusion zones — keeps props
  // off warp stars/signs. `radius` defaults wide enough to cover a star and its sign.
  _isNearAnyPoint(x, z, points = [], radius = 6) {
    for (const p of points) {
      const r = p.radius ?? radius;
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz <= r * r) return true;
    }
    return false;
  }

  spawnRocks(arenaSize, count = 18, hillFootprints = [], avoidPoints = []) {
    const rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a8378,
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
    });

    const half = arenaSize / 2;
    const world = this.physicsWorld?.world || this.physicsWorld;
    const geometries = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = half - 2 - Math.random() * 6;
      const posX = Math.cos(angle) * dist;
      const posZ = Math.sin(angle) * dist;

      // Skip this rock entirely if it would land inside (or clipping
      // through the edge of) a HillBlock platform.
      if (this._isInsideHillFootprint(posX, posZ, hillFootprints)) continue;

      // ...or on top of (or right next to) a warp star/its sign.
      if (this._isNearAnyPoint(posX, posZ, avoidPoints)) continue;

      const radius = 0.6 + Math.random() * 1.4;
      const posY = radius * 0.35;

      // Bake this rock's transform into its own geometry before merging —
      // the merged mesh has no per-rock transform of its own.
      const rockGeo = this._createRockGeometry(radius);
      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      );
      dummy.updateMatrix();
      rockGeo.applyMatrix4(dummy.matrix);
      geometries.push(rockGeo);

      if (world) {
        // Slightly smaller than the visual radius since the jittered
        // vertices in _createRockGeometry poke out a bit past it.
        const body = new CANNON.Body({
          mass: 0,
          shape: new CANNON.Sphere(radius * 0.85),
          position: new CANNON.Vec3(posX, posY, posZ),
          material: this.physicsWorld?.defaultMaterial,
        });
        world.addBody(body);
      }
    }

    if (geometries.length === 0) return;

    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
    const rocks = new THREE.Mesh(mergedGeometry, rockMaterial);
    enableShadows(rocks);
    this.scene.add(rocks);
  }

  // Builds one low-poly bush mesh: a subdivided, jittered, vertically
  // flattened icosahedron — same technique as _createRockGeometry, tuned softer/rounder.
  _createBushGeometry(radius) {
    const geometry = new THREE.IcosahedronGeometry(radius, 1);
    const posAttr = geometry.attributes.position;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      vertex.fromBufferAttribute(posAttr, i);
      const jitter = 0.85 + Math.random() * 0.3;
      vertex.multiplyScalar(jitter);
      posAttr.setXYZ(i, vertex.x, vertex.y * 0.7, vertex.z); // flatten into a bush shape
    }

    geometry.computeVertexNormals();
    return geometry;
  }

  // Scatters low-poly bushes (same central-area exclusion as spawnFieldProps), cycling
  // greens baked as per-vertex colors so all bushes share one draw call.
  spawnBushes(arenaSize, count = 26, hillFootprints = [], avoidPoints = []) {
    const bushColors = [0x3f7d32, 0x4f9b3d, 0x2f6b28, 0x5aa83f, 0x6bb84a];
    const half = arenaSize / 2 - 15;

    const geometries = [];
    const dummy = new THREE.Object3D();
    const colorObj = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const posX = (Math.random() - 0.5) * 2 * half;
      const posZ = (Math.random() - 0.5) * 2 * half;

      // Same central village exclusion zone as spawnFieldProps.
      if (posX > -40 && posX < 80 && posZ > -50 && posZ < 50) continue;

      // Skip this bush entirely if it would land inside (or clipping
      // through the edge of) a HillBlock platform.
      if (this._isInsideHillFootprint(posX, posZ, hillFootprints)) continue;

      // ...or on top of (or right next to) a warp star/its sign.
      if (this._isNearAnyPoint(posX, posZ, avoidPoints)) continue;

      const radius = 0.8 + Math.random() * 0.9;
      const color = bushColors[Math.floor(Math.random() * bushColors.length)];

      const bushGeo = this._createBushGeometry(radius);

      colorObj.set(color);
      const vertexCount = bushGeo.attributes.position.count;
      const colors = new Float32Array(vertexCount * 3);
      for (let v = 0; v < vertexCount; v++) {
        colors[v * 3] = colorObj.r;
        colors[v * 3 + 1] = colorObj.g;
        colors[v * 3 + 2] = colorObj.b;
      }
      bushGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      dummy.position.set(posX, radius * 0.5, posZ);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.updateMatrix();
      bushGeo.applyMatrix4(dummy.matrix);

      geometries.push(bushGeo);
    }

    if (geometries.length === 0) return;

    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      flatShading: true,
    });

    const bushes = new THREE.Mesh(mergedGeometry, material);
    enableShadows(bushes);
    this.scene.add(bushes);
  }

  // Draws a simple flowing-water pattern onto a canvas, returned as a
  // repeating CanvasTexture shared by every pond.
  _createWaterTexture() {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#1c6fa5";
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      const y = Math.random() * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.25, y + 8, size * 0.75, y - 8, size, y);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    return texture;
  }

  // Adds small flat ponds (water surface only, no depth/collider) at hand-picked
  // spots; the shared water texture slowly scrolls in update() for a flowing look.
  spawnPonds(spots = []) {
    if (spots.length === 0) return;

    this._waterTexture = this._createWaterTexture();

    for (const spot of spots) {
      const geometry = new THREE.CircleGeometry(spot.radius || 6, 32);
      const material = new THREE.MeshStandardMaterial({
        map: this._waterTexture,
        color: 0x3fa9dc,
        transparent: true,
        opacity: 0.82,
        roughness: 0.15,
        metalness: 0.1,
      });

      const pond = new THREE.Mesh(geometry, material);
      pond.rotation.x = -Math.PI / 2;
      pond.position.set(spot.x, (spot.y ?? 0) + 0.05, spot.z);
      pond.receiveShadow = true;
      pond.castShadow = false;

      this.scene.add(pond);
      // Radius stored alongside the mesh (rather than read back from
      // geometry.parameters) so _updateWaterWading has an explicit value to test.
      this.ponds.push({ mesh: pond, radius: spot.radius || 6 });
    }
  }

  // Approximate footprint radius (world units, ignoring the JSON "scale"
  // field) used for each house type's fence ring — a visual estimate, not the real hitbox.
  static FOOTPRINT_RADIUS = {
    mario_house: 20, // was 13 — enlarged for a more spacious yard.
    toad_house: 8,
    toad_house_red: 8,
    toad_house_blue: 8,
  };

  // Per-type extra fence-ring rotation, applied on top of the building's own
  // JSON rotationY — kept separate so it never rotates the house model itself.
  static FENCE_ROTATION_OFFSET = {
    mario_house: Math.PI / 2,
  };

  // World Y of the main island's ground surface (LevelLoader.buildPlatforms'
  // platform box: y=-1, size.y=2, top face at y=0) — the fence ring sits here.
  static GROUND_LEVEL = 0;

  // Per-type vertical nudge on top of GROUND_LEVEL. Deliberately NOT based on the
  // building's own JSON "y" (that's per-model pivot compensation; reusing it floated the ring).
  static GROUND_OFFSET = {};

  // Size of the reusable warp-star glow-light pool — 4 decorative stars + 1 each for
  // Kamek's/Bowser's reward stars = 6, plus spare room to avoid the exhausted-pool path.
  static WARP_LIGHT_POOL_SIZE = 8;

  // Lato in unita' di mondo di un blocco d'erba (vedi spawnGrassField): 16 e' il
  // punto in cui culling e draw-call si bilanciano meglio sull'isola da 250.
  static GRASS_CHUNK_SIZE = 16;

  // Distanza di vista iniziale del prato: la nebbia comincia a 120 unita', quindi a
  // 90 il confine non si vede. QualityManager la abbassa se serve.
  static GRASS_VIEW_DISTANCE = 90;

  // Adds a decorated area (fence ring + lamp posts) around every house-type building,
  // from the same JSON entries LevelLoader consumed — purely decorative, no collider.
  decorateStructures(buildingsData = []) {
    for (const b of buildingsData) {
      if (b.type === "mario_house" || b.type.startsWith("toad_house")) {
        this._decorateHouse(b);
      }
    }
  }

  _decorateHouse(b) {
    const groundOffset = Decorations.GROUND_OFFSET[b.type] || 0;
    const fenceRotationOffset = Decorations.FENCE_ROTATION_OFFSET[b.type] || 0;

    const group = new THREE.Group();
    group.position.set(b.x, Decorations.GROUND_LEVEL + groundOffset, b.z);
    group.rotation.y = (b.rotationY || 0) + fenceRotationOffset;

    const ringRadius = (Decorations.FOOTPRINT_RADIUS[b.type] || 10) + 2;
    const postCount = 10;

    const fenceMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8d9b0,
      roughness: 0.85,
    });
    const lampPoleMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.6,
      metalness: 0.3,
    });
    const lampGlowMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe4a0,
      emissive: 0xffbf60,
      emissiveIntensity: 1.4,
      roughness: 0.4,
    });

    // Low fence posts, leaving a gap facing one side so it doesn't block
    // the entrance — a fixed approximate angle, not derived from the door.
    for (let i = 0; i < postCount; i++) {
      const angle = (i / postCount) * Math.PI * 2;
      if (angle > Math.PI * 0.3 && angle < Math.PI * 0.7) continue;

      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 1.1, 6),
        fenceMaterial,
      );
      post.position.set(Math.cos(angle) * ringRadius, 0.55, Math.sin(angle) * ringRadius);
      enableShadows(post);
      group.add(post);
    }

    // Two lamp posts flanking the entrance gap.
    for (const angle of [Math.PI * 0.3, Math.PI * 0.7]) {
      const lamp = new THREE.Group();

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.14, 2.6, 8),
        lampPoleMaterial,
      );
      pole.position.y = 1.3;
      lamp.add(pole);

      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), lampGlowMaterial);
      glow.position.y = 2.7;
      lamp.add(glow);

      // Small local light so the lamp reads as an actual light source at
      // night/dusk, kept short-range/low-intensity to stay cheap.
      const light = new THREE.PointLight(0xffbf60, 0.6, 8, 2);
      light.position.y = 2.7;
      lamp.add(light);

      lamp.position.set(Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius);
      enableShadows(lamp, { castShadow: false, receiveShadow: false });
      group.add(lamp);
    }

    this.scene.add(group);
  }

  // Gives a walkable planet mesh a static sphere collider plus a matching GravityField
  // so the player can land and walk on it — not used for the purely decorative satellites.
  _addPlanetPhysics(mesh, radius, { strength = 30, influenceRadius } = {}) {
    if (!mesh) return;

    const world = this.physicsWorld?.world || this.physicsWorld;
    if (world) {
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Sphere(radius),
        position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
        material: this.physicsWorld?.defaultMaterial,
      });
      world.addBody(body);
    }

    if (this.physicsWorld?.addGravityField) {
      this.physicsWorld.addGravityField(
        new GravityField({
          center: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
          radius,
          influenceRadius,
          strength,
        }),
      );
    }
  }

  // Adds 1-2 small planets orbiting the main sky planet for background richness
  // (colors only, no textures) — orbit radius stays outside the main planet's radius (26).
  spawnSatellitePlanets() {
    if (!this.skyPlanet) return;

    const configs = [
      { color: 0xbfe9ff, roughness: 0.35, metalness: 0.1, radius: 3, orbitRadius: 36, orbitSpeed: 0.35, tilt: 0.15 },
      { color: 0xff6a3d, roughness: 0.9, metalness: 0.0, radius: 2.2, orbitRadius: 44, orbitSpeed: -0.22, tilt: 0.5 },
    ];

    this.satellites = configs.map((cfg) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(cfg.radius, 24, 16),
        new THREE.MeshStandardMaterial({
          color: cfg.color,
          roughness: cfg.roughness,
          metalness: cfg.metalness,
          // Same environment-reflection cap as every other hand-built
          // material in the project (see spawnSkyPlanet).
          envMapIntensity: 0.4,
        }),
      );
      mesh.castShadow = false;
      mesh.receiveShadow = false;

      // BUG FIX: placed on its orbit right away instead of the mesh default (0,0,0) —
      // update() only runs once gameplay starts, so both satellites sat at the origin till then.
      const angle = Math.random() * Math.PI * 2;
      const x = this.skyPlanet.position.x + Math.cos(angle) * cfg.orbitRadius;
      const z = this.skyPlanet.position.z + Math.sin(angle) * cfg.orbitRadius * Math.cos(cfg.tilt);
      const y = this.skyPlanet.position.y + Math.sin(angle) * cfg.orbitRadius * Math.sin(cfg.tilt);
      mesh.position.set(x, y, z);

      this.scene.add(mesh);

      return {
        mesh,
        orbitRadius: cfg.orbitRadius,
        orbitSpeed: cfg.orbitSpeed,
        tilt: cfg.tilt,
        angle,
      };
    });
  }

  // Draws a simple cloud-blob pattern onto a canvas, returned as a repeating
  // CanvasTexture — the blue planet's ocean-and-clouds look, no PNG asset needed.
  _createCloudySphereTexture(baseColor, cloudColor) {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 40; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 6 + Math.random() * 18;

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, cloudColor);
      gradient.addColorStop(1, "rgba(255,255,255,0)");

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  // A second, distinct background planet: ocean-blue with procedural clouds, no
  // collider/gravity/warp star — purely a distant sky prop on the opposite side.
  spawnBluePlanet({ position = new THREE.Vector3(260, 190, 0), radius = 10 } = {}) {
    const material = new THREE.MeshStandardMaterial({
      map: this._createCloudySphereTexture("#2f6fb0", "rgba(255,255,255,0.6)"),
      roughness: 0.55,
      metalness: 0.05,
    });

    const geometry = new THREE.SphereGeometry(radius, 40, 28);
    this.bluePlanet = new THREE.Mesh(geometry, material);
    this.bluePlanet.position.copy(position);
    this.bluePlanet.castShadow = false;
    this.bluePlanet.receiveShadow = false;

    this.scene.add(this.bluePlanet);
    return this.bluePlanet;
  }

  // Scatters findable coins across the red planet's surface — same
  // onCoinSpawned hand-off pattern as spawnFieldProps/spawnCoinTrail.
  async spawnPlanetCoins(planetMesh, radius, count, onCoinSpawned) {
    if (!planetMesh || !radius) return;

    const coinGlb = await this._loadCoinModel();
    if (!coinGlb) return;

    for (let i = 0; i < count; i++) {
      // Standard (non-uniform-area, but good enough here) spherical ->
      // Cartesian parametrization.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = radius + 0.4; // sit just above the surface, not clipped into it

      const dir = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      );

      const coin = coinGlb.scene.clone();
      coin.scale.set(0.6, 0.6, 0.6);
      coin.position.copy(planetMesh.position).addScaledVector(dir, r);

      enableShadows(coin, { castShadow: false, receiveShadow: false });
      this.scene.add(coin);

      if (onCoinSpawned) onCoinSpawned(coin);
    }
  }

  // Clones every mesh's material before tinting, so the same base GLTF can
  // be reused for multiple differently-colored instances without sharing one material.
  _tintModel(root, colorHex) {
    root.traverse((child) => {
      if (child.isMesh) {
        child.material = child.material.clone();
        if (child.material.color) child.material.color.set(colorHex);
        if (child.material.emissive) {
          child.material.emissive.set(colorHex);
          child.material.emissiveIntensity = 0.6;
        }
      }
    });
  }

  // Places Mario Galaxy-style "launch stars" tinted per destination. `target`
  // picks where touching one sends the player; omit it for a purely decorative star.
  async spawnWarpStars(spots = []) {
    if (spots.length === 0) return;

    const baseGlb = await this._loadStarLaunchModel();
    if (!baseGlb) return;

    for (const spot of spots) {
      const star = baseGlb.scene.clone(true);
      const scale = spot.scale || 1.4;
      star.scale.set(scale, scale, scale);
      star.position.set(spot.x -5, spot.y, spot.z );
      this._tintModel(star, spot.color);

      enableShadows(star, { castShadow: true, receiveShadow: false });
      this.scene.add(star);

      // Small matching-color glow so the star reads clearly from a
      // distance; reuses a pre-warmed pool light (see constructor).
      const light = this._nextWarpLight();
      light.color.set(spot.color);
      light.intensity = 1.0;
      light.position.set(spot.x, spot.y + 1, spot.z);

      this.warpStars.push({
        mesh: star,
        baseY: spot.y,
        phase: Math.random() * Math.PI * 2,
        target: spot.target || null,
      });
    }
  }

  // Sets the level's player spawn point (from GameLevel.js after
  // level1.json is parsed), so a "spawn"-target warp star has a destination.
  setSpawnPoint(point) {
    this.spawnPoint = point;
  }

  // Sets the Kamek obstacle course entrance (from main.js once
  // ObstacleZone.load() resolves), so a "kamek_zone" warp star has a destination.
  setKamekZoneEntry(point) {
    this.kamekZoneEntry = point;
  }

  // Same as setKamekZoneEntry, for the separate Bowser obstacle course
  // (bowser_zone.json, its own ObstacleZone instance in main.js).
  setBowserZoneEntry(point) {
    this.bowserZoneEntry = point;
  }

  // Optional UIManager hookup — lets _updateWarpStars show/hide the "get
  // off Yoshi" warning without threading `ui` through every constructor call.
  setUI(ui) {
    this.ui = ui;
  }

  // Places a Minecraft "Oak Sign" prop bearing a logo texture near a warp star to
  // a separate zone. The sign has no blank area to draw on, so the logo is a decal plane.
  async spawnZoneSigns(spots = []) {
    if (spots.length === 0) return;

    let signGlb;
    try {
      signGlb = await this.loader.loadAsync(MAP_MODELS.minecraftSign);
      normalizeMaterials(signGlb.scene);
    } catch (e) {
      console.warn("[Decorations] minecraft_sign.glb not found — skipping zone signs.");
      return;
    }

    // Cache loaded logo textures by path so signs sharing the same logo
    // (e.g. two Kamek-zone stars) only fetch it once.
    const textureLoader = new THREE.TextureLoader();
    const logoTextureCache = new Map();
    const loadLogo = async (path) => {
      if (logoTextureCache.has(path)) return logoTextureCache.get(path);
      let tex = null;
      try {
        tex = await textureLoader.loadAsync(path);
        tex.colorSpace = THREE.SRGBColorSpace;
      } catch (e) {
        console.warn(`[Decorations] sign logo not found (${path}) — that sign will be blank.`);
      }
      logoTextureCache.set(path, tex);
      return tex;
    };

    // Normalized from the model's own bounding-box height, not its raw native scale
    // (unknown for this tiny model, same pattern as Collectibles.spawnStars).
    const targetHeight = 3.6;

    for (const spot of spots) {
      const logoTexture = await loadLogo(spot.logo || TEXTURES.kamekLogo);
      const sign = signGlb.scene.clone();
      sign.scale.set(1, 1, 1);
      sign.position.set(0, 0, 0);
      sign.updateMatrixWorld(true);

      const rawBbox = new THREE.Box3().setFromObject(sign);
      const nativeHeight = rawBbox.isEmpty() ? 0 : rawBbox.max.y - rawBbox.min.y;
      if (nativeHeight > 0.0001) {
        sign.scale.setScalar(targetHeight / nativeHeight);
      }
      sign.updateMatrixWorld(true);

      // Recenter the scaled sign on its own local origin (base at y=0) so the group
      // below places its base on the ground and the logo plane positions from its bbox.
      const scaledBbox = new THREE.Box3().setFromObject(sign);
      const centerX = (scaledBbox.min.x + scaledBbox.max.x) / 2;
      const centerZ = (scaledBbox.min.z + scaledBbox.max.z) / 2;
      sign.position.set(-centerX, -scaledBbox.min.y, -centerZ);
      sign.updateMatrixWorld(true);

      const finalBbox = new THREE.Box3().setFromObject(sign);
      const faceWidth = finalBbox.max.x - finalBbox.min.x;
      const faceHeight = finalBbox.max.y - finalBbox.min.y;
      const faceZ = finalBbox.max.z;

      enableShadows(sign, { castShadow: true, receiveShadow: false });

      const group = new THREE.Group();
      group.position.set(spot.x, Decorations.GROUND_LEVEL, spot.z);
      group.rotation.y = spot.rotationY || 0;
      group.add(sign);

      if (logoTexture) {
        // Logo PNGs are pre-cropped/alpha-masked badges filling their canvas edge-to-edge;
        // 0.45 of the sign's face keeps the badge clearly inset.
        const logoSize = Math.min(faceWidth, faceHeight) * 0.45;
        const logoPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(logoSize, logoSize),
          new THREE.MeshStandardMaterial({
            map: logoTexture,
            transparent: true,
            alphaTest: 0.4,
            depthWrite: false,
            side: THREE.DoubleSide,
            roughness: 0.6,
            metalness: 0,
            envMapIntensity: 0.4,
          }),
        );
        // 0.01 off the face to avoid z-fighting; 0.775 (above dead-center) reads
        // better once the sign's post is accounted for.
        logoPlane.position.set(0, faceHeight * 0.775, faceZ + 0.01);
        logoPlane.castShadow = false;
        logoPlane.receiveShadow = false;
        group.add(logoPlane);
      }

      this.scene.add(group);
    }
  }

  // Resolves a warp star's `target` into a world-space landing spot, or null if
  // unavailable yet — _updateWarpStars simply skips rather than teleporting into empty space.
  _getWarpDestination(target, playerRadius) {
    if (target === "spawn") {
      if (!this.spawnPoint) return null;
      return {
        x: this.spawnPoint.x,
        y: (this.spawnPoint.y ?? 1) + 0.5,
        z: this.spawnPoint.z,
      };
    }

    if (target === "kamek_zone") {
      return this.kamekZoneEntry ? { ...this.kamekZoneEntry } : null;
    }

    if (target === "bowser_zone") {
      return this.bowserZoneEntry ? { ...this.bowserZoneEntry } : null;
    }

    if (target === "sky") {
      if (!this.skyPlanet || !this.skyPlanetRadius) return null;
      // Directly "above" the planet's local up (+Y from center), for a
      // predictable landing orientation — see Player.js's _updateOnPlanet.
      return {
        x: this.skyPlanet.position.x,
        y: this.skyPlanet.position.y + this.skyPlanetRadius + (playerRadius || 1) + 0.5,
        z: this.skyPlanet.position.z,
      };
    }

    return null;
  }

  // Mario Galaxy-style warp: nearing a launch star teleports the player just above
  // the planet it's tinted to match, inside its gravity field — pokes the body directly.
  _updateWarpStars(player) {
    if (!player || !player.body || this.warpStars.length === 0) return;

    // Not while riding Yoshi: every destination is somewhere the mount/planet-gravity
    // logic wasn't built for — the star stays inert until the player steps off him.
    if (player.mountedOnYoshi) {
      this._updateYoshiWarpWarning(player);
      return;
    }
    // Left Yoshi (or never got on him) since the last frame — clear any
    // warning that might still be showing.
    if (this._yoshiWarpWarningActive) {
      this._yoshiWarpWarningActive = false;
      if (this.ui) this.ui.hideYoshiWarpWarning();
    }

    const pos = player.mesh.position;
    const triggerRadius = 2.5;

    for (const w of this.warpStars) {
      if (!w.target) continue;

      const dx = pos.x - w.mesh.position.x;
      const dy = pos.y - w.mesh.position.y;
      const dz = pos.z - w.mesh.position.z;
      if (dx * dx + dy * dy + dz * dz > triggerRadius * triggerRadius) continue;

      const dest = this._getWarpDestination(w.target, player.radius);
      if (!dest) continue;

      player.body.position.set(dest.x, dest.y, dest.z);
      player.body.velocity.set(0, 0, 0);
      return; // one warp per frame is enough, even if stars are ever close together
    }
  }

  // Companion to _updateWarpStars' early-return: while mounted on Yoshi, warns the
  // player as they near a targeted star — a wider radius than the actual trigger.
  _updateYoshiWarpWarning(player) {
    if (!this.ui) return;

    const pos = player.mesh.position;
    const warningRadius = 4.5;
    let near = false;

    for (const w of this.warpStars) {
      if (!w.target) continue;
      const dx = pos.x - w.mesh.position.x;
      const dy = pos.y - w.mesh.position.y;
      const dz = pos.z - w.mesh.position.z;
      if (dx * dx + dy * dy + dz * dz <= warningRadius * warningRadius) {
        near = true;
        break;
      }
    }

    if (near && !this._yoshiWarpWarningActive) {
      this._yoshiWarpWarningActive = true;
      this.ui.showYoshiWarpWarning();
    } else if (!near && this._yoshiWarpWarningActive) {
      this._yoshiWarpWarningActive = false;
      this.ui.hideYoshiWarpWarning();
    }
  }

  // A stylized floating "mini-planet" with a color+normal+roughness textured surface.
  // Gets a static collider + GravityField via _addPlanetPhysics so the player can walk on it.
  spawnSkyPlanet({ position = new THREE.Vector3(-260, 190, 0), radius = 26 } = {}) {
    const textureLoader = new THREE.TextureLoader();

    const colorMap = textureLoader.load(TEXTURES.planetColor);
    colorMap.colorSpace = THREE.SRGBColorSpace;

    const normalMap = textureLoader.load(TEXTURES.planetNormal);
    const roughnessMap = textureLoader.load(TEXTURES.planetRoughness);

    const material = new THREE.MeshStandardMaterial({
      map: colorMap,
      normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughnessMap,
      metalness: 0.05,
    });

    const geometry = new THREE.SphereGeometry(radius, 48, 32);
    this.skyPlanet = new THREE.Mesh(geometry, material);
    this.skyPlanet.position.copy(position);

    // A background prop lit by the scene's directional light — doesn't
    // need to receive shadows, but casts its own silhouette.
    this.skyPlanet.castShadow = false;
    this.skyPlanet.receiveShadow = false;

    this.scene.add(this.skyPlanet);
    this.skyPlanetRadius = radius;
    this._addPlanetPhysics(this.skyPlanet, radius);
    return this.skyPlanet;
  }

  // Purely visual "wading" effect over a pond: nudges the rendered mesh down a
  // little, applied AFTER Player.update()'s own body sync so physics is unaffected.
  _updateWaterWading(player, delta) {
    if (!player || !player.mesh || this.ponds.length === 0) return;

    const pos = player.mesh.position;
    let insidePond = false;

    for (const pond of this.ponds) {
      const dx = pos.x - pond.mesh.position.x;
      const dz = pos.z - pond.mesh.position.z;
      if (dx * dx + dz * dz <= pond.radius * pond.radius) {
        insidePond = true;
        break;
      }
    }

    this._insidePond = insidePond;

    const targetDepth = insidePond ? 0.35 : 0;
    // Smoothly ease toward the target depth instead of snapping, so
    // entering/leaving a pond doesn't look like a sudden step.
    this._waterSinkDepth += (targetDepth - this._waterSinkDepth) * Math.min(1, delta * 6);

    if (this._waterSinkDepth > 0.001) {
      player.mesh.position.y -= this._waterSinkDepth;
    }
  }

  // True while the player is standing inside a pond's footprint — read by
  // GameLevel.update() and forwarded to Player.js for the movement slowdown.
  isPlayerInPond() {
    return this._insidePond === true;
  }

  // Slow, constant self-rotation for the sky planet, plus orbital motion
  // for its satellites, purely decorative.
  update(delta, player) {
    if (this.skyPlanet) {
      this.skyPlanet.rotation.y += 0.05 * delta;
    }
    if (this.bluePlanet) {
      this.bluePlanet.rotation.y += 0.03 * delta;
    }

    for (const sat of this.satellites) {
      sat.angle += sat.orbitSpeed * delta;

      const x = this.skyPlanet.position.x + Math.cos(sat.angle) * sat.orbitRadius;
      const z = this.skyPlanet.position.z + Math.sin(sat.angle) * sat.orbitRadius * Math.cos(sat.tilt);
      const y = this.skyPlanet.position.y + Math.sin(sat.angle) * sat.orbitRadius * Math.sin(sat.tilt);

      sat.mesh.position.set(x, y, z);
      sat.mesh.rotation.y += 0.3 * delta;
    }

    // Gentle flow for every pond's shared water texture.
    if (this._waterTexture) {
      this._waterTexture.offset.x += 0.015 * delta;
      this._waterTexture.offset.y += 0.008 * delta;
    }

    // Slow spin + soft up/down bob for each warp star.
    for (const w of this.warpStars) {
      w.mesh.rotation.y += 0.6 * delta;
      w.phase += delta;
      w.mesh.position.y = w.baseY + Math.sin(w.phase * 1.5) * 0.4;
    }

    this._updateWaterWading(player, delta);
    this._updateWarpStars(player);
    this._updateGrassChunks(player);
  }
}
