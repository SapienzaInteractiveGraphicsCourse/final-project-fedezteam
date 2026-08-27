import MarioHouse from "./MarioHouse.js";
import HillBlock from "./HillBlock.js";
import ToadHouse from "./ToadHouse.js";

export default class BuildingFactory {
  // Creates the wrapper class (mesh + physics body) for a building type
  // coming from the level JSON. Returns null if the type is unknown.
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
