import Enemy from "./Enemy.js";

/**
 * Goomba.js — the basic one-hit enemy.
 *
 * Goomba is a thin config wrapper around the shared Enemy base class: it
 * contributes only its own tuning numbers (detection range, chase speed,
 * collision radius, visual scale) and leaves every behavior — chase AI,
 * physics body, stomp/contact detection, defeat — to Enemy. A Goomba dies in
 * a single stomp, so no invulnerability window is needed.
 */
export default class Goomba extends Enemy {
  // Builds a Goomba with its default stats, overridable via `options`.
  // targetHeight normalizes goomba.glb's scale, which otherwise renders
  // far too tall relative to the player.
  constructor(mesh, physicsEngine, options = {}) {
    super(mesh, physicsEngine, {
      detectionRange: 9,
      chaseSpeed: 2.5,
      radius: 0.55,
      targetHeight: 1.3,
      hitsToDefeat: 1,
      invulnerabilityDuration: 0,
      ...options,
    });
  }
}
