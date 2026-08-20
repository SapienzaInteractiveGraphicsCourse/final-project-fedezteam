import * as THREE from "three";

/**
 * Costruisce a mano le AnimationClip dei personaggi.
 *
 * PERCHÉ NON USIAMO ANGOLI DI EULERO SULLE OSSA
 * Ogni rig orienta gli assi locali delle ossa a modo suo: su un rig Mixamo
 * ruotare il braccio attorno alla Z locale lo porta all'indietro, su un altro
 * lo porta in giù. Indovinare asse e segno modello per modello è una caccia
 * al bug senza fine.
 *
 * Qui invece diciamo DOVE DEVE PUNTARE l'arto, e la rotazione necessaria la
 * calcoliamo. Il sistema di riferimento del personaggio lo ricaviamo dallo
 * scheletro stesso (bacino→spina = su, spalla→spalla = sinistra, e "avanti"
 * come loro prodotto vettoriale), quindi non dipende né da come il modello è
 * orientato nel mondo né da come sono nominati o ruotati i suoi assi locali.
 */

const DEG = Math.PI / 180;

/** Ampiezze delle pose, in gradi. Regolabili a caldo con rebuildRigs(). */
export const POSE = {
  armSpread: 11, // quanto le braccia stanno staccate dal corpo a riposo
  walkArmSwing: 26,
  walkLegSwing: 24,
  walkKneeBend: 38,
  walkHipsBob: 0.045,

  runArmSwing: 45,
  runLegSwing: 40,
  runKneeBend: 65,
  runLean: 12, // inclinazione del busto in avanti
  runHipsBob: 0.07,

  // Salto "alla Super Mario": un braccio in alto, l'altro piegato in basso,
  // ginocchio anteriore raccolto e gamba posteriore distesa all'indietro.
  // I due lati sono OPPOSTI di proposito (braccio destro su, ginocchio
  // sinistro su): è l'incrocio che dà alla posa il suo slancio.
  jumpArmUp: 154, // braccio alzato; 180 sarebbe perfettamente verticale
  jumpArmUpSpread: 34, // quanto lo si apre di lato: serve a scavalcare la testa
  jumpArmDown: 8, // braccio basso, appena in avanti
  jumpArmDownSpread: 10,
  jumpElbowUp: 8, // il braccio alzato resta quasi dritto
  jumpElbowDown: 85, // l'altro gomito invece è ben piegato
  jumpFrontThigh: 72, // ginocchio che sale davanti
  jumpFrontKnee: 100,
  jumpBackThigh: -36, // gamba che resta indietro, quasi distesa
  jumpBackKnee: 18,
  jumpLean: -3, // busto appena indietro, petto in fuori
  jumpTwist: 12 // il busto si torce dalla parte del braccio alzato
};

// Da quale osso "pende" ciascun arto: serve a sapere in che direzione punta.
const LIMB_CHILD = {
  upperArmL: "foreArmL",
  upperArmR: "foreArmR",
  foreArmL: "handL",
  foreArmR: "handR",
  thighL: "shinL",
  thighR: "shinR",
  shinL: "footL",
  shinR: "footR",
  spine: "chest",
  hips: "spine",
};

/**
 * Terna ortonormale del personaggio, dedotta dallo scheletro in posa di bind.
 * @returns {{up: THREE.Vector3, left: THREE.Vector3, forward: THREE.Vector3}}
 */
