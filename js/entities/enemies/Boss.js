import * as THREE from "three";
import Enemy from "./Enemy.js";
import Projectile from "./Projectile.js";

/**
 * Boss.js — shared base for the two ranged bosses (Bowser, Kamek): adds a
 * charge-then-fire ranged attack on top of Enemy's chase/stomp/multi-hit
 * logic. The charge telegraph is a whole-mesh tween (Kamek has no skeleton).
 * Subclasses only supply their charge visual, spawn point and projectile look.
 */
export default class Boss extends Enemy {
  // `scene` is needed here (unlike plain Enemy) so in-flight projectiles
  // can be added/removed independently of the boss' own mesh.
  constructor(mesh, physicsEngine, scene, options = {}) {
    super(mesh, physicsEngine, options);
    this.scene = scene;

    this.attackRange = options.attackRange ?? this.detectionRange;
    this.attackCooldown = options.attackCooldown ?? 3.5;
    this.chargeTime = options.chargeTime ?? 1.1;
    this.projectileSpeed = options.projectileSpeed ?? 14;
    // Shot count + fan angle between them. One straight shot by default
    // (Kamek); Bowser breathes three at once (see Bowser.js).
    this.projectileCount = options.projectileCount ?? 1;
    this.projectileSpread = options.projectileSpread ?? 0;

    // Fired at the START of each wind-up (main.js hangs the attack roar on
    // it), not when the shot fires — the wind-up is what warns the player.
    this.onAttack = null;

    this._cooldownTimer = 0;
    this._chargeTimer = 0;
    this._isCharging = false;
    this.projectiles = [];
    // Set after spawn() normalizes the mesh scale — the charge pulse is
    // relative to this, not a raw scale of 1.
    this._baseScale = 1;
  }

  // Delegates to Enemy.spawn(), then records the resulting scale as the
  // charge telegraph's pulse baseline.
  spawn(x, y, z) {
    super.spawn(x, y, z);
    this._baseScale = this.mesh.scale.x || 1;
  }

  // Runs the normal Enemy update first, then the attack state machine and
  // projectile bookkeeping. Both no-op once defeated.
  update(delta, player) {
    super.update(delta, player);
    if (this.isDefeated || !this.body || !this.mesh) return;

    this._updateAttack(delta, player);
    this._updateProjectiles(delta, player);
  }

  // Cooldown -> charge -> fire. While charging, the chase velocity Enemy
  // already applied is zeroed back out, and _playChargeTelegraph runs.
  _updateAttack(delta, player) {
    if (!player || !player.mesh) return;

    if (this._cooldownTimer > 0) this._cooldownTimer -= delta;

    if (this._isCharging) {
      this.body.velocity.x = 0;
      this.body.velocity.z = 0;
      this._chargeTimer -= delta;
      this._playChargeTelegraph(this._chargeTimer / this.chargeTime);

      if (this._chargeTimer <= 0) {
        this._isCharging = false;
        this._resetChargeTelegraph();
        this._fireProjectile(player);
        this._cooldownTimer = this.attackCooldown;
      }
      return;
    }

    if (this._cooldownTimer > 0 || !this.isChasing) return;

    const dx = player.mesh.position.x - this.mesh.position.x;
    const dz = player.mesh.position.z - this.mesh.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq <= this.attackRange * this.attackRange) {
      this._isCharging = true;
      this._chargeTimer = this.chargeTime;
      if (this.onAttack) this.onAttack();
    }
  }

  // Launches Projectile(s) toward the player's current position, using this
  // boss' spawn point/colors. Hits report through the melee onDamagePlayer.
  _fireProjectile(player) {
    const spawnPoint = this._getProjectileSpawnPoint();
    const colors = this._getProjectileColors();

    const count = Math.max(1, this.projectileCount);
    const target = player.mesh.position;

    // Kept flat: the fan rotates about the vertical axis so every shot
    // travels at the same height a single straight shot would have.
    const aimX = target.x - spawnPoint.x;
    const aimZ = target.z - spawnPoint.z;

    for (let i = 0; i < count; i++) {
      // Symmetrical around the aim line: odd counts always have one shot
      // pointed straight at the player, even counts straddle them.
      const angle = (i - (count - 1) / 2) * this.projectileSpread;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      this.projectiles.push(
        new Projectile(this.scene, {
          from: spawnPoint,
          to: {
            x: spawnPoint.x + aimX * cos - aimZ * sin,
            y: target.y,
            z: spawnPoint.z + aimX * sin + aimZ * cos,
          },
          speed: this.projectileSpeed,
          colorOuter: colors.outer,
          colorInner: colors.inner,
        }),
      );
    }
  }

  // Advances every in-flight projectile and resolves hits/expiry. Runs
  // even between attacks, so a slow projectile keeps flying correctly.
  _updateProjectiles(delta, player) {
    if (this.projectiles.length === 0) return;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      projectile.update(delta);

      if (projectile.checkHit(player)) {
        if (this.onDamagePlayer) this.onDamagePlayer(player);
        projectile.dispose();
        this.projectiles.splice(i, 1);
      } else if (projectile.isExpired) {
        projectile.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  // Default telegraph: a gentle scale pulse around _baseScale. Subclasses
  // overriding this should also override _resetChargeTelegraph.
  _playChargeTelegraph(fractionRemaining) {
    const progress = 1 - Math.max(0, Math.min(1, fractionRemaining));
    const pulse = 1 + progress * 0.15;
    this.mesh.scale.setScalar(this._baseScale * pulse);
  }

  // Restores the mesh to its normalized resting scale once charging ends.
  _resetChargeTelegraph() {
    this.mesh.scale.setScalar(this._baseScale);
  }

  // Roughly head height, one radius ahead along facing. Subclasses can
  // override for a precise mouth/scepter offset.
  _getProjectileSpawnPoint() {
    const forward = new THREE.Vector3(
      Math.sin(this.mesh.rotation.y),
      0,
      Math.cos(this.mesh.rotation.y),
    );
    const height = this.targetHeight ? this.targetHeight * 0.7 : this.radius * 2;
    return {
      x: this.mesh.position.x + forward.x * this.radius,
      y: this.mesh.position.y + height,
      z: this.mesh.position.z + forward.z * this.radius,
    };
  }

  // Fireball-orange by default; Kamek.js overrides with violet.
  _getProjectileColors() {
    return { outer: 0xff4400, inner: 0xffd23f };
  }

  // Drops every in-flight projectile immediately on defeat.
  _defeat() {
    for (const projectile of this.projectiles) {
      projectile.dispose();
    }
    this.projectiles = [];
    super._defeat();
  }
}
