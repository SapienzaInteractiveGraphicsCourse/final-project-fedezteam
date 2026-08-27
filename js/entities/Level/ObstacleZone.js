import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import BossArena from "./BossArena.js";
import { assetUrl } from "../../core/Assets/basePath.js";

/**
 * ObstacleZone.js — a self-contained bonus zone far from the main island:
 * stepping-stone platforms with gaps, lava hazards, and a circular boss
 * arena at the end (BossArena.js). Generic — loads both kamek_zone.json
 * and bowser_zone.json. Reached via warp star, not a real level switch.
 * Lava is a separate overlap-trigger hazard with no collider.
 */
export default class ObstacleZone {
  constructor(scene, physicsEngine) {
    this.scene = scene;
    this.physicsEngine = physicsEngine;

    this.entryPoint = null;
    this.bossSpawn = null;
    this.lavaBlocks = []; // { mesh, halfX, halfZ }
    this._lavaCooldown = 0;
    // Shared procedural texture for every lava block in this zone (see
    // _createLavaTexture) — scrolled slowly in update() for a bubbling look.
    this._lavaTexture = null;

    // Horizontal (x/z) bounds covering every platform + the arena, set in
    // load() — used by setVoidFallZones to respawn at this zone's entrance.
    this.bounds = null;

    // Circular footprint of just the arena, used by main.js to show/hide
    // the boss health bar and as the drop point for the post-victory star.
    this.arenaCenter = null; // {x, y, z}
    this.arenaRadius = 0;
  }

  // Fetches a zone JSON and builds its platforms/lava/entry point.
  // Returns the parsed data, or null on fetch/parse failure.
  async load(jsonPath = "./assets/levels/kamek_zone.json") {
    let data;
    try {
      const res = await fetch(assetUrl(jsonPath));
      data = await res.json();
    } catch (e) {
      console.warn(`[ObstacleZone] Failed to load ${jsonPath}:`, e);
      return null;
    }

    this.entryPoint = data.entryPoint || { x: 260, y: 9, z: 260 };
    // "bossSpawn" is the generic field name; older files may still use
    // "kamekSpawn" — accept either.
    this.bossSpawn = data.bossSpawn || data.kamekSpawn || null;

    // Accumulates the footprint of everything built below into
    // this.bounds, rather than hardcoding coordinates here.
    const boundsAcc = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    const expandBounds = (x, z, half) => {
      boundsAcc.minX = Math.min(boundsAcc.minX, x - half);
      boundsAcc.maxX = Math.max(boundsAcc.maxX, x + half);
      boundsAcc.minZ = Math.min(boundsAcc.minZ, z - half);
      boundsAcc.maxZ = Math.max(boundsAcc.maxZ, z + half);
    };
    if (this.entryPoint) expandBounds(this.entryPoint.x, this.entryPoint.z, 4);

    const world = this.physicsEngine?.world || this.physicsEngine;

    const platformMaterial = new THREE.MeshStandardMaterial({
      color: 0x7a5230,
      roughness: 0.85,
      metalness: 0.05,
    });

    for (const p of data.platforms || []) {
      const size = p.size || { x: 5, y: 1, z: 5 };
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        platformMaterial,
      );
      mesh.position.set(p.x, p.y, p.z);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scene.add(mesh);
      expandBounds(p.x, p.z, Math.max(size.x, size.z) / 2);

      if (world) {
        const body = new CANNON.Body({
          mass: 0,
          shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
          position: new CANNON.Vec3(p.x, p.y, p.z),
          material: this.physicsEngine?.defaultMaterial,
        });
        world.addBody(body);
      }
    }

    this._lavaTexture = this._createLavaTexture();
    // Fixed tiling shared by every block in this zone (they're all a
    // similar ~2-3 unit size) — one repeat setting keeps the crack/vein
    // pattern at a consistent scale without needing a texture per block.
    this._lavaTexture.repeat.set(2, 2);

    const lavaMaterial = new THREE.MeshStandardMaterial({
      map: this._lavaTexture,
      emissiveMap: this._lavaTexture,
      emissive: 0xff3300,
      emissiveIntensity: 1.3,
      roughness: 0.35,
    });

