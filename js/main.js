import RendererManager from "./core/Render/Renderer.js";
import CameraManager from "./core/Render/CameraManager.js";
import AssetLoader from "./core/Assets/AssetLoader.js";
import { initGameModels, initEnemyModels } from "./core/Assets/assetConfig.js";
import GameLoop from "./core/GameLoop.js";
import InputManager from "./core/InputManager.js";
import UIManager from "./ui/UIManager.js";
import PhysicsEngine from "./physics/PhysicsEngine.js";
import AudioManager from "./core/Audio/AudioManager.js";
import { initGameAudio } from "./core/Audio/soundConfig.js";
import { getStoredMuteState } from "./utils/storage.js";
import Yoshi from "./entities/Yoshi.js";
import Goomba from "./entities/enemies/Goomba.js";
import Kamek from "./entities/enemies/Kamek.js";
import ObstacleZone from "./entities/Level/ObstacleZone.js";
import GameLevel from "./entities/GameLevel.js";
import EntityManager from "./entities/EntityManager.js";
import * as THREE from "three";
import CannonDebugger from "https://cdn.jsdelivr.net/npm/cannon-es-debugger@1.0.0/+esm";
import Stats from "three/addons/libs/stats.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import BoneMap from "./entities/animation/BoneMap.js";
import AnimationController from "./entities/animation/AnimationController.js";
import { POSE, characterBasis } from "./entities/animation/clipFactory.js";
// 1. CORE MODULES

const renderer = new RendererManager("#webgl-canvas");
const cameraManager = new CameraManager(renderer.camera);
const assetLoader = new AssetLoader();
const input = new InputManager();

const physics = new PhysicsEngine({
  gravity: -35,
  fallThreshold: -50,
});



// Wireframe dei collider fisici. SPENTO di default: si accende con F3 oppure
// da console con toggleColliders(). Utile quando si tarano le hitbox delle case,
// ma è costoso (ricostruisce le mesh di ogni shape a ogni frame) e va tenuto
// fuori dal gioco vero.
const debugMeshes = [];
let showColliders = false;

const cannonDebugger = new CannonDebugger(renderer.scene, physics.world, {
  // cannon-es-debugger non gestisce `visible`: ci teniamo i riferimenti alle
  // mesh che crea, così possiamo nasconderle quando si spegne il toggle.
  onInit: (body, mesh) => debugMeshes.push(mesh),
});

function toggleColliders(force) {
  showColliders = force === undefined ? !showColliders : !!force;

  if (showColliders) {
    // Aggiorna subito, altrimenti i wireframe compaiono solo al frame dopo.
    cannonDebugger.update();
  }
  for (const mesh of debugMeshes) mesh.visible = showColliders;

  console.log(`[debug] collider ${showColliders ? "ON" : "OFF"}`);
  return showColliders;
}

// Esposto in console per comodità durante il tuning delle hitbox.
window.toggleColliders = toggleColliders;

window.addEventListener("keydown", (e) => {
  if (e.code === "F3") {
    e.preventDefault(); // in alcuni browser F3 apre "trova successivo"
    toggleColliders();
  }
});

// --- BANCO DI PROVA DELLE ANIMAZIONI -------------------------------------
// Carica un modello qualsiasi accanto al giocatore, ne analizza lo scheletro e
// gli fa suonare una delle nostre clip. Serve a verificare un rig PRIMA di
// collegarlo al personaggio vero. Da console:
//
//    testRig("assets/models/Super_Mario/Enemies/bowser_jr.glb")
//    testRig("assets/models/Super_Mario/Main_Characters/mario_ok_fixed.glb", "run")
//
// Poi si tara a occhio senza ricaricare la pagina:
//    POSE.armRest = 60; rebuildRigs()
const testRigs = [];

window.POSE = POSE;

