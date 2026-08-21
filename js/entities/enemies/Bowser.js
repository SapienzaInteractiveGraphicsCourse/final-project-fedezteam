import Boss from "./Boss.js";

/**
 * Bowser.js — the final boss, waiting at the end of the Bowser obstacle
 * course (see bowser_zone.json / ObstacleZone.js / main.js).
 *
 * Bigger, tougher and slower than Kamek: more hits to defeat and a longer
 * invulnerability window between them make the fight take longer, while the
 * lower chase speed and larger radius/targetHeight read as a heavy,
 * lumbering opponent rather than a fast one. Chase/stomp/multi-hit logic
 * comes from Enemy (via Boss); the charge-then-fire ranged attack comes
 * from Boss.js. bowser.glb has no skeleton, so "charges up and spits a
 * fireball" is Boss' default scale-pulse telegraph (reads as Bowser
 * visibly puffing up before spitting) plus a fireball projectile spawned
 * roughly at mouth height — this subclass only supplies the boss-specific
 * numbers and the fireball's spawn height.
 */
export default class Bowser extends Boss {
  // Builds Bowser with its boss stats and attack tuning, overridable via
  // `options`. `scene` is required (see Boss.js) so ranged fireballs can be
  // added to/removed from it independently of Bowser's own mesh.
  constructor(mesh, physicsEngine, scene, options = {}) {
    super(mesh, physicsEngine, scene, {
      detectionRange: 16,
      chaseSpeed: 3,
      radius: 1,
      targetHeight: 3.4,
      hitsToDefeat: 5,
      invulnerabilityDuration: 2,
      stompBounceVelocity: 13,
      // Ranged attack tuning: slightly shorter range than detection (so
      // Bowser closes in a bit before breathing fire) and a longer charge
      // than Kamek's, matching his heavier, more telegraphed style.
      attackRange: 13,
      attackCooldown: 4,
      chargeTime: 1.3,
      projectileSpeed: 12,
      ...options,
    });
  }

  // Roughly mouth height instead of Boss' generic head-height default.
  _getProjectileSpawnPoint() {
    const point = super._getProjectileSpawnPoint();
    point.y = this.mesh.position.y + this.targetHeight * 0.78;
    return point;
  }
}
