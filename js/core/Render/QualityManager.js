/**
 * QualityManager.js — auto-tunes render quality (pixel ratio, shadow map
 * size, grass view distance) from measured fps, so the game stays smooth
 * on slow machines without capping visuals for everyone. Never touches
 * game behavior (physics, camera, fov) — only how the scene is drawn, and
 * never in a way that forces WebGL to recompile shaders.
 */

// Best to lightest. pixelRatio is a CEILING — on a non-Retina screen (dpr
// 1) the top levels are identical and the gain comes from the other two.
const LEVELS = [
  { name: "alta", pixelRatio: 2.0, shadowMap: 2048, grass: 90 },
  { name: "media", pixelRatio: 1.5, shadowMap: 1536, grass: 80 },
  { name: "bassa", pixelRatio: 1.25, shadowMap: 1024, grass: 65 },
  { name: "minima", pixelRatio: 1.0, shadowMap: 768, grass: 50 },
];

// Below FPS_LOW drops a level, above FPS_HIGH raises one; the gap between
// them is a dead zone where nothing changes.
const FPS_LOW = 50;
const FPS_HIGH = 58;

const WINDOW = 1.0; // measurement window, in seconds

// Consecutive windows needed to move: dropping is fast, raising is cautious.
const WINDOWS_TO_DROP = 2;
const WINDOWS_TO_RAISE = 6;

export default class QualityManager {
  // rendererManager: needs the WebGLRenderer + shadow-casting light (see
  // core/Render/Renderer.js). opts.auto=false freezes the current level.
  constructor(rendererManager, opts = {}) {
    this.rendererManager = rendererManager;
    this.auto = opts.auto !== false;

    // Decorations arrive after level load; until set, the grass distance
    // is just remembered and applied once setDecorations() connects it.
    this.decorations = null;

    this.level = 0;
    this.frames = 0;
    this.elapsed = 0;
    this.badWindows = 0;
    this.goodWindows = 0;

    this._apply();
  }

  // Called by GameLevel/main once the grass field exists.
  setDecorations(decorations) {
    this.decorations = decorations;
    this._apply();
  }

  // One frame elapsed. Call always, even paused/in menus (see
  // core/GameLoop.js) — that's where idle draw cost is measured.
  sample(delta) {
    if (!this.auto || delta <= 0) return;

    this.frames++;
    this.elapsed += delta;
    if (this.elapsed < WINDOW) return;

    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;

    if (fps < FPS_LOW) {
      this.goodWindows = 0;
      this.badWindows++;
      if (this.badWindows >= WINDOWS_TO_DROP && this.level < LEVELS.length - 1) {
        this.badWindows = 0;
        this.setLevel(this.level + 1, fps);
      }
      return;
    }

    if (fps > FPS_HIGH) {
      this.badWindows = 0;
      this.goodWindows++;
      if (this.goodWindows >= WINDOWS_TO_RAISE && this.level > 0) {
        this.goodWindows = 0;
        this.setLevel(this.level - 1, fps);
      }
      return;
    }

    // Dead zone: fine as-is, neither counter advances.
    this.badWindows = 0;
    this.goodWindows = 0;
  }

  // Jumps to a specific level (0 = best). Also usable by hand from the
  // console — see the command banner in main.js.
  setLevel(level, measuredFps = null) {
    const next = Math.max(0, Math.min(LEVELS.length - 1, level));
    if (next === this.level) return;

    const from = LEVELS[this.level].name;
    this.level = next;
    this._apply();

    const why = measuredFps ? ` (misurati ${measuredFps.toFixed(0)} fps)` : "";
    console.log(
      `%c[qualita'] ${from} -> ${LEVELS[next].name}${why}`,
      "color:#fbd000;font-weight:bold",
    );
  }

  // Stops/resumes auto-adjustment, leaving the current level as-is.
  setAuto(auto) {
    this.auto = !!auto;
    this.badWindows = 0;
    this.goodWindows = 0;
  }

  get current() {
    return LEVELS[this.level];
  }

  _apply() {
    const cfg = LEVELS[this.level];
    const renderer = this.rendererManager?.renderer;

    if (renderer) {
      // A ceiling only, never an increase — no point rendering 2x on a 1x screen.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pixelRatio));
    }

    const light = this.rendererManager?.dirLight;
    if (light && light.shadow) {
      light.shadow.mapSize.width = cfg.shadowMap;
      light.shadow.mapSize.height = cfg.shadowMap;

      // Disposing forces the render target to be recreated at the new
      // size — no shader recompile (only toggling shadows off/on does that).
      if (light.shadow.map) {
        light.shadow.map.dispose();
        light.shadow.map = null;
      }
    }

    if (this.decorations?.setGrassViewDistance) {
      this.decorations.setGrassViewDistance(cfg.grass);
    }
  }
}
