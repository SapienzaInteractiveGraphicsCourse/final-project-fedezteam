export default class AudioManager {
  constructor() {
    this.sounds = {};
    this.bgm = null;
    this.isMuted = false;
    this.currentCharacter = "mario"; // Default character.

    // Effects that ship as two per-character variants (mario_jump1/mario_jump2,
    // luigi_damage1/luigi_damage2, ...). Each entry holds which variant plays
    // next, so repeating the same action doesn't replay the identical clip.
    this.variantToggles = { jump: false, damage: false };

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
    if (this.bgm) {
      this.bgm.volume = this.bgmVolume;
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
   * Preloads an audio file under the given name.
   */
  load(name, src, isBGM = false) {
    const audio = new Audio(src);
    audio.preload = "auto";

    if (isBGM) {
      audio.loop = true;
      audio.volume = 0.35;
      this.bgm = audio;
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
    if (this.bgm) {
      this.bgm.pause();
      this.bgm.currentTime = 0;
      // Reset the "started" flag when returning to the main menu.
      this.hasStarted = false;
    }
  }

  /**
   * Plays a sound effect by name.
   */
  playSFX(name) {
    if (this.isMuted || this.sfxVolume === 0) return;
    let soundKey = name;

    if (this.sounds[name]) {
      soundKey = name;
    } else if (name in this.variantToggles) {
      // Alternate between the two variants for a less repetitive feel.
      const suffix = this.variantToggles[name] ? "2" : "1";
      this.variantToggles[name] = !this.variantToggles[name];
      soundKey = `${this.currentCharacter}_${name}${suffix}`;
    } else {
      // Fall back to a character-specific variant, e.g. "mario_fall".
      const charSpecificName = `${this.currentCharacter}_${name}`;
      if (this.sounds[charSpecificName]) {
        soundKey = charSpecificName;
      }
    }

    if (!this.sounds[soundKey]) return;

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

    if (this.bgm) {
      this.bgm.muted = isMuted;

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
