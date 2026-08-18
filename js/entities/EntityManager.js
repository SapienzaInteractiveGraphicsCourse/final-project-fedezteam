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

  // In EntityManager.js, aggiorna il metodo spawnPlayer[cite: 5]

  spawnPlayer(model, startX, startY, startZ, characterName = "mario") {
    if (this.player && this.player.mesh) {
      this.scene.remove(this.player.mesh);
      if (this.player.body)
        this.physicsEngine.world.removeBody(this.player.body);
    }

    // 💡 Definisci le Statistiche in base al personaggio scelto!
    let stats = {};
    if (characterName === "luigi") {
      stats = {
        moveSpeed: 20, // Luigi è più veloce
        jumpVelocity: 22, // Luigi salta molto più in alto (es. 22 vs 18)
        control: 0.1, // Luigi è SCIVOLOSO! (Valore basso = tanta inerzia)
      };
    } else {
      stats = {
        moveSpeed: 11, // Mario standard
        jumpVelocity: 18, // Salto bilanciato
        control: 0.6, // Mario è preciso e si ferma/gira molto in fretta
      };
    }

    // Passiamo 'stats' al costruttore del giocatore[cite: 5]
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

    // 1. Physics Engine Update
    if (this.physicsEngine) {
      this.physicsEngine.update(delta);
    }

    if (!this.player) return;

    // 2. Unico update del player con la telecamera passata correttamente
    this.player.update(delta, input, ui, audio, camera);

    // 3. Luce direzionale
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

    // 4. Caduta nel vuoto
    if (this.physicsEngine && this.physicsEngine.checkVoidFall) {
      const SCREAM_Y = -5;
      if (this.player.position.y < SCREAM_Y) {
        if (!this.isFallingScreamPlaying) {
          if (audio && audio.playSFX) audio.playSFX("fall");
          this.isFallingScreamPlaying = true;
        }
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

    // 5. Mappa
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

    // 6. Yoshi
    if (this.yoshi && this.yoshi.update) {
      this.yoshi.update(delta, input, this.player);
    }

    this.entities.forEach((entity) => {
      if (entity.update) entity.update(delta, this.player);
    });
  }
}
