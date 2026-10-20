import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SEED, DEFAULT_SIM_CONFIG } from '../src/config.ts';
import { PullItSimulationCore } from '../src/game.ts';
import { analyzeGestureSamples, createSyntheticGestureSamples } from '../src/input.ts';
import {
  createTableObject,
  findSafeSpawnPlacement,
  getEffectiveCollisionRadius
} from '../src/objects.ts';
import { PersistenceManager } from '../src/persistence.ts';
import { SeededRNG } from '../src/rng.ts';

/**
 * Helper to advance the simulation core until it returns to 'ready' or enters 'game_over'.
 */
function runUntilRoundResolved(core: PullItSimulationCore, fps: number = 60, maxSeconds: number = 6): void {
  const frameDt = 1 / fps;
  const maxFrames = Math.ceil(maxSeconds * fps);
  for (let f = 0; f < maxFrames; f++) {
    core.updateFrame(frameDt);
    if (core.state === 'ready' || core.state === 'game_over') {
      break;
    }
  }
}

test('1. A controlled straight pull succeeds with the first glass', () => {
  const core = new PullItSimulationCore(DEFAULT_SEED);
  core.startNewRun(DEFAULT_SEED);

  assert.equal(core.state, 'ready');
  assert.equal(core.objects.length, 1);
  assert.equal(core.objects[0].type, 'glass');

  const initialX = core.objects[0].x;
  const initialY = core.objects[0].y;

  // Fast, straight, controlled downward swipe (110ms across handle area)
  const samples = createSyntheticGestureSamples({
    startX: 0,
    startY: 0.46,
    endX: 0,
    endY: 0.84,
    durationMs: 110,
    sampleRateHz: 60
  });

  const analysis = analyzeGestureSamples(samples, core.config);
  assert.equal(analysis.valid, true);
  assert.ok(analysis.command);

  core.executePullCommand(analysis.command);
  assert.equal(core.state, 'pulling');

  runUntilRoundResolved(core, 60);

  assert.equal(core.state, 'ready', 'Game should return to ready after successful pull & spawn');
  assert.equal(core.score, 1, 'Score should increment to 1');
  assert.equal(core.objects.length, 2, 'A second object should have been spawned');

  // Verify the glass stayed nearly stationary on a clean fast whip (< 4cm displacement)
  const glassAfter = core.objects[0];
  const disp = Math.hypot(glassAfter.x - initialX, glassAfter.y - initialY);
  assert.ok(disp < 0.045, `Expected small displacement on fast whip, got ${disp.toFixed(4)}m`);
  assert.equal(glassAfter.state, 'upright');
});

test('2. A deliberately poor slow or angled pull produces understandable displacement', () => {
  const coreFast = new PullItSimulationCore(DEFAULT_SEED);
  coreFast.startNewRun(DEFAULT_SEED);
  const startY = coreFast.objects[0].y;
  const startX = coreFast.objects[0].x;

  // Fast straight pull
  const fastCmd = analyzeGestureSamples(
    createSyntheticGestureSamples({ startX: 0, startY: 0.46, endX: 0, endY: 0.84, durationMs: 100 }),
    coreFast.config
  ).command!;
  coreFast.executePullCommand(fastCmd);
  runUntilRoundResolved(coreFast, 60);
  const fastDy = coreFast.objects[0].y - startY;

  // Deliberately slow, angled pull (650ms duration, angled +28 deg to the right)
  const coreSlowAngled = new PullItSimulationCore(DEFAULT_SEED);
  coreSlowAngled.startNewRun(DEFAULT_SEED);
  const slowAngledCmd = analyzeGestureSamples(
    createSyntheticGestureSamples({
      startX: 0,
      startY: 0.46,
      endX: 0.20,
      endY: 0.78,
      durationMs: 650
    }),
    coreSlowAngled.config
  ).command!;

  assert.ok(slowAngledCmd.angleDeg > 15, 'Should have positive rightward pull angle');
  assert.ok(
    slowAngledCmd.extractionSpeedMps < fastCmd.extractionSpeedMps,
    'Slow pull should have lower extraction speed'
  );

  coreSlowAngled.executePullCommand(slowAngledCmd);
  runUntilRoundResolved(coreSlowAngled, 60);

  const slowGlass = coreSlowAngled.objects[0];
  const slowDy = slowGlass.y - startY;
  const slowDx = slowGlass.x - startX;

  assert.ok(
    slowDy > fastDy * 2.2,
    `Slow pull should drag object further down (${slowDy.toFixed(4)}m vs ${fastDy.toFixed(4)}m)`
  );
  assert.ok(
    slowDx > 0.015,
    `Rightward angled pull should displace object to the right (+x), got dx=${slowDx.toFixed(4)}m`
  );
});

