import MarioHouse from "./MarioHouse.js";
import HillBlock from "./HillBlock.js";
import ToadHouse from "./ToadHouse.js";

export default class BuildingFactory {
  /**
   * Creates the correct wrapper class (mesh + physics body) for a given
   * building/structure type coming from the level JSON.
   *
   * @param {string} type - e.g. "mario_house", "toad_house_red", "hill"
   * @param {THREE.Object3D} mesh - already loaded/cloned GLB scene
   * @param {*} physicsEngine - the physics world wrapper (must expose `.world` or be the world itself)
   * @param {object} data - raw entry from level JSON (position, scale, rotation, ...)
   * @returns {object|null} the created instance, or null if the type is unknown
   */
  static create(type, mesh, physicsEngine, data) {
    switch (type) {
      case "mario_house":
        return new MarioHouse(mesh, physicsEngine, data);

      case "block_grass_large":
      case "hill_step":
      case "hill":
        return new HillBlock(mesh, physicsEngine, data);

      // All Toad House variants share the same collision layout.
      case "toad_house":
      case "toad_house_red":
      case "toad_house_blue":
        return new ToadHouse(mesh, physicsEngine, data);

      default:
        console.warn(
          `[BuildingFactory] No class registered for type: "${type}". ` +
          `The mesh will NOT be added to the scene and it will have NO collision. ` +
          `Check that this exact string is handled in the switch above.`
        );
        return null;
    }
  }
}
