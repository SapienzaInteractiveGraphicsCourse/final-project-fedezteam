/**
 * QuestManager.js — the game's single ordered quest chain (see QUESTS),
 * handed out by Toad and shown on the top-right objective panel. Order:
 * Red Planet star -> Yoshi egg/high star -> Kamek -> 25 coins -> Bowser.
 * Quests are assigned/reported only face-to-face with Toad; world events
 * are recorded as flags regardless of order, so out-of-order play still counts.
 */

// How many coins quest 4 asks for. Coins are SPENT on turn-in (ui.spendCoins)
// and checked against the player's whole wallet, not just post-quest pickups.
const COIN_TARGET = 25;

// The chain itself: data + small functions taking the manager (`qm`). Each
// entry: objective/isDone/assignLine/reminder/doneToast/reportLine (+voice).
const QUESTS = [
  {
    id: "redPlanet",
    objective: () => "reach the Red Planet on the yellow Warp Star and collect its star!",
    isDone: (qm) => qm.flags.redPlanetStar,
    assignLine: (qm) =>
      qm.flags.redPlanetStar
        ? "You have already been up to that red planet and brought its Power Star back — impressive!"
        : "See that red planet up in the sky? The yellow Warp Star over there will take you to it — bring back its Power Star!",
    assignVoice: () => [],
    reminder: () => "The yellow Warp Star is your ride to the red planet — its Power Star is still up there!",
    doneToast: () => "Red Planet star collected!",
    reportLine: () => "You made it to the red planet and back — wonderful!",
  },
  {
    id: "yoshi",
    // Two steps in one quest: the egg has to hatch before the star is even
    // reachable, so the panel says which of the two is outstanding.
    objective: (qm) =>
      qm.flags.yoshiEggHatched
        ? "use Yoshi's jump to reach the high star on Passerella Est!"
        : "find Yoshi's egg and hatch it, then use his jump to reach the high star!",
    isDone: (qm) => qm.flags.yoshiHighStar,
    assignLine: (qm) =>
      qm.flags.yoshiHighStar
        ? "And that star high above Passerella Est? Already yours, I see — nothing gets past you!"
        : "There is an egg waiting to hatch nearby. Hatch it, and Yoshi's jump will carry you to the star high above Passerella Est!",
    assignVoice: () => [],
    reminder: (qm) =>
      qm.flags.yoshiEggHatched
        ? "Yoshi is out of his egg! Climb on — his jump reaches that high star easily."
        : "There is an egg waiting to hatch nearby. Yoshi's jump can reach a star none of us can!",
    doneToast: () => "High star collected!",
    reportLine: () => "You and Yoshi make quite the team!",
  },
  {
    id: "kamek",
    objective: () => "defeat Kamek in his arena and collect the star he drops!",
    isDone: (qm) => qm.flags.kamekDefeated,
    assignLine: (qm) =>
      qm.flags.kamekDefeated
        ? "And Kamek? Already dealt with, I hear — the whole kingdom is talking about it!"
        : "Kamek is causing trouble nearby — go defeat him in his arena! The star he is guarding drops right where he falls.",
    assignVoice: (qm) => (qm.flags.kamekDefeated ? [] : ["toad_kamek"]),
    reminder: () => "Kamek is causing trouble nearby — go defeat him in his arena!",
    reminderVoice: () => ["toad_kamek"],
    doneToast: () => "Kamek is defeated — his star is waiting at the arena!",
    reportLine: () => "Well done defeating Kamek!",
  },
  {
    id: "coins",
    // Ends at Toad, not out in the world: no arena drops this star, so
    // handing the coins over IS the report (see _handOverNext).
    needsTurnIn: true,
    objective: (qm) =>
      qm.isCoinQuestReady()
        ? `bring your ${COIN_TARGET} coins back to Toad!`
        : `collect ${COIN_TARGET} coins for Toad.`,
    // Never true: only the turn-in below closes this one, so isDone (and
    // with it reportLine) is never what moves the chain on from here.
    isDone: () => false,
    isReady: (qm) => qm.ui.coins >= COIN_TARGET,
    assignLine: () => `Now, bring me ${COIN_TARGET} coins and a reward is yours!`,
    assignVoice: () => [],
    reminder: (qm) => `You are still ${Math.max(0, COIN_TARGET - qm.ui.coins)} short!`,
    // Runs on assignment and every coin pickup after: keeps the COINS n/25
    // HUD counter (ui.showQuestHud) in step.
    onProgress: (qm) => qm._syncCoinHud(),
    turnInLine: () => "Thank you! Here is a Power Star for you!",
    turnInVoice: () => ["toad_give_star"],
    onTurnIn: (qm) => {
      qm.ui.hideQuestHud();
      qm.ui.spendCoins(COIN_TARGET);
      if (qm.onRewardStar) qm.onRewardStar();
    },
  },
  {
    id: "bowser",
    objective: () => "defeat Bowser in his arena and collect the star he drops!",
    isDone: (qm) => qm.flags.bowserDefeated,
    assignLine: (qm) =>
      qm.flags.bowserDefeated
        ? "And Bowser is already beaten! The Mushroom Kingdom owes you everything."
        : "Now go and defeat Bowser! His star drops at his arena, just like Kamek's did.",
    assignVoice: (qm) => (qm.flags.bowserDefeated ? [] : ["toad_bowser"]),
    reminder: () => "Defeat Bowser in his arena!",
    reminderVoice: () => ["toad_bowser"],
    doneToast: () => "Bowser is defeated — his star is waiting at the arena!",
    reportLine: () =>
      "Congratulations, hero! You defeated Bowser — the Mushroom Kingdom is safe once more!",
  },
];