    for (const l of data.lavaBlocks || []) {
      const size = l.size || { x: 3, y: 0.2, z: 3 };
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        lavaMaterial,
      );
      mesh.position.set(l.x, l.y, l.z);
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      this.scene.add(mesh);

      // No physics body: lava is a trigger hazard, not a solid wall.
      this.lavaBlocks.push({ mesh, halfX: size.x / 2, halfZ: size.z / 2 });
    }

    // Optional: older zone files without an "arena" field still load
    // fine with just their stepping-stone platforms.
    if (data.arena) {
      const arena = new BossArena(this.scene, this.physicsEngine);
      await arena.build(data.arena);
      expandBounds(data.arena.x, data.arena.z, data.arena.radius);
      this.arenaCenter = { x: data.arena.x, y: data.arena.y, z: data.arena.z };
      this.arenaRadius = data.arena.radius;
    }

    // Padded well past a single jump, so falling just past an edge or the
    // arena's fire poles still counts as "inside this zone".
    const ZONE_BOUNDS_MARGIN = 6;
    if (boundsAcc.minX !== Infinity) {
      this.bounds = {
        minX: boundsAcc.minX - ZONE_BOUNDS_MARGIN,
        maxX: boundsAcc.maxX + ZONE_BOUNDS_MARGIN,
        minZ: boundsAcc.minZ - ZONE_BOUNDS_MARGIN,
        maxZ: boundsAcc.maxZ + ZONE_BOUNDS_MARGIN,
      };
    }

    return data;
  }

  // Draws a cracked-rock pattern with glowing magma veins onto a canvas —
  // same in-code procedural approach as Decorations' water/cloud textures,
  // so the lava hazard doesn't depend on an external image asset.
  _createLavaTexture() {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#1a0800";
    ctx.fillRect(0, 0, size, size);

    // Glowing veins: soft orange/yellow radial blobs, like magma showing
    // through cracked rock.
    for (let i = 0; i < 16; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 8 + Math.random() * 20;

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, "#fff2b0");
      gradient.addColorStop(0.35, "#ff9a1f");
      gradient.addColorStop(1, "rgba(255,60,0,0)");

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Thin bright crack lines threading between the veins.
    ctx.strokeStyle = "rgba(255,180,60,0.6)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * size, Math.random() * size);
      ctx.lineTo(Math.random() * size, Math.random() * size);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  // Horizontal-only (x/z) containment check against load()'s bounds —
  // used by EntityManager's void-fall respawn.
  containsPoint(pos) {
    if (!this.bounds || !pos) return false;
    return (
      pos.x >= this.bounds.minX &&
      pos.x <= this.bounds.maxX &&
      pos.z >= this.bounds.minZ &&
      pos.z <= this.bounds.maxZ
    );
  }

  // True once the player is within the arena's circular footprint (plus
  // a small margin) — narrower than containsPoint(), which also covers the approach.
  isPlayerInArena(pos) {
    if (!this.arenaCenter || !pos) return false;
    const dx = pos.x - this.arenaCenter.x;
    const dz = pos.z - this.arenaCenter.z;
    const margin = 2;
    const r = this.arenaRadius + margin;
    return dx * dx + dz * dz <= r * r;
  }

  // Costs a life via onLavaHit if the player's feet are over a lava patch
  // and not already on cooldown. Never touches player.body/mesh directly.
  update(delta, player, onLavaHit) {
    if (this._lavaCooldown > 0) this._lavaCooldown -= delta;

    // Gentle flow for the shared lava texture, purely decorative.
    if (this._lavaTexture) {
      this._lavaTexture.offset.x += 0.012 * delta;
      this._lavaTexture.offset.y += 0.007 * delta;
    }

    if (!player || !player.mesh || this.lavaBlocks.length === 0) return;

    const pos = player.mesh.position;

    for (const lava of this.lavaBlocks) {
      const dx = Math.abs(pos.x - lava.mesh.position.x);
      const dz = Math.abs(pos.z - lava.mesh.position.z);
      const dy = pos.y - lava.mesh.position.y;

      // Within footprint and roughly at height (not passing far overhead).
      if (dx <= lava.halfX && dz <= lava.halfZ && dy > -1.5 && dy < 2) {
        if (this._lavaCooldown <= 0) {
          this._lavaCooldown = 1.5;
          if (onLavaHit) onLavaHit();
        }
        break;
      }
    }
  }
}
