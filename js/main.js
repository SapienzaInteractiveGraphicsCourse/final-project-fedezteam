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
import { assetUrl } from "./core/Assets/basePath.js";
import QualityManager from "./core/Render/QualityManager.js";
import { getStoredMuteState } from "./utils/storage.js";
import Yoshi from "./entities/Yoshi.js";
import Goomba from "./entities/enemies/Goomba.js";
import Kamek from "./entities/enemies/Kamek.js";
import Bowser from "./entities/enemies/Bowser.js";
import ObstacleZone from "./entities/Level/ObstacleZone.js";
import EndingZone from "./entities/Level/EndingZone.js";
import { clone as cloneRigged } from "three/addons/utils/SkeletonUtils.js";
import GameLevel from "./entities/GameLevel.js";
import EntityManager from "./entities/EntityManager.js";
import InteractionManager from "./interactions/InteractionManager.js";
import QuestManager from "./interactions/QuestManager.js";
import PeachCutscene from "./interactions/PeachCutscene.js";
import { MAP_MODELS } from "./core/Assets/manifest.js";
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
//    testRig("assets/models/Super_Mario/Main_Characters/Mario/mario.glb", "run")
//
// Poi si tara a occhio senza ricaricare la pagina:
//    POSE.armRest = 60; rebuildRigs()
const testRigs = [];

window.POSE = POSE;

