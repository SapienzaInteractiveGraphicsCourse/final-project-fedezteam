// The looping track that plays everywhere outside a boss zone. Exported so
// callers can ask for "back to normal" by name instead of by magic string.
export const OVERWORLD_MUSIC = "bgm";

export default class AudioManager {
  // Max copies of the same effect playing together; beyond this the oldest
  // is reused (four overlapping coins already read as one handful).
  static MAX_VOICES = 4;

  // Minimum gap between two plays of the same effect, in ms (two frames at 60fps).
  static RETRIGGER_MS = 30;

  constructor() {
    this.sounds = {};

    // Every looping track from the manifest, by name (overworld + one per
    // boss zone — see playMusic).
    this.music = {};
    // Whichever track is currently the background music; everything else
    // in this class works off this one field.
    this.bgm = null;
    this.isMuted = false;
    this.currentCharacter = "mario"; // Default character.

    // Optional stand-in for currentCharacter when resolving an effect
    // (e.g. "yoshi" while ridden). Null means "just use the character".
    this.voice = null;

    // Which of the two takes plays next, per effect name — filled in lazily
    // by _resolveSFX as effects are discovered, not declared up front.
    this.variantToggles = {};

    // Short effects decoded into memory via the Web Audio context (see
    // _decode/playSFX). Music stays on <audio> elements instead.
    this.buffers = {};
    this.ctx = null;
    this.sfxGain = null;

    // Reusable <audio> elements per effect, and when each last played (see
    // _takeVoice/playSFX) — the fallback path when Web Audio is unavailable.
    this.pools = {};
    this.lastPlayed = {};

    this.hasStarted = false;

    // Default volumes (0 to 1).
    this.bgmVolume = 0.35;
    this.sfxVolume = 0.6;
  }

  // Sets the background music volume (0-1).
  setBGMVolume(volume) {
    this.bgmVolume = volume;
    // Every track, not just the one playing: otherwise switching zones
    // would bring back whatever volume the incoming track was loaded with.
    for (const key in this.music) {
      this.music[key].volume = this.bgmVolume;
    }
  }

  // Sets the sound effects volume (0-1).
  setSFXVolume(volume) {
    this.sfxVolume = volume;
    if (this.sfxGain && !this.isMuted) this.sfxGain.gain.value = volume;
    for (const key in this.sounds) {
      if (this.sounds[key]) {
        this.sounds[key].volume = this.sfxVolume;
      }
    }
  }

  // Sets the active character ('mario' or 'luigi'), used to resolve
  // character-specific sound effects.
  setCharacter(character) {
    if (character) {
      this.currentCharacter = character.toLowerCase();
    }
  }

  // Overrides who _resolveSFX speaks as (currently only Yoshi while ridden);
  // call with no argument to hand the voice back to the character.
  setVoice(voice = null) {
    this.voice = voice ? voice.toLowerCase() : null;
  }

  // Preloads an audio file under the given name.
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

