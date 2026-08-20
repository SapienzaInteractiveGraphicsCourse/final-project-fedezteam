import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { enableShadows } from "../../utils/shadows.js";
import { normalizeMaterials } from "../../utils/materials.js";

/**
 * AssetLoader.js — thin wrapper around three.js' GLTFLoader that loads a
 * batch of named models, applies the shared shadow/material fixups to each
 * one, and caches the results by key so callers can fetch them back later
 * (see initGameModels/initEnemyModels in assetConfig.js).
 */
export default class AssetLoader {
  // Creates the underlying GLTFLoader and the empty model cache.
  constructor() {
    this.loader = new GLTFLoader();
    this.assets = {};
  }

  // Applies the fixups every loaded model needs: shadow flags on every
  // mesh, plus the shared material normalization (color space, eye
  // transparency, metalness/roughness clamps — see utils/materials.js).
  setupModelProperties(model) {
    // 1. Base shadows for every mesh in the hierarchy.
    enableShadows(model);

    // 2. Per-material tweaks (eye transparency, color space, ...) — see
    // utils/materials.js (this used to be duplicated inline here; every
    // other GLTF loader in the game now shares the same fix).
    normalizeMaterials(model);
  }

  // Loads one GLTF/GLB, applies setupModelProperties, caches it under
  // `key`, and resolves with the loaded scene. Rejects (after logging) on
  // load failure.
  loadModel(key, path) {
    return new Promise((resolve, reject) => {
      this.loader.load(
        path,
        (gltf) => {
          const model = gltf.scene;
          this.setupModelProperties(model);
          this.assets[key] = model;
          resolve(model);
        },
        undefined,
        (error) => {
          console.error(
            `Error while loading model "${key}" from ${path}:`,
            error
          );
          reject(error);
        }
      );
    });
  }

  // Loads every entry of `assetsToLoad` (a {key: path} map) in parallel,
  // and resolves with the full assets cache once all of them are ready.
  loadAll(assetsToLoad) {
    const promises = [];
    for (const [key, path] of Object.entries(assetsToLoad)) {
      promises.push(this.loadModel(key, path));
    }
    return Promise.all(promises).then(() => {
      return this.assets;
    });
  }

  // Returns a previously loaded model by key, or undefined if not loaded.
  getAsset(key) {
    return this.assets[key];
  }
}
