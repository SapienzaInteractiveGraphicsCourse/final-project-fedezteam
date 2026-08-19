import * as THREE from "three";
import BoneMap from "./BoneMap.js";
import { buildCharacterClips } from "./clipFactory.js";

/**
 * Macchina a stati delle animazioni di un personaggio.
 *
 * Possiede l'AnimationMixer, tiene un'azione per ogni stato e gestisce le
 * dissolvenze incrociate fra uno stato e l'altro. Lo stato viene dedotto dal
 * moto del personaggio: non tocca né la fisica né i comandi, quindi accenderlo
 * o spegnerlo non cambia di una virgola come si guida il giocatore.
 */
export default class AnimationController {
  /**
   * @param {THREE.Object3D} root - la scena del modello (deve contenere le ossa)
   * @param {object} [opts]
   * @param {number} [opts.runSpeed] - velocità oltre la quale si passa a "run"
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.boneMap = new BoneMap(root);

    this.actions = {};
    this.current = null;

    // Se il modello non ha uno scheletro utilizzabile il controller resta
    // inerte: il gioco continua a funzionare, semplicemente senza animazioni.
    this.enabled = this.boneMap.isUsable;

    this.walkSpeed = opts.walkSpeed ?? 2.0;
    this.runSpeed = opts.runSpeed ?? 12.0;

    if (this.enabled) {
      // Le clip si costruiscono leggendo posizioni e orientamenti MONDO delle
      // ossa in posa di bind: le matrici devono essere aggiornate prima.
      root.updateMatrixWorld(true);

      // Fotografia della posa di riposo, scattata ORA che nessuna animazione
      // ha ancora toccato le ossa. Senza di essa un rebuild() rileggerebbe la
      // posa ANIMATA scambiandola per quella di bind, e ogni ritaratura
      // accumulerebbe deformazione sulla precedente.
      this._bindPose = [];
      root.traverse((n) => {
        if (n.isBone) {
          this._bindPose.push({
            bone: n,
            quaternion: n.quaternion.clone(),
            position: n.position.clone(),
          });
        }
      });

      this._buildActions();
    }
  }

  _buildActions() {
    const clips = buildCharacterClips(this.boneMap);

    for (const [name, clip] of Object.entries(clips)) {
      const action = this.mixer.clipAction(clip);

      if (name === "jump") {
        // Lo stacco si suona una volta e resta sull'ultimo fotogramma,
        // altrimenti il personaggio "rimbalza" mentre è ancora per aria.
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[name] = action;
    }
  }

  /**
   * Passa a uno stato con dissolvenza incrociata.
   * @param {string} name
   * @param {number} [fade] - durata della transizione in secondi
   */
  play(name, fade = 0.18) {
    if (!this.enabled) return;

    const next = this.actions[name];
    if (!next || this.current === name) return;

    const prev = this.current ? this.actions[this.current] : null;

    next.reset();
    next.setEffectiveWeight(1);
    next.fadeIn(fade);
    next.play();

    if (prev) prev.fadeOut(fade);

    this.current = name;
  }

  /**
   * Sceglie lo stato in base al moto e lo applica.
   *
   * @param {number} delta
   * @param {object} motion
   * @param {number} motion.speed - velocità orizzontale
   * @param {number} motion.verticalVelocity
   * @param {boolean} motion.grounded
   */
  update(delta, motion) {
    if (!this.enabled) return;

    if (motion) {
      const { speed = 0, verticalVelocity = 0, grounded = true } = motion;

      let state;
      if (!grounded && verticalVelocity > 0.5) state = "jump";
      else if (!grounded && verticalVelocity < -0.5) state = "fall";
      else if (speed > this.runSpeed) state = "run";
      else if (speed > this.walkSpeed) state = "walk";
      else state = "idle";

      this.play(state);

      // Il passo segue la velocità reale, così il personaggio non "pattina":
      // se rallenta, rallenta anche il ciclo di camminata.
      if (state === "walk" || state === "run") {
        const reference = state === "run" ? this.runSpeed : this.walkSpeed * 2.2;
        const ratio = THREE.MathUtils.clamp(speed / reference, 0.55, 1.8);
        this.actions[state].setEffectiveTimeScale(ratio);
      }
    }

    this.mixer.update(delta);
  }

  /** Ricostruisce le clip dopo aver modificato POSE (per la taratura a occhio). */
  /** Riporta lo scheletro esattamente alla posa di riposo. */
  restoreBindPose() {
    if (!this._bindPose) return;
    for (const s of this._bindPose) {
      s.bone.quaternion.copy(s.quaternion);
      s.bone.position.copy(s.position);
    }
    this.root.updateMatrixWorld(true);
  }

  rebuild() {
    if (!this.enabled) return;

    this.mixer.stopAllAction();
    // Prima di ricostruire le clip lo scheletro va rimesso in posa di riposo,
    // altrimenti le nuove clip verrebbero calcolate a partire da quella animata.
    this.restoreBindPose();

    this.actions = {};
    this.current = null;
    this._buildActions();
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
