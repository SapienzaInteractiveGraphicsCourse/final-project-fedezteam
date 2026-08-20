import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { TEXTURES } from "../Assets/manifest.js";

/**
 * Renderer.js — owns the three.js Scene, PerspectiveCamera and WebGLRenderer,
 * plus the one-time environment setup wrapped around them: skybox, lights,
 * shadow camera tuning, distance fog, and window-resize handling.
 *
 * All numeric "tuning" comments below (exposure, light intensities, shadow
 * area) record earlier values tried during manual brightness calibration —
 * kept as a note for whoever adjusts them next, not because a different
 * approach was rejected.
 */
export default class RendererManager {
  // Builds the canvas/scene/camera/renderer trio, sets up PBR environment
  // lighting (see the environment map note below), and calls the four
  // setup*() methods that populate the scene (skybox, lights, fog, resize).
  constructor(canvasId = "#webgl-canvas") {
    this.canvas = document.querySelector(canvasId);

    // Canvas styling for full-screen rendering.
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

    // Set rendering properties for better visual quality.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.LinearToneMapping; // Preserves the original texture saturation.
    // Was 1.5, then 1.0 — still too bright; now below the neutral default.
    // Scales the WHOLE rendered result (including the environment map
    // below), so this is the main global brightness lever.
    this.renderer.toneMappingExposure = 0.85;

    // PBR materials with real metalness need something to reflect, or they
    // render almost black (this broke the coin/star models, whose glTF
    // materials default metallicFactor to 1.0 with no env map set).
    // RoomEnvironment is three.js' built-in "soft studio" fallback — see
    // also the metalness/roughness clamp in utils/materials.js, a second
    // safety net for the same issue.
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Directional light used for shadows and general illumination.
    this.dirLight = null;

    // 4. Set up the scene: skybox, lights, fog, and window resize handling.
    this.setupSkybox();
    this.setupLights();
    this.setupFog();
    this.setupResize();
  }

  // Loads the sky texture and wraps it in a custom shader (darkens the sky,
  // boosts cloud contrast) applied to a huge inward-facing sphere that
  // always renders first, so it never z-fights with real geometry.
  setupSkybox() {
    const textureLoader = new THREE.TextureLoader();
    const skyTexture = textureLoader.load(TEXTURES.skyBox);

    skyTexture.colorSpace = THREE.SRGBColorSpace;
    skyTexture.magFilter = THREE.LinearFilter;
    skyTexture.minFilter = THREE.LinearFilter;

    // Custom shader for the skybox to enhance cloud contrast and darken the sky.
    const customSkyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        skyTexture: { value: skyTexture },
        skyDarkness: { value: 1 },     // Increase to darken the sky (e.g. 1.2 or 1.5).
        cloudContrast: { value: 1.6 }, // Increase to make clouds more defined (e.g. 1.5 or 2.0).
      },
      vertexShader: `
        varying vec2 textureCoord;
        void main() {
         textureCoord = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      // Fragment shader for the skybox with enhanced cloud contrast and a darker sky.
      fragmentShader: `
        uniform sampler2D skyTexture;
        uniform float skyDarkness;
        uniform float cloudContrast;
        varying vec2 textureCoord;

        void main() {
          vec4 texColor = texture2D(skyTexture, textureCoord);

          // Extract luminance from the texture color to adjust cloud
          // brightness and sky darkness independently.
          float luminance = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));

          // Increase contrast for clouds while keeping the base sky color darker.
          vec3 brightClouds = pow(texColor.rgb, vec3(1.0 / cloudContrast));

          // Darken the sky while keeping the clouds bright.
          vec3 finalColor = mix(texColor.rgb * skyDarkness, brightClouds, luminance * 0.5);

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      // Skybox depth should never interfere with other scene objects, so
      // depth writing is disabled.
      depthWrite: false,
      // The skybox is a sphere with the camera inside it, so we render its
      // inner (back) faces.
      side: THREE.BackSide,
    });

    // Large sphere geometry used as the skybox.
    const geometry = new THREE.SphereGeometry(1000, 64, 32);

    this.skyBox = new THREE.Mesh(geometry, customSkyMaterial);
    // Render the skybox first, before every other object in the scene, to
    // avoid z-fighting and other rendering artifacts.
    this.skyBox.renderOrder = -1;

    this.scene.add(this.skyBox);
  }

  // Sets up the ambient + shadow-casting directional light, and tunes the
  // directional light's orthographic shadow camera to stay tight around
  // the player instead of covering the whole island (see SHADOW_AREA below).
  setupLights() {
    // Slightly warm tint instead of pure white, so the whole scene reads
    // less flat/clinical without changing the exposure or shadow behavior.
    // Was 0.9, then 0.65 — still too bright, lowered further.
    const ambientLight = new THREE.AmbientLight(0xfff1de, 0.4);
    this.scene.add(ambientLight);

    // Was 1.3 — this is the shadow-casting light, so it's kept higher than
    // the ambient light to preserve shadow contrast/definition (lowering
    // this doesn't reduce shadow MAP quality/resolution, just how strongly
    // lit the sunlit side of things is).
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.0);

    this.dirLight.position.set(40, 60, 40);
    this.dirLight.target.position.set(0, 0, 0);
    this.dirLight.castShadow = true;

    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // --- SHADOWS ---
    // The light follows the player (see EntityManager.update), so the
    // shadow map only needs to cover the area around the player, not the
    // whole island. SHADOW_AREA is the ortho box half-width; SHADOW_RES the
    // map resolution — sharpness is roughly (2*SHADOW_AREA)/SHADOW_RES units/texel.
    const SHADOW_AREA = 30;
    const SHADOW_RES = 2048;

    const shadowCam = this.dirLight.shadow.camera;
    shadowCam.left = -SHADOW_AREA;
    shadowCam.right = SHADOW_AREA;
    shadowCam.top = SHADOW_AREA;
    shadowCam.bottom = -SHADOW_AREA;

    // The light sits ~66 units above the player: this range covers
    // everything that can cast a shadow, and keeping it tight improves
    // depth precision.
    shadowCam.near = 1;
    shadowCam.far = 200;

    // IMPORTANT: three.js does NOT call updateProjectionMatrix() for
    // directional lights automatically — without this, left/right/top/
    // bottom/near/far above are silently ignored and the shadow camera
    // stays at its default +/-5 box.
    shadowCam.updateProjectionMatrix();

    this.dirLight.shadow.mapSize.width = SHADOW_RES;
    this.dirLight.shadow.mapSize.height = SHADOW_RES;
  }

  /**
   * Soft distance fog so the island's edges fade into the sky instead of
   * cutting off sharply. Range is kept well outside normal gameplay (the
   * island is only ~60 units wide) so it never fogs anything nearby.
   */
  setupFog() {
    const fogColor = 0xcfe8ff;
    this.scene.fog = new THREE.Fog(fogColor, 120, 550);
  }

  // Keeps the camera aspect ratio and renderer size/pixel-ratio in sync
  // with the browser window on every resize.
  setupResize() {
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    });
  }

  // Renders one frame. The skybox is re-centered on the camera first so it
  // always reads as an infinite backdrop rather than a fixed-size sphere.
  render() {
    // The sky is always re-centered on the camera to give the illusion of an infinite sky.
    if (this.skyBox) {
      this.skyBox.position.copy(this.camera.position);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
