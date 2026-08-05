export default class InputManager {
  constructor() {
    // Mappa per tracciare lo stato dei tasti (premuti o meno)
    this.keys = {};

    // Inizializziamo subito gli ascoltatori degli eventi
    this._setupListeners();
  }

  _setupListeners() {
    window.addEventListener("keydown", (e) => {
      // Previene lo scorrimento della pagina quando si preme Spazio o le frecce
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code,
        )
      ) {
        e.preventDefault();
      }
      this.keys[e.key.toLowerCase()] = true;
      this.keys[e.code.toLowerCase()] = true; // Supporta anche e.code per 'Space'
    });

    window.addEventListener("keyup", (e) => {
      this.keys[e.key.toLowerCase()] = false;
      this.keys[e.code.toLowerCase()] = false;
    });
  }

  /**
   * @param {string} keyName - Es: 'w', 'a', 's', 'd', 'space', 'arrowup'
   */
  isPressed(keyName) {
    return !!this.keys[keyName.toLowerCase()];
  }
}
