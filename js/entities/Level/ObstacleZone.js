import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";

/**
 * A small, self-contained bonus zone far from the main island: a short
 * chain of platforms with gaps between them, a couple of lava hazard
 * patches, and (spawned separately in main.js, see kamekSpawn) Kamek
 * waiting at the end. Loaded from its own JSON file
 * (assets/levels/kamek_zone.json), same "pure data" spirit as level1.json.
 *
 * Reached via warp star teleport (see Decorations._updateWarpStars /
 * setKamekZoneEntry) rather than a real scene/level switch — it's just more
 * of the same physics world, placed somewhere far from the main island so
 * nobody wanders into it by accident.
 *
 * Falling off a platform here is handled entirely by the existing
 * void-fall mechanic (EntityManager.update -> checkVoidFall): same
 * lose-a-life-and-respawn-at-spawn behavior as falling off the main island,
 * no separate logic needed. Lava is a different, additional hazard: it
 * doesn't have a collider (the player can walk straight into it, unlike a
 * wall), so it's checked as a simple overlap trigger every frame instead —
 * see update().
 *
 * Deliberately simple geometry (plain boxes, no models to load) per the
 * "don't make the Kamek level too complex yet" request — platforms and
 * lava can be swapped for real assets later without changing this class'
 * shape.
 */
export default class ObstacleZone {
  constructor(scene, physicsEngine) {
    this.scene = scene;
    this.physicsEngine = physicsEngine;

    this.entryPoint = null;
    this.kamekSpawn = null;
    this.lavaBlocks = []; // { mesh, halfX, halfZ }
    this._lavaCooldown = 0;
  }

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
    this.kamekSpawn = data.kamekSpawn || null;

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

    return data;
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
