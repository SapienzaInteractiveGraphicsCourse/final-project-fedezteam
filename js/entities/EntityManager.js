import Player from "./Player.js";

export default class EntityManager {
  constructor(scene, physicsEngine, dirLight = null) {
    this.scene = scene;
    this.physicsEngine = physicsEngine;
    this.dirLight = dirLight;

    this.map = null;
    this.yoshi = null;
    this.player = null;
    this.entities = [];

    this.spaceWasPressed = false;
    this.isFallingScreamPlaying = false;

    // Optional hook, set from main.js (see QuestManager.onCoinCollected) —
    // called every time ANY coin is picked up anywhere in the level, on top
    // of the existing ui.addCoin()/SFX handling below. Left null by default
    // so nothing changes for anyone who never sets it.
    this.onCoinCollected = null;

    // Same idea, for stars (see QuestManager.onStarCollected) — called with
    // the star record that was just picked up (see Collectibles.spawnStars/
    // update), so a caller can tell WHICH star it was via its optional
    // `id`. Left null by default so nothing changes for anyone who never
    // sets it.
    this.onStarCollected = null;

    // Classic void-fall respawn point (see setSpawnPoint) — defaults to the
    // old hardcoded value so nothing changes for anyone who never calls it.
    this.spawnPoint = { x: 0, y: 2, z: 0 };

    // Extra void-fall respawn zones (see setVoidFallZones), checked before
    // falling back to spawnPoint — e.g. falling into the void during a boss
    // fight respawns at that zone's own entrance instead of the main island.
    this.voidFallZones = [];
  }

  // Sets the classic void-fall respawn point (called from main.js with
  // mapEntity.playerSpawn once level1.json is parsed) — used whenever a
  // fall doesn't land inside any zone registered via setVoidFallZones.
  setSpawnPoint(point) {
    if (point) this.spawnPoint = point;
  }

  // Registers extra void-fall respawn zones: an array of
  // { zone, respawn }, where `zone` exposes containsPoint(pos) (an
  // ObstacleZone instance already does — see there) and `respawn` is the
  // {x,y,z} to send the player back to. Checked in order, first match wins;
  // falls back to spawnPoint if nothing matches. Called from main.js once
  // the Kamek/Bowser zones have finished loading.
  setVoidFallZones(zones) {
    this.voidFallZones = zones || [];
  }

  setMap(mapEntity) {
    this.map = mapEntity;
    if (mapEntity && mapEntity.scene) {
      this.scene.add(mapEntity.scene);
    }
  }

  setYoshi(yoshiEntity) {
    this.yoshi = yoshiEntity;
    if (this.yoshi && this.yoshi.mesh) {
      this.scene.add(this.yoshi.mesh);
    }
  }

  // `characterName` no longer picks movement stats (the two characters
  // share one set — see below); it's kept because callers pass it and it
  // documents which model is being spawned.
  spawnPlayer(model, startX, startY, startZ, characterName = "mario") {
    if (this.player && this.player.mesh) {
      this.player.disposeAnimation();
      this.scene.remove(this.player.mesh);
      if (this.player.body) {
        this.physicsEngine.world.removeBody(this.player.body);
        // Also drop the old body from the planet-gravity registry (see
        // PhysicsEngine.registerGravityBody) — it's about to be replaced,
        // and a stale removed body sitting in that set would be harmless
        // but pointless to keep iterating every frame.
        if (this.physicsEngine.unregisterGravityBody) {
          this.physicsEngine.unregisterGravityBody(this.player.body);
        }
      }
    }

    // Both characters handle IDENTICALLY: same speed, same jump, same grip.
    // Picking one is a purely visual choice — the difference is the model,
    // Luigi being the taller and thinner of the two (1.771 against Mario's
    // 1.639 units, set at export time in tools/fix_character_export.py).
    //
    // Luigi used to carry his own numbers, and the one that mattered was
    // `control` at 0.1 against Mario's 0.6: that value is how sharply the
    // velocity eases toward the target each frame (see Player._updateFlat),
    // so at 0.1 he took roughly six times as long to get up to speed and
    // kept sliding for as long after letting go. It was meant to read as
    // "slippery", but what it actually read as was Luigi struggling to
    // walk. His higher jump (19.5 against 18) also cleared scenery Mario
    // can't, the castle fence included (see EndingZone's FENCE) — one more
    // reason for the two to share a single set of numbers rather than
    // drift apart.
    const stats = { moveSpeed: 11, jumpVelocity: 18, control: 0.6 };

    this.player = new Player(model, this.physicsEngine, stats);
    this.player.spawn(startX, startY, startZ);
    this.scene.add(this.player.mesh);

    // Opt the player into Mario Galaxy-style planet gravity (see
    // PhysicsEngine.registerGravityBody / GravityField.js). Harmless
    // everywhere in the normal level — this only changes anything once the
    // body gets close enough to a planet's registered gravity field.
    if (this.physicsEngine.registerGravityBody) {
      this.physicsEngine.registerGravityBody(this.player.body);
    }
  }

