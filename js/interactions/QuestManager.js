/**
 * QuestManager.js — the game's progression: ONE ordered chain of quests,
 * handed out by Toad and tracked on the top-right objective panel (see
 * UIManager.showQuestObjective, driven by _renderObjective).
 *
 * The chain (QUESTS below, in order):
 *
 *   1. Red Planet — ride the yellow Warp Star up to the red planet and
 *      collect its star (see GameLevel's `id: "redPlanetStar"`).
 *   2. Yoshi — hatch his egg, then use his boosted jump to reach the high
 *      star on Passerella Est (`id: "yoshiHighStar"`).
 *   3. Kamek — beat him in his arena; the star drops right there (see
 *      main.js's kamek.onDefeated).
 *   4. Coins — collect 25 coins and hand them to Toad, who gives this
 *      star himself: it's the only one with no arena to drop it at.
 *   5. Bowser — same as Kamek, at the other arena.
 *
 * HOW A QUEST ARRIVES. Only ever from Toad, face to face. The player
 * starts with "Talk to Toad" on the panel; that conversation opens quest 1.
 * Finishing a quest does NOT reveal the next one — it flips the panel to
 * "return to Toad", and the next quest is only named once the player is
 * standing in front of him again (reportPending / _handOverNext). One
 * conversation moves the chain forward exactly one step.
 *
 * Reporting back is a CONVERSATION, not a collection trip: Kamek's and
 * Bowser's stars are waiting out at their arenas and are picked up there,
 * and quest 4 is the only one whose star Toad hands over — it has no arena
 * to drop one at, so turning the coins in and being given the next quest
 * happen in the same breath.
 *
 * WHAT A QUEST DOES NOT DO. Assignment is bookkeeping, not gating: every
 * warp star, egg and boss arena in the level stays reachable from the first
 * frame. A player who beats Kamek before Toad has even mentioned him is not
 * punished for it — the world flags below are recorded whenever they
 * happen, so a quest handed over for something already done reads as
 * finished the moment it is assigned, and the next conversation moves on
 * from it. Toad's lines cover that case explicitly rather than pretending
 * it didn't happen (see each quest's assignLine).
 *
 * Toad's lines are shown as a proper speech-bubble dialogue
 * (ui.showDialogue/hideDialogue, the same widget Peach's cutscene uses) and
 * closed with E only — see main.js's updateGame. Progress that happens out
 * in the world (a quest finished, the egg hatching, enough coins) is a
 * toast instead: there's no "E press" moment to hang a blocking dialogue on
 * for those.
 *
 * Every line is also SPOKEN when an AudioManager is passed in (see
 * _showToadDialogue): the welcome clip the first time the player ever talks
 * to him, a dedicated clip for the scripted beats ("go and deal with
 * Kamek", "go and deal with Bowser", "here's your star"), and the generic
 * two-take blip — toad_1/toad_2, alternated by AudioManager — otherwise.
 */

// How many coins quest 4 asks for. They are really SPENT on turn-in (see
// ui.spendCoins), not just checked off, and what's counted is the player's
// whole wallet rather than "coins collected since the quest opened" — so
// someone who already had 25 in the bank can hand them over right away.
const COIN_TARGET = 25;

