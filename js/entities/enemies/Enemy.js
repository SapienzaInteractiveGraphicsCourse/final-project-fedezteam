import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { enableShadows } from "../../utils/shadows.js";

/**
 * Enemy.js — shared base class for every enemy in the game (Goomba, Kamek,
 * Bowser, and any future addition).
 *
 * Follows the same spawn()/update() shape as Player.js/Yoshi.js: a dynamic
 * spherical cannon-es body (so gravity and terrain collision work exactly
 * like the player), synced to a visual mesh each frame.
 *
 * On top of that, it owns:
 *  - A simple "idle until the player is within detectionRange, then chase"
 *    AI (straight-line seek, no pathfinding).
 *  - A generic multi-hit defeat system: hitsToDefeat + invulnerabilityDuration.
 *    A one-hit enemy (Goomba) just uses the defaults; a boss (Kamek, Bowser)
 *    sets a higher hitsToDefeat and a cooldown between hits, without needing
 *    any extra code — see Goomba.js / Kamek.js / Bowser.js.
 *  - Classic Mario stomp rule for player contact: landing on top of the
 *    enemy while falling defeats/damages it and bounces the player; any
 *    other contact damages the player instead (via the onDamagePlayer
 *    callback, wired up by whoever spawns the enemy — see main.js).
 *
 * Deliberately never touches Player.js: it only reads player.mesh/player.body
 * and, on a stomp/hit, nudges player.body.velocity.y for the bounce — the
 * same "poke the body directly" pattern EntityManager already uses for the
 * void-fall respawn.
 */
export default class Enemy {
  // Reads every tunable stat from `options` (falling back to plain-enemy
  // defaults), and sets up the bookkeeping state (chase/defeat/cooldown
  // flags) shared by every subclass. Does not create the physics body or
  // add anything to the scene yet — see spawn() for that.
  constructor(mesh, physicsEngine, options = {}) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;

    this.detectionRange = options.detectionRange ?? 9;
    this.chaseSpeed = options.chaseSpeed ?? 2.5;
    this.radius = options.radius ?? 0.7;
    // If set, spawn() rescales the mesh so its bounding-box height matches
    // this value exactly, regardless of the source GLB's native scale (the
    // same normalization trick used for the palm tree colliders). Leave
    // null to keep the model's original scale untouched.
    this.targetHeight = options.targetHeight ?? null;

    // Chase has hysteresis: once the player is noticed (inside
    // detectionRange), the enemy keeps chasing until the player gets to
    // 2x that range, not just outside the original range. Makes "shake it
    // off" feel deliberate instead of the enemy stopping the instant you
    // take one step back.
    this.isChasing = false;

    // Multi-hit defeat system. A simple enemy (Goomba) just leaves these at
    // the 1-hit/no-invulnerability defaults; a boss overrides both.
    this.hitsToDefeat = options.hitsToDefeat ?? 1;
    this.invulnerabilityDuration = options.invulnerabilityDuration ?? 0;
    this.stompBounceVelocity = options.stompBounceVelocity ?? 10;

    this.hitsTaken = 0;
    this.invulnerableTimer = 0;
    this.isDefeated = false;

    // Brief cooldown after damaging the player, so standing in continuous
    // side-contact doesn't strip multiple lives in a single second.
    this.playerHitCooldown = 0;

    this.body = null;
    this._waddlePhase = Math.random() * Math.PI * 2; // desync multiple enemies

