export default class PhysicsEngine {
  constructor(options = {}) {
    this.gravity = options.gravity || -60;
    this.jumpStrength = options.jumpStrength || 22;
    this.groundY = options.groundY || 50;
    
    // 🔍 Aggiungiamo la soglia di caduta (di default sotto al terreno)
    this.fallThreshold = options.fallThreshold || 35;

    this.velocityY = 0;
    this.isJumping = false;
  }

  jump() {
    if (!this.isJumping) {
      this.velocityY = this.jumpStrength;
      this.isJumping = true;
    }
  }

  // 🔍 Metodo per gestire il burrone / caduta nel vuoto
  checkVoidFall(entity, onRespawn) {
    if (!entity) return;

    if (entity.position.y < this.fallThreshold) {
      // Azzera la fisica per evitare rimbalzi o problemi allo spawn
      this.velocityY = 0;
      this.isJumping = false;

      // Esegue il respawn (es. riposiziona il player e toglie una vita)
      if (onRespawn) {
        onRespawn();
      }
    }
  }

  update(entity, delta) {
    if (!entity) return;

    if (this.isJumping || entity.position.y > this.groundY) {
      entity.position.y += this.velocityY * delta;
      this.velocityY += this.gravity * delta;

      if (entity.position.y <= this.groundY) {
        entity.position.y = this.groundY;
        this.velocityY = 0;
        this.isJumping = false;
      }
    }
  }
}