window.testRig = async function (path, state = "walk", scaleTo = 2.2) {
  try {
    const gltf = await new GLTFLoader().loadAsync(path);
    const model = gltf.scene;

    const boneMap = new BoneMap(model);
    const usable = boneMap.describe(path.split("/").pop());
    if (!usable) return null;

    // Normalizza l'altezza: i modelli hanno scale native molto diverse fra loro.
    // Le matrici mondo vanno aggiornate PRIMA di misurare: su un modello con
    // scheletro Box3 chiede a SkinnedMesh.computeBoundingBox(), che legge le
    // matrici delle ossa. Appena uscito dal loader quelle matrici non sono
    // ancora calcolate e la misura viene fuori sbagliata (per mario_ok_fixed
    // 0.65 invece di 1.64, cioè un modello di prova alto il triplo del dovuto).
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const height = box.max.y - box.min.y || 1;
    const s = scaleTo / height;
    model.scale.setScalar(s);

    // Posizionamento RELATIVO ALLA TELECAMERA, non in coordinate mondo: un
    // offset fisso su X finiva dentro la casa di Mario a seconda di dove ti
    // trovavi. Così il modello compare sempre di fianco a te nell'inquadratura.
    const p = entityManager.player
      ? entityManager.player.position
      : new THREE.Vector3(0, 0, 0);

    const camRight = new THREE.Vector3().setFromMatrixColumn(
      renderer.camera.matrixWorld,
      0,
    );
    camRight.y = 0;
    if (camRight.lengthSq() < 1e-6) camRight.set(1, 0, 0);
    camRight.normalize();

    model.position.set(
      p.x + camRight.x * 3.5,
      p.y,
      p.z + camRight.z * 3.5,
    );

    model.traverse((c) => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });
    renderer.scene.add(model);

    const controller = new AnimationController(model);
    controller.play(state, 0);

    // --- DIAGNOSTICA VISIVA ---
    // Scheletro: mostra dove sono davvero le ossa e come si muovono.
    const skeleton = new THREE.SkeletonHelper(model);
    skeleton.visible = false;
    renderer.scene.add(skeleton);

    // Terna del personaggio, disegnata all'altezza del bacino:
    //   ROSSO = avanti   VERDE = su   BLU = sinistra
    const axes = new THREE.Group();
    axes.visible = false;
    try {
      const basis = characterBasis(controller.boneMap);
      const origin = boneMap0(controller).getWorldPosition(new THREE.Vector3());
      const L = 1.4;
      const arrow = (dir, color) =>
        new THREE.ArrowHelper(dir.clone().normalize(), origin, L, color, 0.3, 0.18);
      axes.add(arrow(basis.forward, 0xff2222)); // avanti
      axes.add(arrow(basis.up, 0x22ff22));      // su
      axes.add(arrow(basis.left, 0x2222ff));    // sinistra
      console.log(
        "[testRig] terna — avanti(rosso)=%o  su(verde)=%o  sinistra(blu)=%o",
        basis.forward.toArray().map((v) => +v.toFixed(3)),
        basis.up.toArray().map((v) => +v.toFixed(3)),
        basis.left.toArray().map((v) => +v.toFixed(3)),
      );
    } catch (e) {
      console.warn("[testRig] impossibile disegnare la terna:", e);
    }
    renderer.scene.add(axes);

    const handle = { model, controller, state, path, skeleton, axes };
    testRigs.push(handle);

    console.log(`[testRig] "${path}" caricato, stato "${state}". ` +
      `Cambia con testRigs[0].controller.play("run").`);
    return handle;
  } catch (e) {
    console.error(`[testRig] impossibile caricare ${path}:`, e);
    return null;
  }
};

window.testRigs = testRigs;

function boneMap0(controller) {
  return controller.boneMap.get("hips");
}

