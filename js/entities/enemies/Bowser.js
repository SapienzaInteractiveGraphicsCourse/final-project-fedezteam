import Boss from "./Boss.js";

/**
 * Bowser.js — final boss (bowser_zone.json / ObstacleZone.js / main.js).
 * Tougher and slower than Kamek. bowser.glb carries a real Mixamo
 * skeleton, so he gets a real wind-up pose and the same procedural walk
 * cycle the player characters use, instead of Kamek's scale-pulse/T-pose.
 */
export default class Bowser extends Boss {
  // `scene` is required by Boss so fireballs can be added/removed on it.
  constructor(mesh, physicsEngine, scene, options = {}) {
    super(mesh, physicsEngine, scene, {
      detectionRange: 16,
      chaseSpeed: 3,
      radius: 1,
      targetHeight: 3.4,
      hitsToDefeat: 5,
      invulnerabilityDuration: 2,
      stompBounceVelocity: 13,
      // Shorter range than detection (closes in before breathing fire),
      // longer charge than Kamek's — heavier, more telegraphed style.
      attackRange: 13,
      attackCooldown: 4,
      chargeTime: 1.3,
      projectileSpeed: 12,
      // Three fireballs in a fan instead of Kamek's single orb — must be
      // positioned around, not just dodged. 0.22 rad spacing leaves a gap.
      projectileCount: 3,
      projectileSpread: 0.22,
      ...options,
    });
  }

  // Real skeletal wind-up (clipFactory's buildCharge) instead of Boss'
  // default scale pulse. Locking is idempotent, safe every charge frame.
  _playChargeTelegraph(fractionRemaining) {
    if (this.animation && this.animation.enabled) {
      this.animation.lock("charge");
      return;
    }
    // No usable skeleton: fall back to the inherited scale pulse.
    super._playChargeTelegraph(fractionRemaining);
  }

  // Hands the state back to the walk/idle machine once the fire is out.
  _resetChargeTelegraph() {
    if (this.animation && this.animation.enabled) {
      this.animation.unlock();
      return;
    }
    super._resetChargeTelegraph();
  }

  // Roughly mouth height instead of Boss' generic head-height default.
  _getProjectileSpawnPoint() {
    const point = super._getProjectileSpawnPoint();
    point.y = this.mesh.position.y + this.targetHeight * 0.78;
    return point;
  }
}
