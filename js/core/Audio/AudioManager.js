// The looping track that plays everywhere outside a boss zone. Exported so
// callers can ask for "back to normal" by name instead of by magic string.
export const OVERWORLD_MUSIC = "bgm";

export default class AudioManager {
  constructor() {
    this.sounds = {};

    // Every looping track from the manifest, by name: the overworld theme
    // plus one per boss zone (see playMusic).
    this.music = {};
    // Whichever of them is currently the background music. Everything else
    // in this class works off this one, exactly as it did when there was
    // only ever a single track.
    this.bgm = null;
    this.isMuted = false;
    this.currentCharacter = "mario"; // Default character.

    // Optional stand-in for currentCharacter when resolving a
    // character-specific effect: set to "yoshi" while he's being ridden, so
    // jumping and falling come out in HIS voice instead of the rider's (see
    // setVoice and _resolveSFX). Null means "just use the character".
    this.voice = null;

    // Which of the two takes plays next, per effect name — see _resolveSFX,
    // which fills this in on demand. Populated lazily rather than declared
    // up front: an effect gets a second take by shipping the file, not by
    // being listed here.
    this.variantToggles = {};

    this.hasStarted = false;

    // Default volumes (0 to 1).
    this.bgmVolume = 0.35;
    this.sfxVolume = 0.6;
  }

  /**
   * Sets the background music volume (0 - 1).
   */
  setBGMVolume(volume) {
    this.bgmVolume = volume;
    // Every track, not just the one playing: otherwise switching zones
    // would bring back whatever volume the incoming track was loaded with.
    for (const key in this.music) {
      this.music[key].volume = this.bgmVolume;
    }
  }

  /**
   * Sets the sound effects volume (0 - 1).
   */
  setSFXVolume(volume) {
    this.sfxVolume = volume;
    for (const key in this.sounds) {
      if (this.sounds[key]) {
        this.sounds[key].volume = this.sfxVolume;
      }
    }
  }

  /**
   * Sets the active character ('mario' or 'luigi'), used to resolve
   * character-specific sound effects.
   */
  setCharacter(character) {
    if (character) {
      this.currentCharacter = character.toLowerCase();
    }
  }

  /**
   * Puts someone else in front of the playable character when resolving
   * character-specific effects — currently only Yoshi, while the player is
   * riding him (see main.js's mount/dismount interaction). Call with no
   * argument (or null) to hand the voice back.
   *
   * This is an override, not a replacement: _resolveSFX still falls through
   * to the character for any effect the voice has no clip of its own for,
   * so Yoshi taking over "jump" and "fall" doesn't have to mean inventing a
   * Yoshi version of every other sound in the game.
   */
  setVoice(voice = null) {
    this.voice = voice ? voice.toLowerCase() : null;
  }

  /**
   * Preloads an audio file under the given name.
   */
  load(name, src, isBGM = false) {
    const audio = new Audio(src);
    audio.preload = "auto";

    if (isBGM) {
      audio.loop = true;
      audio.volume = this.bgmVolume;
      this.music[name] = audio;
      // The first looping entry in the manifest is the one the game opens
      // on; the rest are switched to by playMusic().
      if (!this.bgm) this.bgm = audio;
    } else {
      audio.volume = 0.6;
      this.sounds[name] = audio;
    }
  }

  playBGM() {
    if (!this.bgm) return;

    // The game session has officially started.
    this.hasStarted = true;

    this.bgm.muted = this.isMuted;

    // Only start playback if it isn't already playing.
    if (this.bgm.paused) {
      this.bgm.play().catch((err) => console.warn("Error starting audio playback:", err));
    }
  }

  stopBGM() {
    if (!this.bgm) return;

    // Every track, so nothing can be left quietly running behind the
    // game-over or victory screen after a switch.
    for (const key in this.music) {
      this.music[key].pause();
      this.music[key].currentTime = 0;
    }
    // Reset the "started" flag when returning to the main menu.
    this.hasStarted = false;
  }

  /**
   * Switches the background music to `name`, one of the looping tracks in
   * the manifest. Called with no argument it goes back to the overworld
   * theme, which is what everywhere that isn't a boss zone uses.
   *
   * The outgoing track is rewound as well as paused, so walking back into a
   * zone later restarts its theme from the top instead of dropping the
   * player into the middle of it. Asking for the track that is already
   * playing does nothing — stepping on a warp star that leads where you
   * already are shouldn't make the music stutter.
   */
  playMusic(name = OVERWORLD_MUSIC) {
    const next = this.music[name];
    if (!next) return;

    if (next === this.bgm) {
      // Same track: make sure it's actually running (it won't be if the
      // player has just come back from a screen that stopped it).
      this.playBGM();
      return;
    }

    if (this.bgm) {
      this.bgm.pause();
      this.bgm.currentTime = 0;
    }

    this.bgm = next;
    this.bgm.volume = this.bgmVolume;
    this.bgm.muted = this.isMuted;

    // Started only if the player has already pressed Start, the same rule
    // playBGM() follows — otherwise this would be an autoplay attempt with
    // no user gesture behind it.
    if (this.hasStarted && this.bgm.paused) {
      this.bgm.play().catch((err) => console.warn("Error starting audio playback:", err));
    }
  }

