import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { enableShadows } from "../../utils/shadows.js";
import { COLLISION_GROUPS } from "../../physics/PhysicsEngine.js";
import AnimationController from "../animation/AnimationController.js";

/**
 * Enemy.js — shared base for every enemy (Goomba, Kamek, Bowser, ...).
 * Follows Player.js/Yoshi.js's spawn()/update() shape: a dynamic
 * spherical body synced to a mesh. Adds chase AI, a generic multi-hit
 * defeat system, and the classic stomp-vs-side-contact rule. Never
 * touches Player.js beyond reading its mesh/body and nudging velocity.y.
 */
export default class Enemy {
  constructor(mesh, physicsEngine, options = {}) {
    this.mesh = mesh;
    this.physicsEngine = physicsEngine;

    this.detectionRange = options.detectionRange ?? 9;
    this.chaseSpeed = options.chaseSpeed ?? 2.5;
    this.radius = options.radius ?? 0.7;
    // If set, spawn() rescales the mesh to this bounding-box height
    // regardless of the source GLB's native scale.
    this.targetHeight = options.targetHeight ?? null;

    // Hysteresis: once noticed, keeps chasing until the player reaches 2x
    // detectionRange, not just outside the original range.
    this.isChasing = false;

    // Multi-hit defeat: Goomba leaves these at 1-hit/no-invuln defaults;
    // a boss overrides both.
    this.hitsToDefeat = options.hitsToDefeat ?? 1;
    this.invulnerabilityDuration = options.invulnerabilityDuration ?? 0;
    this.stompBounceVelocity = options.stompBounceVelocity ?? 10;

    this.hitsTaken = 0;
    this.invulnerableTimer = 0;
    this.isDefeated = false;

    // Cooldown after damaging the player, so side-contact doesn't strip
    // multiple lives per second.
    this.playerHitCooldown = 0;

    this.body = null;
    this._waddlePhase = Math.random() * Math.PI * 2; // desync multiple enemies

    // Built in spawn() for enemies whose model has a skeleton (Bowser);
    // stays inert for the boneless ones.
    this.animation = null;

    // Optional callbacks set by the spawner (main.js): onDamagePlayer(player),
    // onStomped(hitsTaken, hitsToDefeat), onDefeated().
    this.onDamagePlayer = null;
    this.onStomped = null;
    this.onDefeated = null;
  }

  // Normalizes visual scale (if targetHeight set), positions the mesh,
  // and creates+registers the dynamic physics body.
  spawn(x, y, z) {
    if (!this.mesh) return;

    // Scale from the model's real bounding-box height rather than a guessed
    // multiplier — GLBs vary wildly (a Goomba at scale 1 towered over the player).
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

    // Sphere center raised by `radius` so the model's feet (y=0) touch ground.
    this.body = new CANNON.Body({
      mass: 3,
      position: new CANNON.Vec3(x, y + this.radius, z),
      shape,
      material: this.physicsEngine?.defaultMaterial,
      fixedRotation: true,
    });

    // Excludes the player — all enemy-player interaction goes through
    // _checkPlayerContact; a real physics collision caused a bounce bug.
    this.body.collisionFilterGroup = COLLISION_GROUPS.ENEMY;
    this.body.collisionFilterMask = -1 & ~COLLISION_GROUPS.PLAYER;

    if (this.physicsEngine && this.physicsEngine.world) {
      this.physicsEngine.world.addBody(this.body);
    }

    // Real walk cycle for enemies with a usable skeleton. Built here, not the
    // constructor, since clips need the height normalization above applied.
    this.animation = new AnimationController(this.mesh, {
      // Chasing should read as walking at this enemy's own speed, never
      // the player's flat-out run clip.
      walkSpeed: this.chaseSpeed * 0.5,
      runSpeed: this.chaseSpeed * 10,
    });
  }

