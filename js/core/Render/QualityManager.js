/**
 * QualityManager.js — tiene il gioco fluido su macchine diverse abbassando
 * (e rialzando) da solo la qualita' di rendering, invece di costringere a
 * tarare tutto sul portatile piu' lento in circolazione.
 *
 * PERCHE'. La stessa scena gira a 160 fps su un fisso e arranca su un
 * portatile: la differenza non e' la logica di gioco, e' quanti pixel e
 * quanti triangoli la GPU deve macinare per frame. Le tre voci che pesano
 * davvero, in ordine:
 *
 *   1. la RISOLUZIONE. Su uno schermo Retina devicePixelRatio vale 2, cioe'
 *      quattro volte i pixel di un 1x: e' il moltiplicatore piu' brutale di
 *      tutti e il piu' facile da ridurre.
 *   2. la SHADOW MAP, ridisegnata ogni frame da capo (2048x2048 di default).
 *   3. la distanza di vista del PRATO (vedi Decorations.setGrassViewDistance):
 *      ~45.000 ciuffi da 280 triangoli, di cui se ne disegnano solo quelli
 *      vicini e inquadrati.
 *
 * COME. Misura gli fps su finestre da un secondo. Due finestre di fila sotto
 * la soglia bassa e scende di un livello; diverse finestre di fila sopra
 * quella alta e risale. Le due soglie sono ben distanziate e il ritorno in
 * su e' molto piu' lento della discesa, cosi' non si innesca il ping-pong
 * tipico di questi sistemi (scendo, vado veloce, risalgo, rallento, ...).
 *
 * COSA NON TOCCA. Niente che cambi il comportamento del gioco: non la
 * fisica, non il passo temporale, non la telecamera, non il campo visivo.
 * Solo come la scena viene disegnata. E niente che costringa WebGL a
 * ricompilare gli shader (accendere/spegnere le ombre lo farebbe, con uno
 * scatto ben visibile): la mappa d'ombra cambia solo di dimensione, che e'
 * una semplice riallocazione del render target.
 */

// Dal piu' bello al piu' leggero. `pixelRatio` e' un TETTO: su uno schermo
// non-Retina (dpr 1) i primi livelli sono identici fra loro e il guadagno
// arriva tutto dagli altri due parametri.
const LEVELS = [
  { name: "alta", pixelRatio: 2.0, shadowMap: 2048, grass: 90 },
  { name: "media", pixelRatio: 1.5, shadowMap: 1536, grass: 80 },
  { name: "bassa", pixelRatio: 1.25, shadowMap: 1024, grass: 65 },
  { name: "minima", pixelRatio: 1.0, shadowMap: 768, grass: 50 },
];

// Sotto questa media si scende di livello, sopra l'altra si risale. Il vuoto
// in mezzo e' la fascia in cui non si tocca niente.
const FPS_LOW = 50;
const FPS_HIGH = 58;

// Quanto dura una finestra di misura, in secondi.
const WINDOW = 1.0;

// Finestre consecutive necessarie per muoversi: scendere e' rapido (un paio
// di secondi brutti bastano), risalire e' prudente.
const WINDOWS_TO_DROP = 2;
const WINDOWS_TO_RAISE = 6;

export default class QualityManager {
  /**
   * @param {object} rendererManager - vedi core/Render/Renderer.js: servono
   *   il WebGLRenderer e la luce direzionale che proietta le ombre.
   * @param {object} [opts]
   * @param {boolean} [opts.auto=true] - false per congelare il livello
   *   corrente (utile per confrontare a occhio due impostazioni).
   */
  constructor(rendererManager, opts = {}) {
    this.rendererManager = rendererManager;
    this.auto = opts.auto !== false;

    // Le decorazioni arrivano dopo il caricamento del livello: finche' non
    // ci sono, la distanza del prato viene semplicemente ricordata e
    // applicata appena setDecorations() la collega.
    this.decorations = null;

    this.level = 0;
    this.frames = 0;
    this.elapsed = 0;
    this.badWindows = 0;
    this.goodWindows = 0;

    this._apply();
  }

  // Chiamato da GameLevel/main una volta che il prato esiste.
  setDecorations(decorations) {
    this.decorations = decorations;
    this._apply();
  }

  /**
   * Un frame e' passato. Da chiamare sempre, anche a gioco in pausa o nei
   * menu (e' li' che si misura il costo di disegno "a riposo"), vedi
   * core/GameLoop.js.
   */
  sample(delta) {
    if (!this.auto || delta <= 0) return;

    this.frames++;
    this.elapsed += delta;
    if (this.elapsed < WINDOW) return;

    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;

    if (fps < FPS_LOW) {
      this.goodWindows = 0;
      this.badWindows++;
      if (this.badWindows >= WINDOWS_TO_DROP && this.level < LEVELS.length - 1) {
        this.badWindows = 0;
        this.setLevel(this.level + 1, fps);
      }
      return;
    }

    if (fps > FPS_HIGH) {
      this.badWindows = 0;
      this.goodWindows++;
      if (this.goodWindows >= WINDOWS_TO_RAISE && this.level > 0) {
        this.goodWindows = 0;
        this.setLevel(this.level - 1, fps);
      }
      return;
    }

    // Fascia intermedia: va bene cosi', nessuno dei due contatori avanza.
    this.badWindows = 0;
    this.goodWindows = 0;
  }

  // Passa a un livello preciso (0 = alta). Usabile anche a mano dalla
  // console, vedi il banner dei comandi in main.js.
  setLevel(level, measuredFps = null) {
    const next = Math.max(0, Math.min(LEVELS.length - 1, level));
    if (next === this.level) return;

    const from = LEVELS[this.level].name;
    this.level = next;
    this._apply();

    const why = measuredFps ? ` (misurati ${measuredFps.toFixed(0)} fps)` : "";
    console.log(
      `%c[qualita'] ${from} -> ${LEVELS[next].name}${why}`,
      "color:#fbd000;font-weight:bold",
    );
  }

  // Ferma/riattiva la regolazione automatica lasciando il livello com'e'.
  setAuto(auto) {
    this.auto = !!auto;
    this.badWindows = 0;
    this.goodWindows = 0;
  }

  get current() {
    return LEVELS[this.level];
  }

  _apply() {
    const cfg = LEVELS[this.level];
    const renderer = this.rendererManager?.renderer;

    if (renderer) {
      // Sempre un tetto, mai un aumento: su uno schermo 1x non ha senso
      // renderizzare a 2x per poi rimpicciolire.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pixelRatio));
    }

    const light = this.rendererManager?.dirLight;
    if (light && light.shadow) {
      light.shadow.mapSize.width = cfg.shadowMap;
      light.shadow.mapSize.height = cfg.shadowMap;

      // La mappa gia' allocata ha la vecchia dimensione: buttarla e' quello
      // che fa ricreare il render target alla misura nuova. Non comporta
      // ricompilazione di shader — quella la farebbe solo accendere o
      // spegnere le ombre del tutto.
      if (light.shadow.map) {
        light.shadow.map.dispose();
        light.shadow.map = null;
      }
    }

    if (this.decorations?.setGrassViewDistance) {
      this.decorations.setGrassViewDistance(cfg.grass);
    }
  }
}
