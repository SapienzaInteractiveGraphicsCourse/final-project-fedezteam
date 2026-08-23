/**
 * basePath.js — where the game's own files live, worked out at runtime, so
 * every asset URL is built from one place instead of each call site hoping
 * the page happens to be served from the right directory.
 *
 * WHY. The game is served from the site root during development
 * (http://127.0.0.1:5500/) but from a SUB-PATH on GitHub Pages
 * (https://<user>.github.io/<repo>/). A path like "/assets/x.glb" is the
 * one form that cannot work in both: on Pages it points at
 * <user>.github.io/assets/x.glb, outside the repo entirely. Plain relative
 * paths ("assets/x.glb") do work in both, but only because they are
 * resolved against the DOCUMENT — which quietly makes every asset in the
 * game depend on where index.html sits and on the URL keeping its trailing
 * slash.
 *
 * HOW. BASE_URL is derived from this module's own URL rather than from the
 * document: import.meta.url is always the real, fully resolved address of
 * this file, so walking up out of js/core/Assets/ lands exactly on the
 * project root wherever it is deployed — root, sub-path, or a preview URL
 * nobody has thought of yet. Nothing here needs configuring per
 * environment, and there's no build step to forget to run.
 *
 * WHAT TO USE. Anything about to hand a URL to the browser — fetch(),
 * GLTFLoader/TextureLoader.load(), new Audio(), an <img> src — takes
 * assetUrl(). Everywhere else keeps writing plain, readable relative paths
 * (see Assets/manifest.js, Audio/soundConfig.js).
 */

// The project root: this file is js/core/Assets/basePath.js, so three
// levels up is the directory index.html lives in. Ends with a slash, which
// is what makes it usable as a base for new URL().
export const BASE_URL = new URL("../../../", import.meta.url).href;

/**
 * Resolves one of the game's own asset paths into a full URL under
 * BASE_URL.
 *
 * Accepts the shapes actually written across the codebase — "assets/x",
 * "./assets/x" — and treats a leading "/" as project-relative too rather
 * than as the server root, since an absolute path is precisely what breaks
 * under a sub-path deployment.
 *
 * Anything already carrying a scheme (https:, data:, blob:) is handed back
 * untouched: that covers the CDN-hosted DRACO decoder and makes the
 * function idempotent, so passing an already-resolved URL through it a
 * second time is harmless.
 */
export function assetUrl(path) {
  const raw = String(path ?? "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;

  return new URL(raw.replace(/^\/+/, "").replace(/^\.\//, ""), BASE_URL).href;
}
