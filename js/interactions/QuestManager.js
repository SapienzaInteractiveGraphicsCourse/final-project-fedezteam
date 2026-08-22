/**
 * QuestManager.js — drives the top-right "quest objective" HUD panel
 * through 5 sequential phases (see UIManager.showQuestObjective, wired from
 * _renderObjective below), each one named after one of the 5 stars that
 * make up ui.maxStars (see GameLevel.js's "STAR REBALANCE" comment):
 *
 *   Phase 1 (Stella 1 - Pianeta Rosso): use the yellow Warp Star to reach the
 *     Red Planet and collect its star. Detected via onStarCollected(id) —
 *     see EntityManager.onStarCollected / Collectibles' star `id` field.
 *   Phase 2 (Stella 2 - Yoshi & Stella Alta): hatch Yoshi's egg, then use
 *     his boosted jump to reach and collect the high star on Passerella
 *     Est (HillClimb Yoshi). Detected via markYoshiHatched() (called once
 *     from main.js's hatchYoshiEgg) followed by onStarCollected("yoshiHighStar").
 *   Phase 3 (Stella 3 - Kamek): talk to Toad to get the Kamek quest, defeat
 *     Kamek — his arena drops both the star AND the return Warp Star (see
 *     main.js's kamek.onDefeated) — then talk to Toad again to report back
 *     and unlock the next quest.
 *   Phase 4 (Stella 4 - Monete): talk to Toad to get the 25-coin quest,
 *     collect the coins, then talk to Toad again to turn them in and claim
 *     Toad's own reward star (there's no arena for this one to drop a star
 *     at, unlike Phases 3 and 5).
 *   Phase 5 (Stella 5 - Bowser): defeat Bowser — same as Kamek, his arena
 *     drops both the star and the return Warp Star — then talk to Toad one
 *     last time to report back and finish the game.
 *
 * Phase 1 and 2 are free-standing (the player can do them in any order,
 * whenever they like) — only Toad's own chain (Fasi 3 -> 4 -> 5) is a
 * strict sequence, tracked by `stage`. The HUD panel always shows the
 * FIRST incomplete phase in 1..5 order, which is a pure display choice: it
 * never blocks or gates anything already in the game (the Red Planet, the
 * Yoshi egg and both boss zones stay reachable exactly as before, in any
 * order) — see _renderObjective.
 *
 * Toad's OWN quest chain keeps the state-machine shape it always had (a
 * `stage` string + a switch): it's still strictly linear —
 * NONE -> KAMEK_QUEST -> KAMEK_RETURN -> COIN_QUEST -> COIN_QUEST_READY ->
 * BOWSER_QUEST -> BOWSER_RETURN -> ALL_DONE. Reporting back to Toad after
 * Kamek/Bowser (the two *_RETURN stages) is what UNLOCKS the next quest —
 * it does NOT hand over a star, since Kamek and Bowser each already
 * dropped their own at their arena (see main.js's onDefeated handlers).
 * The coin quest is the odd one out: there's no arena for it, so Toad
 * hands over its Power Star himself, right on turn-in (onRewardStar).
 *
 * Coin counting: the quest tracks the player's TOTAL coin wallet
 * (ui.coins), not a separate "collected since accepting" counter — a
 * player who already has 25+ coins when they accept the quest can turn it
 * in immediately, and handing the coins over on turn-in actually SPENDS 25
 * of them (see ui.spendCoins), rather than just checking a box.
 *
 * Toad's own lines (assigned/reminder/reward/...) are shown as a proper
 * speech-bubble dialogue (ui.showDialogue/hideDialogue, same widget Peach's
 * cutscene uses) rather than a toast, and — per spec — closed with E only
 * (see main.js's updateGame, which no longer accepts Space for this).
 * Ambient, non-interaction-triggered notices (Kamek/Bowser defeated, the
 * Red Planet/high stars) stay as toasts: there's no "E press" moment to
 * gate a blocking dialogue on for those.
 */
