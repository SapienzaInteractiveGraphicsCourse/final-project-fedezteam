/**
 * A spherical gravity well centered on a planet: any dynamic body
 * registered with PhysicsEngine.registerGravityBody() gets pulled radially
 * toward `center` while it's within `influenceRadius`, instead of the
 * world's normal flat "down" gravity — see PhysicsEngine.update() for where
 * that swap actually happens. This class is just a plain data holder, added
 * to a PhysicsEngine via PhysicsEngine.addGravityField().
 *
 * Used for the Mario Galaxy-style walkable sky planets (see
 * Decorations.js's _addPlanetPhysics): each planet gets one of these plus a
 * matching static sphere collider, so getting close enough switches the
 * player from flat gravity to "falling" toward that planet's center, and
 * standing on its surface lets them walk around it in any direction.
 */
export default class GravityField {
  constructor({ center, radius, influenceRadius, strength = 30 } = {}) {
    // CANNON.Vec3 (or any {x,y,z}) — the planet's center, in world space.
    this.center = center;
    // The planet's own surface radius, so other code (Player.js's landing
    // check, Decorations' warp-star destination math) can place things
    // exactly on the surface without duplicating this number.
    this.radius = radius;
    // How far from the center this field starts pulling. Defaults to 3x the
    // planet's radius so a falling/approaching player gets caught well
    // before reaching the surface, rather than flying past it under flat
    // gravity and only redirecting at the last moment.
    this.influenceRadius = influenceRadius ?? radius * 3;
    // Acceleration magnitude (world units/s^2). Defaults to 30 to match
    // PhysicsEngine's default flat gravity (`options.gravity || -30`), so
    // planets don't feel noticeably "heavier" or "floatier" than normal
    // ground.
    this.strength = strength;
  }

  // Distance from `position` ({x,y,z}, works for CANNON.Vec3/THREE.Vector3
  // too) to this field's center.
  distanceTo(position) {
    const dx = position.x - this.center.x;
    const dy = position.y - this.center.y;
    const dz = position.z - this.center.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