export function characterBasis(bm) {
  const wp = (role) => bm.get(role).getWorldPosition(new THREE.Vector3());

  // 1. SU — dal bacino alla spina. È l'asse più affidabile di tutti.
  const up = wp("spine").sub(wp("hips")).normalize();

  // 2. AVANTI — la punta del piede sta davanti al tallone: è il segnale
  //    anatomicamente più diretto per capire da che parte guarda un
  //    personaggio, e non dipende da convenzioni di nomi o di assi.
  let forward = null;

  for (const [footRole, toeRole] of [["footL", "toeL"], ["footR", "toeR"]]) {
    if (bm.has(footRole) && bm.has(toeRole)) {
      forward = wp(toeRole).sub(wp(footRole));
      break;
    }
  }

  if (forward && forward.lengthSq() > 1e-8) {
    // Le punte sono anche rivolte in basso: teniamo solo la parte orizzontale.
    forward.sub(up.clone().multiplyScalar(forward.dot(up)));
  } else {
    forward = null;
  }

  // 3. Ripiego, se il rig non ha ossa per le punte: dalle spalle.
  //    ATTENZIONE ALL'ORDINE — crossVectors(up, leftArms) dà l'INDIETRO.
  if (!forward || forward.lengthSq() < 1e-8) {
    const leftArms = wp("upperArmL").sub(wp("upperArmR"));
    leftArms.sub(up.clone().multiplyScalar(leftArms.dot(up))).normalize();
    forward = new THREE.Vector3().crossVectors(leftArms, up);
  }
  forward.normalize();

  // 4. SINISTRA — derivata, così la terna è ortonormale e destrorsa per
  //    costruzione: left × up = forward, e quindi up × forward = left.
  const left = new THREE.Vector3().crossVectors(up, forward).normalize();

  // Controllo di coerenza: "sinistra" così ottenuta deve puntare dalla spalla
  // destra verso la sinistra. Se non è così il rig ha i nomi specchiati, e va
  // segnalato perché tutte le pose destra/sinistra risulterebbero scambiate.
  if (bm.has("upperArmL") && bm.has("upperArmR")) {
    const check = wp("upperArmL").sub(wp("upperArmR"));
    if (check.dot(left) < 0) {
      console.warn(
        "[clipFactory] le ossa Left/Right di questo rig sembrano specchiate: " +
          "le pose di destra e sinistra risulteranno invertite.",
      );
    }
  }

  return { up, left, forward };
}

/**
 * Direzione bersaglio per un arto, espressa in gradi rispetto al "giù".
 * @param {number} swing - positivo = in avanti
 * @param {number} spread - positivo = verso l'esterno del corpo
 */
function limbDir(basis, swing, spread, side) {
  const d = basis.up.clone().negate(); // punto di partenza: verso il basso

  // SEGNI, ricavati sulla terna reale e non assunti:
  //  • ruotare "giù" attorno a SINISTRA di +θ porta INDIETRO ⇒ per avere
  //    "swing positivo = in avanti" bisogna negare;
  //  • ruotare "giù" attorno ad AVANTI di +θ porta verso SINISTRA ⇒ per il
  //    braccio/gamba di sinistra "verso l'esterno" è +θ, per quello di destra −θ.
  d.applyAxisAngle(basis.left, -swing * DEG);
  d.applyAxisAngle(basis.forward, spread * DEG * (side === "L" ? 1 : -1));

  return d.normalize();
}

/**
 * Rotazione locale da dare all'osso perché il suo arto punti in `dirWorld`.
 *
 * L'osso è orientato dalla catena dei genitori (M) più la sua rotazione di
 * bind; il figlio sta in `child.position`, cioè nel sistema locale dell'osso.
 * Vogliamo q tale che  M · q · ĉ = bersaglio, da cui  q = rot(ĉ → M⁻¹·bersaglio).
 */
function offsetToward(bone, child, dirWorld) {
  if (!bone || !child) return new THREE.Quaternion();

  const childLocalDir = child.position.clone();
  if (childLocalDir.lengthSq() < 1e-12) return new THREE.Quaternion();
  childLocalDir.normalize();

  const boneWorldQ = bone.getWorldQuaternion(new THREE.Quaternion());
  const targetLocal = dirWorld
    .clone()
    .applyQuaternion(boneWorldQ.clone().invert())
    .normalize();

  return new THREE.Quaternion().setFromUnitVectors(childLocalDir, targetLocal);
}

/**
 * Rotazione di CERNIERA: piega l'osso di `angleDeg` attorno a un asse del
 * mondo, RELATIVAMENTE a come sta il segmento precedente.
 *
 * Serve per gomito e ginocchio. Se per questi usassimo una direzione assoluta
 * come per braccio e coscia, la rotazione del segmento padre si SOMMEREBBE
 * alla loro: il braccio scende di 90° dalla T-pose e l'avambraccio se li
 * riprende tutti, ripiegandosi all'indietro. Una cerniera invece dice solo
 * "piegati di tot rispetto a chi ti precede", che è come funziona un gomito.
 */
