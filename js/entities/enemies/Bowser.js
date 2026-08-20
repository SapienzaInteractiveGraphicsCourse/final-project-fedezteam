import Enemy from "./Enemy.js";

/**
 * Bowser.js — the final boss, waiting at the end of the Bowser obstacle
 * course (see bowser_zone.json / ObstacleZone.js / main.js).
 *
 * Bigger, tougher and slower than Kamek: more hits to defeat and a longer
 * invulnerability window between them make the fight take longer, while the
 * lower chase speed and larger radius/targetHeight read as a heavy,
 * lumbering opponent rather than a fast one. Everything it needs (multi-hit
 * tracking, the invulnerability timer, chase AI, stomp detection) already
 * lives in the shared Enemy base class; this subclass only supplies the
 * boss-specific numbers — same pattern as Kamek.js.
 */
export default class Bowser extends Enemy {
  // Builds Bowser with its boss stats, overridable via `options`.
  constructor(mesh, physicsEngine, options = {}) {
    super(mesh, physicsEngine, {
      detectionRange: 16,
      chaseSpeed: 3,
      radius: 1,
      targetHeight: 3.4,
      hitsToDefeat: 5,
      invulnerabilityDuration: 4,
      stompBounceVelocity: 13,
      ...options,
    });
  }
}