test('3. Excessive tilt or insufficient edge support causes a visible failure', () => {
  // Case A: Insufficient edge support -> falls off table edge
  const coreEdge = new PullItSimulationCore(DEFAULT_SEED);
  coreEdge.startNewRun(DEFAULT_SEED);
  // Place glass near the bottom front edge of the table
  coreEdge.objects[0].x = 0;
  coreEdge.objects[0].y = coreEdge.config.tableHalfLength - 0.035;

  const slowDrag = analyzeGestureSamples(
    createSyntheticGestureSamples({ startX: 0, startY: 0.46, endX: 0, endY: 0.78, durationMs: 750 }),
    coreEdge.config
  ).command!;

  coreEdge.executePullCommand(slowDrag);
  runUntilRoundResolved(coreEdge, 60);

  assert.equal(coreEdge.state, 'game_over');
  assert.equal(coreEdge.failureCause, 'fell_off_edge');
  assert.equal(coreEdge.objects[0].state, 'falling');
  assert.ok(coreEdge.failureReasonText.includes('fell off'));

  // Case B: Excessive tilt beyond critical angle -> tips over irreversibly
  const coreTilt = new PullItSimulationCore(DEFAULT_SEED);
  coreTilt.startNewRun(DEFAULT_SEED);
  // Pre-lean the glass near its critical angle as if damaged from a prior round
  coreTilt.objects[0].tiltY = coreTilt.objects[0].criticalTiltRad * 0.88;

  const jerkyPull = analyzeGestureSamples(
    createSyntheticGestureSamples({
      startX: 0,
      startY: 0.46,
      endX: 0.14,
      endY: 0.78,
      durationMs: 320,
      stutter: true,
      wobbleAmplitudeX: 0.05
    }),
    coreTilt.config
  ).command!;

  coreTilt.executePullCommand(jerkyPull);
  runUntilRoundResolved(coreTilt, 60);

  assert.equal(coreTilt.state, 'game_over');
  assert.equal(coreTilt.failureCause, 'tipped_over');
  assert.equal(coreTilt.objects[0].state, 'tipped');
  assert.ok(coreTilt.failureReasonText.includes('tipped over'));
});

test('4 & 5. Objects retain their settled positions between rounds; fresh cloth and new spawn do not reposition survivors', () => {
  const core = new PullItSimulationCore(DEFAULT_SEED);
  core.startNewRun(DEFAULT_SEED);

  // Displace the glass deliberately with a moderate angled pull that still survives
  const moderateAngled = analyzeGestureSamples(
    createSyntheticGestureSamples({
      startX: 0,
      startY: 0.46,
      endX: -0.14,
      endY: 0.82,
      durationMs: 240
    }),
    core.config
  ).command!;

  core.executePullCommand(moderateAngled);

  // Step until the moment 'settling' transitions to 'adding_object'
  let settledGlassX = 0;
  let settledGlassY = 0;
  let settledGlassYaw = 0;
  let capturedAtSettle = false;

  for (let step = 0; step < 600; step++) {
    core.stepFixed(core.config.fixedDt);
    if (core.state === 'adding_object' && !capturedAtSettle) {
      settledGlassX = core.objects[0].x;
      settledGlassY = core.objects[0].y;
      settledGlassYaw = core.objects[0].yaw;
      capturedAtSettle = true;
    }
    if (core.state === 'ready') break;
  }

  assert.equal(capturedAtSettle, true, 'Should have transitioned through adding_object');
  assert.equal(core.state, 'ready');
  assert.equal(core.objects.length, 2);

  // Verify the glass was NOT recentered to (0,0) and was NOT moved by cloth re-threading or new object spawn
  assert.ok(Math.abs(settledGlassX) > 0.005 || Math.abs(settledGlassY) > 0.01);
  assert.equal(core.objects[0].x, settledGlassX);
  assert.equal(core.objects[0].y, settledGlassY);
  assert.equal(core.objects[0].yaw, settledGlassYaw);
  assert.equal(core.cloth.present, true);
});

