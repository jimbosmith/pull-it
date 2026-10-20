import { DEFAULT_SEED, DEFAULT_SIM_CONFIG } from './config.ts';
import type { LiveDragPreview } from './input.ts';
import { analyzeGestureSamples, createSyntheticGestureSamples } from './input.ts';
import {
  cloneTableObjects,
  createInitialGlass,
  createTableObject,
  findSafeSpawnPlacement,
  pickNextObjectType,
  resetObjectIdCounter
} from './objects.ts';
import { createInitialClothState, stepPhysics } from './physics.ts';
import { SeededRNG } from './rng.ts';
import type {
  ArrangementSnapshot,
  ClothState,
  FailureCause,
  GameState,
  ObjectType,
  PointerSample,
  PullGestureCommand,
  SimulationConfig,
  TableObject
} from './types.ts';

export interface GameLoopCallbacks {
  onStateChange?: (state: GameState, prevState: GameState) => void;
  onScoreChange?: (score: number, bestScore: number, closeCall: boolean) => void;
  onStatusFeedback?: (message: string | null) => void;
  onCollision?: (impactSpeed: number, typeA: ObjectType, typeB: ObjectType) => void;
  onPullStarted?: (cmd: PullGestureCommand) => void;
  onPullCancelled?: (reason: string) => void;
  onSpawnObject?: (obj: TableObject) => void;
  onGameOver?: (cause: FailureCause, reasonText: string, finalScore: number) => void;
}

/**
 * Deterministic, frame-rate-independent core game state machine & simulation controller.
 * Can run inside the browser Canvas loop or headlessly inside automated validation tests.
 */
export class PullItSimulationCore {
  public config: SimulationConfig;
  public rng: SeededRNG;
  public seed: number;

  public state: GameState = 'title';
  private stateBeforePause: GameState = 'ready';

  public score: number = 0;
  public bestScore: number = 0;
  public roundIndex: number = 0;

  public objects: TableObject[] = [];
  public cloth: ClothState;

  public activePointerId: number | null = null;
  public recordedSamples: PointerSample[] = [];
  public dragPreview: LiveDragPreview | null = null;

  public activePullCommand: PullGestureCommand | null = null;
  public lastPullCommand: PullGestureCommand | null = null;
  public prePullSnapshot: ArrangementSnapshot | null = null;

  public failureCause: FailureCause = 'none';
  public failureReasonText: string = '';

  private accumulatorSec: number = 0;
  private pullElapsedSec: number = 0;
  private settleElapsedSec: number = 0;
  private addingElapsedSec: number = 0;
  private failureAftermathRemainingSec: number = 0;
  private pendingFailureCause: FailureCause = 'none';
  private pendingFailureReason: string = '';

  private callbacks: GameLoopCallbacks;

  constructor(
    seed: number = DEFAULT_SEED,
    initialBestScore: number = 0,
    callbacks: GameLoopCallbacks = {},
    customConfig?: Partial<SimulationConfig>
  ) {
    this.config = { ...DEFAULT_SIM_CONFIG, ...customConfig };
    this.seed = seed >>> 0;
    this.rng = new SeededRNG(this.seed);
    this.bestScore = initialBestScore;
    this.callbacks = callbacks;
    this.cloth = createInitialClothState(this.config);
    this.setupInitialTable(undefined, false);
  }

  private setState(next: GameState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.callbacks.onStateChange?.(next, prev);
  }

  /**
   * Resets the table with one glass near the center for a fresh run.
   */
  public setupInitialTable(newSeed?: number, notifyCallbacks: boolean = true): void {
    if (newSeed !== undefined) {
      this.seed = newSeed >>> 0;
    }
    this.rng = new SeededRNG(this.seed);
    resetObjectIdCounter();

    this.score = 0;
    this.roundIndex = 0;
    this.accumulatorSec = 0;
    this.pullElapsedSec = 0;
    this.settleElapsedSec = 0;
    this.addingElapsedSec = 0;
    this.failureAftermathRemainingSec = 0;
    this.pendingFailureCause = 'none';
    this.pendingFailureReason = '';
    this.failureCause = 'none';
    this.failureReasonText = '';
    this.activePointerId = null;
    this.recordedSamples = [];
    this.dragPreview = null;
    this.activePullCommand = null;

    this.cloth = createInitialClothState(this.config);
    const firstGlass = createInitialGlass(this.rng);
    this.objects = [firstGlass];
    this.savePrePullSnapshot();
    if (notifyCallbacks) {
      this.callbacks.onScoreChange?.(this.score, this.bestScore, false);
    }
  }

