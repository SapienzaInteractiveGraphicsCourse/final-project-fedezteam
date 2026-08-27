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

    // Optional hooks set from main.js; onStarCollected receives the
    // picked-up star record (with its optional `id`).
    this.onCoinCollected = null;
    this.onStarCollected = null;
    // Fired when a ridden Yoshi falls into the void with the player on his
    // back (see update()'s Yoshi void-fall check) — main.js uses it to lay
    // the egg back down for a fresh hatch.
    this.onYoshiLost = null;

    // Yoshi's own void-fall respawn point — his egg's hatch spot, captured
    // in setYoshi() below.
    this.yoshiRespawnPoint = null;

    // Classic void-fall respawn point (see setSpawnPoint).
    this.spawnPoint = { x: 0, y: 2, z: 0 };

    // Extra void-fall respawn zones (see setVoidFallZones), checked
    // before falling back to spawnPoint.
    this.voidFallZones = [];
  }

  // Called from main.js with mapEntity.playerSpawn once level1.json is
  // parsed — used when a fall doesn't land inside any void-fall zone.
  setSpawnPoint(point) {
    if (point) this.spawnPoint = point;
  }

  // Array of { zone, respawn }: `zone` exposes containsPoint(pos). First
  // match wins; falls back to spawnPoint otherwise.
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
      // His hatch spot doubles as his own void-fall respawn point ("il
      // punto di respawn per yoshi e' dove sta l'uovo").
      this.yoshiRespawnPoint = {
        x: this.yoshi.mesh.position.x,
        y: this.yoshi.mesh.position.y,
        z: this.yoshi.mesh.position.z,
      };
    }
  }

  // `characterName` no longer picks movement stats (both share one set);
  // kept because callers pass it and it documents which model is spawned.
  spawnPlayer(model, startX, startY, startZ, characterName = "mario") {
    if (this.player && this.player.mesh) {
      this.player.disposeAnimation();
      this.scene.remove(this.player.mesh);
      if (this.player.body) {
        this.physicsEngine.world.removeBody(this.player.body);
        // Also drop the old body from the gravity registry — it's about
        // to be replaced, no point keeping a stale one around.
        if (this.physicsEngine.unregisterGravityBody) {
          this.physicsEngine.unregisterGravityBody(this.player.body);
        }
      }
    }

    // Mario and Luigi handle identically now (same speed/jump/grip); the
    // choice is purely visual (they used to diverge, which read as broken).
    const stats = { moveSpeed: 11, jumpVelocity: 18, control: 0.6 };

    this.player = new Player(model, this.physicsEngine, stats);
    this.player.spawn(startX, startY, startZ);
    this.scene.add(this.player.mesh);

    // Opt into Mario Galaxy-style planet gravity — harmless everywhere
    // until the body gets close to a registered gravity field.
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
    // "ENDING" (post-win epilogue) still updates like PLAYING; everything
    // else (menus, win/game-over screens) stays frozen.
    if (ui && ui.gameState !== "PLAYING" && ui.gameState !== "ENDING") return;

    // Frozen during Peach's cutscene dialogue (gameState stays "ENDING"
    // throughout it — this check is what actually stops movement).
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
        // Climbed back above threshold without falling: allow the scream
        // to play again next time.
        this.isFallingScreamPlaying = false;
      }

      this.physicsEngine.checkVoidFall(this.player.position, () => {
        this.isFallingScreamPlaying = false;
        const isGameOver =
          ui && ui.removeLife ? ui.removeLife(1, audio) : false;
        if (isGameOver) return;

        // Zone-aware respawn: falling inside a boss zone sends the player
        // back to that zone's entrance, else to the level's spawn point.
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

    // Yoshi has his own physics body, independent of the player's, so he
    // needs his own void-fall check — without it he just kept falling
    // forever (and, while ridden, kept dragging the rider's mesh down with
    // him, since Yoshi.update()'s isRidden branch overwrites it every frame).
    if (this.yoshi && this.yoshi.body && this.physicsEngine && this.physicsEngine.checkVoidFall) {
      this.physicsEngine.checkVoidFall(this.yoshi.position, () => {
        if (this.yoshi.isRidden) {
          // Lost together with the rider: dismount, drop Yoshi entirely,
          // and hand off to main.js's onYoshiLost (lays the egg back down
          // so he can be hatched again). The player's own fall is handled
          // by the void-fall check above, independently.
          if (this.player && this.player.setMountedOnYoshi) {
            this.player.setMountedOnYoshi(false);
          }
          // BUG FIX: the rider kept Yoshi's jump/fall voice after being
          // separated this way — the manual "Press E to get off" path
          // already resets it (see main.js), this one didn't.
          if (audio && audio.setVoice) audio.setVoice(null);
          const mesh = this.yoshi.mesh;
          this.yoshi.despawn();
          if (mesh && mesh.parent) mesh.parent.remove(mesh);
          this.yoshi = null;
          if (this.onYoshiLost) this.onYoshiLost();
        } else {
          // Wandered off the edge on his own: just send him back to his
          // egg's spot rather than losing him entirely.
          const target = this.yoshiRespawnPoint || this.spawnPoint;
          this.yoshi.body.position.set(target.x, target.y, target.z);
          this.yoshi.body.velocity.set(0, 0, 0);
        }
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
          // audio is passed through so addStar() can stop the BGM itself
          // if this pickup triggers the win screen.
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
