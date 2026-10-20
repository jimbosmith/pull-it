# Pull It — 2.5D Tabletop Cloth-Whip Game

**Pull It** is a short-session, portrait-first mobile & desktop browser physics game built with TypeScript and HTML5 Canvas. Players whip a tablecloth out from underneath tableware while dealing with **persistent spatial consequences**: every surviving object stays wherever it settles for the next pull.

---

## 1. Quick Start & Commands

The project is authored in modular TypeScript (`src/*.ts`) and includes both a **zero-dependency Node 22.6+/24 build & test pipeline** (using Node's native `module.stripTypeScriptTypes` and `node:test`) and standard **Vite/TypeScript** configuration. Pre-built ES modules are also emitted in `dist/*.js` so the game runs immediately offline without external asset downloads.

### Zero-Dependency Workflow (Recommended — No `npm install` or network needed)
From `d:\ANTIGRAVITY PROJECTS\pull-it`:

```powershell
# 1. Compile TypeScript (src/*.ts -> dist/*.js)
node scripts/build.mjs

# 2. Run automated validation tests (Node native TypeScript test runner)
node --test tests/validation.test.ts

# 3. Start local preview server at http://localhost:8080
node scripts/serve.mjs
```

*(If `node` is not on your global PATH on this machine, use `& "C:\Users\jimbo\AppData\Local\OpenAI\Codex\runtimes\cua_node\78fb63cda1a9e2b2\bin\node.exe"` or run `python -m http.server 8080` directly since `dist/*.js` is already built.)*

### Standard npm / Vite Workflow (Optional)
```powershell
npm install
npm run vite:dev      # Start Vite dev server
npm run vite:build    # Typecheck with tsc and bundle with Vite
npm run vite:preview  # Preview production bundle
npm test              # Run validation test suite
```

---

## 2. Controls & Game Loop

- **First-Run Instruction**: *"Swipe the cloth away. Keep everything standing."*
- **Cloth Handle**: Press and drag **only** from the marked cloth handle hanging below the front edge of the table (`▼ GRAB & SWIPE CLOTH ▼`). Touching HUD buttons or tabletop objects will not start a pull.
- **Swipe Cone**: Pull downward toward yourself within a `±35°` cone of straight down. A neutral direction arrow shows your intended pull angle while dragging without predicting success or failure.
- **Short-Tap Cancellation**: Accidental taps or strokes shorter than `13%` of the normalized play height cancel cleanly with a toast message instead of counting as failed attempts.
- **Persistent Consequences**:
  1. After the cloth exits, the game enters `'settling'` until all objects come to rest (or `maxSettleTimeSec` elapses).
  2. Surviving objects remain at their exact settled `(x, y)` coordinates and `yaw` orientations — objects are **never** silently recentered.
  3. One new object is spawned in a safe, non-overlapping position using a bounded placement search (`findSafeSpawnPlacement`).
  4. A fresh cloth visually threads underneath all objects without disturbing their positions.
  5. If no valid placement remains on the table, the run ends with a **"Table Full!"** completion screen and preserves the score.
- **Developer Panel**: Press `D` (or `` ` ``), click the **🛠 Dev** button in the top HUD, or open `?debug=1` / `?seed=20261019` to inspect live telemetry, toggle footprint/support/velocity overlays, adjust friction/stability/damping sliders, or replay a recorded swipe against a reset arrangement.

---

## 3. Code Architecture

| File | Responsibility |
| :--- | :--- |
| `src/types.ts` | Core TypeScript interfaces (`GameState`, `TableObject`, `ClothState`, `PointerSample`, `PullGestureCommand`, `SimulationConfig`). |
| `src/config.ts` | Centralized tuning constants with documented physical units (`m`, `m/s`, `m/s²`, `rad`, `kg`, `s`) and object archetype definitions (`glass`, `plate`, `egg`, `bowl`). |
| `src/rng.ts` | Deterministic `SeededRNG` (Mulberry32) used for initial offsets, object progression, and spawn candidate search. |
| `src/input.ts` | `analyzeGestureSamples()` — resamples variable-rate pointer events onto a uniform `4 ms` timeline before smoothing velocity, acceleration, and jerk for frame-rate invariance across 30/60/120 Hz. |
| `src/objects.ts` | Object instantiation, progression scheduling (`pickNextObjectType`), directional support radius math, and bounded non-overlapping placement search (`findSafeSpawnPlacement`). |
| `src/physics.ts` | Fixed-timestep (`120 Hz`) 2.5D tabletop simulation: partial cloth overlap quadrature, Stribeck whip friction, anisotropic rolling, tipping/restoring torque, object-specific edge overhang thresholds, and bounded collision impulses. |
| `src/renderer.ts` | Responsive 2.5D HTML5 Canvas renderer with wood grain table, stitched bistro cloth, depth-sorted objects with liquid/speckle/glaze details, and debug geometry overlay. |
| `src/devPanel.ts` | Live developer telemetry & tuning UI (`D` key / `?debug=1`) with deterministic swipe replay. |
| `src/persistence.ts` | `localStorage` wrapper for best score, mute, and reduced-motion preferences with automatic in-memory fallback. |
| `src/audio.ts` | Procedural Web Audio API sound synthesizer (fabric grab, speed-modulated cloth whoosh, material-aware collision clinks, success chords, failure thud/clatter) + optional haptics. |
| `src/game.ts` | Explicit state machine (`title`, `ready`, `gesture`, `pulling`, `settling`, `adding_object`, `paused`, `game_over`) and fixed-timestep accumulator loop. |
| `src/main.ts` | Browser DOM/Canvas wiring, pointer capture, multi-touch cancellation, and visibility-change auto-pause. |

---

## 4. Physics Approximations & Gameplay Compromises

This prototype uses a **custom 2.5D arcade rigid-body approximation** rather than a 3D finite-element deformable cloth solver:

1. **Retreating Planar Cloth with 9-Point Footprint Quadrature**:
   - The cloth is modeled as a translating planar surface with a retreating boundary. Each step, `computeClothFootprintOverlap()` evaluates 9 sample points across each object's oriented elliptical base (`footprintRadiusX`, `footprintRadiusY`) with a `12 mm` smooth edge band. This avoids an abrupt whole-table friction switch and smoothly transitions support from cloth to bare wood as the hem passes underneath.
2. **Stribeck-Inspired High-Speed Slip Reduction**:
   - Under pure Coulomb friction ($\mu = \text{const}$), even a fast pull transfers $\Delta v = \mu g \Delta t$, which still nudges light objects noticeably on short phone strokes. To make crisp whip pulls feel rewarding while keeping slow pulls punishing, effective cloth friction decreases smoothly by `highSpeedSlipReduction` (`68%`) once relative slip speed exceeds `characteristicWhipSpeed` (`2.35 m/s`).
3. **Jerk & Hem-Seam Excitation (Why Unlimited Speed Doesn't Guarantee Success)**:
   - To prevent players from winning every round by wildly flicking at maximum speed, `analyzeGestureSamples()` measures path curvature, acceleration sign reversals, and ultra-high-speed whip turbulence into `jerkMetric`. During cloth contact, `jerkMetric` and the passing trailing hem (`hemSeamImpulse`) inject a tipping torque proportional to `comHeight / supportRadius`. Consequently, a **smooth, straight, fast pull** leaves a tall glass nearly stationary, whereas a **crooked or erratic jerky flick** rocks tall objects dangerously.
4. **Nonlinear Restoring Torque & Irreversible Toppling**:
   - Tilt is tracked as a 2D lean vector `(tiltX, tiltY)` in radians. Restoring torque scales with $1 - (|\theta| / \theta_{\text{crit}})^2$. Inside $\theta_{\text{crit}}$, objects rock and damp back upright; once $|\theta| \ge \theta_{\text{crit}}$, restoring torque vanishes and gravity accelerates the object onto its side (`state = 'tipped'`).
5. **Object-Specific Edge Support**:
   - Edge fall checks project the object's tilted center of mass against the rounded-rectangle table boundary and allow overhang up to `directionalFootprintRadius * (1 - edgeSupportRadiusFactor)`. A wide plate (`r = 82 mm`) and a narrow glass (`r = 36 mm`) therefore have physically distinct edge tolerances.
