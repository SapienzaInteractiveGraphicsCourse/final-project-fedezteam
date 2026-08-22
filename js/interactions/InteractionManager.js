/**
 * InteractionManager.js — single place that owns every "walk up and press E"
 * interaction in the game (Toad's quest dialogue, hatching Yoshi's egg,
 * mounting/dismounting Yoshi, talking to Peach, ...), instead of each of
 * those features hand-rolling its own proximity check and prompt handling.
 *
 * Usage: register({ position, radius, prompt, onInteract, isAvailable }),
 * then call update(playerPos, input) once per frame. `position` is kept as
 * a LIVE reference where possible (e.g. an entity's mesh.position) rather
 * than a one-time copy, so a moving interactable (Yoshi, once mounted and
 * following the player) keeps working without re-registering.
 *
 *  - position: {x, y, z} (only x/z are used unless use3D is set)
 *  - radius: interaction range in world units (default 3)
 *  - prompt: string OR a getter — whatever showInteractionPrompt() should
 *    display (e.g. "Premi E per parlare con Toad"); re-read every frame the
 *    player is in range, so it can change with quest/mount state.
 *  - onInteract: called once per physical E press while in range.
 *  - isAvailable: optional () => boolean; interactable is skipped entirely
 *    while this returns false (e.g. Peach's dialogue trigger only while
 *    ui.gameState === "ENDING").
 *  - use3D: set true to also factor vertical distance into range (off by
 *    default — most interactables sit roughly at the player's own height,
 *    and a flat x/z check is friendlier when a platform's exact y differs
 *    slightly from the prompt's anchor point).
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

  // Call once per frame while the player should be able to interact at all
  // (see main.js's updateGame — gated on gameState/pause/dialogue there).
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
      this.ui?.showInteractionPrompt?.(prompt || "Premi E");

      if (input.consumeJustPressed("e")) {
        nearest.onInteract?.();
      }
    } else {
      this.ui?.hideInteractionPrompt?.();
    }
  }
}