test('6. The same recorded swipe gives comparable results with 30, 60 and 120 fps rendering', () => {
  const runAtFps = (fps: number) => {
    const core = new PullItSimulationCore(424242);
    core.startNewRun(424242);

    // Record gesture sampled at the target frame rate
    const samples = createSyntheticGestureSamples({
      startX: 0,
      startY: 0.46,
      endX: 0.10,
      endY: 0.82,
      durationMs: 200,
      sampleRateHz: fps
    });
    const cmd = analyzeGestureSamples(samples, core.config).command!;
    core.executePullCommand(cmd);
    runUntilRoundResolved(core, fps);

    return {
      score: core.score,
      glassX: core.objects[0].x,
      glassY: core.objects[0].y,
      speedMps: cmd.extractionSpeedMps,
      angleDeg: cmd.angleDeg
    };
  };

  const res30 = runAtFps(30);
  const res60 = runAtFps(60);
  const res120 = runAtFps(120);

  assert.equal(res30.score, 1);
  assert.equal(res60.score, 1);
  assert.equal(res120.score, 1);

  // Extracted gesture speeds and final object positions should match closely across 30/60/120 Hz
  assert.ok(Math.abs(res30.speedMps - res120.speedMps) < 0.15);
  assert.ok(Math.abs(res60.speedMps - res120.speedMps) < 0.08);
  assert.ok(Math.abs(res30.glassX - res120.glassX) < 0.004);
  assert.ok(Math.abs(res30.glassY - res120.glassY) < 0.006);
  assert.ok(Math.abs(res60.glassY - res120.glassY) < 0.003);
});

test('7. Touch, mouse, short-tap cancellation, pause/resume, and retry preserve valid state', () => {
  const core = new PullItSimulationCore(DEFAULT_SEED);
  core.startNewRun(DEFAULT_SEED);

  // Touching outside the handle must not start a gesture
  const startedOutside = core.beginHandleGesture(
    1,
    { worldX: 0, worldY: 0, screenX: 200, screenY: 200, timeMs: 0 },
    false
  );
  assert.equal(startedOutside, false);
  assert.equal(core.state, 'ready');

  // Short accidental tap on handle cancels cleanly without failing or scoring
  const startedInside = core.beginHandleGesture(
    1,
    { worldX: 0, worldY: 0.46, screenX: 200, screenY: 500, timeMs: 10 },
    true
  );
  assert.equal(startedInside, true);
  assert.equal(core.state, 'gesture');

  core.moveHandleGesture(1, {
    worldX: 0.002,
    worldY: 0.47,
    screenX: 201,
    screenY: 504,
    timeMs: 35
  });
  const outcome = core.endHandleGesture(1, {
    worldX: 0.002,
    worldY: 0.472,
    screenX: 201,
    screenY: 505,
    timeMs: 45
  });

  assert.equal(outcome.startedPull, false);
  assert.equal(core.state, 'ready', 'Short tap should cancel back to ready, not fail');
  assert.equal(core.score, 0);

  // Pause & resume during active pull discards excess frame delta
  const validSamples = createSyntheticGestureSamples({
    startX: 0,
    startY: 0.46,
    endX: 0,
    endY: 0.84,
    durationMs: 110
  });
  const cmd = analyzeGestureSamples(validSamples, core.config).command!;
  core.executePullCommand(cmd);
  assert.equal(core.state, 'pulling');

  core.pause();
  assert.equal(core.state, 'paused');
  // Updating with a huge 5-second background tab delta while paused should do 0 steps
  const pausedUpdate = core.updateFrame(5.0);
  assert.equal(pausedUpdate.stepsRun, 0);

  core.resume();
  assert.equal(core.state, 'pulling');
  runUntilRoundResolved(core, 60);
  assert.equal(core.state, 'ready');
  assert.equal(core.score, 1);
});

