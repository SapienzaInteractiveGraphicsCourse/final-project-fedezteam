import Enemy from "./Enemy.js";

/**
 * Goomba.js — basic one-hit enemy. Thin config wrapper around Enemy: only
 * contributes tuning numbers, all behavior lives in the base class.
 */
export default class Goomba extends Enemy {
  // targetHeight normalizes goomba.glb's scale (otherwise renders too tall).
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