  addEntity(entity) {
    this.entities.push(entity);
    if (entity.mesh) {
      this.scene.add(entity.mesh);
    }
  }

  update(delta, input, ui, audio, camera) {
    // "ENDING" is the epilogue that follows the win screen: the player is
    // walking around Peach's castle (see UIManager.reachPeach and
    // entities/Level/EndingZone.js). The run is over, but the character is
    // still under the player's control, so it has to keep updating exactly
    // like PLAYING — everything else (menus, pause, the win/game-over
    // screens themselves) stays frozen as before.
    if (ui && ui.gameState !== "PLAYING" && ui.gameState !== "ENDING") return;

    // Frozen during Peach's cutscene dialogue (see PeachCutscene.js /
    // main.js): gameState stays "ENDING" throughout it, so this extra check
    // is what actually stops the player from walking around mid-dialogue.
    if (ui && ui.dialogueActive) return;

    if (this.physicsEngine) {
      this.physicsEngine.update(delta);
    }

    if (!this.player) return;

    this.player.update(delta, input, ui, audio, camera);

    // Directional light follows the player so shadows stay in range.
    if (this.dirLight) {
      this.dirLight.position.set(
        this.player.position.x + 30,
        this.player.position.y + 50,
        this.player.position.z + 30,
      );
      this.dirLight.target.position.copy(this.player.position);
      this.dirLight.target.updateMatrixWorld();
    }

    if (this.physicsEngine && this.physicsEngine.checkVoidFall) {
      const SCREAM_Y = -5;
      if (this.player.position.y < SCREAM_Y) {
        if (!this.isFallingScreamPlaying) {
          if (audio && audio.playSFX) audio.playSFX("fall");
          this.isFallingScreamPlaying = true;
        }
      } else {
        // Player climbed back above the threshold without falling into
        // the void: allow the scream to play again next time they fall.
        this.isFallingScreamPlaying = false;
      }

      this.physicsEngine.checkVoidFall(this.player.position, () => {
        this.isFallingScreamPlaying = false;
        const isGameOver =
          ui && ui.removeLife ? ui.removeLife(1, audio) : false;
        if (isGameOver) return;

        // Zone-aware respawn: falling into the void while inside a boss
        // zone (Kamek's or Bowser's obstacle course, including its arena)
        // sends the player back to THAT zone's own entrance instead of the
        // main island — see setVoidFallZones (wired from main.js). Falls
        // back to the level's classic spawn point (see setSpawnPoint)
        // everywhere else, e.g. the main map (level1.json). player.position
        // is read here BEFORE it's overwritten below, so it still reflects
        // where the player actually fell from.
        let target = this.spawnPoint;
        for (const entry of this.voidFallZones) {
          if (entry.zone && entry.zone.containsPoint(this.player.position)) {
            target = entry.respawn;
            break;
          }
        }

        this.player.body.position.set(target.x, target.y, target.z);
        this.player.body.velocity.set(0, 0, 0);
      });
    }

    if (this.map && this.map.update) {
      this.map.update(
        delta,
        this.player,
        () => {
          if (audio && audio.playSFX) audio.playSFX("coin");
          if (ui && ui.addCoin) ui.addCoin();
          if (this.onCoinCollected) this.onCoinCollected();
        },
        (star) => {
          if (audio && audio.playSFX) audio.playSFX("star");
          // Passing audio through lets addStar() stop the BGM itself if
          // this pickup happens to be the one that reaches maxStars and
          // triggers the win screen (see UIManager.addStar/showWin).
          if (ui && ui.addStar) ui.addStar(1, audio);
          if (this.onStarCollected) this.onStarCollected(star);
        },
        () => {
          if (audio && audio.playSFX) audio.playSFX("mushroom");
          if (ui && ui.addLife) ui.addLife(1);
        },
      );
    }

    if (this.yoshi && this.yoshi.update) {
      this.yoshi.update(delta, input, this.player);
    }

    this.entities.forEach((entity) => {
      if (entity.update) entity.update(delta, this.player);
    });
  }
}
