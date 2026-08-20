import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { enableShadows } from "../../utils/shadows.js";
import { normalizeMaterials } from "../../utils/materials.js";

export default class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.assets = {};
  }

  setupModelProperties(model) {
    // 1. Base shadows for every mesh in the hierarchy.
    enableShadows(model);

    // 2. Per-material tweaks (eye transparency, color space, ...) — see
    // utils/materials.js (this used to be duplicated inline here; every
    // other GLTF loader in the game now shares the same fix).
    normalizeMaterials(model);
  }

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
