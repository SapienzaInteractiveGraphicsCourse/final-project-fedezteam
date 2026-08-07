export default class UIManager {
  constructor() {
    // Elementi principali
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

    // Elementi Menu Pausa / Settings
    this.pauseBtn = document.getElementById("pause-btn");
    this.closeSettingsBtn = document.getElementById("close-settings-btn");
    this.pauseOverlay = document.getElementById("pause-overlay"); // 👈 Overlay scuro
    this.settingsTitle = document.getElementById("settings-title"); // 👈 Titolo dinamico
    this.bgmSlider = document.getElementById("bgm-slider");
    this.sfxSlider = document.getElementById("sfx-slider");
    this.bgmValText = document.getElementById("bgm-val");
    this.sfxValText = document.getElementById("sfx-val");

    // Stato
    this.gameState = "MENU_WELCOME"; 
    this.selectedCharacter = "mario"; 
    this.isPaused = false;

    // Callbacks
    this.onStartCallback = null;
    this.onSelectCallback = null;
    this.onWelcomeStartCallback = null;
    this.onBGMVolumeChange = null;
    this.onSFXVolumeChange = null;

    this._setupListeners();
  }

  _setupListeners() {
    // Selezione Personaggio
    this.btnMario.addEventListener("click", () => {
      this.selectedCharacter = "mario";
      this.btnMario.className = "char-card selected-mario";
      this.btnLuigi.className = "char-card";
      if (this.onSelectCallback) this.onSelectCallback("mario");
    });

    this.btnLuigi.addEventListener("click", () => {
      this.selectedCharacter = "luigi";
      this.btnLuigi.className = "char-card selected-luigi";
      this.btnMario.className = "char-card";
      if (this.onSelectCallback) this.onSelectCallback("luigi");
    });

    // Step 1 -> Step 2
    this.startBtn.addEventListener("click", () => {
      this.gameState = "MENU_NAME";
      this.welcomeScreen.style.display = "none";
      this.nameScreen.style.display = "flex";
      this.heroNameInput.focus();
      if (this.onWelcomeStartCallback) this.onWelcomeStartCallback();
    });

    this.continueBtn.addEventListener("click", () => this._triggerStart());

    this.heroNameInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") this._triggerStart();
    });

    // ⚙️ APERTURA / CHIUSURA OVERLAY PAUSA
    this.pauseBtn.addEventListener("click", () => this.toggleSettings());
    this.closeSettingsBtn.addEventListener("click", () => this.toggleSettings());

    // Toggle Pausa tramite ESC o P
    window.addEventListener("keydown", (e) => {
      if ((e.key === "Escape" || e.key.toLowerCase() === "p") && this.gameState === "PLAYING") {
        this.toggleSettings();
      }
    });

    // Slider volumi
    this.bgmSlider.addEventListener("input", (e) => {
      const val = e.target.value;
      this.bgmValText.textContent = `${val}%`;
      if (this.onBGMVolumeChange) this.onBGMVolumeChange(val / 100);
    });

    this.sfxSlider.addEventListener("input", (e) => {
      const val = e.target.value;
      this.sfxValText.textContent = `${val}%`;
      if (this.onSFXVolumeChange) this.onSFXVolumeChange(val / 100);
    });
  }

  toggleSettings() {
    this.isPaused = !this.isPaused;

    if (this.isPaused) {
      // 🏷️ Cambia il titolo in base alla fase del gioco
      if (this.settingsTitle) {
        this.settingsTitle.textContent = this.gameState === "PLAYING" ? "Pause" : "Settings";
      }
      this.pauseOverlay.classList.remove("hidden");
    } else {
      this.pauseOverlay.classList.add("hidden");
    }
  }

  _triggerStart() {
    const enteredName = this.heroNameInput.value.trim().toUpperCase();
    const defaultName = this.selectedCharacter === "mario" ? "MARIO" : "LUIGI";
    const finalName = enteredName !== "" ? enteredName : defaultName;

    this.hudHeroName.textContent = finalName;
    if (this.hudCharIcon) {
      this.hudCharIcon.src =
        this.selectedCharacter === "mario"
          ? "assets/images/mario-icon.png"
          : "assets/images/luigi-icon.png";
    }
    this.hudHeroName.style.color =
      this.selectedCharacter === "mario" ? "#e52521" : "#43b047";

    this.gameState = "PLAYING";
    
    // 🏷️ Cambia la scritta del pulsante in alto a destra quando parte la partita
    if (this.pauseBtn) {
      this.pauseBtn.textContent = "☰ Pause";
    }

    this.nameScreen.style.display = "none";
    this.hud.style.display = "flex";

    if (this.onStartCallback) {
      this.onStartCallback({
        character: this.selectedCharacter,
        name: finalName,
      });
    }
  }

  onWelcomeStart(cb) { this.onWelcomeStartCallback = cb; }
  onCharacterSelect(cb) { this.onSelectCallback = cb; }
  onGameStart(cb) { this.onStartCallback = cb; }
}