function hingeOffset(bone, axisWorld, angleDeg) {
  const boneWorldQ = bone.getWorldQuaternion(new THREE.Quaternion());
  const axisLocal = axisWorld
    .clone()
    .applyQuaternion(boneWorldQ.clone().invert())
    .normalize();
  return new THREE.Quaternion().setFromAxisAngle(axisLocal, angleDeg * DEG);
}

/** Traccia di cerniera: una lista di angoli di piega, in gradi. */
function hingeTrack(bm, role, times, anglesDeg, axisWorld) {
  const bone = bm.get(role);
  if (!bone) return null;

  const bind = bone.quaternion.clone();
  const values = [];

  for (const a of anglesDeg) {
    const q = bind.clone().multiply(hingeOffset(bone, axisWorld, a));
    values.push(q.x, q.y, q.z, q.w);
  }

  return new THREE.QuaternionKeyframeTrack(
    `${bone.name}.quaternion`,
    times,
    values,
  );
}

/** Costruisce la traccia di quaternioni di un osso da una lista di direzioni. */
function limbTrack(bm, role, times, dirs) {
  const bone = bm.get(role);
  const child = bm.get(LIMB_CHILD[role]);
  if (!bone || !child) return null;

  const bind = bone.quaternion.clone();
  const values = [];

  for (const dir of dirs) {
    const q = bind.clone().multiply(offsetToward(bone, child, dir));
    values.push(q.x, q.y, q.z, q.w);
  }

  return new THREE.QuaternionKeyframeTrack(
    `${bone.name}.quaternion`,
    times,
    values,
  );
}

/**
 * Traccia per busto e torace: inclinazione avanti/indietro e torsione, espresse
 * su assi del PERSONAGGIO invece che sugli assi locali dell'osso (che variano
 * da rig a rig e non sono ispezionabili a priori).
 * @param {number[]} leans - gradi; positivo = si inclina in avanti
 * @param {number[]} twists - gradi; positivo = ruota verso sinistra
 */
function torsoTrack(bm, role, times, leans, twists, basis) {
  const bone = bm.get(role);
  if (!bone) return null;

  const bind = bone.quaternion.clone();
  const values = [];

  for (let i = 0; i < times.length; i++) {
    // Ruotare attorno a "sinistra" di +θ porta indietro ⇒ per inclinarsi in
    // avanti serve il segno negativo.
    const q = bind
      .clone()
      .multiply(hingeOffset(bone, basis.left, -(leans[i] || 0)))
      .multiply(hingeOffset(bone, basis.up, twists[i] || 0));
    values.push(q.x, q.y, q.z, q.w);
  }

  return new THREE.QuaternionKeyframeTrack(
    `${bone.name}.quaternion`,
    times,
    values,
  );
}

/**
 * Saliscendi del bacino. Gli scostamenti sono FRAZIONI della lunghezza della
 * gamba, non valori assoluti: le ossa di un rig Mixamo hanno traslazioni
 * nell'ordine delle decine, quindi sommare "0.045" non produrrebbe alcun
 * movimento visibile.
 */
function hipsBob(bm, times, fractions) {
  const bone = bm.get("hips");
  if (!bone) return null;

  // Lunghezza della gamba nelle unità dello scheletro: la somma delle
  // traslazioni locali di stinco e piede rispetto ai rispettivi padri.
  const shin = bm.get("shinL") || bm.get("shinR");
  const foot = bm.get("footL") || bm.get("footR");
  const legLen =
    (shin ? shin.position.length() : 0) + (foot ? foot.position.length() : 0);
  const unit = legLen > 1e-6 ? legLen : 1;

  const p = bone.position;
  const values = [];
  for (const f of fractions) values.push(p.x, p.y + f * unit, p.z);

  return new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, values);
}

// ------------------------------------------------------------------- CLIP

