/**
 * PeachCutscene.js — the "walk up to Peach, press E" ending dialogue:
 * freezes player movement, takes over the camera with a fixed cinematic
 * framing on Peach, and steps through a short speech-bubble script advanced
 * by Space/E, ending in the final victory screen (see
 * UIManager.showDialogue/showVictoryFinale).
 *
 * Only handles Peach's OWN scripted moment — the earlier "collect every
 * star -> win screen -> REACH PRINCESS PEACH button -> teleport to the
 * ending zone" flow (main.js's ui.onReachPeach) is untouched; this is what
 * happens once the player then walks up to her there and interacts.
 */
export default class PeachCutscene {
  constructor(ui, camera, peachGroup, castleGroup) {
    this.ui = ui;
    this.camera = camera;
    this.peach = peachGroup;
    this.castle = castleGroup;

    this.active = false;
    this.lineIndex = 0;

    // ${heroName} is substituted with whatever name the player entered at
    // the character-select screen (see UIManager._triggerStart / heroName).
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
    this.ui.showDialogue('PEACH', text, isLast);
  }

  // Called once per physical Space/E press while the dialogue is active
  // (see main.js's updateGame).
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

  // Called every frame while active (main.js skips the normal
  // CameraManager.update in favor of this) — a fixed shot in front of
  // Peach, with the look-at target nudged sideways so she reads on the
  // right third of the frame instead of dead-center.
  updateCamera() {
    if (!this.active || !this.peach || !this.camera) return;

    const peachPos = this.peach.position;
    const dist = 6.5;
    const height = peachPos.y + 3.2;

    // Face roughly the direction Peach herself is standing toward (away
    // from the castle behind her), derived from castle->Peach instead of a
    // hardcoded axis so this keeps working if peach_castle.json is ever
    // re-laid-out.
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

    // Perpendicular to the view direction, so the shift reads as
    // "sideways in-frame" rather than "toward/away from the camera".
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
