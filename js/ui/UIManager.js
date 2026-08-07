export default class UIManager {
  constructor() {
    // 1. Selezione Elementi DOM
    this.welcomeScreen = document.getElementById("welcome-screen");
    this.nameScreen = document.getElementById("name-screen");
    this.hud = document.getElementById("hud");

    this.startBtn = document.getElementById("start-btn");
    this.continueBtn = document.getElementById("continue-btn");
    this.heroNameInput = document.getElementById("hero-name-input");
    this.hudHeroName = document.getElementById("hud-hero-name");
    this.hudCharIcon = document.getElementById("hud-char-icon");

    this.btnMario = document.getElementById("btn-mario");
    this.btnLuigi = document.getElementById("btn-luigi");

    // 2. Stato dell'interfaccia
    this.gameState = "MENU_WELCOME"; 
    this.selectedCharacter = "mario"; 

    // Callback per avvisare main.js
    this.onStartCallback = null;
    this.onSelectCallback = null;
    this.onWelcomeStartCallback = null; // 🔊 Callback per il click su START iniziale

    // 3. Inizializzazione Listener
    this._setupListeners();
  }

  _setupListeners() {
    // Selezione Mario
    this.btnMario.addEventListener("click", () => {
      this.selectedCharacter = "mario";
      this.btnMario.className = "char-card selected-mario";
      this.btnLuigi.className = "char-card";
      
      if (this.onSelectCallback) this.onSelectCallback("mario");
    });

    // Selezione Luigi
    this.btnLuigi.addEventListener("click", () => {
      this.selectedCharacter = "luigi";
      this.btnLuigi.className = "char-card selected-luigi";
      this.btnMario.className = "char-card";

      if (this.onSelectCallback) this.onSelectCallback("luigi");
    });

    // Step 1 -> Step 2 (Welcome -> Name/Character)
    this.startBtn.addEventListener("click", () => {
      this.gameState = "MENU_NAME";
      this.welcomeScreen.style.display = "none";
      this.nameScreen.style.display = "flex";
      this.heroNameInput.focus();

      // 🔊 Notifica main.js di far partire la BGM al primo click
      if (this.onWelcomeStartCallback) {
        this.onWelcomeStartCallback();
      }
    });

    // Step 2 -> Avvio Gioco
    this.continueBtn.addEventListener("click", () => this._triggerStart());

    this.heroNameInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        this._triggerStart();
      }
    });
  }

  _triggerStart() {
    const enteredName = this.heroNameInput.value.trim().toUpperCase();
    const defaultName = this.selectedCharacter === "mario" ? "MARIO" : "LUIGI";
    const finalName = enteredName !== "" ? enteredName : defaultName;

    // Aggiorna l'HUD
    this.hudHeroName.textContent = finalName;
    if (this.hudCharIcon) {
      this.hudCharIcon.src =
        this.selectedCharacter === "mario"
          ? "assets/images/mario-icon.png"
          : "assets/images/luigi-icon.png";
    }
    this.hudHeroName.style.color =
      this.selectedCharacter === "mario" ? "#e52521" : "#43b047";

    // Mostra l'HUD e nasconde il menu
    this.gameState = "PLAYING";
    this.nameScreen.style.display = "none";
    this.hud.style.display = "flex";

    // Notifica main.js
    if (this.onStartCallback) {
      this.onStartCallback({
        character: this.selectedCharacter,
        name: finalName,
      });
    }
  }

  /**
   * Permette a main.js di registrare l'avvio della BGM appena si clicca START
   */
  onWelcomeStart(callback) {
    this.onWelcomeStartCallback = callback;
  }

  onCharacterSelect(callback) {
    this.onSelectCallback = callback;
  }

  onGameStart(callback) {
    this.onStartCallback = callback;
  }
}