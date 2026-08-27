import { CHARACTER_MODELS, ENEMY_MODELS } from "./manifest.js";

// Loads every character model in CHARACTER_MODELS through the given
// AssetLoader and returns a promise that resolves once all of them are ready.
export function initGameModels(assetLoader) {
  return assetLoader.loadAll(CHARACTER_MODELS);
}

// Loads every enemy model. Shares the same AssetLoader cache as
// initGameModels, so both calls merge into one combined assets map.
export function initEnemyModels(assetLoader) {
  return assetLoader.loadAll(ENEMY_MODELS);
}
