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

update(delta, input, ui) {
    // 1. Prima facciamo avanzare l'intero mondo fisico
    if (this.physicsEngine) {
      this.physicsEngine.update(delta);
    }

    if (!this.player) return;

    // 2. Aggiorniamo le logiche e gli input del giocatore
    this.player.update(delta, input);

    // ➔ 2.5 AGGIORNAMENTO LUCE DINAMICA
    // Recupera la luce da RendererManager o dalla classe corrente
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

    // 3. Controlliamo se il giocatore è caduto fuori dalla mappa
    if (this.physicsEngine && this.physicsEngine.checkVoidFall) {
      this.physicsEngine.checkVoidFall(this.player.position, () => {
        // Logica di Respawn
        this.player.body.position.set(-20, 10, 250); 
        this.player.body.velocity.set(0, 0, 0);
        
        if (ui && ui.removeLife) ui.removeLife();
      });
    }

    // 4. Aggiorniamo mappa ed entità rimanenti
    if (this.map && this.map.update) {
      this.map.update(this.player, () => {
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