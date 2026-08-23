// The looping track that plays everywhere outside a boss zone. Exported so
// callers can ask for "back to normal" by name instead of by magic string.
export const OVERWORLD_MUSIC = "bgm";

export default class AudioManager {
  // Quante copie dello stesso effetto possono suonare insieme. Oltre questa
  // soglia si riusa la piu' vecchia: quattro monete sovrapposte suonano
  // gia' come una manciata di monete.
  static MAX_VOICES = 4;

  // Distanza minima fra due riproduzioni dello stesso effetto, in
  // millisecondi — due frame a 60fps.
  static RETRIGGER_MS = 30;

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

    // Effetti brevi decodificati in memoria e pronti a partire, piu' il
    // contesto Web Audio che li suona — vedi _decode/playSFX. La musica non
    // passa di qui: resta sugli elementi <audio>, che la trasmettono senza
    // doverla tenere tutta decodificata in RAM.
    this.buffers = {};
    this.ctx = null;
    this.sfxGain = null;

    // Elementi <audio> riutilizzabili per ogni effetto, e quando ciascuno e'
    // stato riprodotto l'ultima volta — vedi _takeVoice/playSFX. Restano la
    // via di riserva se Web Audio non e' disponibile o un file non si
    // decodifica.
    this.pools = {};
    this.lastPlayed = {};

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
    if (this.sfxGain && !this.isMuted) this.sfxGain.gain.value = volume;
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

