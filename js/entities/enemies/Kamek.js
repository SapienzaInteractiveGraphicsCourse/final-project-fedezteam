import Boss from "./Boss.js";

/**
 * Kamek.js — first boss (kamek_zone.json / ObstacleZone.js / main.js).
 * Fast, small-hitbox, defeated after 3 stomps. kamek.glb has no skeleton,
 * so his "casts a magic orb" telegraph is a scale-pulse + float-and-spin
 * flourish on top of Boss.js's charge-then-fire attack.
 */
export default class Kamek extends Boss {
  // `scene` is required by Boss so magic orbs can be added/removed on it.
  constructor(mesh, physicsEngine, scene, options = {}) {
    super(mesh, physicsEngine, scene, {
      detectionRange: 14,
      chaseSpeed: 7,
      radius: 0.3,
      targetHeight: 2.2,
      hitsToDefeat: 3,
      invulnerabilityDuration: 2,
      stompBounceVelocity: 11,
      // Casts from further away than Bowser, with a shorter charge.
      attackRange: 14,
      attackCooldown: 3,
      chargeTime: 0.9,
      projectileSpeed: 16,
      ...options,
    });
  }

  // Violet/white magic orb instead of Boss' default fire palette.
  _getProjectileColors() {
    return { outer: 0x9b30ff, inner: 0xffffff };
  }

  // Raised-scepter height instead of Boss' generic head-height default.
  _getProjectileSpawnPoint() {
    const point = super._getProjectileSpawnPoint();
    point.y = this.mesh.position.y + this.targetHeight * 1.05;
    return point;
  }

  // Adds a float-and-spin on top of Boss' scale pulse — reads as
  // "gathering magic". Applied fresh each frame, so nothing to reset.
  _playChargeTelegraph(fractionRemaining) {
    super._playChargeTelegraph(fractionRemaining);
    const progress = 1 - Math.max(0, Math.min(1, fractionRemaining));
    this.mesh.position.y += progress * 0.8;
    this.mesh.rotation.y += progress * 0.4;
  }
}
