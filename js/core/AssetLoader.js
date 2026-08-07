import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export default class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.assets = {};
  }

  setupModelProperties(model) {
    model.traverse((child) => {
      if (child.isMesh) {
        // 1. OMBRE DI BASE
        child.castShadow = true;
        child.receiveShadow = true;

        if (child.material) {
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];

          materials.forEach((mat) => {
            const matName = mat.name ? mat.name.toLowerCase() : "";

            // 2. GESTIONE OCCHI (Sia bulbo 'eye_m' che pupilla 'eye_m_0')
            if (matName.includes("eye")) {
              mat.visible = true;
              mat.transparent = true; 
              mat.depthWrite = false; 
              mat.alphaTest = 0.1; 
              child.castShadow = false; // Disattiva ombre interne all'occhio
            }
            // 3. RESTO DEL CORPO
            else {
              mat.visible = true;
              mat.transparent = false;
              mat.depthWrite = true;
              mat.alphaTest = 0.5;
            }

            // Colori vividi
            if (mat.map) {
              mat.map.colorSpace = THREE.SRGBColorSpace;
            }

            mat.needsUpdate = true;
          });
        }
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
            `Errore durante il caricamento del modello ${key} da ${path}:`,
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