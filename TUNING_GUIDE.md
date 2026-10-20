# Pull It — Tuning Guide

All simulation and progression constants are centralized in [`src/config.ts`](file:///d:/ANTIGRAVITY%20PROJECTS/pull-it/src/config.ts) with explicit physical units (`m`, `m/s`, `m/s²`, `rad`, `kg`, `s`). You can also experiment with the four primary multipliers live in the **Developer Panel** (press `D` or open `?debug=1`).

---

## 1. Making the Game Easier (More Forgiving)

If early runs feel too punishing or objects slide/tip too easily:

1. **Reduce Cloth Drag**:
   - Lower `clothFrictionScale` in `DEFAULT_SIM_CONFIG` from `1.0` to `0.75–0.85` (or adjust the **Cloth Friction** slider in the Dev Panel). Objects will pick up less forward velocity during medium-speed pulls.
2. **Increase High-Speed Whip Forgiveness**:
   - Increase `highSpeedSlipReduction` from `0.68` to `0.78` and lower `characteristicWhipSpeed` from `2.35` to `1.90` m/s. Moderately fast swipes will break away cleanly with minimal object drift.
3. **Boost Object Tipping Stability**:
   - Increase `stabilityScale` from `1.0` to `1.25–1.40` and `dampingScale` from `1.0` to `1.25`. Tall objects (especially the `glass`) will recover from rocking much faster.
   - Or increase `OBJECT_ARCHETYPES.glass.criticalTiltRad` from `0.34` (~19.5°) to `0.40` (~23°).
4. **Reduce Hem & Jerk Sensitivity**:
   - Lower `hemSeamImpulse` from `0.075` to `0.04` and `jerkTorqueFactor` from `0.048` to `0.025`.

---

## 2. Making the Game Harder (Higher Skill Ceiling)

If players survive too long or slow/crooked pulls are not punished enough:

1. **Increase Cloth Coupling**:
   - Raise `clothFrictionScale` to `1.20–1.35` and `characteristicWhipSpeed` to `2.80` m/s so players must execute genuinely brisk swipes to avoid dragging items toward the front edge.
2. **Decrease Bare-Table Braking**:
   - Lower `woodFrictionScale` from `1.0` to `0.75`. Once objects start sliding off the cloth onto the wood, they will coast farther toward the table edge and collide more forcefully.
3. **Tighten Tipping & Jerk Thresholds**:
   - Lower `stabilityScale` to `0.80` and increase `jerkTorqueFactor` to `0.075`. Crooked or uneven swipes will readily topple the stemless glass.
4. **Accelerate Progression Hazard**:
   - In [`src/objects.ts`](file:///d:/ANTIGRAVITY%20PROJECTS/pull-it/src/objects.ts) (`pickNextObjectType`), introduce a second `glass` or `egg` on Round 2 instead of `bowl`.

---

## 3. Making the Simulation More Physically Convincing

To shift the balance from arcade accessibility toward stricter tabletop mechanics:

1. **Narrower Stribeck Drop**:
   - Set `highSpeedSlipReduction: 0.45` (instead of `0.68`). Even fast pulls will impart a small, consistent forward shift (`1.5–2.5 cm` per pull), forcing the player to manage cumulative forward creep across 4–6 pulls.
2. **Lower Tilt Damping for Longer Ringing**:
   - Set `dampingScale: 0.75` and `maxSettleTimeSec: 4.5`. Tall glasses and bowls will rock back and forth for several oscillations before settling.
3. **Stricter Edge Support**:
   - Increase `edgeSupportRadiusFactor` across archetypes by `+0.08` (e.g., `glass: 0.80`, `plate: 0.88`) so objects tip off the edge as soon as their center of mass approaches the rim bevel.

---

## 4. Object Archetype Reference (`src/config.ts`)

| Archetype | Footprint Radius (`m`) | Visual Radius (`m`) | Mass (`kg`) | COM Height (`m`) | Critical Tilt (`rad` / `deg`) | Key Gameplay Role |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Glass** (`glass`) | `0.036` | `0.041` | `0.24` | `0.086` | `0.34` (`19.5°`) | Tall, narrow, high COM; primary tipping hazard on jerky pulls. |
| **Plate** (`plate`) | `0.082` | `0.096` | `0.44` | `0.011` | `0.82` (`47.0°`) | Low, wide, heavy; resists tipping but consumes space and slides into neighbors. |
| **Egg** (`egg`) | `0.035 × 0.025` | `0.038 × 0.028` | `0.065` | `0.024` | `0.52` (`29.8°`) | Anisotropic ovoid (`anisotropicRollFactor: 0.76`); rolls readily along its minor axis. |
| **Bowl** (`bowl`) | `0.052` | `0.074` | `0.35` | `0.037` | `0.49` (`28.1°`) | Medium stability with a flared rim wider than its base support ring. |
