/**
 * InteractionManager.js — single place owning every "walk up and press E"
 * interaction (Toad, Yoshi's egg/mount, Peach, ...). register({ position,
 * radius = 3, prompt, onInteract, isAvailable, use3D }) once, then call
 * update(playerPos, input) per frame; `position` can be a live reference
 * (e.g. mesh.position) so a moving interactable keeps working.
 */
export default class InteractionManager {
  constructor(ui) {
    this.ui = ui;
    this.interactables = [];
  }

  register(interactable) {
    this.interactables.push(interactable);
    return interactable;
  }

  unregister(interactable) {
    this.interactables = this.interactables.filter((i) => i !== interactable);
  }

  // Call once per frame while the player can interact (see main.js).
  update(playerPos, input) {
    if (!playerPos) {
      this.ui?.hideInteractionPrompt?.();
      return;
    }

    let nearest = null;
    let nearestDist = Infinity;

    for (const it of this.interactables) {
      if (it.enabled === false) continue;
      if (typeof it.isAvailable === "function" && !it.isAvailable()) continue;
      if (!it.position) continue;

      const dx = playerPos.x - it.position.x;
      const dz = playerPos.z - it.position.z;
      const dy = it.use3D ? playerPos.y - it.position.y : 0;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const radius = it.radius ?? 3;
      if (dist <= radius && dist < nearestDist) {
        nearest = it;
        nearestDist = dist;
      }
    }

    if (nearest) {
      const prompt = typeof nearest.prompt === "function" ? nearest.prompt() : nearest.prompt;
      this.ui?.showInteractionPrompt?.(prompt || "Press E");

      if (input.consumeJustPressed("e")) {
        nearest.onInteract?.();
      }
    } else {
      this.ui?.hideInteractionPrompt?.();
    }
  }
}