// Ispeziona le TRACCE della clip corrente: per ognuna dice se il nodo bersaglio
// esiste davvero nel modello e di quanti gradi il primo fotogramma si discosta
// dalla posa di riposo. Una traccia che sposta di ~0° non fa nulla.
window.clipReport = function (stateName) {
  const r = testRigs[0];
  if (!r) return console.warn("[clipReport] nessun rig caricato.");

  const name = stateName || r.controller.current || "walk";
  const action = r.controller.actions[name];
  if (!action) return console.warn(`[clipReport] stato "${name}" inesistente.`);

  const clip = action.getClip();
  const bind = new Map();
  for (const st of r.controller._bindPose || []) bind.set(st.bone.name, st.quaternion);

  console.group(`[clipReport] clip "${clip.name}" — ${clip.tracks.length} tracce, durata ${clip.duration}s`);

  for (const tr of clip.tracks) {
    const nodeName = tr.name.split(".")[0];
    const prop = tr.name.split(".")[1];
    const node = THREE.PropertyBinding.findNode(r.model, nodeName);

    if (!node) {
      console.log(`  ❌ %c${tr.name}%c → NODO NON TROVATO`, "color:#e52521;font-weight:bold", "");
      continue;
    }
    if (prop !== "quaternion") {
      console.log(`  •  ${tr.name} (${tr.times.length} chiavi)`);
      continue;
    }

    const b = bind.get(nodeName);
    let maxDeg = 0;
    const q = new THREE.Quaternion();
    for (let k = 0; k < tr.times.length; k++) {
      q.fromArray(tr.values, k * 4);
      if (b) maxDeg = Math.max(maxDeg, THREE.MathUtils.radToDeg(q.angleTo(b)));
    }
    const dead = maxDeg < 1;
    console.log(
      `  ${dead ? "⚠️" : "✅"} %c${nodeName}%c sposta al massimo di %c${maxDeg.toFixed(1)}°%c ` +
        `(${tr.times.length} chiavi)${dead ? "  ← NON FA NULLA" : ""}`,
      "color:#2196f3", "", dead ? "color:#e52521;font-weight:bold" : "color:#43b047;font-weight:bold", "",
    );
  }
  console.groupEnd();
};

// Misura DOVE SONO davvero le braccia nel fotogramma corrente, invece di
// giudicarle a occhio. Stampa tutto in "unità braccio" così i numeri sono
// confrontabili con le misure fatte sul file del modello.
window.armReport = function () {
  const r = testRigs[0];
  if (!r) return console.warn("[armReport] nessun rig di prova caricato.");

  const bm = r.controller.boneMap;
  const basis = characterBasis(bm);
  const wp = (role) => bm.get(role).getWorldPosition(new THREE.Vector3());

  r.model.updateMatrixWorld(true);

  const hips = wp("hips");
  const comp = (p) => ({
    lat: p.clone().sub(hips).dot(basis.left),
    alt: p.clone().sub(hips).dot(basis.up),
    avz: p.clone().sub(hips).dot(basis.forward),
  });

  console.group(`[armReport] stato "${r.controller.current}"  armSpread=${POSE.armSpread}°`);

  for (const side of ["L", "R"]) {
    const sh = wp("upperArm" + side);
    const hand = wp("hand" + side);
    const armVec = hand.clone().sub(sh);
    const armLen = armVec.length();

    // angolo fra il braccio e la verticale verso il basso
    const down = basis.up.clone().negate();
    const fromDown = THREE.MathUtils.radToDeg(armVec.clone().normalize().angleTo(down));
    // quanto il braccio è aperto lateralmente (positivo = verso il suo esterno)
    const outward = armVec.clone().normalize().dot(basis.left) * (side === "L" ? 1 : -1);

    const c = comp(hand);
    console.log(
      `  ${side}: angolo dalla verticale = ${fromDown.toFixed(1)}°  ` +
        `apertura laterale = ${(outward * 100).toFixed(0)}%
` +
        `     mano → laterale ${(c.lat / armLen).toFixed(2)}  ` +
        `altezza ${(c.alt / armLen).toFixed(2)}  avanti ${(c.avz / armLen).toFixed(2)}  ` +
        `(in unità braccio, braccio=${armLen.toFixed(3)})`,
    );
  }

  // Larghezza reale del corpo, misurata dalla mesh esclusi braccia e testa.
  let halfWidth = 0;
  r.model.traverse((n) => {
    if (!n.isMesh || !n.geometry?.attributes?.position) return;
    const pos = n.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 7) {
      v.fromBufferAttribute(pos, i).applyMatrix4(n.matrixWorld);
      const rel = v.clone().sub(hips);
      const alt = rel.dot(basis.up);
      if (alt > -0.1 && alt < 0.45) {
        halfWidth = Math.max(halfWidth, Math.abs(rel.dot(basis.left)));
      }
    }
  });
  console.log(`  semi-larghezza corpo (braccia incluse) = ${halfWidth.toFixed(3)}`);
  console.groupEnd();
};

