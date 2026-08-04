import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 1. Scena, Telecamera e Renderer
const canvas = document.querySelector('#webgl-canvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  1,    // Aumentato da 0.1 a 1 per risolvere il flickering dei livelli
  1000
);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

// 2. Illuminazione
const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
scene.add(dirLight);

// 3. Loader dei Modelli 3D
const loader = new GLTFLoader();

// --- CARICAMENTO MAPPA ---
const mapPath = 'assets/models/Others/map.glb'; 

loader.load(
  mapPath,
  (gltf) => {
    const map = gltf.scene;

    // Scala la mappa (aggiusta il valore se serve)
    const newScale = 0.2; 
    map.scale.set(newScale, newScale, newScale);    map.position.set(0, 0, 0);

    // CORREZIONE MATERIALI E TRASPARENZE
    map.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        if (child.material) {
          // Mantiene la corretta trasparenza per acqua, erba e dettagli
          child.material.depthWrite = true;
          
          // Se il materiale ha una mappa alpha o trasparenze
          if (child.material.transparent || child.material.alphaTest > 0) {
            child.material.alphaTest = 0.2; // Rimuove lo sfondo trasparente senza creare blocchi solidi
          }
        }
      }
    });

    scene.add(map);
    console.log('Mappa corretta!');
  },
  undefined,
  (error) => console.error('Errore nel caricamento della mappa:', error)
);

// --- CARICAMENTO MARIO ---
let mario = null;
const moveSpeed = 0.6;
const marioPath = 'assets/models/Super_Mario/Main_Characters/mario.glb';

loader.load(
  marioPath,
  (gltf) => {
    mario = gltf.scene;
    
    mario.position.set(-20, 50, 250); 

    mario.rotation.y = -Math.PI / 2;
    
    scene.add(mario);
    console.log('Mario caricato!');
  },
  undefined,
  (error) => console.error('Errore nel caricamento di Mario:', error)
);

// 4. Gestione Input Tastiera
const keys = {};

window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
});

window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

// 5. Movimento e Telecamera
function updatePlayer() {
  if (!mario) return;

  let moved = false;
  let targetRotation = mario.rotation.y;

  if (keys['w'] || keys['arrowup']) {
    mario.position.z -= moveSpeed;
    targetRotation = -Math.PI / 2;
    moved = true;
  }
  if (keys['s'] || keys['arrowdown']) {
    mario.position.z += moveSpeed;
    targetRotation = Math.PI / 2;
    moved = true;
  }
  if (keys['a'] || keys['arrowleft']) {
    mario.position.x -= moveSpeed;
    targetRotation = 0;
    moved = true;
  }
  if (keys['d'] || keys['arrowright']) {
    mario.position.x += moveSpeed;
    targetRotation = Math.PI;
    moved = true;
  }

  if (moved) {
    mario.rotation.y = targetRotation;
  }

  // Telecamera inseguimento
  camera.position.x = mario.position.x;
  camera.position.y = mario.position.y + 3;
  camera.position.z = mario.position.z + 6;
  camera.lookAt(mario.position.x, mario.position.y + 1, mario.position.z);
}

// 6. Resize Finestra
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 7. Game Loop
function animate() {
  requestAnimationFrame(animate);
  updatePlayer();
  renderer.render(scene, camera);
}

animate();