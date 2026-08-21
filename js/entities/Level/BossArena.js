import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { TEXTURES } from "../../core/Assets/manifest.js";

/**
 * BossArena.js — builds the big circular boss-fight platform for a boss
 * obstacle course (see ObstacleZone.js, which delegates to this whenever a
 * zone JSON has an `arena` field — see kamek_zone.json/bowser_zone.json).
 * Extracted out of ObstacleZone so boss/projectile/arena concerns each live
 * in their own file (Boss.js + Projectile.js for the fight itself, this
 * file for the stage it happens on) instead of one growing monolith.
 *
 * Three pieces per arena, all themed together via one `theme` key (see
 * ARENA_THEMES below): a round, textured platform (CANNON.Cylinder's height
 * axis matches THREE.CylinderGeometry's as of cannon-es 0.10.0+, so no
 * extra alignment rotation is needed on the physics body); a ring of fire
 * poles marking its edge (decorative only — no collider of their own, see
 * the class doc on ObstacleZone.js for why falling off is allowed/handled
 * elsewhere); and a flat logo decal at its center.
 */

const ARENA_THEMES = {
  // Bowser: dark lava-stone/brick platform, orange fire poles, the
  // gameover-logo decal (Bowser's "logo", see manifest.js TEXTURES).
  lava: {
    textureKey: "lavaBrickTexture",
    logoKey: "gameoverLogo",
    fallbackColor: 0x4a2a1f,
    poleColor: 0x2b2320,
    flameOuter: 0xff5522,
    flameInner: 0xffd23f,
  },
  // Kamek: purple magic-brick platform with gold inlay, violet fire poles,
  // the Kamek-logo decal.
  magic: {
    textureKey: "magicBrickTexture",
    logoKey: "kamekLogo",
    fallbackColor: 0x2e1840,
    poleColor: 0x241a2e,
    flameOuter: 0x9b30ff,
    flameInner: 0xd9aaff,
  },
};

export default class BossArena {
  // Stores the scene/physics references; nothing is built until build() is
  // called. Textures are cached per-path so a re-themed second arena
  // sharing a texture (not currently the case, but cheap to support)
  // wouldn't re-fetch it.
  constructor(scene, physicsEngine) {
    this.scene = scene;
    this.physicsEngine = physicsEngine;
    this._textureLoader = new THREE.TextureLoader();
    this._textureCache = new Map();
  }

  // Builds all three pieces (platform, fire poles, center logo) for one
  // arena spec — see kamek_zone.json/bowser_zone.json's "arena" field for
  // the {x,y,z,radius,height,theme} shape this expects. Falls back to the
  // "lava" theme if an unknown/missing theme is given, so a typo in the
  // JSON degrades gracefully instead of throwing.
  async build({ x, y, z, radius = 20, height = 1, theme = "lava", poleCount = 16 }) {
    const config = ARENA_THEMES[theme] || ARENA_THEMES.lava;

    await this._buildPlatform({ x, y, z, radius, height, config });
    this._buildFirePoles({ x, y, z, radius, height, config, poleCount });
    await this._buildCenterLogo({ x, y, z, radius, height, config });
  }

  // Fetches (and caches) a texture by path, tagged for the game's sRGB
  // color pipeline and set to tile — same loadLogo pattern already used in
  // Decorations.spawnZoneSigns, generalized to also set repeat-wrapping.
  async _loadTexture(path) {
    if (!path) return null;
    if (this._textureCache.has(path)) return this._textureCache.get(path);

    let texture = null;
    try {
      texture = await this._textureLoader.loadAsync(path);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
    } catch (e) {
      console.warn(`[BossArena] texture not found (${path}) — falling back to a flat color.`, e);
    }

    this._textureCache.set(path, texture);
    return texture;
  }

