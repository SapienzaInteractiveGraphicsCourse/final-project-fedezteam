/**
 * A spherical gravity well centered on a planet: any body registered via
 * PhysicsEngine.registerGravityBody() is pulled radially toward `center`
 * while within `influenceRadius`, instead of flat "down" gravity. Used for
 * the Mario Galaxy-style walkable sky planets (see Decorations.js).
 */
export default class GravityField {
  constructor({ center, radius, influenceRadius, strength = 30 } = {}) {
    this.center = center; // CANNON.Vec3 (or any {x,y,z}), world space
    this.radius = radius; // planet's surface radius
    // Defaults to 3x radius so an approaching player is caught early.
    this.influenceRadius = influenceRadius ?? radius * 3;
    // Matches PhysicsEngine's default flat gravity so planets don't feel
    // noticeably heavier/floatier than normal ground.
    this.strength = strength;
  }

  // Distance from `position` ({x,y,z}) to this field's center.
  distanceTo(position) {
    const dx = position.x - this.center.x;
    const dy = position.y - this.center.y;
    const dz = position.z - this.center.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