  // Per-frame: ticks timers, runs chase AI, syncs mesh to body, plays the
  // idle waddle/walk, checks player contact. No-ops once defeated.
  update(delta, player) {
    if (this.isDefeated || !this.body || !this.mesh) return;

    if (this.invulnerableTimer > 0) this.invulnerableTimer -= delta;
    if (this.playerHitCooldown > 0) this.playerHitCooldown -= delta;

    // Animation reads last frame's velocity (before chase/Boss.attack change
    // it) — one frame of lag beats a walk cycle under a frozen charging boss.
    if (this.animation && this.animation.enabled) {
      // grounded is simply true: enemies walk, never jump.
      this.animation.update(delta, {
        speed: Math.hypot(this.body.velocity.x, this.body.velocity.z),
        verticalVelocity: 0,
        grounded: true,
      });
    } else {
      this._updateWaddle(delta);
    }

    if (player && player.mesh) {
      this._updateChase(delta, player);
    }

    // Sync mesh to body (same offset as Player/Yoshi).
    this.mesh.position.set(
      this.body.position.x,
      this.body.position.y - this.radius,
      this.body.position.z,
    );

    this._updateInvulnerabilityFlicker();

    if (player && player.mesh) {
      this._checkPlayerContact(player);
    }
  }

  // Straight-line seek once noticed; otherwise bleeds off velocity to a
  // stop. See the isChasing hysteresis note in the constructor.
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

      this.mesh.rotation.y = Math.atan2(dx, dz);
    } else {
      this.body.velocity.x *= 0.9;
      this.body.velocity.z *= 0.9;
    }
  }

  // Blinks the mesh while invulnerableTimer counts down (boss only, between
  // stomps). Driven by the timer, so it's frame-rate independent.
  _updateInvulnerabilityFlicker() {
    if (this.invulnerableTimer > 0) {
      const FLICKER_RATE = 10; // on/off toggles per second
      this.mesh.visible = Math.floor(this.invulnerableTimer * FLICKER_RATE) % 2 === 0;
    } else if (!this.mesh.visible) {
      this.mesh.visible = true;
    }
  }

  // Sine-based mesh tilt so a boneless enemy still reads as alive — the
  // fallback half of update()'s branch; a skeletal enemy never tilts.
  _updateWaddle(delta) {
    this._waddlePhase += delta * 6;
    this.mesh.rotation.z = Math.sin(this._waddlePhase) * 0.15;
  }

  // Distinguishes a stomp (player falling, above the enemy) from side
  // contact and dispatches accordingly. No-ops if out of contact range.
  _checkPlayerContact(player) {
    // BUG FIX (fake invulnerability): gated up front now, not per-branch —
    // NOTHING (stomp or side contact) can register while still flickering,
    // instead of relying on each branch below to remember its own check.
    if (this.invulnerableTimer > 0) return;

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
      return;
    }

    // Ground-only (BUG FIX: side-contact used to also fire on a player still
    // airborne en route to a stomp). Mirrors Player's own grounded check.
    const isGrounded = !!(player.canJump && player.body && player.body.velocity.y > -2);
    if (!isGrounded) return;

    if (this.playerHitCooldown <= 0) {
      this._onPlayerContact(player);
    }
  }

  // Bounces the player, counts the hit, and defeats or grants a brief
  // invulnerability window before the enemy can be stomped again.
  _onStomped(player) {
    if (player.body) player.body.velocity.y = this.stompBounceVelocity;
    // BUG FIX (fake invulnerability): the bounce alone left canJump=true,
    // so the very next frame's "isGrounded" side-contact check could read
    // the still-airborne player as grounded. Mirrors Player's own jump.
    if (player) player.canJump = false;

    this.hitsTaken++;
    if (this.onStomped) this.onStomped(this.hitsTaken, this.hitsToDefeat);

    if (this.hitsTaken >= this.hitsToDefeat) {
      this._defeat();
    } else {
      this.invulnerableTimer = this.invulnerabilityDuration;
    }
  }

  // Starts the hit cooldown and forwards to onDamagePlayer, if wired up.
  _onPlayerContact(player) {
    this.playerHitCooldown = 1.0;
    if (this.onDamagePlayer) this.onDamagePlayer(player);
  }

  // Removes the enemy from scene/physics, marks it defeated, fires onDefeated().
  _defeat() {
    this.isDefeated = true;

    if (this.animation) {
      this.animation.dispose();
      this.animation = null;
    }

    if (this.mesh && this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
    if (this.body && this.physicsEngine && this.physicsEngine.world) {
      this.physicsEngine.world.removeBody(this.body);
    }

    if (this.onDefeated) this.onDefeated();
  }

  get position() {
    return this.mesh ? this.mesh.position : new THREE.Vector3();
  }
}
