# Super Mario-Style 3D Platformer 🍄🌟

> **Interactive Graphics Course** · Sapienza University of Rome
> **Academic Year:** 2025/2026 · **Professor:** Marco Schaerf

A browser-playable, third-person 3D platformer built with **Three.js** and the **cannon-es** physics engine, inspired by the classic *Super Mario 3D* games.

The game features a fully explorable open island, a five-stage quest system, two boss encounters, a rideable companion (Yoshi), procedural skeletal animation, and a Mario-Galaxy-style spherical planet with custom gravity. It's a fully client-side single-page application — no server, no build step, just static files.

**[▶ Play the game](#-how-to-run)** · **[📄 Full technical report](docs/report.pdf)**

---

## Table of Contents

- [Key Features](#-key-features)
- [Controls](#-controls)
- [Architecture & Technologies](#%EF%B8%8F-architecture--technologies)
- [Project Structure](#-project-structure)
- [How to Run](#-how-to-run)
- [Credits](#-credits)
- [Authors](#-authors)

---

## ✨ Key Features

- **Open world exploration** — A fully explorable main island populated with coins, Power Stars, NPCs and dynamic decorations (trees, flowers, rocks), placed by a procedural scattering algorithm that respects buildings, hills and points of interest.
- **Mario Galaxy-style spherical gravity** — A walkable "sky planet" with a custom additive gravity field: the player falls toward and walks around its curved surface from any direction, with movement and camera orientation adapting automatically.
- **Procedural skeletal animation** — 100% procedural, rig-agnostic animation for every character (Mario, Luigi, Yoshi, Bowser). No animation clips were imported: idle, walk, run, jump and fall cycles are all synthesized at runtime from hand-authored pose parameters.
- **Rigid-body physics** — Full physics simulation powered by `cannon-es`, including collision filtering, contact materials and the custom planetary gravity layered on top.
- **Advanced graphics & shaders** — A hand-written GLSL skybox shader with luminance-based cloud contrast, procedurally generated tileable arena textures (Python/PIL), and dynamic lighting with a tight, high-resolution shadow map that follows the player.
- **Boss fights & obstacle courses** — Two distinct boss encounters (Kamek and Bowser), each with its own hazard-filled arena, a wind-up ranged attack, and a live health bar.
- **Rideable companion (Yoshi)** — Find and hatch Yoshi's egg, mount him for a boosted jump, and reach otherwise unreachable collectibles.
- **Dynamic HUD & quest system** — A five-phase objective panel guides the player through the game's content, alongside contextual "Press E" prompts, dialogue bubbles, and a live boss health bar.
- **Adaptive audio** — Independent music/SFX volume channels, a mute toggle, contextual sound-effect voices (e.g. while riding Yoshi), and music that switches automatically between the overworld and each boss zone.

---

## 🎮 Controls

| Input | Action |
| :--- | :--- |
| **W / A / S / D** | Move (forward / left / back / right) |
| **Shift** | Sprint |
| **Space** | Jump |
| **I / J / K / L** | Free camera orbit (pitch/yaw) — disabled on the sky planet |
| **E** | Interact: talk to an NPC, mount/dismount Yoshi, advance dialogue |
| **Esc** / Pause button | Pause menu (volume sliders, mute, controls reference, restart) |
| **F3** | Toggle physics collider wireframe overlay (debug mode) |

---

## 🛠️ Architecture & Technologies

- **Rendering engine:** [Three.js (r160)](https://threejs.org/)
- **Physics engine:** [cannon-es (v0.20.0)](https://pmndrs.github.io/cannon-es/)
- **Data-driven levels:** the main island and both boss arenas are defined as JSON files (`level1.json`, `kamek_zone.json`, `bowser_zone.json`) parsed by a custom `LevelLoader`
- **Deployment:** fully static, client-side only — no backend, no bundler, optimized for GitHub Pages

For the full breakdown of the animation pipeline, the gravity/physics system, lighting and shaders, and every implemented interaction, see the [technical report](docs/report.pdf) (also available as [LaTeX source](docs/report.tex)).

## 📁 Project Structure

```
final-project-fedezteam/
├── index.html              # Entry point
├── CSS/                    # UI/HUD styling
├── js/
│   ├── core/                # Renderer, camera, input, audio, asset loading
│   ├── physics/              # cannon-es setup + planetary gravity fields
│   ├── entities/              # Player, Yoshi, enemies/bosses, level & buildings
│   │   ├── animation/           # Procedural rig-agnostic animation system
│   │   └── Level/                # Level loading, decorations, collectibles
│   ├── interactions/         # Quest manager, NPC interactions, dialogue
│   └── ui/                   # HUD and menu management
├── assets/                 # Models, textures and levels (JSON)
└── docs/                   # Technical report (PDF + LaTeX source)
```

## 🚀 How to Run

The project uses ES modules, so it must be served over HTTP(S) rather than opened as a local `file://` page.

1. Clone this repository:
   ```bash
   git clone https://github.com/SapienzaInteractiveGraphicsCourse/final-project-fedezteam.git
   cd final-project-fedezteam
   ```
2. Start any static local server, for example:
   ```bash
   python3 -m http.server
   ```
3. Open your browser at `http://localhost:8000`.

Alternatively, play it directly via **[GitHub Pages](https://sapienzainteractivegraphicscourse.github.io/final-project-fedezteam/)** — no setup required.

## 🙏 Credits

Built on [Three.js](https://threejs.org/) and [cannon-es](https://pmndrs.github.io/cannon-es/). Character and prop 3D models were sourced from public asset repositories and are not original team work; all game logic, physics tuning, procedural animation, shaders, level design and UI were developed by the team. See the [technical report](docs/report.pdf) for the full list of third-party assets and libraries.

## 👤 Authors

- **Alessandro Brighenti**
- **Lorenzo Francescotti**
