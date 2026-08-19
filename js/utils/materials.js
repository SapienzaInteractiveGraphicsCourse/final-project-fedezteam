import * as THREE from "three";

/**
 * Normalizes GLTF-imported materials so they render with correct, vivid
 * colors and sane transparency defaults.
 *
 * AssetLoader.setupModelProperties() already did this for every model
 * loaded through AssetLoader (the characters and enemies), but every other
 * GLTF in the game — coins, stars, mushrooms, "?" blocks, buildings, hills,
 * NPCs, palm trees, flowers, warp stars — is loaded through a raw
 * GLTFLoader instance instead (see GameLevel/Decorations/Collectibles/
 * LevelLoader) and never got this fix. The main symptom: an un-flagged
 * base color texture gets treated as linear data instead of sRGB, which
 * renders it noticeably darker/duller than intended — this is what was
 * making coins and stars look almost black in-game despite looking bright
 * gold in a model viewer.
 *
 * @param {THREE.Object3D} object3D - root of the hierarchy to normalize.
 */
export function normalizeMaterials(object3D) {
  if (!object3D) return;

  object3D.traverse((child) => {
    if (!child.isMesh || !child.material) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];

    materials.forEach((mat) => {
      const matName = mat.name ? mat.name.toLowerCase() : "";

      // Eye materials (mainly character models): keep them transparent so
      // the white/iris layering reads correctly, and never self-shadow.
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

      // Second safety net for the same "renders almost black" problem: the
      // glTF spec defaults an unset metallicFactor to 1.0 (fully metallic)
      // and unset roughnessFactor to 1.0. Several of this project's item
      // models (coin.glb, star.glb, ...) never set these explicitly, so
      // they import as fully metallic + fully rough — with no diffuse
      // response and barely any visible specular, that's essentially
      // black regardless of lighting. This low-poly Mario-style art was
      // never meant to look like photorealistic chrome, so clamping is a
      // safe, conservative choice project-wide (RendererManager's new
      // environment map is the other half of this fix — this clamp makes
      // sure these models still look right even if that weren't enough).
      if (mat.metalness !== undefined && mat.metalness > 0.5) {
        mat.metalness = 0.35;
      }
      if (mat.roughness !== undefined && mat.roughness < 0.35) {
        mat.roughness = 0.35;
      }

      // Tone down how strongly the environment map (see RendererManager)
      // reflects off every material — full-strength (the default 1) was
      // part of what was reading as overexposed. Was 0.6, lowered further.
      if (mat.envMapIntensity !== undefined) {
        mat.envMapIntensity = 0.4;
      }

      mat.needsUpdate = true;
    });
  });
}
