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

  spawnPlayer(model, startX, startY, startZ, characterName = "mario") {
    if (this.player && this.player.mesh) {
      this.scene.remove(this.player.mesh);
      if (this.player.body)
        this.physicsEngine.world.removeBody(this.player.body);
    }

    // Per-character stats: Luigi is faster/higher-jumping but slippery,
    // Mario is precise and stops/turns quickly.
    let stats = {};
    if (characterName === "luigi") {
      stats = { moveSpeed: 20, jumpVelocity: 22, control: 0.1 };
    } else {
      stats = { moveSpeed: 11, jumpVelocity: 18, control: 0.6 };
    }

    this.player = new Player(model, this.physicsEngine, stats);
    this.player.spawn(startX, startY, startZ);
    this.scene.add(this.player.mesh);
  }

  addEntity(entity) {
    this.entities.push(entity);
    if (entity.mesh) {
      this.scene.add(entity.mesh);
    }
  }

  update(delta, input, ui, audio, camera) {
    if (ui && ui.gameState !== "PLAYING") return;

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

        this.player.body.position.set(0, 2, 0);
        this.player.body.velocity.set(0, 0, 0);
      });
    }

    if (this.map && this.map.update) {
      this.map.update(
        this.player,
        () => {
          if (audio && audio.playSFX) audio.playSFX("coin");
          if (ui && ui.addCoin) ui.addCoin();
        },
        () => {
          if (audio && audio.playSFX) audio.playSFX("star");
          if (ui && ui.addStar) ui.addStar(1);
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