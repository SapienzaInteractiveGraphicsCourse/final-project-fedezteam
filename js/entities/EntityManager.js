import Player from "./Player.js";

export default class EntityManager {
  constructor(scene, physicsEngine) {
    this.scene = scene;
    this.physicsEngine = physicsEngine;
    this.map = null;
    this.yoshi = null;
    this.player = null;
    this.entities = [];

    this.spaceWasPressed = false;
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

  spawnPlayer(model, startX, startY, startZ) {
    if (this.player && this.player.mesh) {
      this.scene.remove(this.player.mesh);
      if (this.player.body)
        this.physicsEngine.world.removeBody(this.player.body);
    }

    this.player = new Player(model, this.physicsEngine);
    this.player.spawn(startX, startY, startZ);
    this.scene.add(this.player.mesh);
  }

  addEntity(entity) {
    this.entities.push(entity);
    if (entity.mesh) {
      this.scene.add(entity.mesh);
    }
  }

  update(delta, input, ui, audio) {
    if (ui && ui.gameState !== "PLAYING") return;

    // 1. Physics Engine Update
    if (this.physicsEngine) {
      this.physicsEngine.update(delta);
    }

    if (!this.player) return;

    // 2. Player Update
    this.player.update(delta, input, audio);

    // 3. Update the directional light to follow the player
    const dirLight =
      this.dirLight || (this.rendererManager && this.rendererManager.dirLight);
    if (dirLight) {
      dirLight.position.set(
        this.player.position.x + 30,
        this.player.position.y + 50,
        this.player.position.z + 30,
      );
      dirLight.target.position.copy(this.player.position);
      dirLight.target.updateMatrixWorld();
    }

    // 4. Fall detection and respawn logic
    if (this.physicsEngine && this.physicsEngine.checkVoidFall) {
      // Impostiamo una soglia di respawn più profonda (es. Y = -50)
      const RESPAWN_Y = -50;
      // Impostiamo la soglia per l'urlo prima del respawn (es. Y = -15)
      const SCREAM_Y = -15; // Inizia ad urlare appena lascia l'isola

      if (this.player.position.y < SCREAM_Y) {
        if (!this.isFallingScreamPlaying) {
          if (audio && audio.playSFX) audio.playSFX("fall");
          this.isFallingScreamPlaying = true; // Evita che l'audio riparta a raffica
        }
      }

      if (this.physicsEngine && this.physicsEngine.checkVoidFall) {
        this.physicsEngine.checkVoidFall(this.player.position, () => {
          // Reset del flag per la prossima caduta
          this.isFallingScreamPlaying = false;

          // Gestione Vite / Game Over
          const isGameOver =
            ui && ui.removeLife ? ui.removeLife(1, audio) : false;
          if (isGameOver) return;

          // Respawn di Mario al punto di partenza
          this.player.body.position.set(0, 1.5, 0);
          this.player.body.velocity.set(0, 0, 0);
        });
      }
    }

    // 4. Mappa e altre entità
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
