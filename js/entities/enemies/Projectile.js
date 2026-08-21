import * as THREE from "three";

/**
 * Projectile.js — a simple ranged-attack projectile spawned by a Boss (see
 * Boss.js): a straight-line kinematic mesh with no cannon-es body of its
 * own (same "no physics body, distance-check trigger" pattern already used
 * for lava in ObstacleZone.js), so it can't be deflected or blocked by
 * anything in the world — it just flies from its spawn point toward the
 * point the player was at when it was fired, checks distance-to-player
 * every frame, and reports a hit (or expires) back to its owning Boss.
 *
 * Visual: neither Bowser nor Kamek's GLB has a skeleton (verified via a
 * manual GLB parse — 0 skins/animations on both), so instead of a real fire
 * or magic VFX this reuses Decorations.js' low-poly "jittered icosahedron"
 * technique (see _createRockGeometry/_createBushGeometry there) to build a
 * small polygonal sphere-within-a-sphere: a bigger, dim outer shell plus a
 * brighter, smaller, emissive inner core — reads as a fireball (red/orange
 * outside, yellow-hot inside) or a magic orb (violet outside, white-hot
 * inside) depending on the two colors passed in.
 */
export default class Projectile {
  // Builds the projectile's mesh (two nested jittered-icosahedron shells)
  // and its flight parameters. `from`/`to` are plain {x,y,z} points — `to`
  // is captured once here (not re-read every frame), so the projectile
  // flies in a straight line toward where the player WAS at the moment of
  // firing rather than homing in on them.
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

    const outerGeo = Projectile._createFlameGeometry(radius, 0);
    const outerMat = new THREE.MeshStandardMaterial({
      color: colorOuter,
      emissive: colorOuter,
      emissiveIntensity: 0.9,
      roughness: 0.5,
      flatShading: true,
    });
    this.mesh.add(new THREE.Mesh(outerGeo, outerMat));

    const innerGeo = Projectile._createFlameGeometry(radius * 0.55, 1);
    const innerMat = new THREE.MeshStandardMaterial({
      color: colorInner,
      emissive: colorInner,
      emissiveIntensity: 1.6,
      roughness: 0.3,
      flatShading: true,
    });
    this._innerMesh = new THREE.Mesh(innerGeo, innerMat);
    this.mesh.add(this._innerMesh);

    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);

    // Per-instance random spin so a volley of projectiles doesn't read as
    // identical clones rotating in lockstep.
    this._spinSpeed = 3 + Math.random() * 2;
  }

  // Same jittered-icosahedron "low-poly rock/bush" technique as
  // Decorations.js, tuned into a rounder, more irregular "flame blob"
  // silhouette instead of a rock's sharp facets or a bush's flattened dome.
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

  // Advances the flight and spin; marks the projectile expired once its
  // lifetime runs out (the owning Boss is responsible for disposing it —
  // see Boss._updateProjectiles).
  update(delta) {
    this.mesh.position.x += this.velocity.x * delta;
    this.mesh.position.y += this.velocity.y * delta;
    this.mesh.position.z += this.velocity.z * delta;

    this.mesh.rotation.y += delta * this._spinSpeed;
    this.mesh.rotation.x += delta * this._spinSpeed * 0.6;
    // Small pulsing scale on the inner core for a "flickering" hot center.
    const pulse = 1 + Math.sin(this.age * 18) * 0.12;
    this._innerMesh.scale.setScalar(pulse);

    this.age += delta;
    if (this.age >= this.lifetime) this.isExpired = true;
  }

  // Simple distance check against the player's mesh position — true once
  // per hit (the caller disposes the projectile immediately afterward, so
  // there's no need to guard against reporting the same hit twice).
  checkHit(player) {
    if (!player || !player.mesh) return false;
    const dx = player.mesh.position.x - this.mesh.position.x;
    const dy = player.mesh.position.y - this.mesh.position.y;
    const dz = player.mesh.position.z - this.mesh.position.z;
    return dx * dx + dy * dy + dz * dz <= this.hitRadius * this.hitRadius;
  }

  // Removes the projectile's mesh from the scene AND frees its GPU-side
  // geometry/material buffers. Safe to call once; the owning Boss drops its
  // reference right after calling this.
  //
  // BUG FIX (boss-defeat lag, worse on Bowser than Kamek): each projectile
  // builds its own unique geometries in the constructor (the per-vertex
  // jitter means they can't be shared/cached like a static prop's could
  // be) — removing the mesh from the scene graph alone does NOT free that
  // GPU memory, three.js requires an explicit .dispose() call on every
  // geometry/material or it leaks for the rest of the session. Every
  // fireball/orb fired was leaking 2 geometries + 2 materials this way.
  // Bowser's fight runs longer (5 stomps vs Kamek's 3, with a longer
  // cooldown+charge cycle in between), so more projectiles get fired
  // before he's defeated — more leaked GPU objects piling up by the time
  // _defeat() disposes everything at once, which is why the stutter was
  // more noticeable on Bowser specifically.
  dispose() {
    if (this.mesh) {
      this.mesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      if (this.mesh.parent) {
        this.mesh.parent.remove(this.mesh);
      }
    }
  }
}
