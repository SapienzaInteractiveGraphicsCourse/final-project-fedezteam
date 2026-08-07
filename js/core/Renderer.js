import * as THREE from "three";

export default class RendererManager {
  constructor(canvasId = "#webgl-canvas") {
    this.canvas = document.querySelector(canvasId);

    // Assicuriamoci che il canvas copra tutto lo schermo senza margini
    if (this.canvas) {
      this.canvas.style.position = "fixed";
      this.canvas.style.top = "0";
      this.canvas.style.left = "0";
      this.canvas.style.width = "100vw";
      this.canvas.style.height = "100vh";
      this.canvas.style.zIndex = "0";
    }

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Cielo Azzurro

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Impostazioni Grafiche Avanzate
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Ombre più morbide
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Proprietà per la luce accessibile dall'esterno
    this.dirLight = null;

    // 4. Luci
    this.setupLights();

    // 5. Resize Listener
    this.setupResize();
  }

setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    
    // Posiziona la luce in alto a lato, ma falla puntare SEMPRE al centro (0,0,0)
    this.dirLight.position.set(40, 60, 40);
    this.dirLight.target.position.set(0, 0, 0); 
    this.dirLight.castShadow = true;

    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);


    const d = 100; 
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;

    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 180; // Aumentato per coprire la diagonale della mappa

    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;

    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.05; // Ridotto per evitare artefatti
  }

  setupResize() {
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    });
  }

  // Metodo chiamato da GameLoop ad ogni frame
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}