      // Solo i .wav: sono gli effetti brevi, quelli che devono partire
      // nell'istante esatto in cui succede la cosa. Gli .mp3 del progetto
      // sono musica e jingle (temi dei boss, game over, finale da 8,8 MB):
      // decodificarli vorrebbe dire tenerne in RAM decine di megabyte di
      // PCM per un suono che non ha bisogno di partire al millisecondo.
      if (/\.wav$/i.test(src)) this._decode(name, src);
    }
  }

  /**
   * Il contesto Web Audio, creato alla prima occasione utile.
   *
   * Nasce sospeso finche' il browser non vede un gesto dell'utente: ci
   * pensa playBGM(), che parte proprio dal clic sulla schermata iniziale
   * (vedi main.js), e in seconda battuta playSFX.
   */
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

  // Scarica e decodifica un effetto. Fallire non e' grave: senza campione
  // playSFX ricade sugli elementi <audio> come prima.
  async _decode(name, src) {
    const ctx = this._ensureContext();
    if (!ctx) return;

    try {
      const response = await fetch(src);
      const data = await response.arrayBuffer();
      this.buffers[name] = await ctx.decodeAudioData(data);
    } catch (e) {
      // niente da fare: resta la via degli elementi <audio>
    }
  }

  playBGM() {
    if (!this.bgm) return;

    // Il clic che fa partire la musica e' il gesto che serve al browser per
    // sbloccare anche Web Audio: e' il momento buono per svegliare il
    // contesto degli effetti (vedi _ensureContext).
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
   * Restituisce un elemento <audio> libero per questo effetto, creandone
   * uno solo se serve davvero.
   *
   * PERCHE' UN POOL. Prima ogni singola riproduzione faceva cloneNode():
   * un elemento multimediale nuovo di zecca, con il suo decoder, buttato
   * via subito dopo. Con monete, salti e colpi che si accavallano sono
   * decine di allocazioni al secondo, e il costo non e' il suono in se' —
   * e' il lavoro che il browser fa attorno, piu' la spazzatura che lascia
   * da raccogliere, che sui portatili si vede come micro-scatti.
   *
   * Riusare gli elementi mantiene lo stesso comportamento (due copie dello
   * stesso effetto possono ancora sovrapporsi) con un numero di elementi
   * che si stabilizza da solo: quasi tutti ne usano uno o due, e nessuno
   * puo' superare MAX_VOICES.
   */
  _takeVoice(key) {
    let pool = this.pools[key];
    if (!pool) {
      // La prima voce e' l'elemento gia' caricato all'avvio: e' anche
      // quella che si usa quasi sempre (un effetto per volta), quindi e'
      // proprio lei che deve essere riavvolta in anticipo.
      pool = this.pools[key] = [this.sounds[key]];
      this._armRewind(pool[0]);
    }

    // La prima voce che ha finito di suonare.
    for (const voice of pool) {
      if (voice.paused || voice.ended) return voice;
    }

    if (pool.length < AudioManager.MAX_VOICES) {
      const voice = this.sounds[key].cloneNode();
      this._armRewind(voice);
      pool.push(voice);
      return voice;
    }

    // Tutte occupate: si riusa quella iniziata prima, cioe' la piu' avanti
    // nella riproduzione — e' quella a cui resta meno da sentire.
    let oldest = pool[0];
    for (const voice of pool) {
      if (voice.currentTime > oldest.currentTime) oldest = voice;
    }
    return oldest;
  }

  // Riavvolge la voce appena la clip finisce, cosi' al riutilizzo e' gia'
  // pronta e play() non deve aspettare la fine di una ricerca (vedi
  // playSFX: era quel ritardo a far sentire il salto in ritardo).
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

  /**
   * Plays a sound effect by name — see _resolveSFX for how a generic name
   * like "jump" is turned into the right clip for whoever is speaking.
   *
   * Due richieste identiche a meno di RETRIGGER_MS l'una dall'altra valgono
   * per una sola: piu' copie della stessa clip partite nello stesso frame
   * non si distinguono a orecchio (si sommano e basta) ma costano come
   * tutte le altre. Succede piu' spesso di quanto sembri — due monete
   * raccolte insieme, un nemico colpito mentre ne muore un altro.
   */
  playSFX(name, onEnded = null) {
    if (this.isMuted || this.sfxVolume === 0) return null;

    const soundKey = this._resolveSFX(name);
    if (!soundKey) return null;

    const now = this._now();
    if (now - (this.lastPlayed[soundKey] ?? -Infinity) < AudioManager.RETRIGGER_MS) {
      return null;
    }
    this.lastPlayed[soundKey] = now;

    // Via principale: il campione e' gia' decodificato, parte adesso.
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

    // Riserva: elemento <audio> dal pool.
    const voice = this._takeVoice(soundKey);
    if (!voice) return null;

    // Il volume corrente vive sull'elemento originale (vedi setSFXVolume):
    // le voci del pool lo ricevono qui, al momento di partire.
    voice.volume = this.sounds[soundKey].volume;
    voice.muted = this.isMuted;
    // Il riavvolgimento avviene alla fine della clip (vedi _takeVoice), non
    // qui: chiedere un salto a currentTime = 0 subito prima di play() fa
    // aspettare al browser la fine della ricerca, ed e' un ritardo che si
    // sente — il salto suonava dopo che Mario era gia' per aria.
    if (voice.currentTime !== 0) voice.currentTime = 0;
    if (onEnded) voice.addEventListener("ended", onEnded, { once: true });
    voice.play().catch(() => {});

    return voice;
  }

  /**
   * Plays several effects one after the other, each one starting when the
   * previous has finished — Toad's welcome greeting followed by the quest
   * line he opens with, say (see QuestManager._showToadDialogue).
   *
   * Chained on the clip's own "ended" event rather than on a timer, so it
   * doesn't need the durations hardcoded anywhere and stays right if a
   * clip is ever re-recorded longer or shorter. Anything that can't play
   * (muted, or a name no manifest key matches) simply doesn't hold up the
   * rest of the queue.
   */
  playSFXSequence(names) {
    const queue = (Array.isArray(names) ? names : [names]).filter(Boolean);

    const step = () => {
      const next = queue.shift();
      if (!next) return;

      // La callback vale per entrambe le vie: onended di un BufferSource o
      // l'evento "ended" di un elemento <audio> (vedi playSFX).
      if (!this.playSFX(next, step)) step();
    };

    step();
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

    // Zittisce anche gli effetti gia' partiti su Web Audio, come fa
    // element.muted per quelli sugli elementi <audio>.
    if (this.sfxGain) this.sfxGain.gain.value = isMuted ? 0 : this.sfxVolume;

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

    // Mute every sound effect as well — comprese le voci del pool che in
    // questo momento stanno suonando (vedi _takeVoice): sono elementi
    // distinti da quelli in this.sounds.
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