// Mostra/nasconde scheletro e assi del rig di prova.
window.showBones = function (on = true) {
  for (const r of testRigs) {
    if (r.skeleton) r.skeleton.visible = on;
    if (r.axes) r.axes.visible = on;
  }
  console.log(`[testRig] scheletro e assi ${on ? "VISIBILI" : "nascosti"}`);
};

// Sposta il rig di prova se è finito dentro a qualcosa.
//   moveRig(0, 0, -5)  → spostamento relativo
//   moveRig(-20, 2, 30, true) → posizione assoluta
window.moveRig = function (x = 0, y = 0, z = 0, absolute = false) {
  for (const r of testRigs) {
    if (absolute) r.model.position.set(x, y, z);
    else r.model.position.add(new THREE.Vector3(x, y, z));
    console.log("[testRig] posizione:", r.model.position.toArray().map((v) => +v.toFixed(2)));
  }
};

// Riporta il rig accanto al giocatore, di fianco rispetto alla telecamera.
window.rigToPlayer = function () {
  if (!entityManager.player) return;
  const p = entityManager.player.position;
  const camRight = new THREE.Vector3().setFromMatrixColumn(renderer.camera.matrixWorld, 0);
  camRight.y = 0;
  camRight.normalize();
  for (const r of testRigs) {
    r.model.position.set(p.x + camRight.x * 3.5, p.y, p.z + camRight.z * 3.5);
  }
};

// Rigenera le clip dopo aver modificato POSE, senza ricaricare la pagina.
// Che animazione sta suonando ADDOSSO AL GIOCATORE, e con quali numeri è
// stata scelta. Serve quando il personaggio "sembra fermo" ma in realtà è in
// un altro stato: stampa il moto da cui la macchina a stati decide.
window.animState = function () {
  const p = entityManager.player;
  if (!p || !p.animation) return console.log("[anim] nessun giocatore");

  const v = p.body ? p.body.velocity : { x: 0, y: 0, z: 0 };
  console.log("[anim]", {
    stato: p.animation.current,
    attivo: p.animation.enabled,
    velOrizzontale: +Math.hypot(v.x, v.z).toFixed(2),
    velVerticale: +v.y.toFixed(2),
    canJump: p.canJump,
  });
  return p.animation.current;
};

window.rebuildRigs = function () {
  for (const r of testRigs) {
    r.controller.rebuild();
    r.controller.play(r.state, 0);
  }

  // Anche il giocatore vero, così le pose si tarano guardando il personaggio
  // che si guida invece del modello di prova. Non serve rimettere lo stato a
  // mano: Player.update lo richiede a ogni frame, e dopo rebuild() il
  // controller non ha più uno stato corrente, quindi riparte da solo.
  const playerAnim = entityManager.player && entityManager.player.animation;
  if (playerAnim) playerAnim.rebuild();

  console.log(
    `[testRig] ${testRigs.length} rig + ${playerAnim ? 1 : 0} giocatore rigenerati con POSE`,
    { ...POSE },
  );
};

// Se l'indirizzo contiene ?rig, il banco di prova parte da solo appena il
// gioco è pronto. Serve solo durante lo sviluppo delle animazioni: senza il
// parametro il gioco si comporta esattamente come prima.
//   http://127.0.0.1:5500/?rig            → mario_ok_fixed, stato "walk"
//   http://127.0.0.1:5500/?rig=run        → stato "run"
//   http://127.0.0.1:5500/?rig=walk&model=assets/.../bowser_jr.glb
const rigParams = new URLSearchParams(window.location.search);
const autoRig = rigParams.has("rig")
  ? {
      state: rigParams.get("rig") || "walk",
      model:
        rigParams.get("model") ||
        "assets/models/Super_Mario/Main_Characters/mario_ok_fixed.glb",
    }
  : null;

