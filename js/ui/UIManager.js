export default class UIManager {
  constructor() {
    this.welcomeScreen = document.getElementById("welcome-screen");
    this.nameScreen = document.getElementById("name-screen");
    this.hud = document.getElementById("hud");
    this.gameOverScreen = document.getElementById("game-over-screen");

    this.startBtn = document.getElementById("start-btn");
    this.continueBtn = document.getElementById("continue-btn");
    this.restartBtn = document.getElementById("restart-btn"); // Pulsante MAIN MENU
    
    this.heroNameInput = document.getElementById("hero-name-input");
    this.hudHeroName = document.getElementById("hud-hero-name");
    this.hudCharIcon = document.getElementById("hud-char-icon");

    this.coinsCountEl = document.getElementById("coins-count");
    this.livesCountEl = document.getElementById("lives-count");
    this.starsCountEl = document.getElementById("stars-count");

    this.pauseBtn = document.getElementById("pause-btn");
    this.closeSettingsBtn = document.getElementById("close-settings-btn");
    this.pauseOverlay = document.getElementById("pause-overlay");
    this.settingsTitle = document.getElementById("settings-title");
    this.bgmSlider = document.getElementById("bgm-slider");
    this.sfxSlider = document.getElementById("sfx-slider");
    this.bgmValText = document.getElementById("bgm-val");
    this.sfxValText = document.getElementById("sfx-val");

    this.btnMario = document.getElementById("btn-mario");
    this.btnLuigi = document.getElementById("btn-luigi");

    this.gameState = "MENU_WELCOME"; 
    this.selectedCharacter = "mario"; 
    this.isPaused = false;
    
    this.coins = 0;
    this.lives = 4;
    this.stars = 0;
    this.maxStars = 5;

    this.onStartCallback = null;
    this.onResetToMenuCallback = null;

    this._setupListeners();
  }

  _setupListeners() {
    this.btnMario.addEventListener("click", () => {
      if (this.selectedCharacter !== "mario") {
        this.selectedCharacter = "mario";
        this.btnMario.className = "char-card selected-mario";
        this.btnLuigi.className = "char-card";
        if (this.onSelectCallback) this.onSelectCallback("mario");
      }
    });

    this.btnLuigi.addEventListener("click", () => {
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

    // 🔄 Pressione Tasto MAIN MENU da Game Over
    if (this.restartBtn) {
      this.restartBtn.addEventListener("click", () => this.returnToMainMenu());
    }

    this.pauseBtn.addEventListener("click", () => this.toggleSettings());
    this.closeSettingsBtn.addEventListener("click", () => this.toggleSettings());

    window.addEventListener("keydown", (e) => {
      if ((e.key === "Escape" || e.key.toLowerCase() === "p") && this.gameState === "PLAYING") {
        this.toggleSettings();
      }
    });

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

  // 💀 Sottrazione vita e gestione dell'ultima possibilità (0 vite)
  removeLife(amount = 1, audio = null) {
    // Se era già a 0 vite (ultima vita) ed è morto di nuovo -> GAME OVER
    if (this.lives <= 0) {
      this.showGameOver(audio);
      return true; // Restituisce true se è Game Over
    }

    // Altrimenti scala la vita (es. da 1 passa a 0 ed è ancora in gioco)
    this.lives -= amount;

    if (this.livesCountEl) {
      this.livesCountEl.textContent = Math.max(0, this.lives);
    }

    return false; // Restituisce false se è ancora vivo
  }

  addLife(amount = 1) {
    this.lives += amount;
    if (this.livesCountEl) this.livesCountEl.textContent = this.lives;
  }

  addCoin(amount = 1) {
    this.coins += amount;
    if (this.coinsCountEl) this.coinsCountEl.textContent = this.coins;
  }

  addStar(amount = 1) {
    this.stars += amount;
    if (this.starsCountEl) this.starsCountEl.textContent = `${this.stars}/${this.maxStars}`;
  }

  // 💀 Mostra la schermata Game Over, stacca la BGM e suona gameover.mp3
  showGameOver(audio = null) {
    this.gameState = "GAME_OVER";
    
    if (this.hud) this.hud.style.display = "none";
    if (this.pauseBtn) this.pauseBtn.style.display = "none";
    if (this.gameOverScreen) this.gameOverScreen.classList.remove("hidden");

    // 🎵 Stop BGM + Play gameover.mp3
    if (audio) {
      // 1. Ferma la musica di sottofondo
      try {
        if (typeof audio.stopBGM === "function") audio.stopBGM();
        else if (typeof audio.stop === "function") audio.stop('bgm');
        else if (audio.bgm && audio.bgm.pause) audio.bgm.pause();
        else if (audio.sounds && audio.sounds.bgm && audio.sounds.bgm.pause) audio.sounds.bgm.pause();
      } catch (e) {
        console.warn("Errore nello stop della musica BGM:", e);
      }

      // 2. Riproduce il suono di Game Over
      try {
        if (typeof audio.playSFX === "function") {
          audio.playSFX('gameover');
        } else if (typeof audio.play === "function") {
          audio.play('gameover');
        }
      } catch (e) {
        console.warn("Errore nella riproduzione di gameover.mp3:", e);
      }
    }
  }

  // 🔄 Ritorno al Menù Iniziale
  returnToMainMenu() {
    // Ripristino dati
    this.lives = 4;
    this.coins = 0;
    this.stars = 0;

    if (this.livesCountEl) this.livesCountEl.textContent = this.lives;
    if (this.coinsCountEl) this.coinsCountEl.textContent = this.coins;
    if (this.starsCountEl) this.starsCountEl.textContent = `${this.stars}/${this.maxStars}`;

    // Reset Interfaccia
    if (this.gameOverScreen) this.gameOverScreen.classList.add("hidden");
    if (this.hud) this.hud.style.display = "none";
    if (this.pauseBtn) this.pauseBtn.style.display = "block";
    
    if (this.welcomeScreen) this.welcomeScreen.style.display = "flex";
    if (this.nameScreen) this.nameScreen.style.display = "none";

    this.gameState = "MENU_WELCOME";

    // Ricarica la pagina per resettare completamente il mondo di gioco o esegui il callback
    if (this.onResetToMenuCallback) {
      this.onResetToMenuCallback();
    } else {
      window.location.reload();
    }
  }

  // Metodo per collegare l'AudioManager a UIManager
  setAudio(audio) {
    this.audio = audio;
  }

  toggleSettings() {
    this.isPaused = !this.isPaused;

    // 🔊 Riproduce menu_pause.wav sia all'apertura che alla chiusura
    if (this.audio) {
      if (typeof this.audio.playSFX === "function") {
        this.audio.playSFX('pause');
      } else if (typeof this.audio.play === "function") {
        this.audio.play('pause');
      }
    }

    if (this.isPaused) {
      if (this.settingsTitle) this.settingsTitle.textContent = "Settings";
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
    
    if (this.pauseBtn) this.pauseBtn.textContent = "☰ Settings";

    this.nameScreen.style.display = "none";
    this.hud.style.display = "block";

    if (this.onStartCallback) {
      this.onStartCallback({
        character: this.selectedCharacter,
        name: finalName,
      });
    }
  }

  onResetToMenu(cb) { this.onResetToMenuCallback = cb; }
  onWelcomeStart(cb) { this.onWelcomeStartCallback = cb; }
  onCharacterSelect(cb) { this.onSelectCallback = cb; }
  onGameStart(cb) { this.onStartCallback = cb; }
}