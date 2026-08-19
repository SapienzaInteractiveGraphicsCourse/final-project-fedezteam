import * as THREE from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { ITEM_MODELS, MAP_MODELS, TEXTURES } from "../../core/Assets/manifest.js";
import { enableShadows } from "../../utils/shadows.js";

/**
 * Owns every purely visual, non-collectible prop in the level: trees,
 * flowers, the instanced grass field, and the decorative sky planet.
 * Extracted out of the former monolithic GameLevel.js.
 *
 * Coin meshes are also scattered here (they share the same random layout
 * pass as trees/flowers), but Decorations does not own collectible state:
 * every coin it creates is handed off via the onCoinSpawned callback so
 * Collectibles can register it for pickup detection.
 */
export default class Decorations {
  constructor(scene, gltfLoader) {
    this.scene = scene;
    this.loader = gltfLoader;
    this.skyPlanet = null;
  }

  // Scatters trees, flowers and loose coins across the island, avoiding the
  // central area reserved for buildings/NPCs.
  async spawnFieldProps(arenaSize, onCoinSpawned) {
    let flowerGlb = null,
      coinGlb = null,
      treeGlb = null;

    try {
      flowerGlb = await this.loader.loadAsync(MAP_MODELS.flower);
    } catch (e) {}
    try {
      coinGlb = await this.loader.loadAsync(ITEM_MODELS.coin);
    } catch (e) {}
    try {
      treeGlb = await this.loader.loadAsync(MAP_MODELS.palmTree);
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

          enableShadows(tree);
          this.scene.add(tree);
        } else if (flowerGlb && Math.random() > 0.75) {
          const plant = flowerGlb.scene.clone();
          const scale = 0.7 + Math.random() * 0.8;
          plant.scale.set(scale, scale, scale);
          plant.rotation.y = Math.random() * Math.PI * 2;
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
   * Adds a small stylized "mini-planet" floating in the sky, in the same
   * spirit as the background planetoids in Super Mario Galaxy. It exists
   * purely to demonstrate a surface with color + normal + roughness maps
   * together (the course requires "textures of different kinds"), and it
   * has no collider — it's a distant background prop, not a walkable body.
   */
  spawnSkyPlanet({ position = new THREE.Vector3(-90, 55, -140), radius = 9 } = {}) {
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
    return this.skyPlanet;
  }

  // Slow, constant self-rotation for the sky planet, purely decorative.
  update(delta) {
    if (this.skyPlanet) {
      this.skyPlanet.rotation.y += 0.05 * delta;
    }
  }
}
