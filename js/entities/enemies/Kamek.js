import Boss from "./Boss.js";

/**
 * Kamek.js — the first boss, waiting at the end of the Kamek obstacle
 * course (see kamek_zone.json / ObstacleZone.js / main.js).
 *
 * Fast and small-hitbox compared to a regular enemy, defeated after 3
 * stomps with a 5s invulnerability window after each hit so the fight can't
 * be finished in one jump combo. Chase/stomp/multi-hit logic comes from
 * Enemy (via Boss); the charge-then-fire ranged attack comes from Boss.js.
 * kamek.glb has no skeleton, so "raises his scepter and casts a magic orb"
 * is Boss' scale-pulse telegraph plus a float-and-spin flourish layered on
 * top (see _playChargeTelegraph below), and a violet magic orb spawned
 * roughly at raised-scepter height instead of Boss' fireball palette.
 */
export default class Kamek extends Boss {
  // Builds Kamek with its boss stats and attack tuning, overridable via
  // `options`. `scene` is required (see Boss.js) so magic orbs can be
  // added to/removed from it independently of Kamek's own mesh.
  constructor(mesh, physicsEngine, scene, options = {}) {
    super(mesh, physicsEngine, scene, {
      detectionRange: 14,
      chaseSpeed: 7,
      radius: 0.3,
      targetHeight: 2.2,
      hitsToDefeat: 3,
      invulnerabilityDuration: 5,
      stompBounceVelocity: 11,
      // Ranged attack tuning: full detection range (Kamek casts from
      // further away than Bowser bothers to) and a shorter charge, matching
      // his faster, flightier style.
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

  // Roughly raised-scepter height instead of Boss' generic head-height
  // default — noticeably above the model itself, as if the orb forms at
  // the tip of a scepter held overhead.
  _getProjectileSpawnPoint() {
    const point = super._getProjectileSpawnPoint();
    point.y = this.mesh.position.y + this.targetHeight * 1.05;
    return point;
  }

  // On top of Boss' default scale pulse (kept via the super call), Kamek
  // floats upward and gains a little extra spin while channeling — reads
  // as "gathering magic" rather than Bowser's "physically puffing up".
  // No matching override of _resetChargeTelegraph is needed: the position
  // offset here is applied fresh on top of Enemy.update()'s per-frame
  // body-to-mesh position sync (see Boss.update), so it never accumulates
  // and needs nothing to undo once charging stops.
  _playChargeTelegraph(fractionRemaining) {
    super._playChargeTelegraph(fractionRemaining);
    const progress = 1 - Math.max(0, Math.min(1, fractionRemaining));
    this.mesh.position.y += progress * 0.8;
    this.mesh.rotation.y += progress * 0.4;
  }
}
