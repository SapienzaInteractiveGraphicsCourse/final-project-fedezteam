export default class PhysicsEngine {
  constructor(options = {}) {
    this.gravity = options.gravity || -60;
    this.jumpStrength = options.jumpStrength || 22;
    this.groundY = options.groundY || 50;

    this.velocityY = 0;
    this.isJumping = false;
  }

  jump() {
    if (!this.isJumping) {
      this.velocityY = this.jumpStrength;
      this.isJumping = true;
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