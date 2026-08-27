import * as THREE from "three";

/**
 * GameLoop.js — drives the main render/update loop via three.js'
 * setAnimationLoop, clamping delta so a stalled tab can't produce a huge
 * simulation step on resume.
 */
export default class GameLoop {
  // frameObserver (optional) receives every delta, even during menus/pauses
  // — used by QualityManager, which needs fps measured at all times.
  constructor(rendererManager, updateCallback, frameObserver = null) {
    this.clock = new THREE.Clock();
    this.rendererManager = rendererManager;
    this.updateCallback = updateCallback;
    this.frameObserver = frameObserver;
    this.isRunning = false;
  }

  // Renders via RendererManager.render(), not the raw renderer: that's
  // where the skybox gets re-centered on the camera every frame.
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();

    this.rendererManager.renderer.setAnimationLoop(() => {
      if (!this.isRunning) return;

      const delta = Math.min(this.clock.getDelta(), 0.1);

      if (this.frameObserver) {
        this.frameObserver.sample(delta);
      }

      if (this.updateCallback) {
        this.updateCallback(delta);
      }

      this.rendererManager.render();
    });
  }

  // Stops the loop and the clock. Safe to call even if never started.
  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.rendererManager.renderer.setAnimationLoop(null);
    this.clock.stop();
  }
}