test('8. New objects never overlap existing ones or spawn off the table, and Table Full is detected cleanly', () => {
  const rng = new SeededRNG(999);
  const config = { ...DEFAULT_SIM_CONFIG };
  const placed = [createTableObject('glass', 0, 0, 0)];

  let tableFullReached = false;
  for (let round = 1; round <= 40; round++) {
    const type = round % 2 === 0 ? 'plate' : 'bowl';
    const pos = findSafeSpawnPlacement(type, placed, config, rng, round);
    if (!pos) {
      tableFullReached = true;
      break;
    }
    const candidate = createTableObject(type, pos.x, pos.y, pos.yaw);
    const candR = getEffectiveCollisionRadius(candidate);

    // Check within table boundaries
    assert.ok(Math.abs(candidate.x) + candR <= config.tableHalfWidth);
    assert.ok(Math.abs(candidate.y) + candR <= config.tableHalfLength);

    // Check zero overlap with all existing objects
    for (const existing of placed) {
      const dist = Math.hypot(candidate.x - existing.x, candidate.y - existing.y);
      const minAllowed = candR + getEffectiveCollisionRadius(existing);
      assert.ok(
        dist >= minAllowed,
        `Spawned object #${candidate.id} overlapped existing object #${existing.id}`
      );
    }

    placed.push(candidate);
  }

  assert.equal(
    tableFullReached,
    true,
    'Bounded placement search should cleanly detect when the table is full'
  );
  assert.ok(placed.length >= 5, `Expected at least 5 objects before table full, got ${placed.length}`);
});

test('9. Best-score persistence and storage failure fallback both work', () => {
  // Case A: Working storage backend
  const storeMap = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => storeMap.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storeMap.set(k, v);
    }
  };

  const pm1 = new PersistenceManager(mockStorage);
  assert.equal(pm1.isStorageAvailable(), true);
  assert.equal(pm1.getBestScore(), 0);
  pm1.recordScore(7);
  assert.equal(pm1.getBestScore(), 7);

  // Reload from same storage
  const pm2 = new PersistenceManager(mockStorage);
  assert.equal(pm2.getBestScore(), 7);

  // Case B: Storage throws SecurityError / QuotaExceededError
  const brokenStorage = {
    getItem: () => {
      throw new Error('Storage disabled');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    }
  };

  const pmBroken = new PersistenceManager(brokenStorage);
  assert.equal(pmBroken.isStorageAvailable(), false);
  assert.equal(pmBroken.getBestScore(), 0);
  // In-memory fallback still tracks best score during session without throwing
  pmBroken.recordScore(4);
  assert.equal(pmBroken.getBestScore(), 4);
});

test('10. Egg exhibits direction-dependent rolling and object collisions transfer bounded impulse', () => {
  // Verify anisotropic rolling of the Egg
  const coreMajor = new PullItSimulationCore(DEFAULT_SEED);
  coreMajor.startNewRun(DEFAULT_SEED);
  const eggMajor = createTableObject('egg', 0, 0, Math.PI * 0.5); // Major axis aligned with +Y pull
  eggMajor.vy = 0.45;
  coreMajor.objects = [eggMajor];
  coreMajor.cloth.present = false;
  coreMajor.state = 'settling';
  for (let i = 0; i < 40; i++) coreMajor.stepFixed();

  const coreMinor = new PullItSimulationCore(DEFAULT_SEED);
  coreMinor.startNewRun(DEFAULT_SEED);
  const eggMinor = createTableObject('egg', 0, 0, 0); // Minor (roll) axis aligned with +Y pull
  eggMinor.vy = 0.45;
  coreMinor.objects = [eggMinor];
  coreMinor.cloth.present = false;
  coreMinor.state = 'settling';
  for (let i = 0; i < 40; i++) coreMinor.stepFixed();

  assert.ok(
    eggMinor.y > eggMajor.y * 1.35,
    `Egg should roll noticeably further perpendicular to its long axis (${eggMinor.y.toFixed(4)}m vs ${eggMajor.y.toFixed(4)}m)`
  );

  // Verify bounded collision between a sliding bowl and a stationary glass
  const coreCol = new PullItSimulationCore(DEFAULT_SEED);
  coreCol.startNewRun(DEFAULT_SEED);
  const bowl = createTableObject('bowl', 0, -0.12, 0);
  bowl.vy = 0.9;
  const glass = createTableObject('glass', 0, 0, 0);
  coreCol.objects = [bowl, glass];
  coreCol.cloth.present = false;

  let collisionCount = 0;
  const coreWithCallback = new PullItSimulationCore(DEFAULT_SEED, 0, {
    onCollision: () => {
      collisionCount++;
    }
  });
  coreWithCallback.objects = [bowl, glass];
  coreWithCallback.cloth.present = false;
  coreWithCallback.state = 'settling';

  for (let i = 0; i < 30; i++) coreWithCallback.stepFixed();

  assert.ok(collisionCount >= 1, 'Collision callback should fire when bowl strikes glass');
  assert.ok(glass.y > 0.01, 'Glass should be pushed forward by colliding bowl');
  assert.ok(Math.hypot(glass.tiltX, glass.tiltY) > 0.05, 'Collision should impart tipping motion to glass');
});

