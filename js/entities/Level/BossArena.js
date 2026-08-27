import * as THREE from "three";
import * as CANNON from "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm";
import { TEXTURES } from "../../core/Assets/manifest.js";

/**
 * BossArena.js — builds the circular boss-fight platform for an obstacle
 * course. Extracted out of ObstacleZone so boss/projectile/arena concerns
 * each live in their own file. Three themed pieces per arena: a textured
 * round platform with a matching collider, a ring of fire poles, and a
 * flat logo decal at the center.
 */

const ARENA_THEMES = {
  // Bowser: dark lava-stone/brick platform, orange fire poles, gameover logo.
  lava: {
    textureKey: "lavaBrickTexture",
    logoKey: "gameoverLogo",
    fallbackColor: 0x4a2a1f,
    poleColor: 0x2b2320,
    flameOuter: 0xff5522,
    flameInner: 0xffd23f,
  },
  // Kamek: purple magic-brick platform, violet fire poles, Kamek logo.
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
  constructor(scene, physicsEngine) {
    this.scene = scene;
    this.physicsEngine = physicsEngine;
    this._textureLoader = new THREE.TextureLoader();
    this._textureCache = new Map();
  }

  // Builds platform + fire poles + center logo for one arena spec.
  // Falls back to "lava" for an unknown/missing theme.
  async build({ x, y, z, radius = 20, height = 1, theme = "lava", poleCount = 16 }) {
    const config = ARENA_THEMES[theme] || ARENA_THEMES.lava;

    await this._buildPlatform({ x, y, z, radius, height, config });
    this._buildFirePoles({ x, y, z, radius, height, config, poleCount });
    await this._buildCenterLogo({ x, y, z, radius, height, config });
  }

  // Fetches/caches a texture by path, sRGB-tagged and set to tile.
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

  // The walkable stage: a wide, short cylinder, tiled brick texture
  // (~every 3 world units regardless of radius) plus a matching collider.
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

  // A ring of poles topped with small flame meshes marking the platform's
  // edge — purely visual, no collider.
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

  // One small two-shell flame (dim outer + bright core) — same low-poly
  // technique as Projectile.js, but static, with no lifetime to manage.
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

  // Nudges every vertex outward by a random factor — the same low-poly
  // "faceted blob" trick as Decorations._createRockGeometry.
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

  // Flat logo decal at the arena's center, laid flush on the platform
  // (rotated to face up, offset 0.02 to avoid z-fighting).
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
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, y + height / 2 + 0.02, z);
    plane.castShadow = false;
    plane.receiveShadow = false;
    this.scene.add(plane);
  }
}