function buildIdle(bm, basis) {
  // Respiro lento: tre secondi per ciclo, più calmo di un ritmo da due.
  const t = [0, 1.5, 3];
  const S = POSE.armSpread;

  const tracks = [
    // Braccia: non immobili. Un filo di apertura e un accenno di oscillazione
    // all'indietro rendono la posa viva senza farla sembrare un'animazione.
    limbTrack(bm, "upperArmL", t, [
      limbDir(basis, -1, S, "L"),
      limbDir(basis, -4, S + 2.5, "L"),
      limbDir(basis, -1, S, "L"),
    ]),
    limbTrack(bm, "upperArmR", t, [
      limbDir(basis, -1, S, "R"),
      limbDir(basis, -4, S + 2.5, "R"),
      limbDir(basis, -1, S, "R"),
    ]),

    // Gomiti appena piegati in avanti, con un respiro sopra.
    hingeTrack(bm, "foreArmL", t, [-14, -19, -14], basis.left),
    hingeTrack(bm, "foreArmR", t, [-14, -19, -14], basis.left),

    // Respiro: il torace si apre in avanti e torna.
    torsoTrack(bm, "chest", t, [0, 3, 0], [0, 0, 0], basis),

    // Il bacino si abbassa appena nell'espirazione.
    hipsBob(bm, t, [0, -0.012, 0]),
  ];

  return new THREE.AnimationClip("idle", 3, tracks.filter(Boolean));
}

/** Camminata e corsa hanno la stessa forma: cambiano ampiezze e durata. */
function buildGait(bm, basis, name, duration, cfg) {
  // Cinque istanti: il quinto ripete il primo perché il ciclo si chiuda.
  const t = [0, duration * 0.25, duration * 0.5, duration * 0.75, duration];
  const S = POSE.armSpread;

  // Fase 0: gamba SX avanti / braccio SX indietro. Fase 0.5: specularmente.
  const legPhase = [1, 0, -1, 0, 1];
  const armPhase = [-1, 0, 1, 0, -1];
  // Il ginocchio si piega nella fase di RITORNO, non mentre la gamba è avanti:
  // è ciò che distingue una camminata da due bastoni che oscillano.
  const kneeL = [0, 0.55, 1, 0.35, 0];
  const kneeR = [1, 0.35, 0, 0.55, 1];

  const dirs = (phases, swing, spread, side) =>
    phases.map((p) => limbDir(basis, swing * p, spread, side));

  const tracks = [
    limbTrack(bm, "thighL", t, dirs(legPhase, cfg.legSwing, 3, "L")),
    limbTrack(bm, "thighR", t, dirs(legPhase.map((p) => -p), cfg.legSwing, 3, "R")),

    // Ginocchia: si piegano ALL'INDIETRO rispetto alla coscia. Ruotare attorno
    // all'asse "sinistra" di +θ porta indietro, quindi il segno è positivo.
    hingeTrack(bm, "shinL", t, kneeL.map((k) => cfg.kneeBend * k), basis.left),
    hingeTrack(bm, "shinR", t, kneeR.map((k) => cfg.kneeBend * k), basis.left),

    limbTrack(bm, "upperArmL", t, dirs(armPhase, cfg.armSwing, S, "L")),
    limbTrack(bm, "upperArmR", t, dirs(armPhase.map((p) => -p), cfg.armSwing, S, "R")),

    // Gomiti: si piegano IN AVANTI (segno negativo), con un po' di gioco che
    // accompagna l'oscillazione del braccio.
    hingeTrack(bm, "foreArmL", t, armPhase.map((p) => -(18 + p * 10)), basis.left),
    hingeTrack(bm, "foreArmR", t, armPhase.map((p) => -(18 - p * 10)), basis.left),

    // Il busto ruota in opposizione al bacino e si inclina se si corre.
    // CAVIGLIE. Senza queste il piede resta rigido rispetto allo stinco e la
    // punta va a spasso mentre la gamba oscilla — sembra un piede attaccato
    // male. L'angolo qui annulla la rotazione accumulata da coscia e ginocchio,
    // così la pianta resta all'incirca parallela al terreno; il termine finale
    // aggiunge il rullìo tallone→punta di una camminata vera.
    hingeTrack(
      bm, "footL", t,
      legPhase.map((p, i) => cfg.legSwing * p - cfg.kneeBend * kneeL[i] + 6 * p),
      basis.left,
    ),
    hingeTrack(
      bm, "footR", t,
      legPhase.map((p, i) => -cfg.legSwing * p - cfg.kneeBend * kneeR[i] - 6 * p),
      basis.left,
    ),

    // Busto: inclinazione in avanti (in corsa) più una torsione che contrasta
    // il passo, come fa il tronco umano camminando.
    torsoTrack(
      bm, "spine", t,
      [cfg.lean, cfg.lean, cfg.lean, cfg.lean, cfg.lean],
      [-4, 0, 4, 0, -4],
      basis,
    ),

    // Il bacino sale e scende DUE volte per ciclo, una per ogni appoggio.
    hipsBob(bm, t, [0, cfg.bob, 0, cfg.bob, 0]),
  ];

  return new THREE.AnimationClip(name, duration, tracks.filter(Boolean));
}