test('11. Full PullItApp UI integration: instantiation, Start Run click, and Canvas rendering succeed without errors', async () => {
  const elements = new Map<string, Record<string, unknown>>();
  const listeners = new Map<string, Map<string, Array<(e?: unknown) => void>>>();

  const makeEl = (id: string) => {
    const elListeners = new Map<string, Array<(e?: unknown) => void>>();
    listeners.set(id, elListeners);
    let drawCalls = 0;
    const mockCtx = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'measureText') return () => ({ width: 50 });
          if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
            return () => ({ addColorStop: () => {} });
          }
          return () => {
            drawCalls++;
          };
        }
      }
    );

    const el: Record<string, unknown> = {
      id,
      hidden: id === 'modal-pause' || id === 'modal-gameover' || id === 'dev-panel' || id === 'status-toast' || id === 'praise-badge',
      textContent: '',
      innerHTML: '',
      value: '20261019',
      checked: false,
      disabled: false,
      width: 390,
      height: 780,
      classList: { add: () => {}, remove: () => {} },
      setAttribute: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 700 }),
      getContext: () => mockCtx,
      getDrawCalls: () => drawCalls,
      querySelector: (sel: string) => {
        const subId = sel.replace('#', '');
        if (!elements.has(subId)) elements.set(subId, makeEl(subId));
        return elements.get(subId);
      },
      addEventListener: (type: string, fn: (e?: unknown) => void) => {
        const arr = elListeners.get(type) ?? [];
        arr.push(fn);
        elListeners.set(type, arr);
      },
      click: () => {
        for (const fn of elListeners.get('click') ?? []) fn({});
      }
    };
    return el;
  };

  const g = globalThis as Record<string, unknown>;
  g.window = {
    location: { search: '' },
    innerWidth: 390,
    innerHeight: 780,
    devicePixelRatio: 1,
    addEventListener: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {}
  };
  g.document = {
    readyState: 'complete',
    hidden: false,
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, makeEl(id));
      return elements.get(id);
    },
    addEventListener: () => {}
  };
  g.performance = { now: () => 100 };
  g.requestAnimationFrame = () => 1;

  const { PullItApp } = await import('../src/main.ts');
  const app = new PullItApp();
  assert.ok(app);

  const titleModal = elements.get('modal-title')!;
  const startBtn = elements.get('btn-start')!;
  assert.equal(titleModal.hidden, false, 'Title modal should be visible initially');

  // Click "Start Run" button
  (startBtn.click as () => void)();
  assert.equal(titleModal.hidden, true, 'Title modal must hide immediately when Start Run is clicked');
});

test('12. Tactical skill requirement: mindless 0-deg straight pull on Round 2 causes collision failure, while aimed angled pull succeeds', () => {
  const runRound2WithEndX = (endX: number) => {
    const core = new PullItSimulationCore(DEFAULT_SEED);
    core.startNewRun(DEFAULT_SEED);

    // Round 1: Clean straight pull succeeds
    const cmd1 = analyzeGestureSamples(
      createSyntheticGestureSamples({ startX: 0, startY: 0.46, endX: 0, endY: 0.84, durationMs: 110 }),
      core.config
    ).command!;
    core.executePullCommand(cmd1);
    runUntilRoundResolved(core, 60);
    assert.equal(core.score, 1);

    // Round 2: Bowl has spawned upstream-left of the Glass
    const cmd2 = analyzeGestureSamples(
      createSyntheticGestureSamples({ startX: 0, startY: 0.46, endX, endY: 0.84, durationMs: 140 }),
      core.config
    ).command!;
    core.executePullCommand(cmd2);
    runUntilRoundResolved(core, 60);
    return core;
  };

  // Mindless 0-deg straight pull causes Bowl to clip Glass and knock it over
  const straightCore = runRound2WithEndX(0);
  assert.equal(straightCore.state, 'game_over');
  assert.equal(straightCore.failureCause, 'tipped_over');

  // Aimed leftward angled pull (-0.22m -> ~-30 deg) steers Bowl cleanly past the Glass
  const aimedCore = runRound2WithEndX(-0.22);
  assert.equal(aimedCore.state, 'ready');
  assert.equal(aimedCore.score, 2);
});

