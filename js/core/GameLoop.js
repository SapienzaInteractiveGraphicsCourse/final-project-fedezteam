import * as THREE from "three";

/**
 * GameLoop.js — drives the game's main render/update loop via three.js'
 * built-in animation loop (renderer.setAnimationLoop), clamping delta time
 * so a stalled tab or debugger pause can't produce a huge simulation step
 * when it resumes.
 */
export default class GameLoop {
  // Wires up the clock and stores the renderer/update callback; nothing
  // runs until start() is called.
  // `frameObserver` (opzionale) riceve ogni delta, comprese le pause e i
  // menu in cui updateCallback esce subito: serve a QualityManager, che
  // deve misurare gli fps sempre, non solo mentre si gioca.
  constructor(rendererManager, updateCallback, frameObserver = null) {
    this.clock = new THREE.Clock();
    this.rendererManager = rendererManager;
    this.updateCallback = updateCallback;
    this.frameObserver = frameObserver;
    this.isRunning = false;
  }

  // Starts the loop: each frame computes a clamped delta, runs the game's
  // update callback, then renders via RendererManager.render() (not the
  // raw renderer — that's where the skybox gets re-centered on the camera
  // every frame; calling the renderer directly would skip that and leave
  // the sky sphere pinned to the origin).
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();

    // three.js animation loop
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