function buildJump(bm, basis) {
  // Tre istanti: stacco, posa piena, tenuta. L'azione è LoopOnce con
  // clampWhenFinished (vedi AnimationController), quindi il TERZO fotogramma è
  // quello che si vede per quasi tutto il volo: deve essere la posa buona, non
  // un ritorno alla neutralità.
  const t = [0, 0.16, 0.42];
  const S = POSE.armSpread;
  const P = POSE;

  // Angolo della caviglia: è una cerniera RELATIVA allo stinco, quindi per
  // tenere la pianta in un'inclinazione sensata va scontato quanto hanno già
  // ruotato coscia e ginocchio (stessa contabilità della camminata).
  const ankle = (thigh, knee) => thigh - knee;

  const tracks = [
    // ---- GAMBE: sinistra raccolta davanti, destra distesa indietro --------
    limbTrack(bm, "thighL", t, [
      limbDir(basis, 0, 3, "L"),
      limbDir(basis, P.jumpFrontThigh, 6, "L"),
      limbDir(basis, P.jumpFrontThigh - 5, 6, "L"),
    ]),
    limbTrack(bm, "thighR", t, [
      limbDir(basis, 0, 3, "R"),
      limbDir(basis, P.jumpBackThigh, 4, "R"),
      limbDir(basis, P.jumpBackThigh + 3, 4, "R"),
    ]),
    hingeTrack(bm, "shinL", t, [0, P.jumpFrontKnee, P.jumpFrontKnee - 6], basis.left),
    hingeTrack(bm, "shinR", t, [0, P.jumpBackKnee, P.jumpBackKnee - 4], basis.left),

    // Punte in giù: è la rifinitura che fa leggere il salto come uno slancio
    // invece che come una caduta.
    hingeTrack(
      bm, "footL", t,
      [0, ankle(P.jumpFrontThigh, P.jumpFrontKnee), ankle(P.jumpFrontThigh - 5, P.jumpFrontKnee - 6)],
      basis.left,
    ),
    hingeTrack(
      bm, "footR", t,
      [0, ankle(P.jumpBackThigh, P.jumpBackKnee), ankle(P.jumpBackThigh + 3, P.jumpBackKnee - 4)],
      basis.left,
    ),

    // ---- BRACCIA: la destra al cielo, la sinistra piegata in basso --------
    // ATTENZIONE AL SEGNO DELL'APERTURA. In limbDir "spread positivo = verso
    // l'esterno" vale per un arto che punta in GIÙ; oltre l'orizzontale la
    // convenzione si ribalta e lo stesso segno porterebbe il braccio DENTRO la
    // testa (che su Mario è enorme: senza apertura la mano finisce sull'occhio).
    // Per questo il braccio alzato usa l'apertura cambiata di segno.
    limbTrack(bm, "upperArmR", t, [
      limbDir(basis, 0, S, "R"),
      limbDir(basis, P.jumpArmUp, -P.jumpArmUpSpread, "R"),
      limbDir(basis, P.jumpArmUp - 4, -(P.jumpArmUpSpread + 2), "R"),
    ]),
    limbTrack(bm, "upperArmL", t, [
      limbDir(basis, 0, S, "L"),
      limbDir(basis, P.jumpArmDown, P.jumpArmDownSpread, "L"),
      limbDir(basis, P.jumpArmDown + 3, P.jumpArmDownSpread, "L"),
    ]),

    // Gomiti: quello alzato quasi dritto, quello basso ripiegato in avanti
    // (segno negativo = in avanti, come nella camminata).
    hingeTrack(bm, "foreArmR", t, [-14, -P.jumpElbowUp, -P.jumpElbowUp], basis.left),
    hingeTrack(bm, "foreArmL", t, [-14, -P.jumpElbowDown, -P.jumpElbowDown + 5], basis.left),

    // ---- BUSTO: si allunga verso l'alto e si torce dalla parte del braccio -
    torsoTrack(
      bm, "spine", t,
      [0, P.jumpLean, P.jumpLean - 2],
      [0, P.jumpTwist, P.jumpTwist],
      basis,
    ),
  ];

  return new THREE.AnimationClip("jump", 0.42, tracks.filter(Boolean));
}

