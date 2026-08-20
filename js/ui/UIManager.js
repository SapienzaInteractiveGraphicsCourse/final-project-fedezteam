import { getStoredMuteState, setStoredMuteState } from "../utils/storage.js";

export default class UIManager {
  constructor() {
    this.welcomeScreen = document.getElementById("welcome-screen");
    this.nameScreen = document.getElementById("name-screen");
    this.hud = document.getElementById("hud");
    this.gameOverScreen = document.getElementById("game-over-screen");
    this.winScreen = document.getElementById("win-screen");

    this.startBtn = document.getElementById("start-btn");
    this.continueBtn = document.getElementById("continue-btn");
    this.restartBtn = document.getElementById("restart-btn");
    this.winPeachBtn = document.getElementById("win-peach-btn");

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
    this.audio = null;

    this.coins = 0;
    this.lives = 4;
    this.stars = 0;
    this.maxStars = 5;

    this.onStartCallback = null;
    this.onResetToMenuCallback = null;

    this.btnMute = document.getElementById("btn-mute");
    this.btnReturnMenu = document.getElementById("btn-return-menu");

    // --- MUTE BUTTON / LOCALSTORAGE LOGIC ---
    // Restore the previously saved mute state (defaults to false if none exists).
    this.isMuted = getStoredMuteState();
    this._updateMuteButtonUI();

    if (this.btnMute) {
      this.btnMute.addEventListener("click", () => {
        this.isMuted = !this.isMuted;
        setStoredMuteState(this.isMuted);
        this._updateMuteButtonUI();

        if (this.audio && typeof this.audio.setMute === "function") {
          this.audio.setMute(this.isMuted);
        }

        if (this.onMuteToggle) this.onMuteToggle(this.isMuted);
      });
    }

    // --- "RETURN TO MENU" BUTTON LOGIC ---
    if (this.btnReturnMenu) {
      this.btnReturnMenu.addEventListener("click", () => {
        if (this.onReturnToMenu) this.onReturnToMenu();
      });
    }

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

      // Start audio playback on the first real user gesture, as required
      // by browser autoplay policies.
      if (this.audio && typeof this.audio.playBGM === "function") {
        this.audio.playBGM();
      }

      if (this.onWelcomeStartCallback) this.onWelcomeStartCallback();
    });

    this.continueBtn.addEventListener("click", () => this._triggerStart());

    // "Restart game" button press, shown on the Game Over screen.
    if (this.restartBtn) {
      this.restartBtn.addEventListener("click", () => this.returnToMainMenu());
    }

    // Same button, shown on the Win screen instead.
    if (this.winPeachBtn) {
      this.winPeachBtn.addEventListener("click", () => this.reachPeach());
    }

    this.pauseBtn.addEventListener("click", () => this.toggleSettings());
    this.closeSettingsBtn.addEventListener("click", () => this.toggleSettings());

    window.addEventListener("keydown", (e) => {
      if (
        (e.key === "Escape" || e.key.toLowerCase() === "p") &&
        (this.gameState === "PLAYING" || this.gameState === "ENDING")
      ) {
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

  // Removes a life and handles the "last life lost" case (0 lives -> Game Over).
  removeLife(amount = 1, audio = null) {
    // If lives were already at 0 (last life) and the player died again,
    // trigger Game Over.
    if (this.lives <= 0) {
      this.showGameOver(audio);
      return true;
    }

    // Otherwise, just decrease the life count (e.g. 1 -> 0, still playing).
    this.lives -= amount;

    if (this.livesCountEl) {
      this.livesCountEl.textContent = Math.max(0, this.lives);
    }

    return false; // Returns false while the player is still alive.
  }

  addLife(amount = 1) {
    this.lives += amount;
    if (this.livesCountEl) this.livesCountEl.textContent = this.lives;
  }

  addCoin(amount = 1) {
    this.coins += amount;
    if (this.coinsCountEl) this.coinsCountEl.textContent = this.coins;
  }

  addStar(amount = 1, audio = null) {
    this.stars += amount;
    if (this.starsCountEl)
      this.starsCountEl.textContent = `${this.stars}/${this.maxStars}`;

    // Win condition: collecting maxStars ends the game — same
    // stop-everything-and-show-an-overlay flow as showGameOver(), just for
    // a win instead of a loss. Guarded on gameState so picking up further
    // stars afterward (there are more than maxStars scattered around the
    // level) can't re-trigger it.
    if (this.stars >= this.maxStars && this.gameState === "PLAYING") {
      this.showWin(audio);
    }
  }

  // Shows the victory screen once the player reaches maxStars, swapping the
  // background music for the ending theme — mirrors showGameOver()'s flow,
  // just for a win.
  showWin(audio = null) {
    this.gameState = "WIN";

    if (this.hud) this.hud.style.display = "none";
    if (this.pauseBtn) this.pauseBtn.style.display = "none";
    if (this.winScreen) this.winScreen.classList.remove("hidden");

    const soundManager = audio || this.audio;
    if (soundManager) {
      try {
        if (typeof soundManager.stopBGM === "function") soundManager.stopBGM();
        else if (typeof soundManager.stop === "function") soundManager.stop("bgm");
      } catch (e) {}

      // The ending theme takes the BGM's place, the way the game-over jingle
      // does on a loss. playTrack() rather than playSFX(): it's a long
      // music file, and playSFX's clone-then-play would leave it silent
      // until a second download of it finished — see AudioManager.playTrack.
      try {
        if (typeof soundManager.playTrack === "function") {
          soundManager.playTrack("ending");
        } else if (typeof soundManager.playSFX === "function") {
          soundManager.playSFX("ending");
        }
      } catch (e) {}
    }
  }

  /**
   * "REACH PRINCESS PEACH": closes the win screen and hands control back to
   * the player, now standing in front of Peach's castle — the teleport
   * itself is done by the onReachPeach callback wired up in main.js (see
   * entities/Level/EndingZone.js).
   *
   * The ending theme started by showWin() is left alone on purpose: it has
   * to carry over into the final scene, so nothing here touches the audio.
   */
  reachPeach() {
    // If the ending zone didn't load, teleporting would drop the player
    // into empty space — better to leave the win screen up than to strand
    // them somewhere they can't get out of.
    if (!this.onReachPeach || this.onReachPeach() !== true) return;

    if (this.winScreen) this.winScreen.classList.add("hidden");
    if (this.hud) this.hud.style.display = "block";
    if (this.pauseBtn) this.pauseBtn.style.display = "block";

    // Not "PLAYING": addStar() would then be free to fire showWin() all
    // over again if the player walks over another star (there are more of
    // them scattered around than maxStars). The pause menu is still
    // reachable in this state — see the keydown handler in _setupListeners
    // — so "RETURN TO MENU" remains available once the credits have
    // played out.
    this.gameState = "ENDING";
  }

  // Shows the Game Over screen, stops the background music and plays the
  // game-over sound effect.
  showGameOver(audio = null) {
    this.gameState = "GAME_OVER";

    if (this.hud) this.hud.style.display = "none";
    if (this.pauseBtn) this.pauseBtn.style.display = "none";
    if (this.gameOverScreen) this.gameOverScreen.classList.remove("hidden");

    // Stop the BGM and play the game-over sound effect.
    const soundManager = audio || this.audio;
    if (soundManager) {
      try {
        if (typeof soundManager.stopBGM === "function") soundManager.stopBGM();
        else if (typeof soundManager.stop === "function") soundManager.stop("bgm");
      } catch (e) {}

      try {
        if (typeof soundManager.playSFX === "function") {
          soundManager.playSFX("gameover");
        }
      } catch (e) {}
    }
  }

  // Returns to the main/welcome menu, resetting run state.
  returnToMainMenu() {
    // Reset run data.
    this.lives = 4;
    this.coins = 0;
    this.stars = 0;

    if (this.livesCountEl) this.livesCountEl.textContent = this.lives;
    if (this.coinsCountEl) this.coinsCountEl.textContent = this.coins;
    if (this.starsCountEl)
      this.starsCountEl.textContent = `${this.stars}/${this.maxStars}`;

    // Reset the UI screens.
    if (this.gameOverScreen) this.gameOverScreen.classList.add("hidden");
    if (this.winScreen) this.winScreen.classList.add("hidden");
    if (this.hud) this.hud.style.display = "none";
    if (this.pauseBtn) this.pauseBtn.style.display = "block";

    if (this.welcomeScreen) this.welcomeScreen.style.display = "flex";
    if (this.nameScreen) this.nameScreen.style.display = "none";

    this.gameState = "MENU_WELCOME";

    // Reload the page to fully reset the game world, unless a custom
    // reset callback was provided.
    if (this.onResetToMenuCallback) {
      this.onResetToMenuCallback();
    } else {
      window.location.reload();
    }
  }

  // Links the AudioManager instance to this UIManager.
  setAudio(audio) {
    this.audio = audio;
    if (this.audio && typeof this.audio.setMute === "function") {
      this.audio.setMute(this.isMuted);
    }
  }

  toggleSettings() {
    this.isPaused = !this.isPaused;

    // Play the pause sound effect both when opening and closing the panel.
    if (this.audio && typeof this.audio.playSFX === "function") {
      this.audio.playSFX("pause");
    }

    if (this.isPaused) {
      if (this.settingsTitle) this.settingsTitle.textContent = "Pause";
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

    if (this.pauseBtn) this.pauseBtn.textContent = "☰ Pause";

    this.nameScreen.style.display = "none";
    this.hud.style.display = "block";

    // Make sure the BGM starts even if the welcome-screen step was skipped.
    if (this.audio && typeof this.audio.playBGM === "function") {
      this.audio.playBGM();
    }

    if (this.onStartCallback) {
      this.onStartCallback({
        character: this.selectedCharacter,
        name: finalName,
      });
    }
  }

  _updateMuteButtonUI() {
    if (this.btnMute) {
      this.btnMute.innerText = this.isMuted ? "🔇 MUTED" : "🔊 UNMUTED";
    }
  }

  onResetToMenu(cb) { this.onResetToMenuCallback = cb; }
  onWelcomeStart(cb) { this.onWelcomeStartCallback = cb; }
  onCharacterSelect(cb) { this.onSelectCallback = cb; }
  onGameStart(cb) { this.onStartCallback = cb; }
}