export default class QuestManager {
  constructor(ui) {
    this.ui = ui;

    // Toad's own chain: NONE -> KAMEK_QUEST -> KAMEK_RETURN -> COIN_QUEST
    // -> COIN_QUEST_READY -> BOWSER_QUEST -> BOWSER_RETURN -> ALL_DONE.
    this.stage = "NONE";
    this.coinTarget = 25;

    // Phase 1 — independent of Toad's chain, see class comment above.
    this.redPlanetStarDone = false;

    // Phase 2 — two sub-steps, both independent of Toad's chain: the egg
    // has to be hatched before the high star is even reachable, so the HUD
    // text can tell the two apart (see _renderObjective).
    this.yoshiEggHatched = false;
    this.yoshiStarDone = false;

    // True while a Toad dialogue line is up (ui.dialogueActive mirrors
    // this, but main.js needs to tell Toad's single-line "close" apart
    // from Peach's multi-line "advance" — see closeToadDialogue).
    this.dialogueOpen = false;

    // Set from main.js once Toad's position is known — spawns a Power Star
    // reward next to him on the coin quest's turn-in ONLY. Kamek and
    // Bowser each drop their own star at their arena instead (see main.js's
    // onDefeated handlers) — reporting back to Toad for those two just
    // advances the quest chain, see onToadInteract's KAMEK_RETURN/
    // BOWSER_RETURN cases.
    this.onRewardStar = null;

    this._renderObjective();
  }

  // Text shown by the "Press E ..." prompt while standing near Toad —
  // read fresh every frame (see InteractionManager), so it always reflects
  // the current quest stage without needing to be pushed manually.
  getToadPrompt() {
    if (this.stage === "KAMEK_RETURN") return "Press E to report Kamek's defeat";
    if (this.stage === "COIN_QUEST_READY") return "Press E to hand over the coins";
    if (this.stage === "BOWSER_RETURN") return "Press E to report Bowser's defeat";
    return "Press E to talk to Toad";
  }

  // Called by the Toad interactable's onInteract.
  onToadInteract() {
    switch (this.stage) {
      case "NONE":
        this.stage = "KAMEK_QUEST";
        this._showToadDialogue("Kamek is causing trouble nearby — go defeat him in his arena!");
        this._renderObjective();
        break;

      case "KAMEK_QUEST":
        this._showToadDialogue("Have you dealt with Kamek yet? Go find him in his arena!");
        break;

      case "KAMEK_RETURN":
        // No reward star here — Kamek already dropped one at his arena;
        // this just unlocks the coin quest.
        this.stage = "COIN_QUEST";
        this._showToadDialogue(
          `Well done defeating Kamek! Now, bring me ${this.coinTarget} coins and a reward is yours!`,
        );
        this._syncCoinProgress();
        this._renderObjective();
        break;

      case "COIN_QUEST": {
        const missing = Math.max(0, this.coinTarget - this.ui.coins);
        this._showToadDialogue(`You are still ${missing} short!`);
        break;
      }

      case "COIN_QUEST_READY":
        this.stage = "BOWSER_QUEST";
        this.ui.hideQuestHud();
        this.ui.spendCoins(this.coinTarget);
        if (this.onRewardStar) this.onRewardStar();
        this._showToadDialogue(
          "Thank you! Here is a Power Star for you! Now go and defeat Bowser!",
        );
        this._renderObjective();
        break;

      case "BOWSER_QUEST":
        this._showToadDialogue("Defeat Bowser in his arena!");
        break;

      case "BOWSER_RETURN":
        // Same as Kamek's return above — no reward star here either,
        // Bowser already dropped his at the arena.
        this.stage = "ALL_DONE";
        this._showToadDialogue(
          "Congratulations, hero! You defeated Bowser — the Mushroom Kingdom is safe once more!",
        );
        this._renderObjective();
        break;

      case "ALL_DONE":
        this._showToadDialogue("Thank you for saving the Mushroom Kingdom!");
        break;
    }
  }

  // Called from EntityManager.onCoinCollected (wired in main.js) every time
  // ANY coin is picked up anywhere in the level — a no-op unless the coin
  // quest is currently active. Also called right when the quest is first
  // assigned, in case the player already had 25+ coins in their wallet.
  onCoinCollected() {
    this._syncCoinProgress();
  }

  _syncCoinProgress() {
    if (this.stage !== "COIN_QUEST") return;

    const shown = Math.min(this.ui.coins, this.coinTarget);
    this.ui.showQuestHud(`COINS: ${shown}/${this.coinTarget}`);

    if (this.ui.coins >= this.coinTarget) {
      this.stage = "COIN_QUEST_READY";
      this.ui.showToast("You have enough coins! Head back to Toad!");
      this._renderObjective();
    }
  }

