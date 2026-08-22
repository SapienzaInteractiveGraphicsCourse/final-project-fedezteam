export default class InputManager {
  constructor() {
    // Map tracking the current pressed/released state of every key.
    this.keys = {};

    // Map tracking "was this key pressed since the last time it was
    // consumed" — used for edge-triggered actions (interactions, dialogue
    // advance, egg hatch, mount/dismount, ...) where holding the key down
    // must NOT keep re-firing every frame the way isPressed() does. Set
    // once on the real physical keydown (e.repeat is ignored, so an OS
    // key-repeat while holding the key doesn't re-arm it), cleared the
    // moment consumeJustPressed() reads it — no per-frame bookkeeping
    // needed elsewhere.
    this.justPressed = {};

    // Start listening for keyboard events immediately.
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

  /**
   * @param {string} keyName - e.g. 'w', 'a', 's', 'd', 'space', 'arrowup'
   */
  isPressed(keyName) {
    return !!this.keys[keyName.toLowerCase()];
  }

  /**
   * Edge-triggered read: true only once per physical keydown, then false
   * again (even while the key is still held) until it's released and
   * pressed again. Use this for anything that should fire exactly once per
   * press — E-key interactions, advancing dialogue, ... — instead of
   * isPressed(), which would fire every single frame the key is held.
   */
  consumeJustPressed(keyName) {
    const k = keyName.toLowerCase();
    if (this.justPressed[k]) {
      this.justPressed[k] = false;
      return true;
    }
    return false;
  }
}
