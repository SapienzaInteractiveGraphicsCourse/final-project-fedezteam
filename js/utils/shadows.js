/**
 * Enables/disables shadow casting+receiving on every mesh in a hierarchy.
 * Centralized here since it used to be duplicated across AssetLoader,
 * Player, Yoshi, Buildings/* and GameLevel.
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
