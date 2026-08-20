import Enemy from "./Enemy.js";

/**
 * Boss scaffold: defeated after 3 stomps, with a 5s invulnerability window
 * after each stomp so the fight can't be finished in one jump combo.
 *
 * NOT spawned in any level yet — this is only the class structure, ready
 * for whenever a Kamek boss arena/encounter is designed. Everything it
 * needs (multi-hit tracking, the invulnerability timer, chase AI, stomp
 * detection) already lives in the shared Enemy base class; this subclass
 * only supplies the boss-specific numbers.
 */
export default class Kamek extends Enemy {
  constructor(mesh, physicsEngine, options = {}) {
    super(mesh, physicsEngine, {
      detectionRange: 14,
      chaseSpeed: 4,
      radius: 1.1,
      targetHeight: 2.2,
      hitsToDefeat: 3,
      invulnerabilityDuration: 5,
      stompBounceVelocity: 11,
      ...options,
    });
  }
}