export default class QuestManager {
  constructor(ui, audio = null) {
    this.ui = ui;
    // Optional: without it every line still shows, it just goes unspoken.
    this.audio = audio;

    // Position in QUESTS. -1 = opening state (before Toad); QUESTS.length =
    // whole chain done.
    this.questIndex = -1;

    // Active quest is finished but Toad hasn't heard yet — panel points back
    // at him, next quest stays unnamed until handed over (see _handOverNext).
    this.reportPending = false;

    // What the world has seen happen, recorded regardless of whether the
    // matching quest is active (see the class comment's out-of-order note).
    this.flags = {
      redPlanetStar: false,
      yoshiEggHatched: false,
      yoshiHighStar: false,
      kamekDefeated: false,
      bowserDefeated: false,
    };

    // False until the player's very first conversation with Toad, which is
    // the only one that opens with his welcome clip.
    this.hasMetToad = false;

    // Latches the "you have enough coins" toast to once (see _syncCoinHud).
    this.coinsReadyAnnounced = false;

    // True while a Toad line is up (mirrors ui.dialogueActive, but lets
    // main.js tell Toad's single-line close apart from Peach's multi-line one).
    this.dialogueOpen = false;

    // Set from main.js once Toad's position is known: spawns the coin
    // quest's Power Star next to him on turn-in, the only star this class hands out.
    this.onRewardStar = null;

    this._renderObjective();
  }

  // The quest currently being worked on (or waiting to be reported), null
  // before the first one is assigned and again once the chain is finished.
  get activeQuest() {
    return this.questIndex >= 0 ? QUESTS[this.questIndex] || null : null;
  }

  // True once the coin quest can actually be turned in — used by the panel
  // text, the interaction prompt and the turn-in itself.
  isCoinQuestReady() {
    const quest = this.activeQuest;
    return !!(quest && quest.needsTurnIn && quest.isReady(this));
  }

  // Text for the "Press E ..." prompt near Toad, read fresh every frame
  // (see InteractionManager) so it always matches current state.
  getToadPrompt() {
    if (this.questIndex < 0) return "Press E to get your first quest";
    if (this.reportPending) return "Press E to report back to Toad";
    if (this.isCoinQuestReady()) return "Press E to hand over the coins";
    return "Press E to talk to Toad";
  }

  // Called by the Toad interactable's onInteract (see main.js). Every
  // branch here moves the chain AT MOST one step.
  onToadInteract() {
    // First conversation ever: this is where the chain starts.
    if (this.questIndex < 0) {
      const first = QUESTS[0];
      this._showToadDialogue(first.assignLine(this), ...first.assignVoice(this));
      this._setQuest(0);
      return;
    }

    const quest = this.activeQuest;
    if (!quest) {
      this._showToadDialogue("Thank you for saving the Mushroom Kingdom!");
      return;
    }

    // Reporting a finished quest: he acknowledges it and names the next
    // one in the same line. This is the ONLY way a quest is discovered.
    if (this.reportPending) {
      this.reportPending = false;
      this._handOverNext(quest.reportLine(this), []);
      return;
    }

    // Quest 4's turn-in — the report and the reward in one go.
    if (this.isCoinQuestReady()) {
      quest.onTurnIn(this);
      this._handOverNext(quest.turnInLine(this), quest.turnInVoice(this));
      return;
    }

    this._showToadDialogue(
      quest.reminder(this),
      ...(quest.reminderVoice ? quest.reminderVoice(this) : []),
    );
  }

  // --- WORLD EVENTS (all wired from main.js / EntityManager) -------------
  // Each records a flag and re-checks the active quest, even unassigned.

  // Every star picked up anywhere in the level (Collectibles' star `id`);
  // stars with no id (defaults, boss/Toad rewards) are ignored here.
  onStarCollected(id) {
    if (id === "redPlanetStar") this.flags.redPlanetStar = true;
    else if (id === "yoshiHighStar") this.flags.yoshiHighStar = true;
    else return;

    this._checkActiveQuest();
  }

