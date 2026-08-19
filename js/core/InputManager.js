export default class InputManager {
  constructor() {
    // Map tracking the current pressed/released state of every key.
    this.keys = {};

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
      this.keys[e.key.toLowerCase()] = true;
      this.keys[e.code.toLowerCase()] = true; // Also track e.code, needed for 'Space'.
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
}