// Elenco dei comandi di sviluppo, stampato all'avvio: se NON vedi questo
// banner in console, il browser sta servendo una versione vecchia di main.js.
console.log(
  "%c🎮 COMANDI DI SVILUPPO",
  "background:#e52521;color:#fff;font-weight:bold;padding:3px 8px;border-radius:3px",
);
console.log(
  "  testRig(percorso)      carica un modello e lo fa animare accanto a te\n" +
    '  testRig("assets/models/Super_Mario/Main_Characters/mario_ok_fixed.glb")\n' +
    "  testRigs[0].controller.play(\"run\")   cambia stato: idle|walk|run|jump|fall\n" +
    "  POSE.walkLegSwing = 30; rebuildRigs()  ritara le ampiezze a caldo\n" +
    "     (armSpread, walkArmSwing, walkKneeBend, runLean, ...)\n" +
    "  clipReport()           quanto ogni traccia sposta l'osso rispetto al bind\n" +
    "  armReport()            misura dove sono le braccia (numeri, non occhio)\n" +
    "  showBones()            mostra scheletro + assi (rosso=avanti, verde=su, blu=sinistra)\n" +
    "  moveRig(0,0,-5) / rigToPlayer()      sposta il modello di prova\n" +
    "  toggleColliders()      wireframe delle collisioni (anche F3)\n" +
    "  animState()            stato dell'animazione del giocatore\n" +
    "  toggleStats()          contatore FPS (anche F4)",
);

// Contatore prestazioni. Spento di default, si accende con F4.
// Cliccando sul riquadro si cicla tra FPS / MS per frame / memoria.
const stats = new Stats();
stats.dom.style.left = "auto";
stats.dom.style.right = "0"; // a destra, così non copre l'HUD in alto a sinistra
stats.dom.style.display = "none";
document.body.appendChild(stats.dom);

let showStats = false;
function toggleStats(force) {
  showStats = force === undefined ? !showStats : !!force;
  stats.dom.style.display = showStats ? "block" : "none";
  return showStats;
}
window.toggleStats = toggleStats;

window.addEventListener("keydown", (e) => {
  if (e.code === "F4") {
    e.preventDefault();
    toggleStats();
  }
});

// Owns the Player, Yoshi, and the level, and drives their update() each frame.
const entityManager = new EntityManager(
  renderer.scene,
  physics,
  renderer.dirLight,
);
let mapEntity = null;
let obstacleZone = null;

const ui = new UIManager();
const audio = new AudioManager();
initGameAudio(audio);
ui.setAudio(audio);

// Restore the mute state saved from a previous session, if any.
audio.setMute(getStoredMuteState());

// 2. STATE VARIABLES

// Angle driving the slow orbiting camera shown behind the menu screens.
let menuCameraAngle = 0;

// Raw GLTF models, loaded once and reused whenever a character is spawned.
const rawModels = { mario: null, luigi: null };

// 3. UI EVENT WIRING

ui.onCharacterSelect((character) => {
  audio.setCharacter(character);
  audio.playSFX("selected");
});

ui.onMuteToggle = (isMuted) => {
  audio.setMute(isMuted);
};

ui.onReturnToMenu = () => {
  // Reloading is the simplest way to reset scene, physics, and UI state at once.
  window.location.reload();
};

ui.onBGMVolumeChange = (volume) => {
  audio.setBGMVolume(volume);
};
ui.onSFXVolumeChange = (volume) => {
  audio.setSFXVolume(volume);
};

// Require a user gesture before audio can play, so BGM starts on click.
ui.onWelcomeStart(() => {
  audio.playBGM();
});

ui.onGameStart(({ character }) => {
  audio.setCharacter(character);

  if (!rawModels[character]) return;

  const spawn = mapEntity?.playerSpawn;

  if (spawn) {
    entityManager.spawnPlayer(
      rawModels[character],
      spawn.x,
      spawn.y,
      spawn.z,
      character,
    );
  } else {
    // Fallback spawn point if the level didn't define one.
    entityManager.spawnPlayer(rawModels[character], 0, 1, 0, character);
  }

  // Il banco di prova parte SOLO ORA: prima il giocatore non esisteva e la
  // telecamera era ancora quella che orbita nel menu, quindi il modello finiva
  // all'origine — cioè dentro la casa di Mario. Il piccolo ritardo lascia a
  // CameraManager qualche frame per portarsi dietro al giocatore, così
  // l'offset "destra della camera" è quello giusto.
  if (autoRig) {
    setTimeout(() => {
      console.log(
        `%c[testRig] avvio automatico (?rig) — ${autoRig.model}`,
        "color:#43b047;font-weight:bold",
      );
      window.testRig(autoRig.model, autoRig.state);
    }, 250);
  }
});

