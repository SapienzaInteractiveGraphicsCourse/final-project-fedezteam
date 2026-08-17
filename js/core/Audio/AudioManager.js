export default class AudioManager {
  constructor() {
    this.sounds = {};
    this.bgm = null;
    this.isMuted = false;
    this.currentCharacter = "mario"; // Default
    this.jumpToggle = false;

    this.hasStarted = false; 

    // Volumi predefiniti (da 0 a 1)
    this.bgmVolume = 0.35;
    this.sfxVolume = 0.6;
  }

  /**
   * Regola il volume della Musica (0 - 1)
   */
  setBGMVolume(volume) {
    this.bgmVolume = volume;
    if (this.bgm) {
      this.bgm.volume = this.bgmVolume;
    }
  }

  /**
   * Regola il volume degli Effetti Sonori (0 - 1)
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
   * Imposta il personaggio attivo ('mario' o 'luigi')
   */
  setCharacter(character) {
    if (character) {
      this.currentCharacter = character.toLowerCase();
    }
  }

  /**
   * Precarica un file audio
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

    // 🟢 Il gioco è ufficialmente iniziato
    this.hasStarted = true;
    
    this.bgm.muted = this.isMuted;

    // Avvia la riproduzione solo se non è già attiva
    if (this.bgm.paused) {
      this.bgm.play().catch((err) => console.warn("Errore avvio audio:", err));
    }
  }

  stopBGM() {
    if (this.bgm) {
      this.bgm.pause();
      this.bgm.currentTime = 0;
      // Resettiamo lo stato se torniamo al menu principale
      this.hasStarted = false;
    }
  }

  /**
   * Riproduce l'effetto sonoro.
   */
  playSFX(name) {
    if (this.isMuted || this.sfxVolume === 0) return;
    let soundKey = name;

    if (this.sounds[name]) {
      soundKey = name;
    } else if (name === "jump") {
      const suffix = this.jumpToggle ? "2" : "1";
      this.jumpToggle = !this.jumpToggle;
      soundKey = `${this.currentCharacter}_jump${suffix}`;
    } else {
      const charSpecificName = `${this.currentCharacter}_${name}`;
      if (this.sounds[charSpecificName]) {
        soundKey = charSpecificName;
      }
    }

    if (!this.sounds[soundKey]) return;

    const soundClone = this.sounds[soundKey].cloneNode();
    soundClone.volume = this.sounds[soundKey].volume;
    soundClone.play().catch(() => {});
  }

  setMute(isMuted) {
    this.isMuted = isMuted;

    if (this.bgm) {
      this.bgm.muted = isMuted;
      
      // 🟢 FIX: Falla partire in automatico SOLO SE non è mutata, era in pausa e,
      // soprattutto, SOLO SE il giocatore ha già premuto "Start" (hasStarted)
      if (!isMuted && this.hasStarted && this.bgm.paused) {
        this.bgm
          .play()
          .catch((err) => console.warn("Autoplay bloccato dal browser:", err));
      }
    }

    // Muta tutti gli effetti sonori
    for (const key in this.sounds) {
      if (this.sounds[key]) {
        this.sounds[key].muted = isMuted;
      }
    }
  }
}