/**
 * basePath.js — resolves the game's own asset URLs against this module's
 * own location (import.meta.url) rather than the document, so paths work
 * both from the site root (dev) and a GitHub Pages sub-path (deploy).
 */

// Three levels up from js/core/Assets/ lands on the project root.
export const BASE_URL = new URL("../../../", import.meta.url).href;

// Resolves a game asset path ("assets/x", "./assets/x", "/assets/x") into
// a full URL under BASE_URL; already-absolute URLs pass through untouched.
export function assetUrl(path) {
  const raw = String(path ?? "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;

  return new URL(raw.replace(/^\/+/, "").replace(/^\.\//, ""), BASE_URL).href;
}
