import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { ITEM_MODELS, MAP_MODELS, TEXTURES } from "../../core/Assets/manifest.js";
import { enableShadows } from "../../utils/shadows.js";
import { normalizeMaterials } from "../../utils/materials.js";
import GravityField from "../../physics/GravityField.js";

/**
 * Owns every purely visual, non-collectible prop in the level: trees,
 * flowers, rocks, bushes, ponds, the instanced grass field, small house
 * surroundings (fences/lamp posts), the sky planets (the main
 * color+normal+roughness "red" planet plus its orbiting satellites, and a
 * second, purely decorative blue "ocean" planet), and the Mario
 * Galaxy-style warp stars marking the island's edges. Extracted out of the
 * former monolithic GameLevel.js.
 *
 * Coin meshes are also scattered here (they share the same random layout
 * pass as trees/flowers, plus curated coin trails), but Decorations does
 * not own collectible state: every coin it creates is handed off via the
 * onCoinSpawned callback so Collectibles can register it for pickup
 * detection.
 *
 * Most props here are purely visual (no collider), but rocks, palm trees
 * and the main "red" sky planet do get a physics body (see
 * _addPlanetPhysics for the planet). That planet also gets a GravityField
 * (see PhysicsEngine.addGravityField/GravityField.js) so getting close
 * pulls the player toward it instead of straight down, letting Mario walk
 * around its surface like in Super Mario Galaxy — it's the only planet
 * with this mechanic; the blue planet and its satellites are pure
 * background dressing. Ponds apply a small cosmetic "wading" sink to the
 * player's mesh while they stand over one (see _updateWaterWading).
 *
 * Warp stars (see spawnWarpStars/_updateWarpStars) teleport the player on
 * contact to one of: the red planet, back to the level's spawn point, or
 * the entrance of one of the separate obstacle courses — Kamek's or
 * Bowser's (see entities/Level/ObstacleZone.js, wired up from main.js) —
 * see setSpawnPoint/setKamekZoneEntry/setBowserZoneEntry for how those
 * destinations get filled in.
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
    // Filled in from outside (see setSpawnPoint/setKamekZoneEntry/
    // setBowserZoneEntry, called from GameLevel.js/main.js once those
    // points are known) so warp stars targeting "spawn", "kamek_zone" or
    // "bowser_zone" have somewhere to send the player.
    this.spawnPoint = null;
    this.kamekZoneEntry = null;
    this.bowserZoneEntry = null;
    // Smoothed 0..1-ish sink depth applied to the player's mesh while
    // standing inside a pond's footprint (see _updateWaterWading).
    this._waterSinkDepth = 0;
    // undefined = not attempted yet, null = attempted and failed to load.
    this._coinGlbCache = undefined;
    // Same convention, for star_launch.glb. spawnWarpStars() is called not
    // just once at level load but also at RUNTIME every time a boss
    // (Kamek/Bowser) is defeated, dropping a single warp star back to spawn
    // (see main.js); without this cache each defeat re-fetched and
    // re-parsed star_launch.glb from scratch, which used to be A cause of
    // the brief stutter on boss defeat (see _warpLightPool below for the
    // other, bigger one).
    this._starLaunchGlbCache = undefined;

    // BUG FIX (boss-defeat/warp-star micro-freeze): fixed pool of reusable
    // PointLights, created and added to the scene right now — i.e. well
    // before the one-time renderer.compileAsync() warm-up in main.js runs —
    // instead of spawnWarpStars() below doing `new THREE.PointLight(...)`
    // on every call. Adding a NEW light to the scene forces three.js to
    // recompile the shader of every material it now affects (light counts
    // are baked into the shader source itself, as #define NUM_POINT_LIGHTS
    // — confirmed via three.js's own docs/discussion of this), and that
    // recompile is what caused the stutter: once right when a boss is
    // defeated (a light was created for the reward star on the spot) and
    // again moments later when the player walks up and collects it (the
    // GPU driver can defer actually compiling/linking the new program until
    // the next draw call that needs it, which often lands right around
    // pickup). Every warp star from here on reuses one of these
    // already-compiled-for lights instead, so nothing ever gets added to
    // the scene again after startup — sized for the 4 decorative stars
    // placed at level load (see GameLevel.js) plus one reserved slot each
    // for Kamek's and Bowser's reward stars, with spare room to grow.
    this._warpLightPool = [];
    for (let i = 0; i < Decorations.WARP_LIGHT_POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 14, 2); // intensity 0 = off/unused
      scene.add(light);
      this._warpLightPool.push(light);
    }
    this._warpLightPoolIndex = 0;
  }

  // Hands out the next free light from the pool above (see the constructor
  // for why), growing the pool on the spot — accepting the one-time
  // recompile that was the whole point of pooling to avoid — only if every
  // pooled light is already in use. Logged so the pool size can be raised
  // if this ever actually triggers.
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
      // Normalized once here, before _tintModel below clones a material
      // per instance to tint it — the clone keeps the same (now
      // colorSpace-fixed) texture reference, so this one call covers every
      // warp star regardless of which spawnWarpStars() call they came from.
      normalizeMaterials(this._starLaunchGlbCache.scene);
    } catch (e) {
      console.warn("[Decorations] star_launch.glb not found — skipping warp stars.");
      this._starLaunchGlbCache = null;
    }

    return this._starLaunchGlbCache;
  }

  // Loads (and caches) the coin model, shared by every method that scatters
  // coins so the GLTF is only fetched once regardless of how many callers
  // need it.
  async _loadCoinModel() {
    if (this._coinGlbCache !== undefined) return this._coinGlbCache;

    try {
      this._coinGlbCache = await this.loader.loadAsync(ITEM_MODELS.coin);
      // Normalized once here — every coin clone below shares this
      // material by reference, so this covers all of them (see
      // utils/materials.js for why this was needed at all: coins/stars
      // were rendering almost black without it).
      normalizeMaterials(this._coinGlbCache.scene);
    } catch (e) {
      this._coinGlbCache = null;
    }

    return this._coinGlbCache;
  }

  // Scatters trees, flowers and loose coins across the island, avoiding the
  // central area reserved for buildings/NPCs.
  async spawnFieldProps(arenaSize, onCoinSpawned) {
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
          // Bake the position/rotation/scale just applied into the tree's
          // matrixWorld so the bounding box below measures the tree as it
          // will actually appear, before it's even added to the scene.
          tree.updateMatrixWorld(true);

          enableShadows(tree);
          this.scene.add(tree);

          // Box collider (no cylinder-axis orientation to get wrong) sized
          // from the tree's own real bounding box instead of a guessed
          // constant, so it automatically matches each tree's actual
          // height — trees range ~2.3x in visual scale, so a fixed height
          // was either too short for the big ones or too tall for the
          // small ones. Footprint (width) stays a fixed "trunk" size: the
          // fronds spread much wider than the trunk, and we don't want
          // walking near a tree to feel blocked from several units away.
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

  /**
   * Places a smooth trail of coins along a sequence of waypoints, optionally
   * arcing upward mid-segment. Used to visually guide the player toward a
   * point of interest (e.g. up a staircase of hills) instead of relying
   * purely on the random field scatter from spawnFieldProps.
   *
   * @param {{x:number,y:number,z:number}[]} waypoints - path to follow, in order.
   * @param {(mesh: THREE.Object3D) => void} onCoinSpawned - registers each coin for pickup.
   * @param {{spacing?: number, arcHeight?: number}} [options]
   */
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

  /**
   * Builds one low-poly rock mesh: an icosahedron with each vertex nudged
   * randomly along its own direction from the center, which gives the
   * classic faceted "low-poly rock" silhouette without needing an external
   * model file.
   */
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

  /**
   * Scatters low-poly rocks in a ring hugging the island's outer edge, so
   * the boundary reads as a natural rocky rim instead of the ground simply
   * stopping. Each rock gets a static sphere collider approximating its
   * visual radius (a sphere has no orientation to get wrong, unlike a
   * cylinder/box, which is a good fit for the roughly-round rock shape).
   *
   * All rocks share one material already, so their (baked, static)
   * geometries are merged into a single draw call instead of one mesh per
   * rock — same technique spawnGrassField already uses for grass blades.
   * Physics stays one CANNON.Body per rock (unaffected by this — only the
   * visual mesh count changes), and shadows are unaffected too: the merged
   * mesh still casts/receives exactly as every individual rock did.
   */
  spawnRocks(arenaSize, count = 18) {
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

      const radius = 0.6 + Math.random() * 1.4;
      const posY = radius * 0.35;

      // Bake this rock's position/rotation into its own geometry before
      // merging, since the merged mesh below has no per-rock transform of
      // its own.
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

  /**
   * Builds one low-poly bush mesh: a subdivided icosahedron with jittered,
   * vertically flattened vertices, giving a rounded, slightly irregular
   * bush silhouette. Same technique as _createRockGeometry, tuned for a
   * softer/rounder shape instead of a jagged rock.
   */
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

  /**
   * Scatters low-poly bushes across the island (same central-area exclusion
   * as spawnFieldProps), cycling through a handful of different greens so
   * they don't all read as identical clones of the rocks. Purely
   * decorative, no collider.
   *
   * Unlike rocks, each bush picks its own color, which would normally mean
   * a separate material (and draw call) per bush. Instead, the chosen
   * color is baked into a per-vertex color attribute on each bush's
   * geometry before merging, and the merged mesh uses a single
   * `vertexColors: true` material — one draw call total while still
   * keeping the 5-color variety. Shadows are unaffected: the merged mesh
   * casts/receives exactly as every individual bush did.
   */
  spawnBushes(arenaSize, count = 26) {
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

  /**
   * Draws a simple flowing-water pattern onto a canvas and returns it as a
   * repeating THREE.CanvasTexture, shared by every pond so only one texture
   * is created regardless of pond count.
   */
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

  /**
   * Adds small flat ponds (water surface only — no depth/volume, and no
   * collider) at hand-picked spots. Each spot is
   * {x, z, y?: number, radius?: number}. The shared water texture slowly
   * scrolls in update() for a subtle flowing look.
   *
   * @param {{x:number, z:number, y?:number, radius?:number}[]} spots
   */
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
      // geometry.parameters) so _updateWaterWading has an explicit,
      // guaranteed value to test against.
      this.ponds.push({ mesh: pond, radius: spot.radius || 6 });
    }
  }

  /**
   * Approximate footprint radius (world units, ignoring the JSON "scale"
   * field since it means different things per model) used to place the
   * fence ring around each house type. Purely a visual estimate, not the
   * house's actual collision hitbox.
   */
  static FOOTPRINT_RADIUS = {
    mario_house: 20, // was 13 — enlarged for a more spacious yard.
    toad_house: 8,
    toad_house_red: 8,
    toad_house_blue: 8,
  };

  /**
   * Per-type extra rotation for the fence ring (and its entrance gap +
   * lamp posts), applied ON TOP of the building's own JSON "rotationY" —
   * kept separate so adjusting where the ring's opening sits never rotates
   * the house model itself.
   */
  static FENCE_ROTATION_OFFSET = {
    mario_house: Math.PI / 2,
  };

  /**
   * World Y of the main island's flat ground surface — see
   * LevelLoader.buildPlatforms: the platform box sits at position.y=-1
   * with size.y=2, so its top face is at y = -1 + 2/2 = 0. The fence ring
   * always belongs right on this surface.
   */
  static GROUND_LEVEL = 0;

  /**
   * Per-type vertical nudge on top of GROUND_LEVEL, for any building whose
   * visual base still doesn't line up perfectly with it. Deliberately NOT
   * based on the building's own JSON "y": that value exists to compensate
   * for each house MODEL's own pivot point (mario_house needs y=4 just to
   * render sitting on the ground — its origin isn't at its base), which
   * has nothing to do with where the ground actually is. The previous
   * version of this fix added a small correction on top of "y" instead of
   * replacing it, which happened to look right for toad_house (y=0, i.e.
   * already at ground level) but sent mario_house's ring floating ~3-4
   * units in the air, since its y=4 pivot compensation was never meant to
   * apply to this procedural, pivot-less fence group.
   */
  static GROUND_OFFSET = {};

  /**
   * Size of the reusable warp-star glow-light pool (see _warpLightPool /
   * _nextWarpLight) — currently 4 decorative stars at level load
   * (GameLevel.js) + 1 reserved each for Kamek's and Bowser's reward stars
   * = 6, plus a couple spare so future additions don't silently fall back
   * to the (recompile-triggering) exhausted-pool path.
   */
  static WARP_LIGHT_POOL_SIZE = 8;

  // Adds a small decorated area (fence ring + a couple of lamp posts) around
  // every house-type building in the level, using the same building JSON
  // entries LevelLoader already consumed. Purely decorative primitives, no
  // collider, so this can never conflict with a house's tuned hitbox.
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

    // Low fence posts around the house, leaving a gap facing one side so it
    // doesn't block the entrance. The gap angle is a fixed approximation
    // (not derived from the actual door direction) — good enough for a
    // decorative ring, worth revisiting if it ends up facing the door.
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

      // Small local light so the lamp actually reads as a light source at
      // night/dusk, not just an emissive bulb. Range is short and intensity
      // low to avoid a noticeable performance or exposure impact.
      const light = new THREE.PointLight(0xffbf60, 0.6, 8, 2);
      light.position.y = 2.7;
      lamp.add(light);

      lamp.position.set(Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius);
      enableShadows(lamp, { castShadow: false, receiveShadow: false });
      group.add(lamp);
    }

    this.scene.add(group);
  }

  /**
   * Gives a walkable sky planet mesh a static sphere collider (so the
   * player can actually stand on it) and registers a matching GravityField
   * (so getting close enough pulls the player toward its center instead of
   * straight down, and standing on it lets them walk around its surface —
   * see PhysicsEngine.addGravityField/getActiveGravityField and Player.js's
   * _updateOnPlanet). Called by spawnSkyPlanet/spawnBluePlanet/
   * spawnYoshiEggPlanet; deliberately NOT called for the orbiting
   * satellites, which stay purely decorative (they also move every frame,
   * which a static collider can't follow without extra per-frame body-sync
   * code that isn't needed for background dressing).
   */
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

  // Adds 1-2 smaller planets orbiting the main sky planet at different
  // speeds/tilts, purely for background richness — not too big, so they
  // read as moons rather than competing with the main planet. Colors only
  // (no extra texture files) since the color+normal+roughness requirement
  // is already covered by the main sky planet. Orbit radius stays outside
  // the main planet's own radius (26) so they don't clip through it.
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
          // material in the project (see spawnSkyPlanet above) — left out
          // here too until now.
          envMapIntensity: 0.4,
        }),
      );
      mesh.castShadow = false;
      mesh.receiveShadow = false;

      // Placed on its orbit right away, with the same math update() uses
      // every frame, instead of being left at the mesh's default (0,0,0).
      // update() is what normally keeps this mesh moving along its orbit,
      // but update() only runs once actual gameplay starts (main.js's
      // updateGame() returns early during MENU_WELCOME/MENU_NAME, before
      // entityManager.player exists) — so without this, both satellites
      // sat at the world origin, right on top of Mario's house, for the
      // entire main menu, and only jumped to their real orbit position the
      // instant gameplay began. That pale sphere sitting near the house
      // (confirmed via a scene dump: both satellites at exactly x=0,y=0,z=0)
      // was this, not the toad house — half-buried in the ground at the
      // origin, the light-blue satellite (#bfe9ff) reads as a plain white
      // dome poking out of the lawn.
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

  /**
   * Draws a simple cloud-blob pattern onto a canvas and returns it as a
   * repeating THREE.CanvasTexture. Used for the blue planet so it reads as
   * an ocean-and-clouds sphere without needing a separate PNG asset.
   */
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

  /**
   * A second background planet, distinct from the main color+normal+
   * roughness planet: an ocean-blue sphere with a procedurally drawn cloud
   * pattern (see _createCloudySphereTexture). Purely a distant sky prop —
   * no collider/gravity field, no warp star sends the player here — kept
   * deliberately modest in size ("for beauty", not to walk on).
   * Positioned on the opposite side of the world from the main sky planet,
   * high above the ground.
   */
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

  /**
   * Scatters a handful of coins across the red planet's surface, findable
   * while walking around it — same "hand the mesh off via onCoinSpawned so
   * Collectibles can register it" pattern as spawnFieldProps/
   * spawnCoinTrail. Called from GameLevel.js right after spawnSkyPlanet.
   */
  async spawnPlanetCoins(planetMesh, radius, count, onCoinSpawned) {
    if (!planetMesh || !radius) return;

    const coinGlb = await this._loadCoinModel();
    if (!coinGlb) return;

    for (let i = 0; i < count; i++) {
      // Standard spherical -> Cartesian parametrization. Not perfectly
      // uniform-area, but plenty good enough for scattering a handful of
      // decorative pickups.
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

  // Clones every mesh's material before tinting so the same base GLTF can
  // be reused for multiple differently-colored instances without them
  // sharing (and fighting over) one material.
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

  /**
   * Places Mario Galaxy-style "launch stars" (star_launch.glb) at the
   * island's edges (or wherever a spot says), tinted per destination.
   * Touching one teleports the player there — see `target` below and
   * _updateWarpStars/_getWarpDestination.
   *
   * @param {{x:number,y:number,z:number,color:number,scale?:number,target?:("sky"|"spawn"|"kamek_zone"|"bowser_zone")}[]} spots
   *   `target` picks the destination: "sky" is the walkable red planet
   *   (see spawnSkyPlanet), "spawn" is the level's player spawn point (see
   *   setSpawnPoint), "kamek_zone"/"bowser_zone" are the entrances to the
   *   two separate obstacle courses (see setKamekZoneEntry/
   *   setBowserZoneEntry). Omit `target` to keep a star purely decorative.
   */
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

      // Small matching-color glow so the star reads clearly against the
      // skybox even from a distance. Reuses a pre-warmed light from the
      // pool instead of creating a new THREE.PointLight here — see
      // _warpLightPool's comment in the constructor for why.
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

  // Sets the level's player spawn point (called once from GameLevel.js
  // after level1.json is parsed), so a warp star with target "spawn" has
  // somewhere to send the player back to.
  setSpawnPoint(point) {
    this.spawnPoint = point;
  }

  // Sets the entrance coordinates of the separate Kamek obstacle course
  // (called from main.js once ObstacleZone.load() resolves — see
  // entities/Level/ObstacleZone.js), so a warp star with target
  // "kamek_zone" has somewhere to send the player.
  setKamekZoneEntry(point) {
    this.kamekZoneEntry = point;
  }

  // Same as setKamekZoneEntry, for the separate Bowser obstacle course
  // (bowser_zone.json, loaded via its own ObstacleZone instance in main.js), so
  // a warp star with target "bowser_zone" has somewhere to send the player.
  setBowserZoneEntry(point) {
    this.bowserZoneEntry = point;
  }

  /**
   * Places a small Minecraft "Oak Sign" prop (minecraft_sign.glb, a
   * Mineways export) bearing a logo texture near a warp star that leads to
   * a separate zone, so the destination is marked before the player steps
   * on the star. Used for both the Kamek zone (kamekLogo) and the Bowser
   * zone (gameoverLogo) — see GameLevel.js for the call sites. The sign's
   * own baked material samples a shared Minecraft block-texture atlas with
   * no blank area to draw on (confirmed by inspecting the GLB directly),
   * so the logo can't be applied by editing that texture — instead it's a
   * small separate plane overlaid just in front of the sign's face, the
   * same "decal" technique used for posters on top of baked models.
   *
   * @param {{x:number,y:number,z:number,rotationY?:number,logo?:string}[]} spots
   *   `rotationY` orients the sign so its face reads clearly to an
   *   approaching player; omit for the model's default facing. `logo` is a
   *   texture path (see TEXTURES in manifest.js), defaulting to kamekLogo.
   */
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

    // Normalized from the model's own bounding-box height rather than its
    // raw native scale (same pattern as spawnStars in Collectibles.js) —
    // the sign is a tiny, thin Minecraft plank model of unknown native
    // scale, so trusting scale:1 would render it either invisible-small or
    // enormous. Was 2.2 (read as small/hard to notice from a distance);
    // 3.6 reads as a proper landmark-sized sign next to the player.
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

      // Recenter the (now correctly scaled) sign on its own local origin —
      // horizontally centered, depth centered, base sitting at y=0 — so
      // the group's position below places its base on the ground and the
      // logo plane can be positioned purely from its bounding box.
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
        // Both kamekLogo and gameoverLogo (see manifest.js) are
        // pre-cropped, pre-centered, alpha-masked PNGs — the badge itself
        // already fills its square canvas edge-to-edge with a transparent
        // background. 0.92 of the sign's own face made the badge bigger
        // than the board itself (it stuck out past the wooden edges) —
        // 0.45 keeps it clearly inset within the board while still
        // reading as a big, centered badge.
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
        // A hair off the sign's face (0.01) to avoid z-fighting, centered
        // horizontally (local x=0, matching the sign's own recentered
        // origin). Vertically nudged above the board's exact center
        // (faceHeight * 0.5 would be dead-center) toward the top — 0.62
        // reads better than dead-center once the small post sticking out
        // below the board is taken into account.
        logoPlane.position.set(0, faceHeight * 0.775, faceZ + 0.01);
        logoPlane.castShadow = false;
        logoPlane.receiveShadow = false;
        group.add(logoPlane);
      }

      this.scene.add(group);
    }
  }

  // Resolves a warp star's `target` into an actual world-space landing
  // spot, or null if that destination isn't available yet (e.g.
  // setKamekZoneEntry hasn't been called, or the target planet failed to
  // load) — _updateWarpStars simply skips the star in that case rather
  // than teleporting the player into empty space.
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
      // Directly "above" the planet's own local up (its +Y from center),
      // so the player lands with a predictable initial orientation — see
      // Player.js's _updateOnPlanet.
      return {
        x: this.skyPlanet.position.x,
        y: this.skyPlanet.position.y + this.skyPlanetRadius + (playerRadius || 1) + 0.5,
        z: this.skyPlanet.position.z,
      };
    }

    return null;
  }

  /**
   * Mario Galaxy-style warp: getting close to a launch star teleports the
   * player to just above the planet it's tinted to match, landing them
   * directly inside that planet's gravity field (see
   * PhysicsEngine.getActiveGravityField) so they immediately start falling
   * toward — and can walk around on — its surface. Same "poke the body
   * directly from outside" pattern used elsewhere in this codebase for
   * player-affecting effects (EntityManager's void-fall respawn, Enemy's
   * stomp bounce) — never touches Player.js's own update logic.
   */
  _updateWarpStars(player) {
    if (!player || !player.body || this.warpStars.length === 0) return;

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

  /**
   * Adds a stylized "mini-planet" floating in the sky, in the same spirit
   * as the background planetoids in Super Mario Galaxy. It exists partly
   * to demonstrate a surface with color + normal + roughness maps together
   * (the course requires "textures of different kinds"). Also gets a static
   * sphere collider plus a GravityField via _addPlanetPhysics, so the
   * player can actually land on and walk around it (see Player.js's
   * _updateOnPlanet) — reachable via the matching warp star, see
   * spawnWarpStars.
   */
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

    // A background prop lit by the scene's directional light; it doesn't
    // need to receive shadows from the level geometry, but it does cast
    // its own silhouette if anything is ever placed near it.
    this.skyPlanet.castShadow = false;
    this.skyPlanet.receiveShadow = false;

    this.scene.add(this.skyPlanet);
    this.skyPlanetRadius = radius;
    this._addPlanetPhysics(this.skyPlanet, radius);
    return this.skyPlanet;
  }

  /**
   * Purely visual "wading" effect: while the player's horizontal position
   * is over a pond, nudge their rendered mesh down a little so they look
   * like they're standing in shallow water. This intentionally never
   * touches the physics body (player.body) — it only offsets the mesh
   * AFTER Player.update() has already synced it from the body for this
   * frame, so next frame's physics step is completely unaffected and there
   * is nothing for gravity/collision to fight against.
   */
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

    const targetDepth = insidePond ? 0.35 : 0;
    // Smoothly ease toward the target depth instead of snapping, so
    // entering/leaving a pond doesn't look like a sudden step.
    this._waterSinkDepth += (targetDepth - this._waterSinkDepth) * Math.min(1, delta * 6);

    if (this._waterSinkDepth > 0.001) {
      player.mesh.position.y -= this._waterSinkDepth;
    }
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
  }
}
