import Enemy from "./Enemy.js";

/**
 * Standard one-hit enemy: a single stomp defeats it, no invulnerability
 * window needed since there's no second hit to space out. Everything else
 * (chase AI, physics body, contact detection) comes from Enemy.
 */
export default class Goomba extends Enemy {
  constructor(mesh, physicsEngine, options = {}) {
    super(mesh, physicsEngine, {
      detectionRange: 9,
      chaseSpeed: 2.5,
      radius: 0.55,
      // The raw goomba.glb came out towering over the player at scale 1 —
      // this normalizes it to a believable, slightly-shorter-than-Mario
      // height regardless of the model's native scale.
      targetHeight: 1.3,
      hitsToDefeat: 1,
      invulnerabilityDuration: 0,
      ...options,
    });
  }
}
