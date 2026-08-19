import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { enableShadows } from "../../utils/shadows.js";

export default class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.assets = {};
  }

  setupModelProperties(model) {
    // 1. Base shadows for every mesh in the hierarchy.
    enableShadows(model);

    // 2. Per-material tweaks (eye transparency, color space, ...).
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];

        materials.forEach((mat) => {
          const matName = mat.name ? mat.name.toLowerCase() : "";

          // Eye materials (both the eyeball 'eye_m' and the pupil 'eye_m_0').
          if (matName.includes("eye")) {
            mat.visible = true;
            mat.transparent = true;
            mat.depthWrite = false;
            mat.alphaTest = 0.1;
            child.castShadow = false; // Disable self-shadowing on the eye.
          }
          // Rest of the body.
          else {
            mat.visible = true;
            mat.transparent = false;
            mat.depthWrite = true;
            mat.alphaTest = 0.5;
          }

          // Ensure vivid, correctly interpreted colors.
          if (mat.map) {
            mat.map.colorSpace = THREE.SRGBColorSpace;
          }

          mat.needsUpdate = true;
        });
      }
    });
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