  // The round walkable stage itself: a wide, short cylinder, textured with
  // this theme's brick map (tiled roughly every 3 world units so brick
  // scale stays consistent regardless of the arena's radius) and given a
  // matching static CANNON.Cylinder collider.
  async _buildPlatform({ x, y, z, radius, height, config }) {
    const texture = await this._loadTexture(TEXTURES[config.textureKey]);
    if (texture) {
      const repeat = Math.max(2, Math.round(radius / 3));
      texture.repeat.set(repeat, repeat);
    }

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: texture ? 0xffffff : config.fallbackColor,
      roughness: 0.85,
      metalness: 0.08,
    });

    const geometry = new THREE.CylinderGeometry(radius, radius, height, 48);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.scene.add(mesh);

    const world = this.physicsEngine?.world || this.physicsEngine;
    if (world) {
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Cylinder(radius, radius, height, 24),
        position: new CANNON.Vec3(x, y, z),
        material: this.physicsEngine?.defaultMaterial,
      });
      world.addBody(body);
    }
  }

  // A ring of short poles around the platform's rim, each topped with a
  // small polygonal "flame" (same jittered-icosahedron shell technique as
  // Projectile.js, tinted per-theme) marking where the walkable area ends.
  // Purely a visual boundary cue — no collider, so falling off is still
  // possible and still handled by the ordinary void-fall respawn (see
  // ObstacleZone.js's class doc).
  _buildFirePoles({ x, y, z, radius, height, config, poleCount }) {
    const poleHeight = 2.2;
    const poleRadius = 0.16;
    const poleGeometry = new THREE.CylinderGeometry(poleRadius, poleRadius * 1.3, poleHeight, 8);
    const poleMaterial = new THREE.MeshStandardMaterial({
      color: config.poleColor,
      roughness: 0.7,
      metalness: 0.35,
    });

    const group = new THREE.Group();
    group.position.set(x, y + height / 2, z);

    const ringRadius = radius - 0.7;
    for (let i = 0; i < poleCount; i++) {
      const angle = (i / poleCount) * Math.PI * 2;
      const px = Math.cos(angle) * ringRadius;
      const pz = Math.sin(angle) * ringRadius;

      const pole = new THREE.Mesh(poleGeometry, poleMaterial);
      pole.position.set(px, poleHeight / 2, pz);
      pole.castShadow = true;
      pole.receiveShadow = true;
      group.add(pole);

      const flame = this._createFlameMesh(config, poleRadius * 2.4);
      flame.position.set(px, poleHeight + poleRadius, pz);
      group.add(flame);
    }

    this.scene.add(group);
  }

  // Builds one small two-shell "flame" (outer dim shell + inner bright
  // core), the same low-poly technique Projectile.js uses for its
  // fireball/orb visuals — kept in sync in spirit rather than sharing code,
  // since a pole flame is static (no flight/spin/lifetime state to manage)
  // while a Projectile is a full moving, self-expiring entity.
  _createFlameMesh(config, radius) {
    const group = new THREE.Group();

    const outerGeo = new THREE.IcosahedronGeometry(radius, 0);
    BossArena._jitterGeometry(outerGeo, 0.8, 0.4);
    const outerMat = new THREE.MeshStandardMaterial({
      color: config.flameOuter,
      emissive: config.flameOuter,
      emissiveIntensity: 0.8,
      roughness: 0.5,
      flatShading: true,
    });
    group.add(new THREE.Mesh(outerGeo, outerMat));

    const innerGeo = new THREE.IcosahedronGeometry(radius * 0.5, 0);
    BossArena._jitterGeometry(innerGeo, 0.8, 0.4);
    const innerMat = new THREE.MeshStandardMaterial({
      color: config.flameInner,
      emissive: config.flameInner,
      emissiveIntensity: 1.4,
      roughness: 0.3,
      flatShading: true,
    });
    group.add(new THREE.Mesh(innerGeo, innerMat));

    return group;
  }

  // Nudges every vertex of `geometry` outward by a random factor in
  // [jitterMin, jitterMin+jitterRange] along its own direction from the
  // center — the same low-poly "faceted blob" trick as
  // Decorations._createRockGeometry, factored out here since both the pole
  // flames and (conceptually) Projectile's shells use it.
  static _jitterGeometry(geometry, jitterMin, jitterRange) {
    const posAttr = geometry.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      vertex.fromBufferAttribute(posAttr, i);
      vertex.multiplyScalar(jitterMin + Math.random() * jitterRange);
      posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    geometry.computeVertexNormals();
  }

  // A flat decal at the arena's center — Bowser's gameover-logo or Kamek's
  // own logo depending on theme (see ARENA_THEMES) — laid flat on the
  // platform surface (rotated to face up) rather than standing upright
  // like the zone-entrance signs in Decorations.spawnZoneSigns.
  async _buildCenterLogo({ x, y, z, radius, height, config }) {
    const texture = await this._loadTexture(TEXTURES[config.logoKey]);
    if (!texture) return;

    const size = Math.min(radius * 0.9, 14);
    const plane = new THREE.Mesh(
      new THREE.CircleGeometry(size / 2, 48),
      new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
        roughness: 0.6,
        metalness: 0,
        envMapIntensity: 0.4,
      }),
    );
    // Lay flat facing up (a plain PlaneGeometry/CircleGeometry faces +Z by
    // default) and sit it a hair above the platform surface to avoid
    // z-fighting with it.
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, y + height / 2 + 0.02, z);
    plane.castShadow = false;
    plane.receiveShadow = false;
    this.scene.add(plane);
  }
}
