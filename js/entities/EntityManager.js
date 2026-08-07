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
    // 1. Avanzamento fisica
    if (this.physicsEngine) {
      this.physicsEngine.update(delta);
    }

    if (!this.player) return;

    // 🔊 GESTIONE SUONO SALTO SINGOLO
    const isSpaceDown = input && (input.isPressed("space") || input.isPressed(" "));

    // Il suono parte SOLO se lo spazio è premuto ADESSO e NON era premuto il frame prima
    if (isSpaceDown && !this.spaceWasPressed) {
      if (!this.player.isJumping) {
        if (audio && audio.playSFX) audio.playSFX('jump');
      }
    }

    // Salva lo stato di Spazio per il prossimo frame
    this.spaceWasPressed = isSpaceDown;

    // 2. Aggiornamento Player
    this.player.update(delta, input);

    // 2.5 Luce dinamica
    const dirLight = this.dirLight || (this.rendererManager && this.rendererManager.dirLight);
    
    if (dirLight) {
      // Muove la luce mantenendo l'inclinazione in alto a destra rispetto a Mario
      dirLight.position.set(
        this.player.position.x + 30,
        this.player.position.y + 50,
        this.player.position.z + 30
      );
      // Punta il centro della luce esattamente su Mario
      dirLight.target.position.copy(this.player.position);
      dirLight.target.updateMatrixWorld();
    }

    // 3. Caduta nel vuoto
    if (this.physicsEngine && this.physicsEngine.checkVoidFall) {
      this.physicsEngine.checkVoidFall(this.player.position, () => {
        if (audio && audio.playSFX) audio.playSFX('fall');
        
        this.player.body.position.set(-20, 10, 250); 
        this.player.body.velocity.set(0, 0, 0);
        
        if (ui && ui.removeLife) ui.removeLife();
      });
    }

    // 4. Mappa e altre entità
    if (this.map && this.map.update) {
      this.map.update(this.player, () => {
        if (audio && audio.playSFX) audio.playSFX('coin');
        if (ui && ui.addCoin) ui.addCoin();
      });
    }

    if (this.yoshi && this.yoshi.update) {
      this.yoshi.update(delta, input, this.player);
    }

    this.entities.forEach((entity) => {
      if (entity.update) entity.update(delta, this.player);
    });
  }
}