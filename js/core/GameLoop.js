import * as THREE from "three";

export default class GameLoop {
  constructor(rendererManager, updateCallback) {
    this.clock = new THREE.Clock();
    this.rendererManager = rendererManager; 
    this.updateCallback = updateCallback;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();

    // three.js animation loop
    this.rendererManager.renderer.setAnimationLoop(() => {
      if (!this.isRunning) return;

      const delta = Math.min(this.clock.getDelta(), 0.1);

      if (this.updateCallback) {
        this.updateCallback(delta);
      }

      this.rendererManager.renderer.render(
        this.rendererManager.scene,
        this.rendererManager.camera
      );
    });
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.rendererManager.renderer.setAnimationLoop(null);
    this.clock.stop();
  }
}
