export default class AudioManager {
  constructor() {
    this.sounds = {};
    this.bgm = null;
    this.isMuted = false;
    this.currentCharacter = 'mario'; // Default
    // 🔴 Toggle per alternare il primo e il secondo suono del salto
    this.jumpToggle = false;
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
    audio.preload = 'auto';

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
    if (this.bgm && !this.isMuted) {
      this.bgm.play().catch((err) => console.warn("Autoplay bloccato dal browser:", err));
    }
  }

  stopBGM() {
    if (this.bgm) {
      this.bgm.pause();
      this.bgm.currentTime = 0;
    }
  }

  /**
   * Riproduce l'effetto sonoro. 
   * Cerca prima l'audio specifico (es. 'mario_jump'), altrimenti usa quello generico ('star').
   */
playSFX(name) {
    if (this.isMuted) return;

    let soundKey = name;

// 1. Se il suono esiste con il nome esatto (es. 'mario_selected'), usa quello
    if (this.sounds[name]) {
      soundKey = name;
    } 
    // 2. Alternanza dei due suoni per il salto
    else if (name === 'jump') {
      const suffix = this.jumpToggle ? '2' : '1';
      this.jumpToggle = !this.jumpToggle;
      soundKey = `${this.currentCharacter}_jump${suffix}`;
    } 
    // 3. Altrimenti aggiunge automaticamente il prefisso del personaggio (es. 'selected' -> 'mario_selected')
    else {
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
}