  /**
   * Transitions from Title or Game Over into an active Ready run.
   */
  public startNewRun(newSeed?: number): void {
    this.setupInitialTable(newSeed);
    this.setState('ready');
    this.callbacks.onStatusFeedback?.(null);
  }

  public savePrePullSnapshot(): void {
    this.prePullSnapshot = {
      seed: this.rng.getState(),
      score: this.score,
      objects: cloneTableObjects(this.objects)
    };
  }

  /**
   * Restores the pre-pull arrangement and replays a recorded gesture deterministically.
   */
  public replaySwipeOnSavedArrangement(cmd: PullGestureCommand): boolean {
    if (!this.prePullSnapshot) return false;
    this.rng.setState(this.prePullSnapshot.seed);
    this.score = this.prePullSnapshot.score;
    this.objects = cloneTableObjects(this.prePullSnapshot.objects);
    this.cloth = createInitialClothState(this.config);
    this.accumulatorSec = 0;
    this.failureAftermathRemainingSec = 0;
    this.pendingFailureCause = 'none';
    this.failureCause = 'none';
    this.failureReasonText = '';
    this.setState('ready');
    this.executePullCommand(cmd);
    return true;
  }

  /**
   * Begins a pointer gesture ONLY if in 'ready' (or 'title') state and the touch started on the handle.
   */
  public beginHandleGesture(
    pointerId: number,
    sample: PointerSample,
    isInsideHandle: boolean
  ): boolean {
    // Allow starting directly from title if player grabs the handle
    if (this.state === 'title' && isInsideHandle) {
      this.setState('ready');
    }

    if (this.state !== 'ready') {
      return false;
    }
    if (!isInsideHandle || this.activePointerId !== null) {
      return false;
    }

    this.activePointerId = pointerId;
    this.recordedSamples = [{ ...sample }];
    this.dragPreview = {
      active: true,
      startX: sample.worldX,
      startY: sample.worldY,
      currentX: sample.worldX,
      currentY: sample.worldY,
      clampedDirX: 0,
      clampedDirY: 1,
      angleDeg: 0,
      strokeLengthNorm: 0,
      willCancel: true
    };
    this.setState('gesture');
    this.callbacks.onStatusFeedback?.(null);
    return true;
  }

  /**
   * Records a pointer move sample during an active handle drag.
   */
  public moveHandleGesture(pointerId: number, sample: PointerSample): void {
    if (this.state !== 'gesture' || this.activePointerId !== pointerId) {
      return;
    }

    // Ensure monotonically non-decreasing timestamps
    const prev = this.recordedSamples[this.recordedSamples.length - 1];
    const safeTime = Math.max(prev.timeMs + 0.1, sample.timeMs);
    this.recordedSamples.push({ ...sample, timeMs: safeTime });

    const start = this.recordedSamples[0];
    const dx = sample.worldX - start.worldX;
    const dy = sample.worldY - start.worldY;
    const normRef = this.config.tableHalfLength * 0.78;
    const strokeNorm = Math.hypot(dx, dy) / normRef;

    const rawAngleDeg = (Math.atan2(dx, Math.max(0.001, dy)) * 180) / Math.PI;
    const clampedDeg = Math.max(
      -this.config.maxPullAngleDeg,
      Math.min(this.config.maxPullAngleDeg, rawAngleDeg)
    );
    const clampedRad = (clampedDeg * Math.PI) / 180;

    // Visible pre-tension on the cloth handle while dragging
    this.cloth.offsetX = Math.sin(clampedRad) * Math.min(0.032, strokeNorm * 0.028);
    this.cloth.offsetY = Math.cos(clampedRad) * Math.min(0.042, Math.max(0, dy) * 0.15);

    this.dragPreview = {
      active: true,
      startX: start.worldX,
      startY: start.worldY,
      currentX: sample.worldX,
      currentY: sample.worldY,
      clampedDirX: Math.sin(clampedRad),
      clampedDirY: Math.cos(clampedRad),
      angleDeg: clampedDeg,
      strokeLengthNorm: strokeNorm,
      willCancel: dy < 0.022 || strokeNorm < this.config.minSwipeStrokeNorm
    };
  }