  // Called from Kamek's onDefeated (wired in main.js). Ambient notice, not
  // an E-press interaction, so this stays a toast rather than a dialogue.
  onKamekDefeated() {
    if (this.stage !== "KAMEK_QUEST") return;
    this.stage = "KAMEK_RETURN";
    this.ui.showToast("Kamek is defeated! Grab the star, then report back to Toad!");
    this._renderObjective();
  }

  // Called from Bowser's onDefeated (wired in main.js). Same reasoning.
  onBowserDefeated() {
    if (this.stage !== "BOWSER_QUEST") return;
    this.stage = "BOWSER_RETURN";
    this.ui.showToast("Bowser is defeated! Grab the star, then report back to Toad!");
    this._renderObjective();
  }

  // Called from EntityManager.onStarCollected (see Collectibles' star `id`
  // field) every time ANY star is picked up anywhere in the level — a no-op
  // unless `id` matches one this quest cares about.
  onStarCollected(id) {
    if (id === "redPlanetStar" && !this.redPlanetStarDone) {
      this.redPlanetStarDone = true;
      this.ui.showToast("Red Planet star collected!");
      this._renderObjective();
    } else if (id === "yoshiHighStar" && !this.yoshiStarDone) {
      this.yoshiStarDone = true;
      this.ui.showToast("High star collected!");
      this._renderObjective();
    }
  }

  // Called once from main.js's hatchYoshiEgg, right when the egg actually
  // hatches — only unlocks the SECOND half of Phase 2 (reaching the high
  // star with Yoshi's jump); see onStarCollected("yoshiHighStar") above.
  markYoshiHatched() {
    if (this.yoshiEggHatched) return;
    this.yoshiEggHatched = true;
    this.ui.showToast("Yoshi hatched!");
    this._renderObjective();
  }

  _showToadDialogue(text) {
    this.dialogueOpen = true;
    this.ui.dialogueActive = true;
    // Always a single line, so it's always "the last line" — the dialogue
    // hint reads "Press E to close" rather than "to continue".
    this.ui.showDialogue("TOAD", text, true);
  }

  // Called from main.js when E is pressed while a Toad line is up (see
  // updateGame — Space no longer does this, per spec).
  closeToadDialogue() {
    if (!this.dialogueOpen) return;
    this.dialogueOpen = false;
    this.ui.hideDialogue();
    this.ui.dialogueActive = false;
  }

  // Picks the first incomplete phase (1..5) and shows it on the top-right
  // HUD panel (see UIManager.showQuestObjective) — a pure display choice,
  // see class comment: it never gates anything in the level itself.
  _renderObjective() {
    let text;

    if (!this.redPlanetStarDone) {
      text = "Phase 1: use the yellow Warp Star to reach the Red Planet and collect its star!";
    } else if (!this.yoshiEggHatched) {
      text = "Phase 2: find Yoshi's egg and hatch it, then use his jump to reach the high star!";
    } else if (!this.yoshiStarDone) {
      text = "Phase 2: use Yoshi's jump to reach and collect the high star!";
    } else {
      switch (this.stage) {
        case "NONE":
          text = "Phase 3: talk to Toad to start Kamek's quest.";
          break;
        case "KAMEK_QUEST":
          text = "Phase 3: defeat Kamek and collect his star!";
          break;
        case "KAMEK_RETURN":
          text = "Phase 3: report back to Toad.";
          break;
        case "COIN_QUEST":
          text = `Phase 4: bring Toad ${this.coinTarget} coins.`;
          break;
        case "COIN_QUEST_READY":
          text = "Phase 4: return to Toad to claim your star.";
          break;
        case "BOWSER_QUEST":
          text = "Phase 5: defeat Bowser and collect his star!";
          break;
        case "BOWSER_RETURN":
          text = "Phase 5: report back to Toad.";
          break;
        case "ALL_DONE":
        default:
          text = "All quests complete — the Mushroom Kingdom is safe!";
          break;
      }
    }

    if (this.ui.showQuestObjective) this.ui.showQuestObjective(text);
  }
}
