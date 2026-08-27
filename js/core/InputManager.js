export default class InputManager {
  constructor() {
    // Current pressed/released state of every key.
    this.keys = {};

    // Edge-triggered "pressed since last consumed" state so holding a key
    // doesn't re-fire every frame. Cleared by consumeJustPressed().
    this.justPressed = {};

    this._setupListeners();
  }

  _setupListeners() {
    window.addEventListener("keydown", (e) => {
      // Prevent the page from scrolling when Space or the arrow keys are used.
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code,
        )
      ) {
        e.preventDefault();
      }

      const key = e.key.toLowerCase();
      const code = e.code.toLowerCase();

      if (!e.repeat) {
        if (!this.keys[key]) this.justPressed[key] = true;
        if (!this.keys[code]) this.justPressed[code] = true;
      }

      this.keys[key] = true;
      this.keys[code] = true; // Also track e.code, needed for 'Space'.
    });

    window.addEventListener("keyup", (e) => {
      this.keys[e.key.toLowerCase()] = false;
      this.keys[e.code.toLowerCase()] = false;
    });
  }

  // @param {string} keyName - e.g. 'w', 'a', 's', 'd', 'space', 'arrowup'
  isPressed(keyName) {
    return !!this.keys[keyName.toLowerCase()];
  }

  // True once per physical keydown, then false until released and pressed
  // again — use for anything that should fire once per press (E, dialogue).
  consumeJustPressed(keyName) {
    const k = keyName.toLowerCase();
    if (this.justPressed[k]) {
      this.justPressed[k] = false;
      return true;
    }
    return false;
  }
}
