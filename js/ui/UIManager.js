export default class UIManager {
  constructor() {
    // Elementi Schermate
    this.welcomeScreen = document.getElementById("welcome-screen");
    this.nameScreen = document.getElementById("name-screen");
    this.hud = document.getElementById("hud");

    this.startBtn = document.getElementById("start-btn");
    this.continueBtn = document.getElementById("continue-btn");
    this.heroNameInput = document.getElementById("hero-name-input");
    this.hudHeroName = document.getElementById("hud-hero-name");
    this.hudCharIcon = document.getElementById("hud-char-icon");

    // Elementi Contatori HUD
    this.coinsCountEl = document.getElementById("coins-count");
    this.livesCountEl = document.getElementById("lives-count");
    this.starsCountEl = document.getElementById("stars-count");

    // Elementi Menu Pausa
    this.pauseBtn = document.getElementById("pause-btn");
    this.closeSettingsBtn = document.getElementById("close-settings-btn");
    this.pauseOverlay = document.getElementById("pause-overlay");
    this.settingsTitle = document.getElementById("settings-title");
    this.bgmSlider = document.getElementById("bgm-slider");
    this.sfxSlider = document.getElementById("sfx-slider");
    this.bgmValText = document.getElementById("bgm-val");
    this.sfxValText = document.getElementById("sfx-val");

    // Selezione Personaggio
    this.btnMario = document.getElementById("btn-mario");
    this.btnLuigi = document.getElementById("btn-luigi");

    // Stato del Gioco e Contatori
    this.gameState = "MENU_WELCOME"; 
    this.selectedCharacter = "mario"; 
    this.isPaused = false;
    
    this.coins = 0;
    this.lives = 4;
    this.stars = 0;
    this.maxStars = 5;

    // Callbacks
    this.onStartCallback = null;
    this.onSelectCallback = null;
    this.onWelcomeStartCallback = null;
    this.onBGMVolumeChange = null;
    this.onSFXVolumeChange = null;

    this._setupListeners();
  }

_setupListeners() {
    // Selezione Mario
    this.btnMario.addEventListener("click", () => {
      // 🔊 Riproduce il suono e aggiorna lo stato SOLO se Mario NON era già selezionato
      if (this.selectedCharacter !== "mario") {
        this.selectedCharacter = "mario";
        this.btnMario.className = "char-card selected-mario";
        this.btnLuigi.className = "char-card";
        
        if (this.onSelectCallback) this.onSelectCallback("mario");
      }
    });

    // Selezione Luigi
    this.btnLuigi.addEventListener("click", () => {
      // 🔊 Riproduce il suono e aggiorna lo stato SOLO se Luigi NON era già selezionato
      if (this.selectedCharacter !== "luigi") {
        this.selectedCharacter = "luigi";
        this.btnLuigi.className = "char-card selected-luigi";
        this.btnMario.className = "char-card";

        if (this.onSelectCallback) this.onSelectCallback("luigi");
      }
    });

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

  // Metodi per aggiornare le risorse in tempo reale
  addCoin(amount = 1) {
    this.coins += amount;
    if (this.coinsCountEl) this.coinsCountEl.textContent = this.coins;
  }

  addStar(amount = 1) {
    this.stars += amount;
    if (this.starsCountEl) this.starsCountEl.textContent = `${this.stars}/${this.maxStars}`;
  }

  removeLife(amount = 1) {
    this.lives = Math.max(0, this.lives - amount);
    if (this.livesCountEl) this.livesCountEl.textContent = this.lives;
  }

  toggleSettings() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      if (this.settingsTitle) {
        this.settingsTitle.textContent = "Settings";
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
    this.hud.style.display = "block";

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