  /**
   * Completes the gesture on pointerup and either starts the cloth pull or cancels cleanly.
   */
  public endHandleGesture(pointerId: number, finalSample?: PointerSample): GestureStateOutcome {
    if (this.state !== 'gesture' || this.activePointerId !== pointerId) {
      return { startedPull: false };
    }

    if (finalSample) {
      const prev = this.recordedSamples[this.recordedSamples.length - 1];
      const safeTime = Math.max(prev.timeMs + 0.1, finalSample.timeMs);
      this.recordedSamples.push({ ...finalSample, timeMs: safeTime });
    }

    const samplesCopy = [...this.recordedSamples];
    this.activePointerId = null;
    this.dragPreview = null;

    // Reset pre-tension offset before starting deterministic physics integration
    this.cloth.offsetX = 0;
    this.cloth.offsetY = 0;
    this.cloth.prevOffsetX = 0;
    this.cloth.prevOffsetY = 0;

    const analysis = analyzeGestureSamples(samplesCopy, this.config);
    if (!analysis.valid || !analysis.command) {
      this.setState('ready');
      const msg = analysis.cancelReason ?? 'Swipe further down to pull the cloth';
      this.callbacks.onPullCancelled?.(msg);
      this.callbacks.onStatusFeedback?.(msg);
      return { startedPull: false, cancelReason: msg };
    }

    this.executePullCommand(analysis.command);
    return { startedPull: true, command: analysis.command };
  }

  /**
   * Safely cancels an active gesture (e.g. pointercancel, multi-touch interruption, blur, pause).
   */
  public cancelActiveGesture(reason: string = 'Gesture cancelled'): void {
    if (this.state !== 'gesture') return;
    this.activePointerId = null;
    this.recordedSamples = [];
    this.dragPreview = null;
    this.cloth.offsetX = 0;
    this.cloth.offsetY = 0;
    this.cloth.prevOffsetX = 0;
    this.cloth.prevOffsetY = 0;
    this.setState('ready');
    this.callbacks.onPullCancelled?.(reason);
    this.callbacks.onStatusFeedback?.(reason);
  }

  /**
   * Executes a validated PullGestureCommand from the 'ready' state.
   */
  public executePullCommand(cmd: PullGestureCommand): void {
    if (this.state !== 'ready' && this.state !== 'gesture') {
      return;
    }

    this.savePrePullSnapshot();
    for (const obj of this.objects) {
      obj.peakTiltRatio = 0;
    }

    this.activePullCommand = cmd;
    this.lastPullCommand = cmd;
    this.pullElapsedSec = 0;
    this.settleElapsedSec = 0;
    this.failureAftermathRemainingSec = 0;
    this.pendingFailureCause = 'none';
    this.pendingFailureReason = '';

    this.setState('pulling');
    this.callbacks.onPullStarted?.(cmd);
  }

  public pause(): void {
    if (this.state === 'paused' || this.state === 'title' || this.state === 'game_over') {
      return;
    }
    if (this.state === 'gesture') {
      this.cancelActiveGesture('Paused');
    }
    this.stateBeforePause = this.state;
    this.accumulatorSec = 0;
    this.setState('paused');
  }

  public resume(): void {
    if (this.state !== 'paused') return;
    this.accumulatorSec = 0;
    this.setState(this.stateBeforePause);
  }

  /**
   * Advances the game loop by `frameDeltaSec` with fixed-timestep physics and capped catch-up.
   * Returns `{ alpha, stepsRun }` where `alpha` in [0, 1] is the render interpolation factor.
   */
  public updateFrame(frameDeltaSec: number): { alpha: number; stepsRun: number } {
    if (
      this.state === 'paused' ||
      this.state === 'title' ||
      this.state === 'game_over'
    ) {
      this.accumulatorSec = 0;
      return { alpha: 1, stepsRun: 0 };
    }

    // Clamp raw frame delta to prevent spiral of death after tab backgrounding
    const maxAllowedDelta = this.config.fixedDt * this.config.maxCatchUpSteps;
    const clampedDelta = Math.max(0, Math.min(maxAllowedDelta, frameDeltaSec));
    this.accumulatorSec += clampedDelta;

    let stepsRun = 0;
    while (
      this.accumulatorSec >= this.config.fixedDt &&
      stepsRun < this.config.maxCatchUpSteps
    ) {
      this.stepFixed(this.config.fixedDt);
      this.accumulatorSec -= this.config.fixedDt;
      stepsRun++;
      if (this.state === 'game_over') {
        this.accumulatorSec = 0;
        break;
      }
    }

    const alpha = Math.max(0, Math.min(1, this.accumulatorSec / this.config.fixedDt));
    return { alpha, stepsRun };
  }

