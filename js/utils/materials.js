import * as THREE from "three";

/**
 * Normalizes GLTF-imported materials for correct color and transparency.
 * AssetLoader already did this for characters/enemies; everything else
 * (coins, stars, buildings, NPCs, ...) loads through a raw GLTFLoader and
 * needs it applied here — mainly the sRGB color-space flag that was making
 * bright-gold models render almost black.
 */
export function normalizeMaterials(object3D) {
  if (!object3D) return;

  object3D.traverse((child) => {
    if (!child.isMesh || !child.material) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];

    materials.forEach((mat) => {
      const matName = mat.name ? mat.name.toLowerCase() : "";

      // Eye materials: transparent, no self-shadow, so iris layering reads.
      if (matName.includes("eye")) {
        mat.visible = true;
        mat.transparent = true;
        mat.depthWrite = false;
        mat.alphaTest = 0.1;
        child.castShadow = false;
      } else {
        mat.visible = true;
        mat.transparent = false;
        mat.depthWrite = true;
        mat.alphaTest = 0.5;
      }

      // The actual color fix.
      if (mat.map) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
      }

      // glTF defaults unset metallic/roughness to 1.0, rendering near-black.
      // Clamped since this low-poly art was never meant to look like chrome.
      if (mat.metalness !== undefined && mat.metalness > 0.5) {
        mat.metalness = 0.35;
      }
      if (mat.roughness !== undefined && mat.roughness < 0.35) {
        mat.roughness = 0.35;
      }

      // Tone down environment-map reflection (see RendererManager) — full
      // strength was part of what read as overexposed.
      if (mat.envMapIntensity !== undefined) {
        mat.envMapIntensity = 0.4;
      }

      mat.needsUpdate = true;
    });
  });
}