/**
 * The chain itself. Each entry is data + small functions taking the manager
 * (`qm`), so the class below stays a generic runner and adding or
 * reordering a quest never means touching its logic:
 *
 *   objective(qm)   -> the panel's text while this quest is being worked
 *                      on (the "Quest n/N:" prefix comes from
 *                      _renderObjective).
 *   isDone(qm)      -> finished, read off qm.flags. Checked whenever a flag
 *                      changes AND right after the quest is handed over.
 *   assignLine(qm)  -> what Toad SAYS when he hands it over, and which
 *   assignVoice(qm)    clips go with it. Every quest is assigned in person,
 *                      so every quest has these.
 *   reminder(qm)    -> what he says if you talk to him while it's active.
 *   reminderVoice(qm)
 *   doneToast(qm)   -> the "you did it" toast, out in the world, at the
 *                      moment it's finished. Never names what comes next:
 *                      that's Toad's to tell.
 *   reportLine(qm)  -> how he opens the conversation where it's reported,
 *                      immediately followed by the next quest's assignLine.
 *
 * Quest 4 additionally uses the turn-in fields (needsTurnIn, isReady,
 * onProgress, turnInLine/turnInVoice, onTurnIn) — see onToadInteract.
 */
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
    // The one quest that ends at Toad rather than out in the world: no
    // arena drops this star, he hands it over himself. So it never goes
    // through the report-back path — handing the coins over IS the report,
    // and it comes with the next quest attached (see _handOverNext).
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
    // Runs when the quest is handed over and on every coin picked up
    // afterwards: keeps the separate COINS n/25 counter (ui.showQuestHud)
    // in step.
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

    // Position in QUESTS. -1 is the opening state, before Toad has been
    // spoken to at all (the panel says so); QUESTS.length means the whole
    // chain is done.
    this.questIndex = -1;

    // The active quest is finished but Toad hasn't heard about it yet. The
    // panel points back at him and the next quest stays unnamed until he
    // hands it over — see _handOverNext.
    this.reportPending = false;

    // What the world has seen happen, recorded whether or not the matching
    // quest is the active one — see the "not gating" note in the class
    // comment. Everything a quest's isDone() reads lives here.
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

    // True while a Toad line is up (ui.dialogueActive mirrors this, but
    // main.js needs to tell Toad's single-line "close" apart from Peach's
    // multi-line "advance" — see closeToadDialogue).
    this.dialogueOpen = false;

    // Set from main.js once Toad's position is known: spawns the coin
    // quest's Power Star next to him on turn-in. It is the only star this
    // class ever hands out — the other four are picked up out in the level.
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

  // Text for the "Press E ..." prompt while standing near Toad — read
  // fresh every frame (see InteractionManager), so it always matches the
  // current state without needing to be pushed.
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
  //
  // Each one records a flag and then asks the active quest whether that
  // finished it. Recording happens even when the matching quest hasn't been
  // assigned yet, which is what makes playing out of order work.

  // Every star picked up anywhere in the level (see
  // EntityManager.onStarCollected / Collectibles' star `id`); stars with no
  // id — the level defaults, the boss and Toad rewards — are ignored here.
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

  /**
   * Closes the current quest inside a conversation and hands over the next
   * one in the same line: `closing` is Toad acknowledging what was just
   * done (a report, or the coin turn-in), immediately followed by the next
   * quest's own assignLine, so one E press = one step of the chain.
   *
   * On the last quest there is nothing to append and the acknowledgement
   * stands alone as the ending line.
   */
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

  /**
   * Makes QUESTS[index] the active quest (or ends the chain when past the
   * last one), refreshes the panel, and re-checks it straight away: it may
   * ALREADY be satisfied — a boss beaten before Toad ever mentioned him —
   * in which case it lands on "return to Toad" immediately and the NEXT
   * conversation moves past it. Deliberately one step at a time: the chain
   * never runs several quests forward while the player stands there.
   */
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

  // Re-evaluates the active quest against the world flags: keeps its
  // progress display current and, the moment its condition holds, flips to
  // "report back to Toad" — WITHOUT revealing what comes next.
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

  // Keeps the separate COINS n/25 counter (a different widget from the
  // objective panel — see UIManager.showQuestHud) in step with the wallet,
  // and says so once when the target is reached.
  _syncCoinHud() {
    const shown = Math.min(this.ui.coins, COIN_TARGET);
    this.ui.showQuestHud(`COINS: ${shown}/${COIN_TARGET}`);

    if (!this.coinsReadyAnnounced && this.ui.coins >= COIN_TARGET) {
      this.coinsReadyAnnounced = true;
      this.ui.showToast("You have enough coins! Head back to Toad!");
    }
  }

  /**
   * Puts one of Toad's lines on screen and gives it a voice.
   *
   * `cues` are AudioManager sound names for THIS line, played in order (see
   * AudioManager.playSFXSequence): most lines pass none and fall back to
   * the generic two-take blip, while the scripted beats name their own clip
   * — and a line that both closes one quest and opens the next ("here's
   * your star, now go and get Bowser") names both, one after the other. The
   * welcome clip is prepended to whichever line the player hears first, so
   * meeting Toad always opens with a greeting.
   */
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

  // Top-right panel: where the player is in the chain. Shown from the very
  // first frame — before quest 1 exists it's what points at Toad, and
  // between quests it points back at him again.
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
