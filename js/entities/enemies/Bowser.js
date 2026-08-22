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
 * from Boss.js. What this subclass adds on top is what makes his fight
 * read differently from Kamek's: a real skeletal wind-up pose instead of
 * the inherited scale pulse (see _playChargeTelegraph), three fireballs in
 * a fan instead of one orb, and a spawn point down at mouth height.
 *
 * Walking is NOT part of that: bowser.glb carries a Mixamo skeleton (see
 * tools/fix_character_export.py for how it was put back together), so
 * Enemy.spawn hands him the same procedural walk cycle the player
 * characters use, and he chases on his own two feet instead of sliding
 * along in a T-pose.
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
      // Three at once instead of Kamek's single orb: what makes the two
      // fights feel different is that Kamek's shot has to be dodged and
      // Bowser's has to be positioned around. 0.22 rad between neighbours
      // opens the fan to about 3 units of gap by the time it reaches the
      // far end of attackRange — wide enough to slip between, narrow
      // enough that standing still never works.
      projectileCount: 3,
      projectileSpread: 0.22,
      ...options,
    });
  }

  /**
   * The wind-up, as a real pose: Bowser rocks back, lifts his chin, sweeps
   * his arms behind him and braces his knees — someone taking an enormous
   * breath in. It replaces Boss' default scale pulse, which only existed
   * because this model used to have no skeleton at all.
   *
   * The pose is a clip like any other (clipFactory's buildCharge), held on
   * screen by locking the controller: while charging he is standing
   * perfectly still, and left to itself the state machine would quite
   * reasonably call that "idle". Locking is idempotent, so calling it on
   * every frame of the charge costs nothing.
   */
  _playChargeTelegraph(fractionRemaining) {
    if (this.animation && this.animation.enabled) {
      this.animation.lock("charge");
      return;
    }
    // No usable skeleton (a model swapped back out, say): fall back to the
    // inherited scale pulse rather than telegraphing nothing at all.
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