  // Called once from main.js's hatchYoshiEgg. Only the first half of quest
  // 2 — the star still has to be collected (see the quest's objective).
  markYoshiHatched() {
    if (this.flags.yoshiEggHatched) return;
    this.flags.yoshiEggHatched = true;
    this.ui.showToast("Yoshi hatched!");
    this._checkActiveQuest();
  }

  onKamekDefeated() {
    if (this.flags.kamekDefeated) return;
    this.flags.kamekDefeated = true;
    this._checkActiveQuest();
  }

  onBowserDefeated() {
    if (this.flags.bowserDefeated) return;
    this.flags.bowserDefeated = true;
    this._checkActiveQuest();
  }

  // Every coin picked up anywhere in the level (EntityManager.onCoinCollected)
  // — a no-op unless the coin quest is the active one.
  onCoinCollected() {
    this._checkActiveQuest();
  }

  // --- CHAIN MACHINERY ---------------------------------------------------

  // Closes the current quest inside one conversation and appends the next
  // quest's assignLine in the same breath (nothing appended on the last quest).
  _handOverNext(closing, closingVoice = []) {
    const next = QUESTS[this.questIndex + 1];

    if (!next) {
      this._showToadDialogue(closing, ...closingVoice);
      this._setQuest(this.questIndex + 1);
      return;
    }

    this._showToadDialogue(
      `${closing} ${next.assignLine(this)}`,
      ...closingVoice,
      ...next.assignVoice(this),
    );
    this._setQuest(this.questIndex + 1);
  }

  // Makes QUESTS[index] active (or ends the chain past the last one),
  // refreshes the panel, and re-checks it in case it's already satisfied.
  _setQuest(index) {
    this.questIndex = Math.min(index, QUESTS.length);
    this.reportPending = false;

    const quest = this.activeQuest;
    if (!quest) {
      this._renderObjective();
      return;
    }

    if (quest.onProgress) quest.onProgress(this);
    this._renderObjective();
    this._checkActiveQuest();
  }

  // Re-evaluates the active quest against the world flags, and the moment
  // its condition holds flips to "report back to Toad" (without naming what's next).
  _checkActiveQuest() {
    const quest = this.activeQuest;
    if (!quest || this.reportPending) return;

    if (quest.onProgress) quest.onProgress(this);

    if (quest.isDone(this)) {
      this.reportPending = true;
      const done = quest.doneToast ? quest.doneToast(this) : "";
      // The toast says what was achieved and where to go — never what the
      // next quest is, which is Toad's to tell.
      this.ui.showToast([done, "Report back to Toad!"].filter(Boolean).join(" "));
    }

    this._renderObjective();
  }

  // Keeps the separate COINS n/25 HUD counter (UIManager.showQuestHud) in
  // step with the wallet, and announces once when the target is reached.
  _syncCoinHud() {
    const shown = Math.min(this.ui.coins, COIN_TARGET);
    this.ui.showQuestHud(`COINS: ${shown}/${COIN_TARGET}`);

    if (!this.coinsReadyAnnounced && this.ui.coins >= COIN_TARGET) {
      this.coinsReadyAnnounced = true;
      this.ui.showToast("You have enough coins! Head back to Toad!");
    }
  }

  // Puts one of Toad's lines on screen and voices it via AudioManager
  // (`cues`, falling back to the generic blip); prepends the welcome clip.
  _showToadDialogue(text, ...cues) {
    this.dialogueOpen = true;
    this.ui.dialogueActive = true;
    // Always a single line, so it's always "the last line" — the dialogue
    // hint reads "Press E to close" rather than "to continue".
    this.ui.showDialogue("TOAD", text, true);

    const voice = cues.length ? [...cues] : ["toad_talk"];
    if (!this.hasMetToad) {
      this.hasMetToad = true;
      voice.unshift("toad_welcome");
    }
    if (this.audio?.playSFXSequence) this.audio.playSFXSequence(voice);
  }

  // Called from main.js when E is pressed while a Toad line is up (see
  // updateGame — Space no longer does this, per spec).
  closeToadDialogue() {
    if (!this.dialogueOpen) return;
    this.dialogueOpen = false;
    this.ui.hideDialogue();
    this.ui.dialogueActive = false;
  }

  // Top-right panel: where the player is in the chain — points at Toad
  // before quest 1 exists and again between every quest.
  _renderObjective() {
    const total = QUESTS.length;
    let text;

    if (this.questIndex < 0) {
      text = "Talk to Toad to get your first quest!";
    } else if (!this.activeQuest) {
      text = "All quests complete — the Mushroom Kingdom is safe!";
    } else if (this.reportPending) {
      text = `Quest ${this.questIndex + 1}/${total} complete — return to Toad for the next one!`;
    } else {
      text = `Quest ${this.questIndex + 1}/${total}: ${this.activeQuest.objective(this)}`;
    }

    if (this.ui.showQuestObjective) this.ui.showQuestObjective(text);
  }
}