  /**
   * Runs a single fixed timestep `dt` of the active simulation state.
   */
  public stepFixed(dt: number = this.config.fixedDt): void {
    if (this.state === 'ready' || this.state === 'gesture') {
      // Only update visual spawn bounce if any
      for (const obj of this.objects) {
        obj.prevX = obj.x;
        obj.prevY = obj.y;
        obj.prevYaw = obj.yaw;
        obj.prevTiltX = obj.tiltX;
        obj.prevTiltY = obj.tiltY;
        obj.prevZ = obj.z;
        if (obj.spawnAnimProgress < 1) {
          obj.spawnAnimProgress = Math.min(1, obj.spawnAnimProgress + dt * 3.8);
        }
      }
      return;
    }

    if (this.state === 'adding_object') {
      this.addingElapsedSec += dt;
      // Visually re-thread the fresh cloth underneath stationary objects without disturbing them
      this.cloth.rethreadProgress = Math.min(1, this.addingElapsedSec / 0.28);
      for (const obj of this.objects) {
        obj.prevX = obj.x;
        obj.prevY = obj.y;
        obj.prevYaw = obj.yaw;
        obj.prevTiltX = obj.tiltX;
        obj.prevTiltY = obj.tiltY;
        obj.prevZ = obj.z;
        if (obj.spawnAnimProgress < 1) {
          obj.spawnAnimProgress = Math.min(1, obj.spawnAnimProgress + dt * 3.6);
        }
      }

      if (this.addingElapsedSec >= 0.34) {
        this.cloth.rethreadProgress = 1.0;
        this.setState('ready');
      }
      return;
    }

    if (this.state === 'pulling' || this.state === 'settling') {
      if (this.state === 'pulling') {
        this.pullElapsedSec += dt;
      } else {
        this.settleElapsedSec += dt;
      }

      const stepRes = stepPhysics(
        this.objects,
        this.cloth,
        this.activePullCommand,
        this.pullElapsedSec,
        this.config
      );

      for (const col of stepRes.collisions) {
        this.callbacks.onCollision?.(col.impactSpeed, col.typeA, col.typeB);
      }

      // If an object tipped or fell off the edge, start brief physical aftermath timer
      // so the player clearly sees the glass/plate/egg topple or fall before the modal appears.
      if (stepRes.failed && this.failureAftermathRemainingSec <= 0) {
        this.failureAftermathRemainingSec = 0.48;
        this.pendingFailureCause = stepRes.failureCause;
        this.pendingFailureReason =
          stepRes.failedObject?.failureReason ??
          (stepRes.failureCause === 'fell_off_edge'
            ? 'An object fell off the table edge!'
            : 'An object tipped over!');
        this.callbacks.onStatusFeedback?.(this.pendingFailureReason);
      }

      if (this.failureAftermathRemainingSec > 0) {
        this.failureAftermathRemainingSec -= dt;
        if (this.failureAftermathRemainingSec <= 0) {
          this.triggerFailure(this.pendingFailureCause, this.pendingFailureReason);
          return;
        }
        return;
      }

      // Transition from 'pulling' to 'settling' as soon as the cloth exits the table
      if (this.state === 'pulling' && stepRes.clothFinishedExiting) {
        this.activePullCommand = null;
        this.settleElapsedSec = 0;
        this.setState('settling');
      }

      // In 'settling', wait until all objects finish moving OR maxSettleTimeSec is reached
      if (this.state === 'settling') {
        const timedOut = this.settleElapsedSec >= this.config.maxSettleTimeSec;
        if (stepRes.allObjectsSettled || timedOut) {
          // If timed out with tiny residual motion (and not failed), gently damp residual velocities
          // without changing any object's settled position or yaw orientation!
          if (timedOut) {
            for (const obj of this.objects) {
              if (obj.state === 'rocking' || obj.state === 'upright') {
                obj.vx = 0;
                obj.vy = 0;
                obj.tiltVelX = 0;
                obj.tiltVelY = 0;
                obj.tiltX = obj.restTiltX;
                obj.tiltY = obj.restTiltY;
                obj.state = 'upright';
              }
            }
          }
          this.handleSuccessfulPullSettled();
        }
      }
    }
  }

