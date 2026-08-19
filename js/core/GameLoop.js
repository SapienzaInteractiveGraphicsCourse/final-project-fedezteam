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

    // Three.js animation loop, driven by the WebGL renderer itself.
    this.rendererManager.renderer.setAnimationLoop(() => {
      if (!this.isRunning) return;

      // Clamp delta to avoid huge physics/animation steps after a tab
      // switch or a long GC pause.
      const delta = Math.min(this.clock.getDelta(), 0.1);

      if (this.updateCallback) {
        this.updateCallback(delta);
      }

      // Render through RendererManager.render() rather than calling the raw
      // WebGLRenderer directly: that method is what re-centers the skybox on
      // the camera every frame. Calling the renderer directly skips it,
      // leaving the sky sphere pinned to the world origin.
      this.rendererManager.render();
    });
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.rendererManager.renderer.setAnimationLoop(null);
    this.clock.stop();
  }
}
