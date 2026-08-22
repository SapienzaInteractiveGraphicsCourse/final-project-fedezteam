import * as THREE from "three";
import Enemy from "./Enemy.js";
import Projectile from "./Projectile.js";

/**
 * Boss.js — shared base class for the two ranged bosses (Bowser, Kamek),
 * extending Enemy with a charge-then-fire ranged attack on top of the
 * existing chase/stomp/multi-hit logic, which is left completely untouched
 * here (see Enemy.js — this class never overrides update()'s inherited
 * behavior, only adds to it).
 *
 * The "charge" telegraph is a whole-mesh transform tween rather than a
 * skeletal animation — see _updateAttack. That was originally because
 * neither boss model had a skeleton at all; Bowser has since been re-
 * exported with a Mixamo rig (Enemy.spawn now gives him a real walk cycle,
 * see AnimationController), but the tween is kept because it's what still
 * works for Kamek, who has no bones. Subclasses (Bowser.js/Kamek.js) only
 * supply their own charge visual and where the projectile spawns from and
 * how it looks; the state machine (cooldown -> charge -> fire) and the
 * projectile lifecycle (spawn, fly, hit/expire, cleanup) live here once.
 */
export default class Boss extends Enemy {
  // `scene` is needed here (unlike the plain Enemy base) because a boss
  // owns extra meshes of its own — the in-flight projectiles — that have
  // to be added/removed independently of the boss' own mesh, which
  // EntityManager.addEntity already handles.
  constructor(mesh, physicsEngine, scene, options = {}) {
    super(mesh, physicsEngine, options);
    this.scene = scene;

    this.attackRange = options.attackRange ?? this.detectionRange;
    this.attackCooldown = options.attackCooldown ?? 3.5;
    this.chargeTime = options.chargeTime ?? 1.1;
    this.projectileSpeed = options.projectileSpeed ?? 14;
    // How many projectiles one attack fires, and the angle between
    // neighbours in the fan. One straight shot by default (Kamek); Bowser
    // breathes three at once — see Bowser.js.
    this.projectileCount = options.projectileCount ?? 1;
    this.projectileSpread = options.projectileSpread ?? 0;

    // Fired once at the START of each wind-up, alongside onStomped/
    // onDefeated from Enemy — main.js hangs the boss' attack roar on it.
    // Deliberately not at the moment the projectile leaves: the wind-up is
    // the part that's meant to warn the player, and a telegraph nobody can
    // hear is half a telegraph.
    this.onAttack = null;

    this._cooldownTimer = 0;
    this._chargeTimer = 0;
    this._isCharging = false;
    this.projectiles = [];
    // Captured right after spawn() normalizes the mesh's scale from the
    // model's native bounding-box height (see Enemy.spawn) — the charge
    // telegraph pulses relative to THIS, not to a raw scale of 1, since the
    // normalized base scale is almost never 1 itself.
    this._baseScale = 1;
  }

  // Delegates to Enemy.spawn() for the actual placement/normalization/body
  // creation, then records the resulting scale as the charge telegraph's
  // pulse baseline (see _playChargeTelegraph/_resetChargeTelegraph).
  spawn(x, y, z) {
    super.spawn(x, y, z);
    this._baseScale = this.mesh.scale.x || 1;
  }

  // Runs the normal Enemy update (chase/waddle/stomp/defeat) first, then
  // layers the attack state machine and projectile bookkeeping on top.
  // Both no-op once defeated, same guard Enemy.update already uses.
  update(delta, player) {
    super.update(delta, player);
    if (this.isDefeated || !this.body || !this.mesh) return;

    this._updateAttack(delta, player);
    this._updateProjectiles(delta, player);
  }

  // Cooldown -> charge -> fire state machine. While charging, the boss is
  // frozen in place (its chase velocity from Enemy._updateChase, already
  // applied by super.update() above, is zeroed back out here) and
  // _playChargeTelegraph runs so the attack reads as "winding up" instead
  // of firing with no warning.
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

  // Builds and launches a Projectile toward the player's current position,
  // using this boss' own _getProjectileSpawnPoint/_getProjectileColors
  // (overridden by Bowser.js/Kamek.js) for where it comes from and how it
  // looks. A hit is reported through the same onDamagePlayer callback used
  // for melee contact (see Enemy._onPlayerContact), so whoever spawned this
  // boss (main.js) doesn't need any extra wiring for ranged damage.
  _fireProjectile(player) {
    const spawnPoint = this._getProjectileSpawnPoint();
    const colors = this._getProjectileColors();

    const count = Math.max(1, this.projectileCount);
    const target = player.mesh.position;

    // The aim line, kept flat: the fan is rotated about the vertical axis
    // so every projectile in a volley travels at the same height as the
    // single straight shot would have.
    const aimX = target.x - spawnPoint.x;
    const aimZ = target.z - spawnPoint.z;

    for (let i = 0; i < count; i++) {
      // Symmetrical around the aim line, so an odd count always keeps one
      // shot pointed straight at the player and an even one straddles them.
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

  // Advances every in-flight projectile, resolves player hits (via the
  // shared onDamagePlayer callback) and lifetime expiry, and disposes/
  // removes anything no longer active. Runs even while the boss itself is
  // between attacks, so a slow-traveling projectile keeps flying correctly.
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

  // Default charge telegraph: a gentle scale pulse around _baseScale,
  // growing as the charge completes (fractionRemaining goes 1 -> 0).
  // Subclasses can override for a more character-specific tell (see
  // Bowser.js/Kamek.js) — if they do, they should override
  // _resetChargeTelegraph too, to restore whatever they perturbed.
  _playChargeTelegraph(fractionRemaining) {
    const progress = 1 - Math.max(0, Math.min(1, fractionRemaining));
    const pulse = 1 + progress * 0.15;
    this.mesh.scale.setScalar(this._baseScale * pulse);
  }

  // Restores the mesh to its normalized resting scale once a charge ends
  // (fired or interrupted by defeat). See the override note above.
  _resetChargeTelegraph() {
    this.mesh.scale.setScalar(this._baseScale);
  }

  // Where a projectile should visually originate from — roughly head
  // height, one radius in front of the boss along its current facing.
  // Subclasses can override for a more precise "mouth"/"scepter" offset.
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

  // Fireball-orange by default; Kamek.js overrides with a violet palette.
  _getProjectileColors() {
    return { outer: 0xff4400, inner: 0xffd23f };
  }

  // Drops every in-flight projectile immediately on defeat, so nothing
  // keeps flying toward the player after the fight is already won.
  _defeat() {
    for (const projectile of this.projectiles) {
      projectile.dispose();
    }
    this.projectiles = [];
    super._defeat();
  }
}
