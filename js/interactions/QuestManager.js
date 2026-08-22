/**
 * QuestManager.js — Toad's quest chain: talk to him to get a 25-coin
 * fetch quest (with its own HUD progress counter), turn the coins in for a
 * Power Star reward, then two follow-up "go defeat the boss" quests
 * (Kamek, then Bowser).
 *
 * A tiny state machine on purpose: every quest in this chain is strictly
 * linear (coins -> Kamek -> Bowser -> done), so a `stage` string plus a
 * switch is simpler and easier to follow than a generic quest-graph system
 * for a chain this short.
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
 * Ambient, non-interaction-triggered notices (coin-quest-ready while
 * walking around, Kamek/Bowser defeated) stay as toasts: there's no "E
 * press" moment to gate a blocking dialogue on for those.
 */
export default class QuestManager {
  constructor(ui) {
    this.ui = ui;

    this.stage = "NONE"; // NONE -> COIN_QUEST -> COIN_QUEST_READY -> KAMEK_QUEST -> BOWSER_QUEST -> ALL_DONE
    this.coinTarget = 25;

    // True while a Toad dialogue line is up (ui.dialogueActive mirrors
    // this, but main.js needs to tell Toad's single-line "close" apart
    // from Peach's multi-line "advance" — see closeToadDialogue).
    this.dialogueOpen = false;

    // Set from main.js once Toad's position is known — spawns the Power
    // Star reward next to him when the coin quest is turned in.
    this.onRewardStar = null;
  }

  // Text shown by the "Premi E ..." prompt while standing near Toad —
  // read fresh every frame (see InteractionManager), so it always reflects
  // the current quest stage without needing to be pushed manually.
  getToadPrompt() {
    if (this.stage === "COIN_QUEST_READY") return "Premi E per consegnare le monete";
    return "Premi E per parlare con Toad";
  }

  // Called by the Toad interactable's onInteract.
  onToadInteract() {
    switch (this.stage) {
      case "NONE":
        this.stage = "COIN_QUEST";
        this._showToadDialogue(`Raccogli ${this.coinTarget} monete e portamele!`);
        this._syncCoinProgress();
        break;

      case "COIN_QUEST": {
        const missing = Math.max(0, this.coinTarget - this.ui.coins);
        this._showToadDialogue(`Te ne mancano ancora ${missing}!`);
        break;
      }

      case "COIN_QUEST_READY":
        this.stage = "KAMEK_QUEST";
        this.ui.hideQuestHud();
        this.ui.spendCoins(this.coinTarget);
        if (this.onRewardStar) this.onRewardStar();
        this._showToadDialogue(
          "Grazie! Ecco una Power Star per te! Ora vai a sconfiggere Kamek!",
        );
        break;

      case "KAMEK_QUEST":
        this._showToadDialogue("Sconfiggi Kamek nella sua arena!");
        break;

      case "BOWSER_QUEST":
        this._showToadDialogue("Sconfiggi Bowser nella sua arena!");
        break;

      case "ALL_DONE":
        this._showToadDialogue("Grazie per aver salvato il Regno dei Funghi!");
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
    this.ui.showQuestHud(`MONETE: ${shown}/${this.coinTarget}`);

    if (this.ui.coins >= this.coinTarget) {
      this.stage = "COIN_QUEST_READY";
      this.ui.showToast("Hai raccolto abbastanza monete! Torna da Toad!");
    }
  }

  // Called from Kamek's onDefeated (wired in main.js). Ambient notice, not
  // an E-press interaction, so this stays a toast rather than a dialogue.
  onKamekDefeated() {
    if (this.stage !== "KAMEK_QUEST") return;
    this.stage = "BOWSER_QUEST";
    this.ui.showToast("Kamek è sconfitto! Ora vai a sconfiggere Bowser!");
  }

  // Called from Bowser's onDefeated (wired in main.js). Same reasoning.
  onBowserDefeated() {
    if (this.stage !== "BOWSER_QUEST") return;
    this.stage = "ALL_DONE";
    this.ui.showToast("Hai sconfitto Bowser! Sei un vero eroe del Regno dei Funghi!");
  }

  _showToadDialogue(text) {
    this.dialogueOpen = true;
    this.ui.dialogueActive = true;
    // Always a single line, so it's always "the last line" — the dialogue
    // hint reads "premi E per concludere" rather than "per continuare".
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
}
