import {
  getStoredMuteState,
  setStoredMuteState,
  getStoredCameraInvertX,
  setStoredCameraInvertX,
  getStoredCameraInvertY,
  setStoredCameraInvertY,
} from "../utils/storage.js";
import { assetUrl } from "../core/Assets/basePath.js";

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
    // Two lookups for the same <h1>: falls back to id+class in case the
    // markup's hardcoded "THANK YOU, HERO!" id ever gets dropped again.
    this.victoryFinaleTitle =
      document.getElementById("victory-finale-title") ||
      document.querySelector("#victory-finale-screen .win-title");
    if (!this.victoryFinaleTitle) {
      console.warn(
        "[UIManager] Victory-finale title not found — the ending screen will " +
          "keep its placeholder text instead of greeting the player by name.",
      );
    }
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

    // Boss health bar (showBossHealthBar/updateBossHealthBar/
    // hideBossHealthBar below), driven from main.js on Bowser's/Kamek's arena.
    this.bossHpBar = document.getElementById("boss-hp-bar");
    this.bossHpNameEl = document.getElementById("boss-hp-name");
    this.bossHpBlocksEl = document.getElementById("boss-hp-blocks");
    this._bossHpBlockEls = [];
    // Which boss the bar is currently built for, so main.js's per-frame
    // showBossHealthBar call only rebuilds segments when it changed.
    this.activeBossHpKey = null;

    // Interaction prompt, quest HUD, and toast (see js/interactions/) — all
    // optional in the DOM, every method below checks its element first.
    this.interactionPromptEl = document.getElementById("interaction-prompt");
    this.questHudEl = document.getElementById("quest-hud");
    this.toastEl = document.getElementById("toast");
    this._toastTimer = null;

    // Quest objective panel and "get off Yoshi" warp-star warning (see
    // QuestManager and Decorations._updateYoshiWarpWarning) — same optional-DOM convention.
    this.questObjectiveEl = document.getElementById("quest-objective");
    this.yoshiWarpWarningEl = document.getElementById("yoshi-warp-warning");

    // Peach's ending dialogue (see PeachCutscene.js) and the final victory
    // screen shown once it finishes.
    this.dialogueBoxEl = document.getElementById("dialogue-box");
    this.dialogueSpeakerEl = document.getElementById("dialogue-speaker");
    this.dialogueTextEl = document.getElementById("dialogue-text");
    this.dialogueHintEl = document.getElementById("dialogue-hint");
    this.victoryFinaleScreen = document.getElementById("victory-finale-screen");
    this.victoryFinaleMenuBtn = document.getElementById("victory-finale-menu-btn");
    // True for the whole span of Peach's cutscene — EntityManager freezes
    // the player and main.js hands the camera to PeachCutscene while this is true.
    this.dialogueActive = false;

    if (this.victoryFinaleMenuBtn) {
      this.victoryFinaleMenuBtn.addEventListener("click", () => this.returnToMainMenu());
    }

    this.gameState = "MENU_WELCOME";
    this.selectedCharacter = "mario";
    this.isPaused = false;
    this.audio = null;
    // The name entered on the character-select screen (see _triggerStart)
    // — reused by PeachCutscene to address the player by name.
    this.heroName = "";

    this.coins = 0;
    this.lives = 10;
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

    // --- CAMERA INVERT TOGGLES / LOCALSTORAGE LOGIC ---
    // Read directly by CameraManager every frame (see storage.js), so all
    // this button needs to do is flip + persist the flag.
    this.btnInvertCamX = document.getElementById("btn-invert-cam-x");
    this.btnInvertCamY = document.getElementById("btn-invert-cam-y");

    this.isCameraInvertedX = getStoredCameraInvertX();
    this.isCameraInvertedY = getStoredCameraInvertY();
    this._updateCameraInvertButtonsUI();

    if (this.btnInvertCamX) {
      this.btnInvertCamX.addEventListener("click", () => {
        this.isCameraInvertedX = !this.isCameraInvertedX;
        setStoredCameraInvertX(this.isCameraInvertedX);
        this._updateCameraInvertButtonsUI();
      });
    }

    if (this.btnInvertCamY) {
      this.btnInvertCamY.addEventListener("click", () => {
        this.isCameraInvertedY = !this.isCameraInvertedY;
        setStoredCameraInvertY(this.isCameraInvertedY);
        this._updateCameraInvertButtonsUI();
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

  // Deducts coins (Toad's quest turn-in actually spends the 25 coins rather
  // than just checking them off — see QuestManager.onToadInteract). Never below 0.
  spendCoins(amount) {
    this.coins = Math.max(0, this.coins - amount);
    if (this.coinsCountEl) this.coinsCountEl.textContent = this.coins;
  }

  // Shows the boss bar for `key` (a stable id) with `name` and `maxHits`
  // segments. Safe every frame — blocks only rebuild when the boss changes.
  showBossHealthBar(key, name, maxHits) {
    if (!this.bossHpBar) return;

    if (this.activeBossHpKey !== key) {
      this.activeBossHpKey = key;
      if (this.bossHpNameEl) this.bossHpNameEl.textContent = name;

      if (this.bossHpBlocksEl) {
        this.bossHpBlocksEl.innerHTML = "";
        this._bossHpBlockEls = [];
        for (let i = 0; i < maxHits; i++) {
          const block = document.createElement("div");
          block.className = "boss-hp-block";
          this.bossHpBlocksEl.appendChild(block);
          this._bossHpBlockEls.push(block);
        }
      }
    }

    this.bossHpBar.classList.remove("hidden");
  }

  // Blackens `hitsTaken` blocks from the RIGHT end (health drains
  // left-to-right), called from main.js's onStomped handlers on each new hit.
  updateBossHealthBar(hitsTaken, maxHits) {
    const blocks = this._bossHpBlockEls;
    if (!blocks || blocks.length === 0) return;

    const hits = Math.max(0, Math.min(hitsTaken, maxHits));
    blocks.forEach((block, i) => {
      const fromRight = blocks.length - 1 - i;
      block.classList.toggle("hit", fromRight < hits);
    });
  }

  // Hides the bar (arena exited or boss defeated). Doesn't reset
  // activeBossHpKey — re-entering the SAME boss' arena skips the rebuild.
  hideBossHealthBar() {
    if (this.bossHpBar) this.bossHpBar.classList.add("hidden");
  }

  // --- INTERACTIONS (js/interactions/InteractionManager.js) ---

  showInteractionPrompt(text) {
    if (!this.interactionPromptEl) return;
    this.interactionPromptEl.textContent = "";
    const label = document.createElement("span");
    label.textContent = text;
    this.interactionPromptEl.appendChild(label);
    this.interactionPromptEl.classList.remove("hidden");
  }

  hideInteractionPrompt() {
    if (this.interactionPromptEl) this.interactionPromptEl.classList.add("hidden");
  }

  // --- QUEST HUD (js/interactions/QuestManager.js) ---

  showQuestHud(text) {
    if (!this.questHudEl) return;
    this.questHudEl.textContent = text;
    this.questHudEl.classList.remove("hidden");
  }

  hideQuestHud() {
    if (this.questHudEl) this.questHudEl.classList.add("hidden");
  }

  // --- QUEST OBJECTIVE PANEL (js/interactions/QuestManager.js) ---

  showQuestObjective(text) {
    if (!this.questObjectiveEl) return;
    this.questObjectiveEl.textContent = text;
    this.questObjectiveEl.classList.remove("hidden");
  }

  hideQuestObjective() {
    if (this.questObjectiveEl) this.questObjectiveEl.classList.add("hidden");
  }

  // --- YOSHI / WARP STAR WARNING (js/entities/Level/Decorations.js) ---

  showYoshiWarpWarning() {
    if (!this.yoshiWarpWarningEl) return;
    this.yoshiWarpWarningEl.textContent = "Get off Yoshi to use the Warp Star!";
    this.yoshiWarpWarningEl.classList.remove("hidden");
  }

  hideYoshiWarpWarning() {
    if (this.yoshiWarpWarningEl) this.yoshiWarpWarningEl.classList.add("hidden");
  }

  // Brief feedback message shown for `duration` ms then auto-hidden.
  // Restarts its own timer each call, so overlapping toasts replace text.
  showToast(text, duration = 3200) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.classList.remove("hidden");

    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toastEl.classList.add("hidden");
      this._toastTimer = null;
    }, duration);
  }

  // --- PEACH'S DIALOGUE (js/interactions/PeachCutscene.js) ---

  // `isLastLine` swaps the "Press E to continue" hint for a clearer
  // "Press E to close" on the final line.
  showDialogue(speaker, text, isLastLine = false) {
    if (this.dialogueSpeakerEl) this.dialogueSpeakerEl.textContent = speaker;
    if (this.dialogueTextEl) this.dialogueTextEl.textContent = text;
    if (this.dialogueHintEl) {
      this.dialogueHintEl.textContent = isLastLine
        ? "Press E to close"
        : "Press E to continue";
    }
    if (this.dialogueBoxEl) this.dialogueBoxEl.classList.remove("hidden");

    // Movement/jump would otherwise fight for the same keys while a
    // dialogue line is up.
    this.hideInteractionPrompt();
  }

  hideDialogue() {
    if (this.dialogueBoxEl) this.dialogueBoxEl.classList.add("hidden");
  }

  // The final "you win" screen shown once Peach's dialogue finishes —
  // distinct from showWin()'s star-collection screen, which leads into it.
  showVictoryFinale() {
    // A distinct terminal state: EntityManager.update() only updates the
    // player while gameState is "PLAYING"/"ENDING", freezing movement here.
    this.gameState = "VICTORY_FINALE";

    if (this.hud) this.hud.style.display = "none";
    if (this.pauseBtn) this.pauseBtn.style.display = "none";

    // Addressed by the name typed at character select (see _triggerStart).
    // textContent, not innerHTML: the name is player input.
    if (this.victoryFinaleTitle) {
      this.victoryFinaleTitle.textContent = `THANK YOU, ${this.heroName || "HERO"}!`;
    }

    if (this.victoryFinaleScreen) this.victoryFinaleScreen.classList.remove("hidden");
  }

  addStar(amount = 1, audio = null) {
    this.stars += amount;
    if (this.starsCountEl)
      this.starsCountEl.textContent = `${this.stars}/${this.maxStars}`;

    // Win condition, same stop-everything-and-show-an-overlay flow as
    // showGameOver(). Guarded on gameState so stars picked up after can't retrigger it.
    if (this.stars >= this.maxStars && this.gameState === "PLAYING") {
      this.showWin(audio);
    }
  }

  // Shows the victory screen at maxStars, swapping BGM for the ending theme
  // — mirrors showGameOver()'s flow, just for a win.
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

      // playTrack() rather than playSFX(): it's a long music file and
      // playSFX's clone-then-play would sit silent until a second download.
      try {
        if (typeof soundManager.playTrack === "function") {
          soundManager.playTrack("ending");
        } else if (typeof soundManager.playSFX === "function") {
          soundManager.playSFX("ending");
        }
      } catch (e) {}
    }
  }

  // "REACH PRINCESS PEACH": closes the win screen and hands control back,
  // now in front of Peach's castle (teleport is main.js's onReachPeach).
  reachPeach() {
    // If the ending zone didn't load, teleporting would drop the player
    // into empty space — better to leave the win screen up instead.
    if (!this.onReachPeach || this.onReachPeach() !== true) return;

    if (this.winScreen) this.winScreen.classList.add("hidden");
    if (this.hud) this.hud.style.display = "block";
    if (this.pauseBtn) this.pauseBtn.style.display = "block";

    // Not "PLAYING": otherwise addStar() could fire showWin() again from
    // an extra scattered star. Pause stays reachable, so menu stays available.
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
    if (this.victoryFinaleScreen) this.victoryFinaleScreen.classList.add("hidden");
    if (this.questHudEl) this.questHudEl.classList.add("hidden");
    if (this.questObjectiveEl) this.questObjectiveEl.classList.add("hidden");
    if (this.yoshiWarpWarningEl) this.yoshiWarpWarningEl.classList.add("hidden");
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

    this.heroName = finalName;
    this.hudHeroName.textContent = finalName;
    if (this.hudCharIcon) {
      this.hudCharIcon.src =
        this.selectedCharacter === "mario"
          ? assetUrl("assets/images/mario-icon.png")
          : assetUrl("assets/images/luigi-icon.png");
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

  _updateCameraInvertButtonsUI() {
    if (this.btnInvertCamX) {
      this.btnInvertCamX.innerText = this.isCameraInvertedX ? "INVERTED" : "NORMAL";
    }
    if (this.btnInvertCamY) {
      this.btnInvertCamY.innerText = this.isCameraInvertedY ? "INVERTED" : "NORMAL";
    }
  }

  onResetToMenu(cb) { this.onResetToMenuCallback = cb; }
  onWelcomeStart(cb) { this.onWelcomeStartCallback = cb; }
  onCharacterSelect(cb) { this.onSelectCallback = cb; }
  onGameStart(cb) { this.onStartCallback = cb; }
}