// 4. GAME LOOP

function updateGame(delta) {
  // Prima di ogni return anticipato: updateGame viene chiamata a ogni frame,
  // quindi il contatore resta corretto anche nei menu e in pausa.
  if (showStats) stats.update();

  // I rig di prova si animano sempre, anche a gioco fermo.
  for (const r of testRigs) r.controller.update(delta, null);

  // While on a menu screen, only orbit the camera around the scene; nothing
  // else updates (physics, player, entities all stay frozen).
  if (ui.gameState === "MENU_WELCOME" || ui.gameState === "MENU_NAME") {
    menuCameraAngle += 0.2 * delta;
    const radius = 25;
    renderer.camera.position.x = 0 + Math.sin(menuCameraAngle) * radius;
    renderer.camera.position.z = 0 + Math.cos(menuCameraAngle) * radius;
    renderer.camera.position.y = 5;
    renderer.camera.lookAt(0, 1, 0);
    return;
  }

  // Paused or no player yet: skip the update, which also freezes physics
  // since entityManager.update() is what steps the physics world.
  if (ui.isPaused || !entityManager.player) return;

  entityManager.update(delta, input, ui, audio, renderer.camera);

  // Lava hazard check for the separate Kamek obstacle zone (see
  // ObstacleZone.js) — a no-op everywhere else in the level, since it only
  // does anything when the player is standing inside a lava patch's
  // footprint.
  if (obstacleZone) {
    obstacleZone.update(delta, entityManager.player, () => {
      if (ui.removeLife) ui.removeLife(1, audio);
    });
  }

  cameraManager.update(entityManager.player, input, delta);
  if (showColliders) cannonDebugger.update();
}

// Drives the loading bar shown on the initial screen while assets download.
THREE.DefaultLoadingManager.onProgress = function (
  url,
  itemsLoaded,
  itemsTotal,
) {
  const progress = (itemsLoaded / itemsTotal) * 100;

  const loadingBar = document.getElementById("loading-bar");
  const loadingText = document.getElementById("loading-text");

  if (loadingBar) loadingBar.style.width = progress + "%";
  if (loadingText) loadingText.innerText = Math.floor(progress) + "%";
};

// 5. STARTUP SEQUENCE
// Load characters, then the level, then reveal the game and start the loop.