  /**
   * Turns the name a call site asked for into an actual manifest key, or
   * null if nothing matches. Three cases, tried in this order:
   *
   *  - an exact key ("coin", "gameover", "bowser_attack"): used as is;
   *  - a two-variant per-speaker effect ("jump", "damage"): alternates
   *    between `<speaker>_<name>1` and `<speaker>_<name>2`;
   *  - anything else: `<speaker>_<name>`, e.g. "fall" -> "mario_fall".
   *
   * The speaker is the voice override first (Yoshi, while he's carrying
   * the player) and the playable character second, so an effect Yoshi has
   * no clip for simply comes out in the rider's voice instead of silently
   * doing nothing.
   */
  _resolveSFX(name) {
    if (this.sounds[name]) return name;

    const speakers = this.voice
      ? [this.voice, this.currentCharacter]
      : [this.currentCharacter];

    // Two-variant effects, alternated so doing the same thing twice in a
    // row doesn't replay the identical clip. Both shapes are handled: the
    // plain one (peach_talk1/peach_talk2 — nobody's voice but Peach's, so
    // there's no speaker to prefix) and the per-speaker one
    // (mario_jump1/mario_jump2). Which shape an effect uses is discovered
    // from the manifest instead of being declared in a list up here, so
    // giving something a second take is just a matter of adding the file.
    const suffix = this.variantToggles[name] ? "2" : "1";
    for (const stem of [name, ...speakers.map((s) => `${s}_${name}`)]) {
      if (!this.sounds[`${stem}1`]) continue;

      // The second take is optional: an effect that only ever shipped a
      // "1" still plays, it simply has nothing to alternate with.
      const key = this.sounds[`${stem}${suffix}`] ? `${stem}${suffix}` : `${stem}1`;
      // Flipped only once something is actually going to play: otherwise a
      // miss would eat a turn and make the next hit repeat the very clip
      // this one was meant to alternate away from.
      this.variantToggles[name] = !this.variantToggles[name];
      return key;
    }

    // Single-clip and speaker-specific: "fall" -> "mario_fall".
    for (const speaker of speakers) {
      const key = `${speaker}_${name}`;
      if (this.sounds[key]) return key;
    }

    return null;
  }

  /**
   * Plays a sound effect by name — see _resolveSFX for how a generic name
   * like "jump" is turned into the right clip for whoever is speaking.
   */
  playSFX(name) {
    if (this.isMuted || this.sfxVolume === 0) return;

    const soundKey = this._resolveSFX(name);
    if (!soundKey) return;

    // Clone the audio element so overlapping plays of the same effect don't
    // cut each other off.
    const soundClone = this.sounds[soundKey].cloneNode();
    soundClone.volume = this.sounds[soundKey].volume;
    soundClone.play().catch(() => {});
  }

  /**
   * Plays a one-shot music cue — currently the ending theme — from the
   * element that was preloaded at startup instead of from a throwaway copy.
   *
   * playSFX() clones its element before playing so two overlapping hits of
   * the same effect can't cut each other off. That's the right trade for a
   * 15 KB jump grunt, but a clone starts its own fresh load of the file,
   * and ending.mp3 is 8.8 MB: the music would sit silent until that second
   * download caught up (measured: still at readyState 0, nothing decoded,
   * seconds after play() was called). A music cue never overlaps itself, so
   * it has no reason to be cloned and can start instantly from the copy
   * that has been in memory since the loading screen.
   */
  playTrack(name) {
    if (this.isMuted || this.sfxVolume === 0) return;

    const track = this.sounds[name];
    if (!track) return;

    // Rewound rather than resumed, so a second playthrough of the game
    // starts the theme from the top.
    track.currentTime = 0;
    track.play().catch(() => {});
  }

  setMute(isMuted) {
    this.isMuted = isMuted;

    for (const key in this.music) {
      this.music[key].muted = isMuted;
    }

    if (this.bgm) {
      // Resume playback automatically only if: the game is being unmuted,
      // the track was paused, and the player has already pressed "Start"
      // at least once (hasStarted) - otherwise this would break the
      // "audio starts on the first user gesture" requirement.
      if (!isMuted && this.hasStarted && this.bgm.paused) {
        this.bgm
          .play()
          .catch((err) => console.warn("Autoplay blocked by the browser:", err));
      }
    }

    // Mute every sound effect as well.
    for (const key in this.sounds) {
      if (this.sounds[key]) {
        this.sounds[key].muted = isMuted;
      }
    }
  }
}
