import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 1. Scena, Telecamera e Renderer
const canvas = document.querySelector('#webgl-canvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  1,
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

// 3. Gestione Stati e Interfaccia
let gameState = 'MENU_WELCOME'; // 'MENU_WELCOME', 'MENU_NAME', 'PLAYING'
let selectedCharacter = 'mario'; // 'mario' oppure 'luigi'
let menuCameraAngle = 0;

const welcomeScreen = document.getElementById('welcome-screen');
const nameScreen = document.getElementById('name-screen');
const hud = document.getElementById('hud');

const startBtn = document.getElementById('start-btn');
const continueBtn = document.getElementById('continue-btn');
const heroNameInput = document.getElementById('hero-name-input');
const hudHeroName = document.getElementById('hud-hero-name');

const btnMario = document.getElementById('btn-mario');
const btnLuigi = document.getElementById('btn-luigi');

// Seleziona Mario
btnMario.addEventListener('click', () => {
  selectedCharacter = 'mario';
  btnMario.className = 'char-card selected-mario';
  btnLuigi.className = 'char-card';
});

// Seleziona Luigi
btnLuigi.addEventListener('click', () => {
  selectedCharacter = 'luigi';
  btnLuigi.className = 'char-card selected-luigi';
  btnMario.className = 'char-card';
});

// Step 1 -> Step 2
startBtn.addEventListener('click', () => {
  gameState = 'MENU_NAME';
  welcomeScreen.style.display = 'none';
  nameScreen.style.display = 'flex';
  heroNameInput.focus();
});

// Step 2 -> Avvio Gioco
function startGame() {
  const enteredName = heroNameInput.value.trim().toUpperCase();
  const defaultName = selectedCharacter === 'mario' ? 'MARIO' : 'LUIGI';
  hudHeroName.textContent = enteredName !== '' ? enteredName : defaultName;

  if (models[selectedCharacter]) {
    player = models[selectedCharacter];
    player.position.set(-20, groundY, 250);
    
    // 🔄 ORIENTAMENTO NATIVO DI MARIO (Guarda in avanti verso l'interno mappa)
    player.rotation.y = -Math.PI / 2; 
    
    scene.add(player);
  }

  gameState = 'PLAYING';
  nameScreen.style.display = 'none';
  hud.style.display = 'flex';
}

continueBtn.addEventListener('click', startGame);

heroNameInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    startGame();
  }
});

// 4. Loader dei Modelli 3D
const loader = new GLTFLoader();

// Helper per configurare ombre, materiali opachi e spazio colore sRGB
function setupModelProperties(model) {
  model.traverse((child) => {
    if (child.isMesh) {
      // 1. OMBRE DI BASE
      child.castShadow = true;
      child.receiveShadow = true;

      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];

        materials.forEach((mat) => {
          const matName = mat.name.toLowerCase();

          // 2. GESTIONE OCCHI (Sia bulbo 'eye_m' che pupilla 'eye_m_0')
          if (matName.includes('eye')) {
            mat.visible = true;
            mat.transparent = true;  // Essenziale affinché la pupilla non copra il bianco attorno a sé
            mat.depthWrite = false;  // Evita che il bianco e la pupilla si compenetrino (bug grafico)
            mat.alphaTest = 0.1;     // Ritaglia i bordi trasparenti della texture
            
            // LA MAGIA È QUI: Disattiviamo le ombre per gli occhi!
            // Era l'ombra della pupilla proiettata sull'occhio a farlo sembrare "chiuso".
            child.castShadow = false; 
          } 
          // 3. RESTO DEL CORPO (Pelle, scarpe, guscio solidi)
          else {
            mat.visible = true;
            mat.transparent = false;
            mat.depthWrite = true;
            mat.alphaTest = 0.5;
          }

          // Colori vividi
          if (mat.map) {
            mat.map.colorSpace = THREE.SRGBColorSpace;
          }

          mat.needsUpdate = true;
        });
      }
    }
  });
}
// --- CARICAMENTO MAPPA ---
const mapPath = 'assets/models/Others/map.glb';

loader.load(
  mapPath,
  (gltf) => {
    const map = gltf.scene;
    const newScale = 0.2;
    map.scale.set(newScale, newScale, newScale);
    map.position.set(0, 0, 0);

    map.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        if (child.material) {
          child.material.depthWrite = true;
          if (child.material.transparent || child.material.alphaTest > 0) {
            child.material.alphaTest = 0.2;
          }
        }
      }
    });

    scene.add(map);
  },
  undefined,
  (error) => console.error('Errore caricamento mappa:', error)
);

// --- CARICAMENTO YOSHI ---
let yoshiModel = null;
loader.load(
  'assets/models/Super_Mario/Mounts/yoshi_ride.glb',
  (gltf) => {
    yoshiModel = gltf.scene;
    setupModelProperties(yoshiModel);

    // Posizionamento Yoshi nella mappa vicino allo spawn del personaggio
    yoshiModel.position.set(-20, groundY, 245);
    yoshiModel.rotation.y = 0; // Orientato verso il giocatore

    scene.add(yoshiModel);
    console.log('Yoshi caricato nella mappa!');
  },
  undefined,
  (error) => console.error('Errore caricamento Yoshi:', error)
);

