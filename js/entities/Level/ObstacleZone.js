import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import BossArena from "./BossArena.js";

/**
 * ObstacleZone.js — a small, self-contained bonus zone far from the main
 * island: a short chain of stepping-stone platforms with gaps between them,
 * a couple of lava hazard patches, and a big circular boss arena at the end
 * (built by BossArena.js — see the "arena" field below), where a boss
 * waits (spawned separately in main.js, see bossSpawn).
 *
 * Generic — this same class loads both the Kamek zone
 * (assets/levels/kamek_zone.json) and the Bowser zone
 * (assets/levels/bowser_zone.json, wider platforms with bigger height gaps
 * between them, see that file), same "pure data" spirit as level1.json.
 *
 * Reached via warp star teleport (see Decorations._updateWarpStars /
 * setKamekZoneEntry / setBowserZoneEntry) rather than a real scene/level
 * switch — it's just more of the same physics world, placed somewhere far
 * from the main island so nobody wanders into it by accident.
 *
 * Falling off a platform (or the arena) here is handled entirely by the
 * existing void-fall mechanic (EntityManager.update -> checkVoidFall): same
 * lose-a-life-and-respawn-at-spawn behavior as falling off the main island,
 * no separate logic needed — this is also why the arena's fire poles (see
 * BossArena._buildFirePoles) are purely a visual boundary marker with no
 * collider of their own, rather than an actual wall. Lava is a different,
 * additional hazard: it has no collider (the player can walk straight into
 * it, unlike a wall), so it's checked as a simple overlap trigger every
 * frame instead — see update().
 *
 * The stepping-stone platforms stay deliberately simple geometry (plain
 * boxes, no models to load); the arena itself is textured/circular/lined
 * with fire poles (see BossArena.js) since that's the stage the actual
 * fight happens on.
 */
export default class ObstacleZone {
  // Stores the scene/physics references and resets zone state. Nothing is
  // built yet — call load() to actually populate the zone from a JSON file.
  constructor(scene, physicsEngine) {
    this.scene = scene;
    this.physicsEngine = physicsEngine;

    this.entryPoint = null;
    this.bossSpawn = null;
    this.lavaBlocks = []; // { mesh, halfX, halfZ }
    this._lavaCooldown = 0;

    // Horizontal (x/z) bounding box covering every platform and the arena,
    // computed in load() below — see containsPoint(). Used by
    // EntityManager.setVoidFallZones (wired from main.js) to tell whether a
    // void fall happened inside THIS zone, so it can respawn the player at
    // this zone's own entrance instead of the main island's spawn point.
    // Stays null if load() never ran or the zone had no platforms/arena.
    this.bounds = null;

    // Circular footprint of just the boss arena itself (a subset of
    // `bounds` above, which also covers the approach platforms) — see
    // isPlayerInArena() below, used by main.js to show/hide the boss health
    // bar specifically while the player is on the arena, not the whole
    // course. `y` (arena platform height) is included too so main.js can
    // also use this as the fixed drop point for the post-victory Power
    // Star/Warp Star, instead of wherever the boss happened to die.
    this.arenaCenter = null; // {x, y, z}
    this.arenaRadius = 0;
  }

  // Fetches a zone JSON file and builds its platforms/lava/entry point into
  // the scene and physics world. Returns the parsed data (or null on
  // fetch/parse failure, logged via console.warn).
  async load(jsonPath = "./assets/levels/kamek_zone.json") {
    let data;
    try {
      const res = await fetch(jsonPath);
      data = await res.json();
    } catch (e) {
      console.warn(`[ObstacleZone] Failed to load ${jsonPath}:`, e);
      return null;
    }

    this.entryPoint = data.entryPoint || { x: 260, y: 9, z: 260 };
    // "bossSpawn" is the generic field name (used by bowser_zone.json); older
    // zone files may still use "kamekSpawn" (kamek_zone.json) — accept
    // either so that file doesn't need to be touched.
    this.bossSpawn = data.bossSpawn || data.kamekSpawn || null;

    // Accumulates the horizontal footprint of everything built below, so
    // `this.bounds` (see containsPoint()) ends up covering the whole zone —
    // stepping-stone platforms and the arena alike — without hardcoding any
    // coordinates here that would drift out of sync with the JSON.
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

    const lavaMaterial = new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: 0xff2200,
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

      // No physics body on purpose — see the class doc: lava is a trigger
      // hazard the player should be able to step into, not a solid wall.
      this.lavaBlocks.push({ mesh, halfX: size.x / 2, halfZ: size.z / 2 });
    }

    // The boss arena (round platform + fire poles + center logo) — see
    // BossArena.js. Optional so older/simpler zone files without an
    // "arena" field still load fine with just their stepping-stone
    // platforms.
    if (data.arena) {
      const arena = new BossArena(this.scene, this.physicsEngine);
      await arena.build(data.arena);
      expandBounds(data.arena.x, data.arena.z, data.arena.radius);
      this.arenaCenter = { x: data.arena.x, y: data.arena.y, z: data.arena.z };
      this.arenaRadius = data.arena.radius;
    }

    // Pad the accumulated footprint generously (well past a single jump)
    // so falling just past an edge platform or the arena's fire poles still
    // counts as "inside this zone" for respawn purposes, rather than
    // falling through to the main island's spawn point.
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

  /**
   * Horizontal-only containment check (x/z) against the bounds computed in
   * load() — used by EntityManager's void-fall respawn (see
   * setVoidFallZones in main.js). Void falls are always detected once y
   * drops far below every platform here, so only x/z need checking.
   * Returns false if the zone never loaded or ended up with no bounds.
   */
  containsPoint(pos) {
    if (!this.bounds || !pos) return false;
    return (
      pos.x >= this.bounds.minX &&
      pos.x <= this.bounds.maxX &&
      pos.z >= this.bounds.minZ &&
      pos.z <= this.bounds.maxZ
    );
  }

  /**
   * True once the player's horizontal position is within the boss arena's
   * circular footprint (plus a small margin, so the health bar appears
   * right as the player steps onto the platform rather than exactly at its
   * mathematical edge). False if this zone has no arena (data.arena was
   * missing) or the player hasn't reached it yet. Used by main.js to show/
   * hide the boss health bar — deliberately narrower than containsPoint()
   * above, which also covers the approach platforms leading up to it.
   */
  isPlayerInArena(pos) {
    if (!this.arenaCenter || !pos) return false;
    const dx = pos.x - this.arenaCenter.x;
    const dz = pos.z - this.arenaCenter.z;
    const margin = 2;
    const r = this.arenaRadius + margin;
    return dx * dx + dz * dz <= r * r;
  }

  /**
   * Checks whether the player's feet are currently over a lava patch and,
   * if so (and not already on cooldown from a previous hit), costs them a
   * life via onLavaHit. Deliberately never touches player.body/mesh itself
   * — same "poke the game state from outside, not the player" pattern used
   * for Enemy contact damage and the pond wading effect.
   */
  update(delta, player, onLavaHit) {
    if (this._lavaCooldown > 0) this._lavaCooldown -= delta;
    if (!player || !player.mesh || this.lavaBlocks.length === 0) return;

    const pos = player.mesh.position;

    for (const lava of this.lavaBlocks) {
      const dx = Math.abs(pos.x - lava.mesh.position.x);
      const dz = Math.abs(pos.z - lava.mesh.position.z);
      const dy = pos.y - lava.mesh.position.y;

      // Within the patch's footprint and roughly at its height (not just
      // passing far overhead mid-jump).
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
