/**
 * PeachCutscene.js — "walk up to Peach, press E" ending dialogue: freezes
 * player movement, takes a fixed cinematic camera shot, and steps through
 * a short speech-bubble script into the victory finale. Only Peach's own
 * scripted moment — the earlier win-screen -> teleport flow is main.js's.
 */
export default class PeachCutscene {
  constructor(ui, camera, peachGroup, castleGroup, audio = null) {
    this.ui = ui;
    this.camera = camera;
    this.peach = peachGroup;
    this.castle = castleGroup;
    // Optional; without it the cutscene plays out silently.
    this.audio = audio;

    this.active = false;
    this.lineIndex = 0;

    // ${heroName} is substituted with the name entered at character-select.
    this.lines = [
      'Thank you for saving me, ${heroName}!',
      'I knew you could do it — defeating Bowser and collecting every Power Star.',
      'The Mushroom Kingdom is safe once more, thanks to you.',
      'How about we all celebrate together with a nice cake at the castle?',
    ];
  }

  start(heroName = 'hero') {
    if (this.active || !this.ui) return;
    this.active = true;
    this.lineIndex = 0;
    this.heroName = heroName;
    this.ui.dialogueActive = true;
    this._renderLine();
  }

  _renderLine() {
    const raw = this.lines[this.lineIndex];
    const text = raw.replace('${heroName}', this.heroName || 'hero');
    const isLast = this.lineIndex >= this.lines.length - 1;

    // Character-specific greeting on the opening line, alternated generic
    // blip on the rest. Nothing plays on the line that closes the dialogue.
    this.audio?.playSFX?.(this.lineIndex === 0 ? 'peach_call' : 'peach_talk');

    this.ui.showDialogue('PEACH', text, isLast);
  }

  // Called once per physical Space/E press while active (main.js).
  advance() {
    if (!this.active) return;

    this.lineIndex++;
    if (this.lineIndex >= this.lines.length) {
      this.active = false;
      this.ui.hideDialogue();
      this.ui.dialogueActive = false;
      this.ui.showVictoryFinale();
      return;
    }

    this._renderLine();
  }

  // Called every frame while active, replacing CameraManager.update: a
  // fixed shot in front of Peach, nudged so she sits off-center.
  updateCamera() {
    if (!this.active || !this.peach || !this.camera) return;

    const peachPos = this.peach.position;
    const dist = 6.5;
    const height = peachPos.y + 3.2;

    // Faces away from the castle behind her, from castle->Peach rather
    // than a hardcoded axis, so a re-laid-out zone still works.
    let dirX = 0;
    let dirZ = 1;
    if (this.castle) {
      dirX = peachPos.x - this.castle.position.x;
      dirZ = peachPos.z - this.castle.position.z;
      const len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len;
      dirZ /= len;
    }

    this.camera.position.set(peachPos.x + dirX * dist, height, peachPos.z + dirZ * dist);

    // Perpendicular to the view direction, so the shift reads sideways.
    const perpX = -dirZ;
    const perpZ = dirX;
    const lateralShift = 1.8;

    this.camera.lookAt(
      peachPos.x + perpX * lateralShift,
      peachPos.y + 2.0,
      peachPos.z + perpZ * lateralShift,
    );
  }
}
