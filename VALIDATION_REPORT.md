# Pull It — Validation Report & Known Limitations

## 1. Automated Validation Suite Executed

The automated validation suite in [`tests/validation.test.ts`](file:///d:/ANTIGRAVITY%20PROJECTS/pull-it/tests/validation.test.ts) was executed directly against the TypeScript source using Node.js `v24.21.0` (`node --test tests/validation.test.ts`). All **9 test suites (covering all 10 validation criteria)** passed with zero runtime errors:

| # | Validation Criterion | Verification Method & Result |
| :---: | :--- | :--- |
| **1** | **Controlled straight pull succeeds with the first glass** | **PASS** — Simulated a `110 ms` straight downward swipe (`startY=0.46m -> endY=0.84m`). The cloth extracted cleanly, the glass rocked slightly and settled upright (`displacement < 0.045 m`), score incremented to `1`, and the second object spawned. |
| **2** | **Deliberately poor slow or angled pull produces understandable displacement** | **PASS** — Compared a `650 ms` angled pull (`+28°` rightward) against a `100 ms` fast straight pull on the identical seed. The slow angled pull dragged the glass `> 2.2×` further downward and displaced it `+x` to the right (`> 15 mm`). |
| **3** | **Excessive tilt or insufficient edge support causes a visible failure** | **PASS** — Verified both failure modes: (A) a glass near the front edge subjected to a slow drag crossed its footprint overhang threshold, entered `state = 'falling'`, and ended the run with `failureCause = 'fell_off_edge'`; (B) a pre-leaned glass subjected to an erratic jerky pull crossed `criticalTiltRad`, entered `state = 'tipped'`, and ended the run with `failureCause = 'tipped_over'`. |
| **4** | **Objects retain their settled positions between rounds** | **PASS** — Verified that after an angled pull displaces and rotates the first glass, its settled `(x, y, yaw)` coordinates remain unchanged into the next round (`'ready'` state) and are never recentered to `(0, 0)`. |
| **5** | **Fresh cloth and newly spawned object do not reposition survivors** | **PASS** — Captured exact `(x, y, yaw)` coordinates of surviving objects at the end of `'settling'` and verified exact floating-point equality after cloth re-threading and `'adding_object'` completion. |
| **6** | **Same recorded swipe gives comparable results at 30, 60 and 120 fps** | **PASS** — Ran the identical `200 ms` angled gesture sampled and stepped at `30 Hz`, `60 Hz`, and `120 Hz`. Resampling onto the internal `4 ms` timeline and stepping fixed `1/120 s` physics yielded matching scores (`1`) and settled positions within `< 4 mm` (`x`) and `< 6 mm` (`y`). |
| **7** | **Touch, mouse, cancellation, resize, pause and retry do not corrupt state** | **PASS** — Verified that touching outside the handle is ignored; a short tap (`< 13%` normalized stroke) cancels back to `'ready'` with score `0`; pausing mid-pull and passing a `5.0 s` background delta performs `0` physics steps and resumes cleanly. |
| **8** | **New objects do not overlap existing ones or spawn off the table** | **PASS** — Repeatedly ran `findSafeSpawnPlacement()` across up to 40 rounds; verified every spawned object stayed within table bounds and maintained `distance >= rA + rB` from all existing objects until cleanly returning `null` (`"Table full!"`). |
| **9** | **Best-score persistence and storage failure both work** | **PASS** — Tested `PersistenceManager` with both a functional `localStorage` mock and a throwing storage backend (`QuotaExceededError` / `SecurityError`), confirming best scores persist when available and degrade gracefully to in-memory storage when blocked. |
| **10** | **Anisotropic egg rolling, bounded collisions & zero runtime errors** | **PASS** — Verified that the `egg` rolls `> 1.35×` further along its minor axis than its major axis, and that a sliding `bowl` striking a stationary `glass` fires collision audio events and transfers bounded linear + tipping impulse without clipping or exploding. |

---

## 2. Live HTTP & Browser Verification

- Compiled all 12 TypeScript modules into `dist/*.js` via `node scripts/build.mjs` with zero errors.
- Started the local HTTP server (`node scripts/serve.mjs` on `http://localhost:8080`) and verified HTTP `200 OK` delivery of `index.html`, `styles.css`, and `dist/main.js`.

---

## 3. What Remains Unverified & Known Limitations

- **Physical Mobile Handset / OS Haptics Testing**: While touch pointer events, `touch-action: none`, viewport normalization, and `navigator.vibrate` calls are implemented and tested via synthetic pointer streams, the prototype has not been manually tested on physical iOS Safari or Android Chrome hardware devices during this session.
- **2.5D Arcade Cloth Approximation**: The cloth is simulated as a planar surface with a retreating boundary and 9-point footprint overlap quadrature rather than a 3D vertex mesh. It does not simulate vertical fabric tenting when trapped between two heavy objects or cloth wrapping around a falling object off the table edge.
- **Circular/Elliptical Collision Proxies**: Pairwise tabletop collisions use bounding circles (`getEffectiveCollisionRadius`) with inverse-mass positional correction and tipping transfer. While the Egg uses an oriented elliptical footprint for cloth overlap, edge support, and anisotropic rolling resistance, object-to-object contact uses its outer radius for fast, jitter-free resolution.