  private handleSuccessfulPullSettled(): void {
    // Award 1 point per successfully completed cloth pull
    this.score += 1;
    this.roundIndex += 1;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
    }

    const closeCall = this.objects.some((o) => o.peakTiltRatio >= 0.72);
    this.callbacks.onScoreChange?.(this.score, this.bestScore, closeCall);

    // Visually thread a fresh cloth underneath everything without disturbing any survivor's position/orientation
    this.cloth = createInitialClothState(this.config);
    this.cloth.rethreadProgress = 0;
    for (const survivor of this.objects) {
      survivor.clothOverlap = 1.0;
      survivor.vx = 0;
      survivor.vy = 0;
      survivor.tiltVelX = 0;
      survivor.tiltVelY = 0;
      survivor.tiltX = survivor.restTiltX;
      survivor.tiltY = survivor.restTiltY;
      survivor.state = 'upright';
    }

    // Spawn 1 new object in a safe, unoccupied position
    const nextType = pickNextObjectType(this.roundIndex, this.rng);
    const placement = findSafeSpawnPlacement(
      nextType,
      this.objects,
      this.config,
      this.rng,
      this.roundIndex
    );

    if (!placement) {
      // Table has no safe room! End with a clear "Table full!" completion result and preserve score.
      this.cloth.rethreadProgress = 1.0;
      this.triggerFailure(
        'table_full',
        'Table full! Every inch of the table is packed — impressive run!'
      );
      return;
    }

    const newObj = createTableObject(nextType, placement.x, placement.y, placement.yaw);
    newObj.spawnAnimProgress = 0.0;
    this.objects.push(newObj);
    this.callbacks.onSpawnObject?.(newObj);

    this.addingElapsedSec = 0;
    this.setState('adding_object');
  }

  private triggerFailure(cause: FailureCause, reasonText: string): void {
    this.failureCause = cause;
    this.failureReasonText = reasonText;
    this.activePullCommand = null;
    this.setState('game_over');
    this.callbacks.onGameOver?.(cause, reasonText, this.score);
  }

  /**
   * Helper for tests or developer presets: runs a preset gesture and steps until resolution.
   */
  public triggerPresetSwipe(preset: 'fast_straight' | 'slow_drag' | 'angled_jerk'): void {
    if (this.state === 'game_over' || this.state === 'title') {
      this.startNewRun(this.seed);
    } else if (this.state !== 'ready' && this.prePullSnapshot) {
      this.rng.setState(this.prePullSnapshot.seed);
      this.score = this.prePullSnapshot.score;
      this.objects = cloneTableObjects(this.prePullSnapshot.objects);
      this.cloth = createInitialClothState(this.config);
      this.setState('ready');
    }

    let samples: PointerSample[];
    if (preset === 'fast_straight') {
      samples = createSyntheticGestureSamples({
        startX: 0,
        startY: 0.46,
        endX: 0,
        endY: 0.84,
        durationMs: 110
      });
    } else if (preset === 'slow_drag') {
      samples = createSyntheticGestureSamples({
        startX: 0,
        startY: 0.46,
        endX: 0.02,
        endY: 0.72,
        durationMs: 680
      });
    } else {
      samples = createSyntheticGestureSamples({
        startX: 0,
        startY: 0.46,
        endX: 0.22,
        endY: 0.76,
        durationMs: 260,
        wobbleAmplitudeX: 0.04,
        stutter: true
      });
    }

    const res = analyzeGestureSamples(samples, this.config);
    if (res.valid && res.command) {
      this.executePullCommand(res.command);
    }
  }
}

export interface GestureStateOutcome {
  startedPull: boolean;
  cancelReason?: string;
  command?: PullGestureCommand;
}
