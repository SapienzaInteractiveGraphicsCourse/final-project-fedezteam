/**
 * Shared helper to enable/disable shadow casting and receiving on every
 * mesh inside a THREE.Object3D hierarchy (a loaded GLTF scene, a group of
 * primitives, ...).
 *
 * This traverse-and-flag pattern used to be duplicated across AssetLoader,
 * Player, Yoshi, the Buildings/* classes and GameLevel: centralizing it
 * here keeps the shadow policy consistent and makes it a one-line call at
 * every spawn site.
 *
 * @param {THREE.Object3D} object3D - root of the hierarchy to traverse.
 * @param {object} [options]
 * @param {boolean} [options.castShadow=true]
 * @param {boolean} [options.receiveShadow=true]
 */
export function enableShadows(object3D, { castShadow = true, receiveShadow = true } = {}) {
  if (!object3D) return;

  object3D.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = castShadow;
      child.receiveShadow = receiveShadow;
    }
  });
}