window.testRig = async function (path, state = "walk", scaleTo = 2.2) {
  try {
    const gltf = await new GLTFLoader().loadAsync(assetUrl(path));
    const model = gltf.scene;

    const boneMap = new BoneMap(model);
    const usable = boneMap.describe(path.split("/").pop());
    if (!usable) return null;

    // Normalizza l'altezza: i modelli hanno scale native molto diverse fra loro.
    // Le matrici mondo vanno aggiornate PRIMA di misurare: su un modello con
    // scheletro Box3 chiede a SkinnedMesh.computeBoundingBox(), che legge le
    // matrici delle ossa. Appena uscito dal loader quelle matrici non sono
    // ancora calcolate e la misura viene fuori sbagliata (per Mario/mario.glb
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
//   http://127.0.0.1:5500/?rig            → Mario/mario.glb, stato "walk"
//   http://127.0.0.1:5500/?rig=run        → stato "run"
//   http://127.0.0.1:5500/?rig=walk&model=assets/.../bowser_jr.glb
const rigParams = new URLSearchParams(window.location.search);
const autoRig = rigParams.has("rig")
  ? {
      state: rigParams.get("rig") || "walk",
      model:
        rigParams.get("model") ||
        "assets/models/Super_Mario/Main_Characters/Mario/mario.glb",
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
    '  testRig("assets/models/Super_Mario/Main_Characters/Mario/mario.glb")\n' +
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

// The 25-coin quest listens on every coin pickup, whatever point the
// chain is actually at — see QuestManager.onCoinCollected for the no-op
// guard.
entityManager.onCoinCollected = () => questManager.onCoinCollected();
// Same idea, for stars — see QuestManager.onStarCollected (a no-op unless
// the star's own `id` is one a quest is watching for, e.g. the Red
// Planet's — see GameLevel.js).
entityManager.onStarCollected = (star) => questManager.onStarCollected(star?.id);

let mapEntity = null;
let kamekZone = null;
let bowserZone = null;
let endingZone = null;
// Hoisted out of the async asset-loading callback (where they're actually
// created — see initGameModels().then below) so updateGame()'s per-frame
// loop can reach them to drive the boss health bar (see showBossHealthBar/
// hideBossHealthBar calls below).
let kamek = null;
let bowser = null;

// Yoshi's egg -> mount mechanic (see js/interactions/) — hoisted the same
// way as kamek/bowser above, since they're actually created inside the
// async asset-loading callback further down but need to be reachable from
// updateGame()'s per-frame loop.
let yoshiEggMesh = null;
let yoshiEntity = null;
// The two "press E" interactions, kept in hand because Yoshi can go back
// into his egg mid-run (falling into the void while ridden kills him — see
// EntityManager._loseYoshi) and the pair has to be swapped over each time.
let yoshiEggInteractable = null;
let yoshiMountInteractable = null;
let peachCutscene = null;

const ui = new UIManager();

// Regola da sola risoluzione, ombre e distanza del prato in base agli fps
// misurati, cosi' lo stesso gioco resta fluido sia sul fisso che sul
// portatile — vedi core/Render/QualityManager.js.
const quality = new QualityManager(renderer);
window.quality = quality; // per provare i livelli a mano: quality.setLevel(3)

const audio = new AudioManager();
initGameAudio(audio);
ui.setAudio(audio);

// Owns every "walk up and press E" interaction in the game: Toad's quest
// dialogue, hatching Yoshi's egg, mounting/dismounting Yoshi, and talking
// to Peach at the end — see js/interactions/.
const interactions = new InteractionManager(ui);
// `audio` as well as `ui`: every one of Toad's lines is spoken (his welcome
// greeting, the per-quest clips, the generic blip) — see
// QuestManager._showToadDialogue.
const questManager = new QuestManager(ui, audio);

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

// "REACH PRINCESS PEACH" on the win screen: teleports the player in front
// of Peach's castle instead of restarting the game. Returns false when the
// ending zone failed to load, which tells UIManager to leave the win screen
// up rather than drop the player into empty space — same guard the warp
// stars use (see Decorations._getWarpDestination).
//
// Deliberately does not touch the audio: the ending theme started by
// showWin() has to keep playing across the teleport.
ui.onReachPeach = () => {
  const dest = endingZone?.entryPoint;
  if (!dest || !entityManager.player) return false;

  const player = entityManager.player;
  player.body.position.set(dest.x, dest.y, dest.z);
  player.body.velocity.set(0, 0, 0);

  // Turn both the character and the camera toward the castle, so the warp
  // lands on the view it exists for. Without this the player keeps whatever
  // facing they happened to have when the last star dropped, and the
  // camera stays behind them — pointing at empty grass just as often as at
  // the castle. Only the current orbit angle is set here; every camera
  // tuning value (distance, follow speed, limits) is left alone, and the
  // player's own movement takes the angle straight back over.
  const castle = endingZone.castle?.position;
  if (castle) {
    const facing = Math.atan2(castle.x - dest.x, castle.z - dest.z);
    player.currentFacingAngle = facing;
    player.mesh.rotation.y = facing + (player.modelOffset || 0);
    // Same "behind the player" angle CameraManager's auto-follow aims for.
    cameraManager.cameraAngleX = facing + Math.PI;
    // Flatter than the usual look-down angle: the castle is 26 units tall
    // and the default pitch crops its towers right off the top of the
    // screen. Still just the current angle, well inside the limits
    // CameraManager clamps to, and i/k take it back over immediately.
    cameraManager.cameraAngleY = 0.22;
  }

  return true;
};

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

// Life lost to a hazard that actually hits the character: enemy contact
// (Goomba/Kamek/Bowser) or lava. Every one of those goes through here so the
// hurt sound stays in one place instead of being repeated at each call site.
// The void fall is deliberately NOT one of them: it already plays the falling
// scream (see EntityManager.update) and stacking a second voice clip on top
// of it sounds wrong.
function damagePlayer() {
  if (!ui.removeLife) return;

  // removeLife() returns true when this hit was the fatal one, and in that
  // case it has already started the game-over jingle — so the hurt sound is
  // skipped rather than played over it.
  const isGameOver = ui.removeLife(1, audio);
  if (!isGameOver && audio && audio.playSFX) audio.playSFX("damage");
}

// Which boss course the player was inside on the previous frame, so that
// ARRIVING in one can be told apart from merely still being there. Null
// while anywhere else, including the main island.
let currentBossZone = null;

// Called every frame the player is inside `key`'s obstacle course (see
// updateGame's zone check): puts that boss' battle theme on — a no-op after
// the first frame, since playMusic() ignores a request for the track that's
// already playing — and, only on the frame they actually arrive, plays his
// greeting.
//
// Skipped once he's beaten: coming back to pick up the star he dropped
// shouldn't be announced by a boss who isn't there anymore. The music still
// switches either way, so a defeated zone keeps its own atmosphere.
function enterBossZone(key, track, boss) {
  audio.playMusic(track);

  if (currentBossZone === key) return;
  currentBossZone = key;

  // playTrack, not playSFX: the greeting is the one effect in the game big
  // enough for playSFX's clone-then-play to be a problem (kamek_start is
  // 1.3 MB — the clone starts its own download of it, and the cue would
  // arrive late over anything slower than localhost). It can't overlap
  // itself either, since you only arrive once per visit, so there's nothing
  // the clone was protecting. Same reasoning as the ending theme — see
  // AudioManager.playTrack.
  if (boss && !boss.isDefeated && audio.playTrack) audio.playTrack(`${key}_start`);
}

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

  // Final "THANK YOU, HERO!" popup (see UIManager.showVictoryFinale): a
  // dead stop on the whole loop, not just the player — without this,
  // cameraManager.update() below would keep responding to I/J/K/L and
  // interactions.update() would keep showing "Press E..." prompts
  // underneath the popup, even though the character itself is already
  // frozen by EntityManager's own gameState check.
  if (ui.gameState === "VICTORY_FINALE") return;

  // Paused or no player yet: skip the update, which also freezes physics
  // since entityManager.update() is what steps the physics world.
  if (ui.isPaused || !entityManager.player) return;

  entityManager.update(delta, input, ui, audio, renderer.camera);

  // Lava hazard check for the two separate obstacle zones (Kamek's and
  // Bowser's, see ObstacleZone.js) — a no-op everywhere else in the level,
  // since it only does anything when the player is standing inside a lava
  // patch's footprint.
  if (kamekZone) {
    kamekZone.update(delta, entityManager.player, () => {
      damagePlayer();
    });
  }
  if (bowserZone) {
    bowserZone.update(delta, entityManager.player, () => {
      damagePlayer();
    });
  }

  // Boss health bar: shown only while the player is standing on the
  // relevant boss' arena (ObstacleZone.isPlayerInArena — see its own
  // comment), hidden as soon as they leave OR the boss is defeated.
  // updateBossHealthBar() itself is driven by each boss' onStomped
  // callback above, for an immediate per-hit update rather than waiting
  // for next frame's arena check.
  if (kamekZone && kamek && entityManager.player?.mesh) {
    if (!kamek.isDefeated && kamekZone.isPlayerInArena(entityManager.player.mesh.position)) {
      ui.showBossHealthBar("kamek", "KAMEK", kamek.hitsToDefeat);
    } else if (ui.activeBossHpKey === "kamek") {
      ui.hideBossHealthBar();
    }
  }
  if (bowserZone && bowser && entityManager.player?.mesh) {
    if (!bowser.isDefeated && bowserZone.isPlayerInArena(entityManager.player.mesh.position)) {
      ui.showBossHealthBar("bowser", "BOWSER", bowser.hitsToDefeat);
    } else if (ui.activeBossHpKey === "bowser") {
      ui.hideBossHealthBar();
    }
  }

  // Boss zone music: kamek_battle/bowser_battle take over the BGM for the
  // WHOLE obstacle course (ObstacleZone.containsPoint — approach platforms
  // included, not just the arena itself, unlike the health bar above), back
  // to the overworld theme as soon as the player leaves either. Gated on
  // gameState === "PLAYING" so it can't fight the game-over/win jingle —
  // updateGame() itself isn't guarded on that (unlike the MENU_* early
  // return above), so without this a still-running per-frame call would
  // restart the zone track right after showGameOver()/showWin() stopped it.
  if (ui.gameState === "PLAYING") {
    const playerPos = entityManager.player?.mesh?.position;
    if (kamekZone && kamekZone.containsPoint(playerPos)) {
      enterBossZone("kamek", "kamek_battle", kamek);
    } else if (bowserZone && bowserZone.containsPoint(playerPos)) {
      enterBossZone("bowser", "bowser_battle", bowser);
    } else {
      currentBossZone = null;
      audio.playMusic();
    }
  }

  // "Press E to ..." interactions (Toad's quest, Yoshi's egg/mount,
  // Peach's dialogue trigger) — suppressed while a dialogue line is
  // already up, both so the prompt doesn't fight the speech bubble for
  // screen space and so E doesn't simultaneously advance a line AND
  // re-trigger whatever's underneath it.
  if (!ui.dialogueActive) {
    interactions.update(entityManager.player.mesh.position, input);
  } else {
    ui.hideInteractionPrompt();
  }

  // Dialogue advance (Peach's cutscene or Toad's quest lines): E ONLY, per
  // spec — Space is deliberately not read here at all, so it stays free
  // for jumping the instant a dialogue box closes. While Peach's cutscene
  // is active the camera is also a fixed cinematic shot on her
  // (PeachCutscene.updateCamera) instead of the normal follow-cam.
  if (ui.dialogueActive && input.consumeJustPressed("e")) {
    if (peachCutscene && peachCutscene.active) {
      peachCutscene.advance();
    } else if (questManager.dialogueOpen) {
      questManager.closeToadDialogue();
    }
  }

  if (peachCutscene && peachCutscene.active) {
    peachCutscene.updateCamera();
  } else {
    cameraManager.update(entityManager.player, input, delta);
  }

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
    await mapEntity.loadLevel(assetUrl("assets/levels/level1.json"));

    entityManager.setMap(mapEntity);

    // Lets Decorations show/hide the "get off Yoshi" warp-star warning
    // (see Decorations._updateYoshiWarpWarning) without needing `ui` added
    // to its constructor.
    if (mapEntity?.decorations) mapEntity.decorations.setUI(ui);

    // Il prato e' la voce piu' pesante della scena: da qui in poi
    // QualityManager puo' regolarne la distanza di vista insieme a
    // risoluzione e ombre (vedi core/Render/QualityManager.js).
    if (mapEntity?.decorations) quality.setDecorations(mapEntity.decorations);

    // Toad's quest dialogue: looked up by type from the NPCs GameLevel just
    // spawned (see LevelLoader.buildBuildingsAndNPCs / NPC.js — this is
    // also where Toad's previously-missing collision comes from). Skipped
    // gracefully (console warning only) if level1.json ever stops defining
    // a "toad" NPC.
    const toadNpc = mapEntity.npcs?.find((n) => n.type === "toad");
    if (toadNpc) {
      questManager.onRewardStar = () => {
        if (mapEntity?.collectibles) {
          mapEntity.collectibles.spawnStars([
            { x: toadNpc.position.x + 3, y: toadNpc.position.y + 2, z: toadNpc.position.z },
          ]);
        }
      };

      // That is the ONLY star Toad hands over: Kamek and Bowser each drop
      // their own at the arena where they die (see their onDefeated below),
      // and beating them advances the quest chain by itself — there's no
      // "report back to Toad" step for either of them to claim a star at.
      // The coin quest is the exception because it has no arena to drop
      // one at.

      interactions.register({
        position: toadNpc.position,
        radius: 3.5,
        prompt: () => questManager.getToadPrompt(),
        onInteract: () => questManager.onToadInteract(),
      });
    } else {
      console.warn('[main] No "toad" NPC found in level1.json — Toad\'s quest is not registered.');
    }

    // Yoshi's egg -> mount mechanic: Yoshi starts hatched inside an egg at
    // the level's yoshiSpawn point. Pressing E hatches it (no animation, per
    // spec) into the rideable Yoshi from before; pressing E on Yoshi
    // himself afterward mounts/dismounts (see Yoshi.mount()/dismount() and
    // Player.setMountedOnYoshi for the boosted jump while riding).
    if (mapEntity.yoshiSpawn && assets.yoshi) {
      const ySpawn = mapEntity.yoshiSpawn;

      try {
        const eggGltf = await new GLTFLoader().loadAsync(MAP_MODELS.yoshiEgg);
        yoshiEggMesh = eggGltf.scene;

        // Measure-then-scale to a sensible in-world size, same recipe used
        // throughout the level (see EndingZone._placeModel) rather than
        // trusting a hardcoded scale on a model whose native size is
        // unknown here.
        yoshiEggMesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(yoshiEggMesh);
        const height = box.max.y - box.min.y || 1;
        const targetHeight = 2.2;
        yoshiEggMesh.scale.setScalar(targetHeight / height);
        yoshiEggMesh.updateMatrixWorld(true);
        const scaledBox = new THREE.Box3().setFromObject(yoshiEggMesh);

        yoshiEggMesh.position.set(ySpawn.x, ySpawn.y - scaledBox.min.y, ySpawn.z);
        yoshiEggMesh.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
        renderer.scene.add(yoshiEggMesh);

        // Hatching: the egg leaves the scene, Yoshi takes its place, and
        // the mount prompt replaces the hatch one. The egg MESH is kept
        // (not disposed) because Yoshi can be lost and end up back inside
        // it — see layYoshiEgg below — so it gets re-added rather than
        // reloaded, and the model is fetched exactly once per session.
        const hatchYoshiEgg = () => {
          if (!yoshiEggMesh || yoshiEntity) return;

          renderer.scene.remove(yoshiEggMesh);
          yoshiEggInteractable.enabled = false;

          // First half of the Yoshi quest (see QuestManager's QUESTS) —
          // the egg hatching is a step of its own, so this fires right
          // here rather than being tied to any star pickup.
          questManager.markYoshiHatched();

          yoshiEntity = new Yoshi(assets.yoshi, physics);
          yoshiEntity.spawn(ySpawn.x, ySpawn.y, ySpawn.z);
          entityManager.setYoshi(yoshiEntity);

          yoshiMountInteractable = interactions.register({
            // Live reference, not a copy: once mounted, Yoshi.update()
            // follows the player every frame, so this keeps tracking him
            // automatically without re-registering.
            position: yoshiEntity.mesh.position,
            radius: 3,
            prompt: () =>
              yoshiEntity.isRidden ? "Press E to get off Yoshi" : "Press E to ride Yoshi",
            onInteract: () => {
              if (yoshiEntity.isRidden) {
                yoshiEntity.dismount();
                entityManager.player?.setMountedOnYoshi(false);
                // The rider gets his own voice back.
                audio?.setVoice?.(null);
              } else {
                yoshiEntity.mount();
                entityManager.player?.setMountedOnYoshi(true);
                // From here until dismount, every effect Yoshi has a clip
                // for is his: jumping and the falling scream. It's Yoshi
                // doing the jumping now, so hearing Mario grunt over it
                // read as a leftover. Anything he has no clip for (taking
                // damage) still comes out in the rider's voice — see
                // AudioManager.setVoice.
                audio?.setVoice?.("yoshi");
                audio?.playSFX?.("yoshi_mounted");
              }
            },
          });

          // Yoshi's own cry, not the star-pickup chime this used to borrow
          // before he had a sound of his own — nothing is being collected
          // here, he's hatching.
          if (audio && audio.playSFX) audio.playSFX("yoshi_spawn");
        };

        // The reverse: Yoshi went into the void with the player on his back
        // and didn't come out (EntityManager._loseYoshi has already taken
        // him out of the scene and the physics world by the time this
        // runs). He returns to where he came from — inside the egg, at the
        // spot he first hatched from — so the mechanic can be picked up
        // again later instead of being gone for the rest of the run.
        const layYoshiEgg = () => {
          if (yoshiMountInteractable) {
            interactions.unregister(yoshiMountInteractable);
            yoshiMountInteractable = null;
          }
          yoshiEntity = null;

          if (!yoshiEggMesh) return;
          renderer.scene.add(yoshiEggMesh);
          yoshiEggInteractable.enabled = true;
        };

        yoshiEggInteractable = interactions.register({
          position: yoshiEggMesh.position,
          radius: 3,
          prompt: "Press E to hatch the egg",
          onInteract: hatchYoshiEgg,
        });

        entityManager.onYoshiLost = layYoshiEgg;
      } catch (e) {
        console.warn("[main] Could not load the Yoshi egg model — falling back to spawning Yoshi directly.", e);
        yoshiEntity = new Yoshi(assets.yoshi, physics);
        yoshiEntity.spawn(ySpawn.x, ySpawn.y, ySpawn.z);
        entityManager.setYoshi(yoshiEntity);
      }
    }

    // Classic void-fall respawn point for the main map (level1.json): if
    // this is the only match (see setVoidFallZones below, for the two boss
    // zones), falling into the void anywhere on the main island sends the
    // player back to the game's actual starting point instead of a
    // hardcoded (0,2,0) that could drift out of sync with the level file.
    entityManager.setSpawnPoint(mapEntity.playerSpawn);

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
      // cloneRigged, not mesh.clone(): Object3D.clone() copies the bones
      // but leaves every SkinnedMesh in the copy still pointing at the
      // ORIGINAL's skeleton. Bowser's model has one (see Enemy.spawn's
      // walk cycle), and with a plain clone his meshes followed bones
      // nobody was animating while his bounding box was measured off a
      // skeleton that never gets updated — which came out ~1200 units tall
      // and shrank him to a speck. Harmless for the boneless enemies, so
      // all three go through the same call rather than special-casing.
      const goomba = new Goomba(cloneRigged(enemyAssets.goomba), physics);
      goomba.spawn(spawn.x, spawn.y, spawn.z);

      goomba.onStomped = () => {
        if (audio && audio.playSFX) audio.playSFX("jump"); // bounce sound
      };
      goomba.onDamagePlayer = () => {
        damagePlayer();
      };

      entityManager.addEntity(goomba);
    }

    // Separate bonus zone far from the main island: a short platform path
    // with fall risk (handled entirely by the existing void-fall respawn,
    // see EntityManager.update) plus a couple of lava hazards, ending with
    // Kamek. Reached via the "kamek_zone" warp stars placed in
    // GameLevel.js — see entities/Level/ObstacleZone.js for why this is a
    // teleport within the same world rather than a real level switch.
    kamekZone = new ObstacleZone(renderer.scene, physics);
    await kamekZone.load(assetUrl("assets/levels/kamek_zone.json"));

    if (mapEntity?.decorations && kamekZone.entryPoint) {
      mapEntity.decorations.setKamekZoneEntry(kamekZone.entryPoint);
    }

    if (kamekZone.bossSpawn) {
      kamek = new Kamek(cloneRigged(enemyAssets.kamek), physics, renderer.scene);
      kamek.spawn(kamekZone.bossSpawn.x, kamekZone.bossSpawn.y, kamekZone.bossSpawn.z);

      kamek.onStomped = (hits, needed) => {
        if (audio && audio.playSFX) {
          audio.playSFX("jump"); // the player's own bounce off his head
          // ...and his yelp — but not on the blow that finishes him, which
          // gets the death cry from onDefeated below instead of both at
          // once.
          if (hits < needed) audio.playSFX("kamek_hit");
        }
        ui.updateBossHealthBar(kamek.hitsTaken, kamek.hitsToDefeat);
      };
      kamek.onDamagePlayer = () => {
        damagePlayer();
      };
      // Fired when a ranged attack starts winding up, not when the
      // projectile leaves — see Boss.onAttack.
      kamek.onAttack = () => {
        if (audio && audio.playSFX) audio.playSFX("kamek_attack");
      };
      kamek.onDefeated = () => {
        if (audio && audio.playSFX) audio.playSFX("kamek_last_hit");

        questManager.onKamekDefeated();

        // A real star to walk over and collect (not an instant grant),
        // plus a warp star right next to it to head back to spawn — same
        // "poke the level's existing systems from outside, after the
        // event" pattern used everywhere else for this kind of thing
        // (EntityManager's void-fall respawn, Enemy's stomp bounce).
        //
        // BUG FIX (instant/accidental pickup): the drop point used to be
        // wherever kamek.mesh last stood at the moment of the final stomp —
        // which, since a stomp only lands at close range, could be right
        // under (or one step from) the player, granting the star/warp
        // instantly instead of as something to walk over. Anchored to the
        // arena's own fixed center instead (kamekZone.arenaCenter — see
        // ObstacleZone.load), independent of where the fight happened to
        // end, with a fallback to bossSpawn only if the zone had no arena.
        const center = kamekZone.arenaCenter;
        let dropX = center ? center.x : (kamekZone.bossSpawn?.x ?? 320);
        let dropY = (center ? center.y : (kamekZone.bossSpawn?.y ?? 10)) + 1;
        let dropZ = center ? center.z : (kamekZone.bossSpawn?.z ?? 260);

        // Extra safety net on top of the fixed arena-center anchor above:
        // nudge the drop point away if it still ends up suspiciously close
        // to the player (who may well be standing near the arena's middle
        // right after winning) or to kamek's last position, so the reward
        // can never spawn exactly on top of either.
        const tooClose = (px, pz) => Math.hypot(dropX - px, dropZ - pz) < 4;
        const playerPos = entityManager.player?.mesh?.position;
        if (
          (playerPos && tooClose(playerPos.x, playerPos.z)) ||
          (kamek.mesh && tooClose(kamek.mesh.position.x, kamek.mesh.position.z))
        ) {
          dropX += 6;
          dropZ += 6;
        }

        if (mapEntity?.collectibles) {
          mapEntity.collectibles.spawnStars([{ x: dropX, y: dropY + 2, z: dropZ }]);
        }
        if (mapEntity?.decorations) {
          // Bright yellow (was plain white) so a boss-reward warp star
          // reads as distinct from the decorative ones at level load.
          mapEntity.decorations.spawnWarpStars([
            { x: dropX + +5, y: dropY + 4, z: dropZ+5, color: 0xffee00, target: "spawn" },
          ]);
        }
      };

      entityManager.addEntity(kamek);
    }

    // Same idea, second obstacle course: wider platforms with bigger
    // height gaps between them (see bowser_zone.json), ending with Bowser
    // instead of Kamek. Reached via the single "bowser_zone" warp star
    // placed in GameLevel.js.
    bowserZone = new ObstacleZone(renderer.scene, physics);
    await bowserZone.load(assetUrl("assets/levels/bowser_zone.json"));

    if (mapEntity?.decorations && bowserZone.entryPoint) {
      mapEntity.decorations.setBowserZoneEntry(bowserZone.entryPoint);
    }

    if (bowserZone.bossSpawn) {
      bowser = new Bowser(cloneRigged(enemyAssets.bowser), physics, renderer.scene);
      bowser.spawn(bowserZone.bossSpawn.x, bowserZone.bossSpawn.y, bowserZone.bossSpawn.z);

      bowser.onStomped = (hits, needed) => {
        if (audio && audio.playSFX) {
          audio.playSFX("jump"); // the player's own bounce off his head
          // ...and his yelp — but not on the blow that finishes him, which
          // gets the death cry from onDefeated below instead of both at
          // once.
          if (hits < needed) audio.playSFX("bowser_hit");
        }
        ui.updateBossHealthBar(bowser.hitsTaken, bowser.hitsToDefeat);
      };
      bowser.onDamagePlayer = () => {
        damagePlayer();
      };
      // Fired when a ranged attack starts winding up, not when the
      // projectile leaves — see Boss.onAttack.
      bowser.onAttack = () => {
        if (audio && audio.playSFX) audio.playSFX("bowser_attack");
      };
      bowser.onDefeated = () => {
        if (audio && audio.playSFX) audio.playSFX("bowser_last_hit");

        questManager.onBowserDefeated();

        // Same "drop a real collectible star + a warp star back to spawn"
        // pattern as Kamek's onDefeated above — including the same fix:
        // anchored to the arena's fixed center (bowserZone.arenaCenter)
        // instead of wherever bowser.mesh last stood, plus the same
        // too-close-to-player/boss safety nudge.
        const center = bowserZone.arenaCenter;
        let dropX = center ? center.x : (bowserZone.bossSpawn?.x ?? -230);
        let dropY = (center ? center.y : (bowserZone.bossSpawn?.y ?? 10)) + 1;
        let dropZ = center ? center.z : (bowserZone.bossSpawn?.z ?? 300);

        const tooClose = (px, pz) => Math.hypot(dropX - px, dropZ - pz) < 4;
        const playerPos = entityManager.player?.mesh?.position;
        if (
          (playerPos && tooClose(playerPos.x, playerPos.z)) ||
          (bowser.mesh && tooClose(bowser.mesh.position.x, bowser.mesh.position.z))
        ) {
          dropX += 6;
          dropZ += 6;
        }

        if (mapEntity?.collectibles) {
          mapEntity.collectibles.spawnStars([{ x: dropX, y: dropY + 2, z: dropZ }]);
        }
        if (mapEntity?.decorations) {
          // Bright yellow (was plain white) — same reasoning as Kamek's
          // onDefeated above.
          mapEntity.decorations.spawnWarpStars([
            { x: dropX + 5, y: dropY + 4, z: dropZ + 5, color: 0xffee00, target: "spawn" },
          ]);
        }
      };

      entityManager.addEntity(bowser);
    }

    // Zone-aware void-fall respawn: falling into the void while inside
    // Kamek's or Bowser's obstacle course (including its boss arena) should
    // respawn the player at THAT zone's own entrance, not drag them all the
    // way back to the main island (see EntityManager.setVoidFallZones /
    // ObstacleZone.containsPoint for the actual bounds check). Only zones
    // that both loaded and ended up with a computed bounding box are
    // registered — an empty/failed zone load is simply skipped, falling
    // through to the classic spawn-point respawn set above.
    entityManager.setVoidFallZones(
      [
        { zone: kamekZone, respawn: kamekZone?.entryPoint },
        { zone: bowserZone, respawn: bowserZone?.entryPoint },
      ].filter((entry) => entry.zone && entry.zone.bounds && entry.respawn),
    );

    // The place the player is sent to after collecting every star: Peach's
    // castle with Peach waiting outside it. Built up front like the two
    // boss courses (it's the same physics world, just far away) so that
    // pressing the win screen's button is a plain teleport with nothing
    // left to load — see entities/Level/EndingZone.js and the
    // ui.onReachPeach handler below.
    endingZone = new EndingZone(renderer.scene, physics);
    await endingZone.load(assetUrl("assets/levels/peach_castle.json"));

    // Peach's ending dialogue: walk up to her at the castle and press E —
    // only available once the player has actually been teleported there
    // (ui.gameState === "ENDING", set by ui.onReachPeach above), and not
    // while a dialogue line is already up.
    if (endingZone.peach) {
      peachCutscene = new PeachCutscene(
        ui,
        renderer.camera,
        endingZone.peach,
        endingZone.castle,
        audio,
      );

      interactions.register({
        position: endingZone.peach.position,
        radius: 4,
        prompt: "Press E to talk to Peach",
        isAvailable: () => ui.gameState === "ENDING" && !ui.dialogueActive,
        onInteract: () => peachCutscene.start(ui.heroName || "hero"),
      });
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

    const gameLoop = new GameLoop(renderer, updateGame, quality);
    gameLoop.start();

  })
  .catch((error) => {
    console.error("Error while loading assets:", error);
    const loadingText = document.getElementById("loading-text");
    if (loadingText) loadingText.innerText = "LOADING ERROR";
  });