      // Only .wav files are decoded (short effects that must fire exactly
      // on cue); the project's .mp3s are music/jingles, too big to keep in RAM as PCM.
      if (/\.wav$/i.test(src)) this._decode(name, src);
    }
  }

  // The Web Audio context, created on first use. Starts suspended until a
  // user gesture; playBGM() (the start-screen click) resumes it, playSFX() as a fallback.
  _ensureContext() {
    if (this.ctx) return this.ctx;

    const Ctx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!Ctx) return null;

    try {
      this.ctx = new Ctx();
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.isMuted ? 0 : this.sfxVolume;
      this.sfxGain.connect(this.ctx.destination);
    } catch (e) {
      this.ctx = null;
    }
    return this.ctx;
  }

  // Fetches and decodes one effect. Failure isn't fatal: playSFX falls back
  // to the <audio> element pool.
  async _decode(name, src) {
    const ctx = this._ensureContext();
    if (!ctx) return;

    try {
      const response = await fetch(src);
      const data = await response.arrayBuffer();
      this.buffers[name] = await ctx.decodeAudioData(data);
    } catch (e) {
      // nothing to do: falls back to the <audio> element path
    }
  }

  playBGM() {
    if (!this.bgm) return;

    // The click that starts the music is also the gesture that unlocks Web
    // Audio — a good moment to wake the effects context too.
    const ctx = this._ensureContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});

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

  // Switches BGM to `name` (default: overworld theme). Rewinds the outgoing
  // track so re-entering later restarts it; a no-op if `name` is already playing.
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

    // Started only if the player has already pressed Start (same rule as
    // playBGM()), to avoid an autoplay attempt with no user gesture.
    if (this.hasStarted && this.bgm.paused) {
      this.bgm.play().catch((err) => console.warn("Error starting audio playback:", err));
    }
  }

  // Resolves a requested name to a manifest key: an exact match, a
  // two-variant per-speaker effect, or `<speaker>_<name>` (voice, then character).
  _resolveSFX(name) {
    if (this.sounds[name]) return name;

    const speakers = this.voice
      ? [this.voice, this.currentCharacter]
      : [this.currentCharacter];

    // Two-variant effects alternate so repeats don't replay the identical
    // clip; discovered from the manifest rather than declared in a list.
    const suffix = this.variantToggles[name] ? "2" : "1";
    for (const stem of [name, ...speakers.map((s) => `${s}_${name}`)]) {
      if (!this.sounds[`${stem}1`]) continue;

      // The second take is optional: an effect that only ever shipped a
      // "1" still plays, it simply has nothing to alternate with.
      const key = this.sounds[`${stem}${suffix}`] ? `${stem}${suffix}` : `${stem}1`;
      // Flipped only once something is actually going to play, so a miss
      // doesn't eat a turn and make the next hit repeat this same clip.
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

  // Returns a free <audio> element for this effect, creating one only when
  // needed — a pool instead of cloneNode() per play, which caused stutter.
  _takeVoice(key) {
    let pool = this.pools[key];
    if (!pool) {
      // The first voice is the element already loaded at startup — also
      // the one used almost always, so it's the one pre-armed to rewind.
      pool = this.pools[key] = [this.sounds[key]];
      this._armRewind(pool[0]);
    }

    // The first voice that's finished playing.
    for (const voice of pool) {
      if (voice.paused || voice.ended) return voice;
    }

    if (pool.length < AudioManager.MAX_VOICES) {
      const voice = this.sounds[key].cloneNode();
      this._armRewind(voice);
      pool.push(voice);
      return voice;
    }

    // All busy: reuse the one furthest into playback — least left to hear.
    let oldest = pool[0];
    for (const voice of pool) {
      if (voice.currentTime > oldest.currentTime) oldest = voice;
    }
    return oldest;
  }

  // Rewinds a voice as soon as its clip ends, so reuse doesn't have to wait
  // on a seek (that lag was making jumps sound delayed).
  _armRewind(voice) {
    voice.addEventListener("ended", () => {
      voice.currentTime = 0;
    });
  }

  _now() {
    return typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  }

  // Plays a sound effect by name (see _resolveSFX). Two identical requests
  // within RETRIGGER_MS collapse to one — indistinguishable by ear but not free.
  playSFX(name, onEnded = null) {
    if (this.isMuted || this.sfxVolume === 0) return null;

    const soundKey = this._resolveSFX(name);
    if (!soundKey) return null;

    const now = this._now();
    if (now - (this.lastPlayed[soundKey] ?? -Infinity) < AudioManager.RETRIGGER_MS) {
      return null;
    }
    this.lastPlayed[soundKey] = now;

    // Main path: the sample is already decoded, starts now.
    const buffer = this.buffers[soundKey];
    if (buffer && this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.sfxGain);
      if (onEnded) source.onended = onEnded;
      source.start();
      return source;
    }

    // Fallback: an <audio> element from the pool.
    const voice = this._takeVoice(soundKey);
    if (!voice) return null;

    // Current volume lives on the original element (see setSFXVolume); pool
    // voices pick it up here, right as they start.
    voice.volume = this.sounds[soundKey].volume;
    voice.muted = this.isMuted;
    // Rewinding happens when the clip ends (see _takeVoice), not here:
    // seeking to 0 right before play() made the delay audible.
    if (voice.currentTime !== 0) voice.currentTime = 0;
    if (onEnded) voice.addEventListener("ended", onEnded, { once: true });
    voice.play().catch(() => {});

    return voice;
  }

  // Plays several effects back to back, each starting when the previous
  // ends. Chained on the "ended" event; anything that can't play is skipped.
  playSFXSequence(names) {
    const queue = (Array.isArray(names) ? names : [names]).filter(Boolean);

    const step = () => {
      const next = queue.shift();
      if (!next) return;

      // Covers both paths: a BufferSource's onended or an <audio>
      // element's "ended" event (see playSFX).
      if (!this.playSFX(next, step)) step();
    };

    step();
  }

  // Plays a one-shot music cue from the element preloaded at startup
  // rather than a clone: ending.mp3 is 8.8 MB, a clone would re-download it.
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

    // Also silences effects already playing via Web Audio, mirroring
    // element.muted for the <audio>-based ones.
    if (this.sfxGain) this.sfxGain.gain.value = isMuted ? 0 : this.sfxVolume;

    for (const key in this.music) {
      this.music[key].muted = isMuted;
    }

    if (this.bgm) {
      // Resume automatically only if unmuting, the track was paused, and
      // the player already pressed "Start" (preserves the gesture rule).
      if (!isMuted && this.hasStarted && this.bgm.paused) {
        this.bgm
          .play()
          .catch((err) => console.warn("Autoplay blocked by the browser:", err));
      }
    }

    // Mutes every sound effect too, including pool voices currently
    // playing (see _takeVoice) — separate elements from this.sounds.
    for (const key in this.sounds) {
      if (this.sounds[key]) {
        this.sounds[key].muted = isMuted;
      }
    }
    for (const key in this.pools) {
      for (const voice of this.pools[key]) voice.muted = isMuted;
    }
  }
}
