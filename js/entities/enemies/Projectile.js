import * as THREE from "three";

/**
 * Projectile.js — a Boss ranged-attack projectile: a kinematic mesh with
 * no physics body, flying straight from its spawn point toward where the
 * player was when fired, checking distance-to-player every frame. Visual
 * is a jittered-icosahedron "sphere within a sphere" (Decorations.js'
 * low-poly technique) reading as a fireball or magic orb by color.
 */
export default class Projectile {
  // How many distinct shape variants to prepare per detail level.
  static VARIANTS = 4;

  // Geometries (per detail level) and materials (per color pair), shared
  // across every projectile — see _flameGeometry/_materials.
  static _geoPool = new Map();
  static _matCache = new Map();

  // `to` is captured once (not re-read per frame): the projectile flies
  // straight toward where the player WAS when fired, not homing on them.
  constructor(scene, { from, to, speed = 14, radius = 0.55, colorOuter = 0xff4400, colorInner = 0xffd23f, lifetime = 4, hitRadius = 1.3 }) {
    this.scene = scene;
    this.speed = speed;
    this.hitRadius = hitRadius;
    this.lifetime = lifetime;
    this.age = 0;
    this.isExpired = false;

    const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    if (dir.lengthSq() < 0.0001) dir.set(0, 0, 1);
    dir.normalize();
    this.velocity = dir.multiplyScalar(speed);

    this.mesh = new THREE.Group();
    this.mesh.position.set(from.x, from.y, from.z);

    // Geometry/materials are shared — each shot only adds two light Meshes.
    const look = Projectile._materials(colorOuter, colorInner);

    const outer = new THREE.Mesh(Projectile._flameGeometry(0), look.outer);
    outer.scale.setScalar(radius);
    this.mesh.add(outer);

    // Also read by update()'s pulse, else it'd reset to radius 1 on frame 1.
    this._innerBaseScale = radius * 0.55;
    this._innerMesh = new THREE.Mesh(Projectile._flameGeometry(1), look.inner);
    this._innerMesh.scale.setScalar(this._innerBaseScale);
    this.mesh.add(this._innerMesh);

    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);

    // Per-instance random spin so a volley doesn't rotate in lockstep.
    this._spinSpeed = 3 + Math.random() * 2;
  }

  // One of VARIANTS shared geometries at radius 1, built once per detail
  // level and picked at random instead of built fresh per shot mid-fight.
  static _flameGeometry(detail) {
    let pool = Projectile._geoPool.get(detail);
    if (!pool) {
      pool = [];
      for (let i = 0; i < Projectile.VARIANTS; i++) {
        pool.push(Projectile._createFlameGeometry(1, detail));
      }
      Projectile._geoPool.set(detail, pool);
    }
    return pool[(Math.random() * pool.length) | 0];
  }

  // Material pair for a color combo, created once — a new material forces
  // a shader compile, the stutter that used to hit every shot in a fight.
  static _materials(colorOuter, colorInner) {
    const key = `${colorOuter}-${colorInner}`;
    let look = Projectile._matCache.get(key);
    if (!look) {
      look = {
        outer: new THREE.MeshStandardMaterial({
          color: colorOuter,
          emissive: colorOuter,
          emissiveIntensity: 0.9,
          roughness: 0.5,
          flatShading: true,
        }),
        inner: new THREE.MeshStandardMaterial({
          color: colorInner,
          emissive: colorInner,
          emissiveIntensity: 1.6,
          roughness: 0.3,
          flatShading: true,
        }),
      };
      Projectile._matCache.set(key, look);
    }
    return look;
  }

  // Same jittered-icosahedron technique as Decorations.js, tuned into a
  // rounder "flame blob" instead of a rock's facets or a bush's dome.
  static _createFlameGeometry(radius, detail) {
    const geometry = new THREE.IcosahedronGeometry(radius, detail);
    const posAttr = geometry.attributes.position;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      vertex.fromBufferAttribute(posAttr, i);
      const jitter = 0.8 + Math.random() * 0.4;
      vertex.multiplyScalar(jitter);
      posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    geometry.computeVertexNormals();
    return geometry;
  }

  // Advances flight/spin; marks expired past lifetime (the owning Boss
  // disposes it — see Boss._updateProjectiles).
  update(delta) {
    this.mesh.position.x += this.velocity.x * delta;
    this.mesh.position.y += this.velocity.y * delta;
    this.mesh.position.z += this.velocity.z * delta;

    this.mesh.rotation.y += delta * this._spinSpeed;
    this.mesh.rotation.x += delta * this._spinSpeed * 0.6;
    // Small pulsing scale on the inner core for a "flickering" hot center.
    const pulse = 1 + Math.sin(this.age * 18) * 0.12;
    this._innerMesh.scale.setScalar(this._innerBaseScale * pulse);

    this.age += delta;
    if (this.age >= this.lifetime) this.isExpired = true;
  }

  // Distance check against the player's mesh — true once per hit (caller
  // disposes the projectile right after, so no double-hit guard needed).
  checkHit(player) {
    if (!player || !player.mesh) return false;
    const dx = player.mesh.position.x - this.mesh.position.x;
    const dy = player.mesh.position.y - this.mesh.position.y;
    const dz = player.mesh.position.z - this.mesh.position.z;
    return dx * dx + dy * dy + dz * dz <= this.hitRadius * this.hitRadius;
  }

  // Removes the projectile from the scene. Does NOT dispose geometry or
  // materials — those are shared (see _flameGeometry/_materials).
  dispose() {
    if (this.mesh && this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
  }
}
