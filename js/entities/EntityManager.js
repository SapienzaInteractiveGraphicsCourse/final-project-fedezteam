import Player from "./Player.js";

export default class EntityManager {
  // Aggiunto il physicsEngine nel costruttore per distribuirlo dove serve
  constructor(scene, physicsEngine) {
    this.scene = scene;
    this.physicsEngine = physicsEngine;
    this.map = null;
    this.yoshi = null;
    this.player = null;
    this.entities = [];

    // 🔴 FLAG: tiene traccia se lo spazio era già premuto nel frame precedente
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
    // Pulizia se esiste già un player (utile per i respawn totali)
    if (this.player && this.player.mesh) {
      this.scene.remove(this.player.mesh);
      if (this.player.body) this.physicsEngine.world.removeBody(this.player.body);
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
    // 🛑 Se il gioco è in GAME_OVER o nei menù, ferma la fisica e l'aggiornamento
    if (ui && ui.gameState !== "PLAYING") return;

    // 1. Avanzamento fisica
    if (this.physicsEngine) {
      this.physicsEngine.update(delta);
    }

    if (!this.player) return;

    // 2. Aggiornamento Player
    this.player.update(delta, input, audio);

    // 2.5 Luce dinamica
    const dirLight = this.dirLight || (this.rendererManager && this.rendererManager.dirLight);
    if (dirLight) {
      dirLight.position.set(
        this.player.position.x + 30,
        this.player.position.y + 50,
        this.player.position.z + 30
      );
      dirLight.target.position.copy(this.player.position);
      dirLight.target.updateMatrixWorld();
    }

    // 3. Caduta nel vuoto
    if (this.physicsEngine && this.physicsEngine.checkVoidFall) {
      this.physicsEngine.checkVoidFall(this.player.position, () => {
        
        // Verifica se la morte causa il Game Over (quando si era già a 0 vite)
        const isGameOver = ui && ui.removeLife ? ui.removeLife(1, audio) : false;

        // Se è Game Over, ferma il respawn
        if (isGameOver) {
          return;
        }

        // Se è ancora in gioco (anche a 0 vite), suona la caduta e respawna Mario
        if (audio && audio.playSFX) audio.playSFX('fall');
        
        this.player.body.position.set(-20, 10, 250); 
        this.player.body.velocity.set(0, 0, 0);
      });
    }

    // 4. Mappa e altre entità
    if (this.map && this.map.update) {
      this.map.update(
        this.player,
        () => {
          if (audio && audio.playSFX) audio.playSFX('coin');
          if (ui && ui.addCoin) ui.addCoin();
        },
        () => {
          if (audio && audio.playSFX) audio.playSFX('star');
          if (ui && ui.addStar) ui.addStar(1);
        },
        () => {
          if (audio && audio.playSFX) audio.playSFX('mushroom');
          if (ui && ui.addLife) ui.addLife(1);
        }
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