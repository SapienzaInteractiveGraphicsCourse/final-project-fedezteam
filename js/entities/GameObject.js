import Player from './Player.js';

export default class GameObject {
  constructor(scene) {
    this.scene = scene;
    this.map = null;
    this.yoshi = null;
    this.player = null;
    this.entities = []; // Array per contenere nemici, monete o altre entità dinamicamente
  }

  // Imposta e aggiunge la mappa alla scena
  setMap(mapEntity) {
    this.map = mapEntity;
    if (this.map && this.map.addToScene) {
      this.map.addToScene(this.scene);
    }
  }

  // Imposta e aggiunge Yoshi alla scena
  setYoshi(yoshiEntity) {
    this.yoshi = yoshiEntity;
    if (this.yoshi && this.yoshi.mesh) {
      this.scene.add(this.yoshi.mesh);
    }
  }

  // Crea e spawna il personaggio scelto
  spawnPlayer(model, groundY) {
    // Se esisteva già un player, lo rimuoviamo prima dalla scena
    if (this.player && this.player.mesh) {
      this.scene.remove(this.player.mesh);
    }

    this.player = new Player(model, 35);
    this.player.spawn(-20, groundY, 250);
    this.scene.add(this.player.mesh);
  }

  // Metodo generico per aggiungere altre entità al gioco
  addEntity(entity) {
    this.entities.push(entity);
    if (entity.mesh) {
      this.scene.add(entity.mesh);
    }
  }

  // Aggiorna tutte le entità in un unico punto
  update(delta, input, physics, ui) {
    if (!this.player) return;

    // 1. Aggiornamento Player (movimento + gravità + salto)
    this.player.update(delta, input, physics);

    // 2. Controllo caduta nel vuoto
    if (physics && physics.checkVoidFall) {
      physics.checkVoidFall(this.player, () => {
        this.player.spawn(-20, physics.groundY, 250);
        if (ui && ui.removeLife) {
          ui.removeLife();
        }
      });
    }

    // 3. Aggiornamento Mappa (rotazione stelle, raccolta oggetti)
    if (this.map && this.map.update) {
      this.map.update(this.player, () => {
        if (ui && ui.addCoin) {
          ui.addCoin();
        }
      });
    }

    // 4. Aggiornamento Yoshi ed eventuali altre entità (Passiamo sia delta che input e player)
    if (this.yoshi && this.yoshi.update) {
      this.yoshi.update(delta, input, this.player);
    }

    this.entities.forEach((entity) => {
      if (entity.update) entity.update(delta, this.player);
    });
  }
}