import Enemy from "./Enemy.js";

/**
 * Kamek.js — the first boss, waiting at the end of the Kamek obstacle
 * course (see kamek_zone.json / ObstacleZone.js / main.js).
 *
 * Fast and small-hitbox compared to a regular enemy, defeated after 3
 * stomps with a 5s invulnerability window after each hit so the fight can't
 * be finished in one jump combo. Everything it needs (multi-hit tracking,
 * the invulnerability timer, chase AI, stomp detection) already lives in
 * the shared Enemy base class; this subclass only supplies the
 * boss-specific numbers.
 */
export default class Kamek extends Enemy {
  // Builds Kamek with its boss stats, overridable via `options`.
  constructor(mesh, physicsEngine, options = {}) {
    super(mesh, physicsEngine, {
      detectionRange: 14,
      chaseSpeed: 7,
      radius: 0.3,
      targetHeight: 2.2,
      hitsToDefeat: 3,
      invulnerabilityDuration: 5,
      stompBounceVelocity: 11,
      ...options,
    });
  }
}
