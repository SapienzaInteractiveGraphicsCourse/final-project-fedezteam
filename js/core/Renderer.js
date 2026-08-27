import * as THREE from "three";

export default class RendererManager {
  constructor(canvasId = "#webgl-canvas") {
    this.canvas = document.querySelector(canvasId);
    

    // Canvas styling for full-screen rendering
    if (this.canvas) {
      this.canvas.style.position = "fixed";
      this.canvas.style.top = "0";
      this.canvas.style.left = "0";
      this.canvas.style.width = "100vw";
      this.canvas.style.height = "100vh";
      this.canvas.style.zIndex = "0";
    }

    // 1. MAIN SCENE
    this.scene = new THREE.Scene();

    // 2. CAMERA
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      2000,
    );

    // 3. RENDERER
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Set rendering properties for better visual quality
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.LinearToneMapping; // Mantiene la saturazione originale delle texture
    this.renderer.toneMappingExposure = 1.5; // Aumenta la brillantezza generale

    // Directional light for shadows and illumination
    this.dirLight = null;

    // 4. Setup the scene with skybox, lights, and resize handling
    this.setupSkybox();
    this.setupLights();
    this.setupResize();
  }

setupSkybox() {
    const textureLoader = new THREE.TextureLoader();
    const skyTexture = textureLoader.load("assets/textures/sky/skyBox.png");

    skyTexture.colorSpace = THREE.SRGBColorSpace;
    skyTexture.magFilter = THREE.LinearFilter;
    skyTexture.minFilter = THREE.LinearFilter;

    // Custom Shader for the skybox to enhance cloud contrast and darken the sky
    const customSkyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        skyTexture: { value: skyTexture },
        skyDarkness: { value: 1 },  // Increase to darken the sky (e.g., 1.2 or 1.5)
        cloudContrast: { value: 1.6 }, // Increase to make clouds more defined (e.g., 1.5 or 2.0)
      },
      vertexShader: `
        varying vec2 textureCoord;
        void main() {
         textureCoord = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `, 
      // Fragment Shader for the skybox with enhanced cloud contrast and darker sky
      fragmentShader: `
        uniform sampler2D skyTexture;
        uniform float skyDarkness;
        uniform float cloudContrast;
        varying vec2 textureCoord;

        void main() {
          vec4 texColor = texture2D(skyTexture, textureCoord);
          
          // Separate luminance from the texture color to adjust cloud brightness and sky darkness independently
          float luminance = dot(texColor.rgb, vec3(0.299, 0.587, 0.114)); // dot product to get luminance
          
          // Increase contrast for clouds while keeping the base sky color darker
          vec3 brightClouds = pow(texColor.rgb, vec3(1.0 / cloudContrast)); // txclr^(1/cloudContrast) to enhance contrast
          
          // Darken the sky while keeping clouds bright
          vec3 finalColor = mix(texColor.rgb * skyDarkness, brightClouds, luminance * 0.5);
          
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      // I dont want the skybox depth to interfere with other objects in the scene, so I disable depth writing
      depthWrite: false,
      // Since the skybox is a sphere and the camera is inside it, we need to render the inside of the sphere
      side: THREE.BackSide,
    });
    
    // Create a large sphere geometry for the skybox
    const geometry = new THREE.SphereGeometry(1000, 64, 32);

    this.skyBox = new THREE.Mesh(geometry, customSkyMaterial);
    // Prioritize the skybox rendering to ensure it is always rendered first before other objects in the scene, preventing any potential z-fighting or rendering issues
    this.skyBox.renderOrder = -1;

    this.scene.add(this.skyBox);
  }

setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9); 
    this.scene.add(ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.3);

    this.dirLight.position.set(40, 60, 40);
    this.dirLight.target.position.set(0, 0, 0);
    this.dirLight.castShadow = true;

    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);


    // --- OMBRE --- La shadow map copre solo l'area attorno al giocatore,
    // non tutta l'isola: SHADOW_AREA/SHADOW_RES = nitidezza in unità/texel.
    const SHADOW_AREA = 30;
    const SHADOW_RES = 2048;

    const shadowCam = this.dirLight.shadow.camera;
    shadowCam.left = -SHADOW_AREA;
    shadowCam.right = SHADOW_AREA;
    shadowCam.top = SHADOW_AREA;
    shadowCam.bottom = -SHADOW_AREA;

    // La luce sta ~66 unità sopra il player: questo range copre tutto ciò che
    // può proiettare ombra, e tenerlo stretto migliora la precisione in profondità.
    shadowCam.near = 1;
    shadowCam.far = 200;

    // ⚠️ INDISPENSABILE: three.js non aggiorna da solo la projection matrix
    // delle luci direzionali; senza questa riga i limiti sopra sono ignorati.
    shadowCam.updateProjectionMatrix();

    this.dirLight.shadow.mapSize.width = SHADOW_RES;
    this.dirLight.shadow.mapSize.height = SHADOW_RES;
  }

  // Resize when the window is resized, we need to update the camera aspect ratio and the renderer size
  setupResize() {
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    });
  }

  render() {
    // The sky is always centered on the camera to give the illusion of an infinite sky
    if (this.skyBox) {
      this.skyBox.position.copy(this.camera.position);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
