import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { enableShadows } from "../../utils/shadows.js";
import { normalizeMaterials } from "../../utils/materials.js";

/**
 * AssetLoader.js — wraps GLTFLoader to load a batch of named models,
 * apply the shared shadow/material fixups, and cache results by key.
 */
export default class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.assets = {};
  }

  // Shadow flags + shared material normalization (see utils/materials.js).
  setupModelProperties(model) {
    enableShadows(model);
    normalizeMaterials(model);
  }

  // Loads one GLTF/GLB, applies setupModelProperties, caches it under
  // `key`. Rejects (after logging) on load failure.
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

  // Loads every entry of `assetsToLoad` ({key: path}) in parallel.
  loadAll(assetsToLoad) {
    const promises = [];
    for (const [key, path] of Object.entries(assetsToLoad)) {
      promises.push(this.loadModel(key, path));
    }
    return Promise.all(promises).then(() => {
      return this.assets;
    });
  }

  getAsset(key) {
    return this.assets[key];
  }
}