initGameModels(assetLoader)
  .then(async (assets) => {
    mapEntity = new GameLevel(physics);

    // Blocks until every platform, building, and collectible is in the scene.
    await mapEntity.loadLevel("./assets/levels/level1.json");

    entityManager.setMap(mapEntity);

    if (mapEntity.yoshiSpawn) {
      const ySpawn = mapEntity.yoshiSpawn;
      const yoshiEntity = new Yoshi(assets.yoshi, physics);
      yoshiEntity.spawn(ySpawn.x, ySpawn.y, ySpawn.z);
      entityManager.setYoshi(yoshiEntity);
    }

    // Enemies. Loaded separately from the character models (see
    // assetConfig.initEnemyModels) since they aren't part of CHARACTER_MODELS;
    // the underlying AssetLoader cache is shared, so this just adds to it.
    // 3 Goombas, hand-placed a good distance apart around the island so they
    // don't cluster in one spot. EntityManager already has a generic
    // entities[] update loop (see addEntity), so no changes to
    // EntityManager.js or Player.js were needed to wire this up.
    const enemyAssets = await initEnemyModels(assetLoader);
    const GOOMBA_SPAWNS = [
      { x: 70, y: 2, z: -20 },
      { x: -50, y: 2, z: 80 },
      { x: 20, y: 2, z: -95 },
    ];

    for (const spawn of GOOMBA_SPAWNS) {
      const goomba = new Goomba(enemyAssets.goomba.clone(), physics);
      goomba.spawn(spawn.x, spawn.y, spawn.z);

      goomba.onStomped = () => {
        if (audio && audio.playSFX) audio.playSFX("jump"); // bounce sound
      };
      goomba.onDamagePlayer = () => {
        if (ui.removeLife) ui.removeLife(1, audio);
      };

      entityManager.addEntity(goomba);
    }

    // Separate bonus zone far from the main island: a short platform path
    // with fall risk (handled entirely by the existing void-fall respawn,
    // see EntityManager.update) plus a couple of lava hazards, ending with
    // Kamek. Reached via the "kamek_zone" warp stars placed in
    // GameLevel.js — see entities/Level/ObstacleZone.js for why this is a
    // teleport within the same world rather than a real level switch.
    obstacleZone = new ObstacleZone(renderer.scene, physics);
    await obstacleZone.load("./assets/levels/kamek_zone.json");

    if (mapEntity?.decorations && obstacleZone.entryPoint) {
      mapEntity.decorations.setKamekZoneEntry(obstacleZone.entryPoint);
    }

    if (obstacleZone.kamekSpawn) {
      const kamek = new Kamek(enemyAssets.kamek.clone(), physics);
      kamek.spawn(obstacleZone.kamekSpawn.x, obstacleZone.kamekSpawn.y, obstacleZone.kamekSpawn.z);

      kamek.onStomped = () => {
        if (audio && audio.playSFX) audio.playSFX("jump");
      };
      kamek.onDamagePlayer = () => {
        if (ui.removeLife) ui.removeLife(1, audio);
      };
      kamek.onDefeated = () => {
        // A real star to walk over and collect (not an instant grant),
        // plus a warp star right next to it to head back to spawn — same
        // "poke the level's existing systems from outside, after the
        // event" pattern used everywhere else for this kind of thing
        // (EntityManager's void-fall respawn, Enemy's stomp bounce).
        // kamek.mesh stays valid after _defeat() (only removed from the
        // scene graph, never nulled out), so its last position is still
        // readable here.
        const dropX = kamek.mesh ? kamek.mesh.position.x : (obstacleZone.kamekSpawn?.x ?? 320);
        const dropY = (kamek.mesh ? kamek.mesh.position.y : (obstacleZone.kamekSpawn?.y ?? 12)) + 1;
        const dropZ = kamek.mesh ? kamek.mesh.position.z : (obstacleZone.kamekSpawn?.z ?? 260);

        if (mapEntity?.collectibles) {
          mapEntity.collectibles.spawnStars([{ x: dropX, y: dropY, z: dropZ }]);
        }
        if (mapEntity?.decorations) {
          mapEntity.decorations.spawnWarpStars([
            { x: dropX + 3, y: dropY, z: dropZ, color: 0xffffff, target: "spawn" },
          ]);
        }
      };

      entityManager.addEntity(kamek);
    }

    rawModels.mario = assets.mario;
    rawModels.luigi = assets.luigi;

    // Compile every shader the scene currently needs (level geometry,
    // planets, enemies, Kamek's zone, ...) right now, while the loading
    // screen is still up, instead of letting the GPU compile them one at a
    // time the first moment each material actually appears on screen
    // during gameplay (a classic cause of random mid-game stutters the
    // first time you look at something new). This trades a slightly
    // longer load for a smoother run afterward. The character models
    // aren't in the scene yet at this point (they're only added once the
    // player picks Mario/Luigi on the next screen), so there's still a
    // small one-time compile the first time the player actually spawns —
    // unavoidable without restructuring the character-select flow, but
    // this covers the vast majority of what's on screen during play.
    if (renderer.renderer.compileAsync) {
      await renderer.renderer.compileAsync(renderer.scene, renderer.camera);
    } else {
      renderer.renderer.compile(renderer.scene, renderer.camera);
    }

    // Everything is ready: fade out and hide the loading screen.
    const loadingScreen = document.getElementById("loading-screen");
    if (loadingScreen) {
      loadingScreen.style.opacity = "0";
      setTimeout(() => {
        loadingScreen.style.display = "none";
      }, 500);
    }

    const gameLoop = new GameLoop(renderer, updateGame);
    gameLoop.start();

  })
  .catch((error) => {
    console.error("Error while loading assets:", error);
    const loadingText = document.getElementById("loading-text");
    if (loadingText) loadingText.innerText = "LOADING ERROR";
  });