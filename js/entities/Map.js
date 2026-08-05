export default class Map {
  constructor(mesh, scale = 0.2) {
    this.mesh = mesh;
    this.scale = scale;
    this._setupMap();
  }

  _setupMap() {
    if (!this.mesh) return;

    // Applica la scala e la posizione iniziale
    this.mesh.scale.set(this.scale, this.scale, this.scale);
    this.mesh.position.set(0, 0, 0);

    // Regola le proprietà dei materiali opachi/trasparenti della mappa
    this.mesh.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.depthWrite = true;
        if (child.material.transparent || child.material.alphaTest > 0) {
          child.material.alphaTest = 0.2;
        }
      }
    });
  }

  /**
   * Aggiunge la mappa alla scena di Three.js
   */
  addToScene(scene) {
    if (this.mesh) {
      scene.add(this.mesh);
    }
  }
}