function buildFall(bm, basis) {
  const t = [0, 0.4, 0.8];
  const S = POSE.armSpread;
  const tracks = [
    limbTrack(bm, "thighL", t, [limbDir(basis, 16, 8, "L"), limbDir(basis, 8, 10, "L"), limbDir(basis, 16, 8, "L")]),
    limbTrack(bm, "thighR", t, [limbDir(basis, 8, 10, "R"), limbDir(basis, 16, 8, "R"), limbDir(basis, 8, 10, "R")]),
    hingeTrack(bm, "shinL", t, [32, 22, 32], basis.left),
    hingeTrack(bm, "shinR", t, [22, 32, 22], basis.left),
    // Braccia larghe che sbracciano piano.
    limbTrack(bm, "upperArmL", t, [limbDir(basis, 20, 70, "L"), limbDir(basis, 35, 80, "L"), limbDir(basis, 20, 70, "L")]),
    limbTrack(bm, "upperArmR", t, [limbDir(basis, 35, 80, "R"), limbDir(basis, 20, 70, "R"), limbDir(basis, 35, 80, "R")]),
    torsoTrack(bm, "spine", t, [-6, -2, -6], [0, 0, 0], basis),
  ];
  return new THREE.AnimationClip("fall", 0.8, tracks.filter(Boolean));
}

/**
 * CLIP DI CONTROLLO. Chiede a ogni arto di puntare esattamente dove già punta.
 * Se il pipeline (offset, tracce, mixer) è corretto questa clip NON deve
 * cambiare nulla: il modello resta identico alla sua posa di riposo.
 * Se invece si deforma, l'errore è a monte delle direzioni che scegliamo.
 */
function buildBind(bm) {
  const t = [0, 1];
  const tracks = [];

  for (const role of Object.keys(LIMB_CHILD)) {
    const bone = bm.get(role);
    const child = bm.get(LIMB_CHILD[role]);
    if (!bone || !child) continue;

    // Direzione MONDO attuale dell'arto, in posa di bind.
    const dir = child
      .getWorldPosition(new THREE.Vector3())
      .sub(bone.getWorldPosition(new THREE.Vector3()))
      .normalize();

    const tr = limbTrack(bm, role, t, [dir, dir]);
    if (tr) tracks.push(tr);
  }

  return new THREE.AnimationClip("bind", 1, tracks);
}

/**
 * @param {BoneMap} boneMap - il modello deve avere le matrici mondo aggiornate
 * @returns {Object<string, THREE.AnimationClip>}
 */
export function buildCharacterClips(boneMap) {
  const basis = characterBasis(boneMap);

  return {
    bind: buildBind(boneMap),
    idle: buildIdle(boneMap, basis),
    walk: buildGait(boneMap, basis, "walk", 1.0, {
      legSwing: POSE.walkLegSwing, armSwing: POSE.walkArmSwing,
      kneeBend: POSE.walkKneeBend, lean: 0, bob: POSE.walkHipsBob,
    }),
    run: buildGait(boneMap, basis, "run", 0.62, {
      legSwing: POSE.runLegSwing, armSwing: POSE.runArmSwing,
      kneeBend: POSE.runKneeBend, lean: POSE.runLean, bob: POSE.runHipsBob,
    }),
    jump: buildJump(boneMap, basis),
    fall: buildFall(boneMap, basis),
  };
}
