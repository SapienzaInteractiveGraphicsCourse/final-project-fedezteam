import { CHARACTER_MODELS, ENEMY_MODELS } from "./manifest.js";

// Loads every character model in CHARACTER_MODELS through the given
// AssetLoader and returns a promise that resolves once all of them are ready.
export function initGameModels(assetLoader) {
  return assetLoader.loadAll(CHARACTER_MODELS);
}

// Loads every enemy model in ENEMY_MODELS. Uses the same AssetLoader
// instance/cache as initGameModels, so calling both just merges into one
// combined assets map (AssetLoader.assets is shared, not reset per call).
export function initEnemyModels(assetLoader) {
  return assetLoader.loadAll(ENEMY_MODELS);
}
