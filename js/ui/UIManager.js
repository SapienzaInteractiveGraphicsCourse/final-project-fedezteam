import { getStoredMuteState, setStoredMuteState } from "../utils/storage.js";
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
    // Two ways of finding the same <h1>, because losing it is silent: the
    // title has a hardcoded "THANK YOU, HERO!" in the markup, so if the
    // lookup comes back null showVictoryFinale simply leaves that in place
    // and the screen looks fine while quietly not greeting anyone by name.
    // That already happened once when an editor round-trip dropped the id
    // from index.html. The fallback keys off the screen's own id plus the
    // title class instead, so both would have to go for it to break.
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

    // Boss health bar (see showBossHealthBar/updateBossHealthBar/
    // hideBossHealthBar below) — driven from main.js while the player is on
    // Bowser's or Kamek's arena.
    this.bossHpBar = document.getElementById("boss-hp-bar");
    this.bossHpNameEl = document.getElementById("boss-hp-name");
    this.bossHpBlocksEl = document.getElementById("boss-hp-blocks");
    this._bossHpBlockEls = [];
    // Tracks which boss the bar is currently built for, so main.js's
    // per-frame showBossHealthBar call only rebuilds the segments when it
    // changed — see showBossHealthBar.
    this.activeBossHpKey = null;

    // Interaction prompt ("Press E to ..."), quest HUD (Toad's 25-coin
    // quest progress) and toast (brief quest feedback messages) — see
    // js/interactions/. All optional in the DOM: every method below checks
    // its element before touching it, so nothing breaks if index.html is
    // ever loaded without these.
    this.interactionPromptEl = document.getElementById("interaction-prompt");
    this.questHudEl = document.getElementById("quest-hud");
    this.toastEl = document.getElementById("toast");
    this._toastTimer = null;

    // Sequential quest objective panel (top-right, under the pause button)
    // and the "get off Yoshi" warp-star warning — see QuestManager and
    // Decorations._updateYoshiWarpWarning. Same "optional, checked before
    // every use" convention as the elements above.
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
    // True for the whole span of Peach's cutscene (from the E press that
    // starts it to the last dialogue line) — EntityManager checks this to
    // freeze the player, and main.js checks it to hand the camera over to
    // PeachCutscene.updateCamera() instead of the normal follow-cam.
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

  // Deducts coins (used by Toad's quest turn-in: the 25 coins the player
  // hands over are actually spent, not just "checked off" — see
  // QuestManager.onToadInteract). Never goes below 0.
  spendCoins(amount) {
    this.coins = Math.max(0, this.coins - amount);
    if (this.coinsCountEl) this.coinsCountEl.textContent = this.coins;
  }

  /**
   * Shows the boss health bar for `key` (a stable id like "bowser"/"kamek",
   * used only to detect "is this already the active boss" — never shown to
   * the player) with `name` as the label and `maxHits` segments, so the
   * bar's segment count always matches that boss' actual hit count (5 for
   * Bowser, 3 for Kamek — see Bowser.js/Kamek.js's hitsToDefeat). Safe to
   * call every frame the player is inside the arena — rebuilding the
   * block elements only happens the first time (or if a different boss
   * becomes active), everything else is just un-hiding the bar.
   */
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

  // Blackens `hitsTaken` blocks starting from the RIGHT end (the boss'
  // health draining left-to-right as it takes hits), leaving the remaining
  // blocks their normal yellow — called from main.js's onStomped handlers,
  // right when Enemy._onStomped reports a new hit.
  updateBossHealthBar(hitsTaken, maxHits) {
    const blocks = this._bossHpBlockEls;
    if (!blocks || blocks.length === 0) return;

    const hits = Math.max(0, Math.min(hitsTaken, maxHits));
    blocks.forEach((block, i) => {
      const fromRight = blocks.length - 1 - i;
      block.classList.toggle("hit", fromRight < hits);
    });
  }

  // Hides the bar (called once the player leaves the arena, or the boss is
  // defeated). Doesn't reset activeBossHpKey: re-entering the SAME boss'
  // arena via showBossHealthBar doesn't need to rebuild them.
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

  // Brief feedback message (quest assigned/updated/completed, ...), shown
  // for `duration` ms then auto-hidden. Restarts its own timer on every
  // call, so a second toast while one is already showing just replaces the
  // text and keeps the clock from there instead of stacking/flickering.
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

  // The final "you win" screen shown once Peach's dialogue finishes — a
  // separate screen from showWin()'s star-collection win screen: that one
  // leads INTO the ending zone, this one is what closes it out.
  showVictoryFinale() {
    // A distinct terminal state (not "ENDING" anymore) — this is what
    // actually stops the player from walking around under the final popup:
    // EntityManager.update() only keeps updating the player while
    // gameState is "PLAYING" or "ENDING", so anything else (this included)
    // freezes movement/physics automatically, and the Escape/P pause
    // shortcut is gated the same way (see _setupListeners), so the whole
    // game is inert behind this screen. dialogueActive is already false by
    // the time this runs (see PeachCutscene.advance), so that alone was NOT
    // enough to keep the player frozen once the dialogue closed — this is
    // the actual fix.
    this.gameState = "VICTORY_FINALE";

    if (this.hud) this.hud.style.display = "none";
    if (this.pauseBtn) this.pauseBtn.style.display = "none";

    // Addressed to the player by the name they typed at the character
    // select screen, the same one Peach uses in her dialogue and the HUD
    // shows all game (see _triggerStart, which already uppercases it and
    // falls back to MARIO/LUIGI when the field is left blank). "HERO" is
    // only reached if this screen is somehow shown without a game having
    // been started. textContent, not innerHTML: the name is player input.
    if (this.victoryFinaleTitle) {
      this.victoryFinaleTitle.textContent = `THANK YOU, ${this.heroName || "HERO"}!`;
    }

    if (this.victoryFinaleScreen) this.victoryFinaleScreen.classList.remove("hidden");
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

  onResetToMenu(cb) { this.onResetToMenuCallback = cb; }
  onWelcomeStart(cb) { this.onWelcomeStartCallback = cb; }
  onCharacterSelect(cb) { this.onSelectCallback = cb; }
  onGameStart(cb) { this.onStartCallback = cb; }
}
