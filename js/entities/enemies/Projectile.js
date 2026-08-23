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
  // Quante forme diverse preparare per ogni livello di dettaglio.
  static VARIANTS = 4;

  // Geometrie (per livello di dettaglio) e materiali (per coppia di colori)
  // condivisi da tutti i proiettili — vedi _flameGeometry/_materials.
  static _geoPool = new Map();
  static _matCache = new Map();

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

    // Geometrie e materiali sono CONDIVISI (vedi _flameGeometry/_materials):
    // ogni colpo aggiunge solo due Mesh, che sono oggetti leggeri di scena.
    const look = Projectile._materials(colorOuter, colorInner);

    const outer = new THREE.Mesh(Projectile._flameGeometry(0), look.outer);
    outer.scale.setScalar(radius);
    this.mesh.add(outer);

    // La scala della sfera interna serve anche al battito in update(), che
    // altrimenti la riporterebbe a raggio 1 al primo frame.
    this._innerBaseScale = radius * 0.55;
    this._innerMesh = new THREE.Mesh(Projectile._flameGeometry(1), look.inner);
    this._innerMesh.scale.setScalar(this._innerBaseScale);
    this.mesh.add(this._innerMesh);

    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);

    // Per-instance random spin so a volley of projectiles doesn't read as
    // identical clones rotating in lockstep.
    this._spinSpeed = 3 + Math.random() * 2;
  }

  /**
   * Una delle geometrie condivise, a raggio 1 (chi la usa la scala).
   *
   * PERCHE' UN INSIEME FISSO E NON UNA PER COLPO. Costruire una geometria
   * significa allocarla, riempirla e caricarla sulla GPU: farlo a ogni
   * proiettile, in mezzo a un combattimento, e' esattamente il momento
   * peggiore. Qui se ne preparano VARIANTS diverse la prima volta che
   * servono e poi si pescano a caso: la varieta' che serviva — due palle di
   * fuoco vicine non devono sembrare cloni — resta, il costo per colpo no.
   * Con la rotazione casuale gia' presente, quattro forme bastano.
   */
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

  /**
   * La coppia di materiali per una data combinazione di colori (fuoco di
   * Bowser, magia di Kamek), creata una volta sola.
   *
   * Condividerli non e' solo un risparmio di memoria: un materiale nuovo
   * costringe WebGL a cercare (e alla prima volta a COMPILARE) il suo
   * programma shader, e distruggerlo lo butta via — cosi' il colpo
   * successivo lo ricompilava da capo. E' quello lo scatto che si sentiva
   * durante le due boss fight.
   */
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
    this._innerMesh.scale.setScalar(this._innerBaseScale * pulse);

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

  /**
   * Toglie il proiettile dalla scena. Chiamabile una volta sola; il Boss
   * che lo possiede lascia cadere il riferimento subito dopo.
   *
   * NON libera geometrie e materiali, e non e' una dimenticanza: da quando
   * sono condivisi (vedi _flameGeometry/_materials) non appartengono piu' al
   * singolo colpo — sono una manciata di oggetti creati una volta per
   * sessione, e distruggerli qui li farebbe ricreare al colpo dopo.
   *
   * Prima ogni proiettile costruiva i propri e questo metodo li distruggeva:
   * niente perdite di memoria, ma un ciclo completo alloca / carica sulla
   * GPU / cerca il programma shader / butta via, a ogni colpo e nel bel
   * mezzo del combattimento. Era quello a far scattare le boss fight.
   */
  dispose() {
    if (this.mesh && this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
  }
}