    // Optional callbacks, set by whoever spawns this enemy (see main.js):
    //   onDamagePlayer(player) — called once per side-contact hit.
    //   onStomped(hitsTaken, hitsToDefeat) — called on every successful stomp.
    //   onDefeated() — called once, when hitsTaken reaches hitsToDefeat.
    this.onDamagePlayer = null;
    this.onStomped = null;
    this.onDefeated = null;
  }

  // Places the enemy in the world: normalizes its visual scale (if
  // targetHeight is set), positions the mesh, and creates+registers its
  // dynamic physics body.
  spawn(x, y, z) {
    if (!this.mesh) return;

    // Normalize visual scale from the model's real bounding-box height
    // instead of guessing a raw scale multiplier — different enemy GLBs
    // can have wildly different native scales (a Goomba spawned at scale 1
    // came out towering over the player), so this makes every enemy come
    // out at a predictable, comparable size.
    if (this.targetHeight) {
      this.mesh.scale.set(1, 1, 1);
      this.mesh.position.set(0, 0, 0);
      this.mesh.updateMatrixWorld(true);

      const bbox = new THREE.Box3().setFromObject(this.mesh);
      const nativeHeight = bbox.isEmpty() ? 0 : bbox.max.y - bbox.min.y;
      if (nativeHeight > 0.001) {
        this.mesh.scale.setScalar(this.targetHeight / nativeHeight);
      }
    }

    this.mesh.position.set(x, y, z);
    enableShadows(this.mesh);

    const shape = new CANNON.Sphere(this.radius);

    // Same "raise the sphere center by radius" trick as Player/Yoshi, so
    // the model's origin (feet, y=0) touches the ground.
    this.body = new CANNON.Body({
      mass: 3,
      position: new CANNON.Vec3(x, y + this.radius, z),
      shape,
      material: this.physicsEngine?.defaultMaterial,
      fixedRotation: true,
    });

    if (this.physicsEngine && this.physicsEngine.world) {
      this.physicsEngine.world.addBody(this.body);
    }
  }

  // Per-frame tick: ticks timers, runs the chase AI, syncs the mesh to the
  // physics body, plays the idle waddle, and checks for player contact.
  // No-ops once the enemy is defeated or before spawn() has run.
  update(delta, player) {
    if (this.isDefeated || !this.body || !this.mesh) return;

    if (this.invulnerableTimer > 0) this.invulnerableTimer -= delta;
    if (this.playerHitCooldown > 0) this.playerHitCooldown -= delta;

    if (player && player.mesh) {
      this._updateChase(delta, player);
    }

    // Sync the visual mesh to the physics body (same offset as Player/Yoshi).
    this.mesh.position.set(
      this.body.position.x,
      this.body.position.y - this.radius,
      this.body.position.z,
    );

    this._updateWaddle(delta);

    if (player && player.mesh) {
      this._checkPlayerContact(player);
    }
  }

  // Straight-line "seek" toward the player once noticed; otherwise lets
  // horizontal velocity bleed off so the enemy settles back to a stop.
  // See the isChasing hysteresis note in the constructor: entering range
  // starts the chase, but escaping it takes getting to 2x that range.
  _updateChase(delta, player) {
    const dx = player.mesh.position.x - this.body.position.x;
    const dz = player.mesh.position.z - this.body.position.z;
    const distSq = dx * dx + dz * dz;

    const noticeRangeSq = this.detectionRange * this.detectionRange;
    const giveUpRange = this.detectionRange * 2;
    const giveUpRangeSq = giveUpRange * giveUpRange;

    if (!this.isChasing && distSq <= noticeRangeSq) {
      this.isChasing = true;
    } else if (this.isChasing && distSq > giveUpRangeSq) {
      this.isChasing = false;
    }

    if (this.isChasing) {
      const dist = Math.sqrt(distSq) || 1;
      this.body.velocity.x = (dx / dist) * this.chaseSpeed;
      this.body.velocity.z = (dz / dist) * this.chaseSpeed;

      // Face the player while chasing.
      this.mesh.rotation.y = Math.atan2(dx, dz);
    } else {
      this.body.velocity.x *= 0.9;
      this.body.velocity.z *= 0.9;
    }
  }

  // Small procedural "waddle" — a sine-based tilt, no skeleton — so an idle
  // enemy still reads as alive. Deliberately stays out of the character
  // skeletal-animation system.
  _updateWaddle(delta) {
    this._waddlePhase += delta * 6;
    this.mesh.rotation.z = Math.sin(this._waddlePhase) * 0.15;
  }

  // Distinguishes a stomp (player falling, above the enemy) from a
  // side/other contact (damages the player instead), and dispatches to
  // the matching handler. No-ops if the player is out of contact range.
  _checkPlayerContact(player) {
    const dx = player.mesh.position.x - this.mesh.position.x;
    const dz = player.mesh.position.z - this.mesh.position.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);

    const contactRange = this.radius + (player.radius || 1);
    if (horizontalDist > contactRange) return;

    const verticalDiff = player.mesh.position.y - this.mesh.position.y;
    const isFalling = player.body && player.body.velocity.y < 0;
    const isAbove = verticalDiff > this.radius * 0.3;

    if (isFalling && isAbove) {
      this._onStomped(player);
    } else if (this.invulnerableTimer <= 0 && this.playerHitCooldown <= 0) {
      this._onPlayerContact(player);
    }
  }

  // Handles a successful stomp: bounces the player, counts the hit, and
  // either defeats the enemy (hitsTaken reached hitsToDefeat) or grants a
  // brief invulnerability window before it can be stomped again.
  _onStomped(player) {
    // Bounce the player upward, same "poke the body directly" pattern used
    // elsewhere in the codebase (e.g. the void-fall respawn in
    // EntityManager) — never touches Player.js itself.
    if (player.body) player.body.velocity.y = this.stompBounceVelocity;

    this.hitsTaken++;
    if (this.onStomped) this.onStomped(this.hitsTaken, this.hitsToDefeat);

    if (this.hitsTaken >= this.hitsToDefeat) {
      this._defeat();
    } else {
      // Not defeated yet (boss case): grant a short invulnerability window
      // so the player can't chain-stomp it down in one jump combo.
      this.invulnerableTimer = this.invulnerabilityDuration;
    }
  }

  // Handles a non-stomp contact: starts the hit cooldown and forwards to
  // the onDamagePlayer callback, if one was wired up by the spawner.
  _onPlayerContact(player) {
    this.playerHitCooldown = 1.0;
    if (this.onDamagePlayer) this.onDamagePlayer(player);
  }

  // Removes the enemy from the scene and physics world, marks it defeated
  // (so update() becomes a no-op from here on), and fires onDefeated().
  _defeat() {
    this.isDefeated = true;

    if (this.mesh && this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
    if (this.body && this.physicsEngine && this.physicsEngine.world) {
      this.physicsEngine.world.removeBody(this.body);
    }

    if (this.onDefeated) this.onDefeated();
  }

  // Current world position, or the origin if the enemy hasn't spawned yet.
  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}