// Funzione per calcolare l'altezza esatta di un modello 3D
function getModelHeight(model) {
  const box = new THREE.Box3().setFromObject(model);
  return box.max.y - box.min.y;
}

// Funzione per pareggiare la scala di Luigi a quella di Mario
function equalizeLuigiScale() {
  if (!models.mario || !models.luigi) return;

  const marioHeight = getModelHeight(models.mario);
  const luigiHeight = getModelHeight(models.luigi);

  const scaleFactor = marioHeight / luigiHeight;
  models.luigi.scale.set(scaleFactor, scaleFactor, scaleFactor);
  console.log(`Luigi scalato con successo! Fattore calcolato: ${scaleFactor.toFixed(4)}`);
}

// --- CARICAMENTO PERSONAGGI (MARIO E LUIGI) ---
const models = { mario: null, luigi: null };
let player = null;

const moveSpeed = 0.6;
let velocityY = 0;
const gravity = -0.015;
const jumpStrength = 0.5;
let isJumping = false;

const groundY = 50;

// Carica Mario (Inalterato, orientamento nativo)
loader.load(
  'assets/models/Super_Mario/Main_Characters/mario.glb',
  (gltf) => {
    models.mario = gltf.scene;
    console.log('Mario caricato!');
    equalizeLuigiScale();
  },
  undefined,
  (error) => console.error('Errore caricamento Mario:', error)
);

// Carica Luigi (Inserito in un gruppo ruotato di -90° per pareggiarlo a Mario)
loader.load(
  'assets/models/Super_Mario/Main_Characters/luigi.glb',
  (gltf) => {
    const luigiGroup = new THREE.Group();
    gltf.scene.rotation.y = -Math.PI / 2; // Allinea la direzione nativa di Luigi a quella di Mario
    luigiGroup.add(gltf.scene);

    models.luigi = luigiGroup;
    console.log('Luigi caricato e allineato a Mario!');
    equalizeLuigiScale();
  },
  undefined,
  (error) => console.error('Errore caricamento Luigi:', error)
);

// 5. Input Tastiera per il Gioco
const keys = {};

window.addEventListener('keydown', (e) => {
  if (gameState !== 'PLAYING') return;

  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (!isJumping && player) {
      velocityY = jumpStrength;
      isJumping = true;
    }
  }

  keys[e.key.toLowerCase()] = true;
});

window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

// 6. Aggiornamento Scena e Telecamera
function updateGame() {

  // --- TELECAMERA DURANTE I MENÙ ---
  if (gameState === 'MENU_WELCOME' || gameState === 'MENU_NAME') {
    menuCameraAngle += 0.005;
    const radius = 25;
    camera.position.x = -20 + Math.sin(menuCameraAngle) * radius;
    camera.position.z = 250 + Math.cos(menuCameraAngle) * radius;
    camera.position.y = groundY + 10;
    camera.lookAt(-20, groundY + 2, 250);
    return;
  }

  if (!player) return;

  // --- LOGICA DURANTE IL GIOCO ---
  let moved = false;
  let targetRotation = player.rotation.y;

  // --- MOVIMENTO ORIZZONTALE NATIVO ---
  if (keys['w'] || keys['arrowup']) {
    player.position.z -= moveSpeed;
    targetRotation = -Math.PI / 2;   // ⬆️ AVANTI
    moved = true;
  }
  if (keys['s'] || keys['arrowdown']) {
    player.position.z += moveSpeed;
    targetRotation = Math.PI / 2;    // ⬇️ INDIETRO
    moved = true;
  }
  if (keys['a'] || keys['arrowleft']) {
    player.position.x -= moveSpeed;
    targetRotation = 0;              // ⬅️ SINISTRA
    moved = true;
  }
  if (keys['d'] || keys['arrowright']) {
    player.position.x += moveSpeed;
    targetRotation = Math.PI;        // ➡️ DESTRA
    moved = true;
  }

  if (moved) {
    player.rotation.y = targetRotation;
  }

  // Fisica Salto
  if (isJumping || player.position.y > groundY) {
    player.position.y += velocityY;
    velocityY += gravity;

    if (player.position.y <= groundY) {
      player.position.y = groundY;
      velocityY = 0;
      isJumping = false;
    }
  }

  // Telecamera Inseguimento
  camera.position.x = player.position.x;
  camera.position.y = player.position.y + 4;
  camera.position.z = player.position.z + 8;
  camera.lookAt(player.position.x, player.position.y + 1, player.position.z);
}

// 7. Resize Finestra
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 8. Game Loop
function animate() {
  requestAnimationFrame(animate);
  updateGame();
  renderer.render(scene, camera);
}

animate();