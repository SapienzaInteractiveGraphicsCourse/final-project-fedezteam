import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { TEXTURES } from "../Assets/manifest.js";

export default class RendererManager {
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
    // Was 1.5, then 1.0 — still reading too bright, so now below the
    // neutral three.js default. toneMappingExposure scales the ENTIRE
    // rendered result, including the environment map below (every
    // material in the scene receives IBL light from it), so this is the
    // main global brightness lever.
    this.renderer.toneMappingExposure = 0.85;

    // Environment map (IBL) for PBR materials. Without this, any material
    // with real metalness has nothing to reflect and renders almost black
    // — only a tiny specular speck is visible instead of a shiny surface.
    // This is exactly what was happening to the coin/star models: their
    // glTF materials never set metallicFactor explicitly, and the glTF
    // spec's default for that is 1.0 (fully metallic), so they came out
    // fully metallic with zero environment to reflect. A model viewer
    // always provides some kind of studio lighting/environment by default,
    // which is why they looked fine there. RoomEnvironment is three.js'
    // built-in generic "soft studio" environment made for exactly this
    // case — no external HDRI file needed — and it improves every
    // metallic/glossy material in the scene uniformly, not just the item
    // models (see also the metalness/roughness clamp in
    // utils/materials.js, a second, more direct safety net for this same
    // issue).
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
    // The light follows the player (see EntityManager.update), so the shadow
    // map only needs to cover the area AROUND the player, not the entire
    // island: SHADOW_AREA is the half-width of the orthographic shadow box,
    // in world units.
    //
    // Sharpness = (2 * SHADOW_AREA) / SHADOW_RES world units per texel.
    // With 30 and 2048 -> ~0.029 units/texel. Want sharper shadows? Lower
    // SHADOW_AREA. Want shadows to reach further? Raise it (and accept
    // softer edges).
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
    // directional lights automatically (LightShadow.updateMatrices only
    // updates position/lookAt). Without this call, left/right/top/bottom/
    // near/far are silently ignored and the shadow camera stays at its
    // constructor default, a box of only +/-5.
    shadowCam.updateProjectionMatrix();

    this.dirLight.shadow.mapSize.width = SHADOW_RES;
    this.dirLight.shadow.mapSize.height = SHADOW_RES;
  }

  /**
   * Adds soft distance fog so the island's edges fade into the sky instead
   * of cutting off sharply, and the far background gains a sense of depth.
   * Near/far are kept well outside normal gameplay range (the island itself
   * is only ~60 units wide) so it never fogs anything the player is
   * actually standing on or near.
   */
  setupFog() {
    const fogColor = 0xcfe8ff;
    this.scene.fog = new THREE.Fog(fogColor, 120, 550);
  }

  // Update the camera aspect ratio and renderer size whenever the window is resized.
  setupResize() {
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    });
  }

  render() {
    // The sky is always re-centered on the camera to give the illusion of an infinite sky.
    if (this.skyBox) {
      this.skyBox.position.copy(this.camera.position);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
