import { SoundManager } from './audio.js?v=7';
import { DEFAULT_SEED, DEFAULT_SIM_CONFIG } from './config.js?v=7';
import { DeveloperPanel } from './devPanel.js?v=7';
import { PullItSimulationCore } from './game.js?v=7';
import { PersistenceManager } from './persistence.js?v=7';
import { TabletopRenderer } from './renderer.js?v=7';
                                                                         

export class PullItApp {
          canvas                   ;
          renderer                  ;
          persistence                    ;
          sound              ;
          core                      ;
          devPanel                ;

          debugOverlay          = false;
          lastRafTimeMs         = 0;
          smoothedFps         = 60;
          statusMessage                = null;
          statusTimeoutId                = null;

  // HUD DOM elements
          scoreValEl             ;
          bestValEl             ;
          countValEl             ;
          firstRunHintEl             ;
          statusToastEl             ;
          praiseBadgeEl             ;

          pauseBtn                   ;
          muteBtn                   ;
          motionBtn                   ;
          devBtn                   ;

          titleModal             ;
          startBtn                   ;
          pauseModal             ;
          resumeBtn                   ;
          restartFromPauseBtn                   ;

          gameOverModal             ;
          gameOverTitleEl             ;
          gameOverReasonEl             ;
          finalScoreValEl             ;
          finalBestValEl             ;
          retryBtn                   ;

  constructor() {
    this.canvas = document.getElementById('game-canvas')                     ;
    this.scoreValEl = document.getElementById('hud-score')               ;
    this.bestValEl = document.getElementById('hud-best')               ;
    this.countValEl = document.getElementById('hud-count')               ;
    this.firstRunHintEl = document.getElementById('first-run-hint')               ;
    this.statusToastEl = document.getElementById('status-toast')               ;
    this.praiseBadgeEl = document.getElementById('praise-badge')               ;

    this.pauseBtn = document.getElementById('btn-pause')                     ;
    this.muteBtn = document.getElementById('btn-mute')                     ;
    this.motionBtn = document.getElementById('btn-motion')                     ;
    this.devBtn = document.getElementById('btn-dev')                     ;

    this.titleModal = document.getElementById('modal-title')               ;
    this.startBtn = document.getElementById('btn-start')                     ;
    this.pauseModal = document.getElementById('modal-pause')               ;
    this.resumeBtn = document.getElementById('btn-resume')                     ;
    this.restartFromPauseBtn = document.getElementById('btn-restart-pause')                     ;

    this.gameOverModal = document.getElementById('modal-gameover')               ;
    this.gameOverTitleEl = document.getElementById('gameover-title')               ;
    this.gameOverReasonEl = document.getElementById('gameover-reason')               ;
    this.finalScoreValEl = document.getElementById('final-score')               ;
    this.finalBestValEl = document.getElementById('final-best')               ;
    this.retryBtn = document.getElementById('btn-retry')                     ;

    this.persistence = new PersistenceManager();
    this.sound = new SoundManager(this.persistence.isMuted());
    this.renderer = new TabletopRenderer(this.canvas);

    const params = new URLSearchParams(window.location.search);
    const seedParam = params.get('seed');
    const initialSeed = seedParam ? parseInt(seedParam, 10) || DEFAULT_SEED : DEFAULT_SEED;

    this.core = new PullItSimulationCore(initialSeed, this.persistence.getBestScore(), {
      onStateChange: (state) => this.handleStateChange(state),
      onScoreChange: (score, best, closeCall) => this.handleScoreChange(score, best, closeCall),
      onStatusFeedback: (msg) => this.showStatusToast(msg),
      onCollision: (speed, a, b) => this.sound.playCollision(speed, a, b),
      onPullStarted: (cmd) => {
        this.sound.playClothWhoosh(cmd.extractionSpeedMps, cmd.extractionDurationSec);
      },
      onPullCancelled: () => {
        this.sound.playCancel();
      },
      onSpawnObject: () => {
        this.sound.playSpawnPop();
        this.updateHudCounters();
      },
      onGameOver: (cause, reasonText, finalScore) => {
        this.handleGameOver(cause, reasonText, finalScore);
      }
    });

    const devContainer = document.getElementById('dev-panel')               ;
    this.devPanel = new DeveloperPanel(
      devContainer,
      {
        onApplySeed: (newSeed) => {
          this.core.startNewRun(newSeed);
          this.updateHudCounters();
        },
        onToggleDebugOverlay: (enabled) => {
          this.debugOverlay = enabled;
        },
        onUpdateConfig: (partial) => {
          this.core.config = { ...this.core.config, ...partial };
        },
        onResetConfig: () => {
          this.core.config = { ...DEFAULT_SIM_CONFIG };
        },
        onReplayLastSwipe: () => {
          if (this.core.lastPullCommand) {
            this.core.replaySwipeOnSavedArrangement(this.core.lastPullCommand);
            this.updateHudCounters();
          }
        },
        onRunPresetSwipe: (preset) => {
          this.sound.unlock();
          this.core.triggerPresetSwipe(preset);
          this.updateHudCounters();
        }
      },
      initialSeed
    );

    this.syncToggleButtons();
    this.updateHudCounters();
    this.bindEvents();
    this.handleStateChange(this.core.state);

    this.lastRafTimeMs = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

          bindEvents()       {
    window.addEventListener('resize', () => {
      this.renderer.resize(this.core.config.tableHalfWidth, this.core.config.tableHalfLength);
    });

    // Pause when tab is hidden and discard accumulated frame time on resume
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.core.pause();
      } else {
        this.lastRafTimeMs = performance.now();
      }
    });

    window.addEventListener('blur', () => {
      if (this.core.state === 'gesture') {
        this.core.cancelActiveGesture('Gesture interrupted');
      }
    });

    // Keyboard shortcut for developer panel (D or `) and Space/Enter for start/retry
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'd' || e.key === 'D' || e.key === '`') {
        this.devPanel.toggle();
      } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        if (this.core.state === 'paused') this.core.resume();
        else this.core.pause();
      }
    });

    // Pointer Events on the play surface Canvas
    this.canvas.addEventListener('pointerdown', (e) => {
      this.sound.unlock();

      // If a secondary finger touches while dragging, cancel safely to avoid erratic jumps
      if (this.core.activePointerId !== null && e.pointerId !== this.core.activePointerId) {
        this.core.cancelActiveGesture('Multi-touch cancelled — use one finger');
        return;
      }

      // Only left mouse button or touch/pen contact
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      const sample = this.eventToSample(e);
      const inHandle = this.renderer.isPointInHandle(
        sample.worldX,
        sample.worldY,
        this.core.config,
        this.core.cloth
      );

      if (this.core.beginHandleGesture(e.pointerId, sample, inHandle)) {
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch {
          // Ignore pointer capture errors on synthetic events
        }
        this.sound.playHandleGrab();
      } else if (this.core.state === 'ready' && !inHandle) {
        this.showStatusToast('Grab the cloth handle below the table to pull');
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (this.core.activePointerId !== e.pointerId) return;

      // Use coalesced events when available for higher temporal fidelity on high-rate touchscreens
      const coalesced =
        typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ce of coalesced) {
        this.core.moveHandleGesture(e.pointerId, this.eventToSample(ce));
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (this.core.activePointerId !== e.pointerId) return;
      try {
        if (this.canvas.hasPointerCapture(e.pointerId)) {
          this.canvas.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
      this.core.endHandleGesture(e.pointerId, this.eventToSample(e));
    });

    window.addEventListener('pointercancel', (e) => {
      if (this.core.activePointerId !== e.pointerId) return;
      this.core.cancelActiveGesture('Touch cancelled');
    });

    // Prevent page scrolling only inside the play surface
    this.canvas.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );

    // HUD & Modal Buttons
    this.startBtn.addEventListener('click', () => {
      this.sound.unlock();
      this.core.startNewRun();
      this.updateHudCounters();
    });

    this.pauseBtn.addEventListener('click', () => {
      this.sound.unlock();
      if (this.core.state === 'paused') {
        this.core.resume();
      } else {
        this.core.pause();
      }
    });

    this.resumeBtn.addEventListener('click', () => {
      this.sound.unlock();
      this.core.resume();
    });

    this.restartFromPauseBtn.addEventListener('click', () => {
      this.sound.unlock();
      // Slightly advance seed between runs for subtle arrangement variation unless fixed via URL
      const nextSeed = this.NextRunSeed();
      this.core.startNewRun(nextSeed);
      this.updateHudCounters();
    });

    this.retryBtn.addEventListener('click', () => {
      if (this.core.state !== 'game_over') return;
      this.sound.unlock();
      const nextSeed = this.NextRunSeed();
      this.core.startNewRun(nextSeed);
      this.updateHudCounters();
    });

    this.muteBtn.addEventListener('click', () => {
      const nextMuted = !this.sound.isMuted();
      this.sound.setMuted(nextMuted);
      this.persistence.setMuted(nextMuted);
      if (!nextMuted) this.sound.unlock();
      this.syncToggleButtons();
    });

    this.motionBtn.addEventListener('click', () => {
      const nextReduced = !this.persistence.isReducedMotion();
      this.persistence.setReducedMotion(nextReduced);
      this.syncToggleButtons();
    });

    this.devBtn.addEventListener('click', () => {
      this.devPanel.toggle();
    });
  }

          NextRunSeed()         {
    const params = new URLSearchParams(window.location.search);
    if (params.has('seed')) {
      return parseInt(params.get('seed') , 10) || DEFAULT_SEED;
    }
    return (this.core.seed + 1013) >>> 0;
  }

          eventToSample(e              )                {
    const world = this.renderer.screenToWorld(e.clientX, e.clientY);
    const timeMs = e.timeStamp && e.timeStamp > 0 ? e.timeStamp : performance.now();
    return {
      worldX: world.worldX,
      worldY: world.worldY,
      screenX: world.screenX,
      screenY: world.screenY,
      timeMs
    };
  }

          handleStateChange(state           )       {
    this.titleModal.hidden = state !== 'title';
    this.pauseModal.hidden = state !== 'paused';
    this.gameOverModal.hidden = state !== 'game_over';

    this.pauseBtn.textContent = state === 'paused' ? '▶ Resume' : '⏸ Pause';
  }

          handleScoreChange(score        , best        , closeCall         )       {
    this.persistence.recordScore(score);
    this.scoreValEl.textContent = String(score);
    this.bestValEl.textContent = String(Math.max(best, this.persistence.getBestScore()));
    this.updateHudCounters();

    if (score >= 1) {
      this.persistence.markFirstRunHintSeen();
      this.firstRunHintEl.classList.add('hint-dimmed');
      this.sound.playSuccess(closeCall);
      if (closeCall) {
        this.showPraise('Close call! Phew!');
      } else if (score === 1) {
        this.showPraise('Clean pull!');
      }
    }
  }

          handleGameOver(cause              , reasonText        , finalScore        )       {
    this.persistence.recordScore(finalScore);
    const best = this.persistence.getBestScore();
    this.bestValEl.textContent = String(best);

    if (cause === 'table_full') {
      this.gameOverTitleEl.textContent = 'Table Full!';
      this.sound.playSuccess(true);
    } else {
      this.gameOverTitleEl.textContent =
        cause === 'fell_off_edge' ? 'Fell Off the Edge!' : 'Tipped Over!';
      this.sound.playFailure(cause);
    }

    this.gameOverReasonEl.textContent = reasonText;
    this.finalScoreValEl.textContent = String(finalScore);
    this.finalBestValEl.textContent = String(best);
    this.gameOverModal.hidden = false;
  }

          updateHudCounters()       {
    if (!this.core) return;
    this.scoreValEl.textContent = String(this.core.score);
    this.bestValEl.textContent = String(
      Math.max(this.core.bestScore, this.persistence.getBestScore())
    );
    this.countValEl.textContent = String(this.core.objects.length);
  }

          syncToggleButtons()       {
    const muted = this.sound.isMuted();
    const reduced = this.persistence.isReducedMotion();
    this.muteBtn.textContent = muted ? '🔇 Muted' : '🔊 Sound';
    this.muteBtn.setAttribute('aria-pressed', String(muted));
    this.motionBtn.textContent = reduced ? '⚡ Reduced Motion: ON' : '✨ Motion: Full';
    this.motionBtn.setAttribute('aria-pressed', String(reduced));
  }

          showStatusToast(msg               )       {
    this.statusMessage = msg;
    if (this.statusTimeoutId !== null) {
      window.clearTimeout(this.statusTimeoutId);
      this.statusTimeoutId = null;
    }
    if (!msg) {
      this.statusToastEl.hidden = true;
      return;
    }
    this.statusToastEl.textContent = msg;
    this.statusToastEl.hidden = false;
    this.statusTimeoutId = window.setTimeout(() => {
      this.statusToastEl.hidden = true;
    }, 2200);
  }

          showPraise(text        )       {
    this.praiseBadgeEl.textContent = text;
    this.praiseBadgeEl.hidden = false;
    window.setTimeout(() => {
      this.praiseBadgeEl.hidden = true;
    }, 1100);
  }

          loop(nowMs        )       {
    const rawDtMs = Math.max(0.1, nowMs - this.lastRafTimeMs);
    this.lastRafTimeMs = nowMs;

    // Discard inappropriate accumulated time after long tab switch
    const safeDtSec = rawDtMs > 500 ? this.core.config.fixedDt : rawDtMs / 1000;
    const instFps = 1000 / Math.max(1, rawDtMs);
    this.smoothedFps = this.smoothedFps * 0.9 + instFps * 0.1;

    const { alpha, stepsRun } = this.core.updateFrame(safeDtSec);

    this.renderer.render({
      alpha,
      state: this.core.state,
      config: this.core.config,
      cloth: this.core.cloth,
      objects: this.core.objects,
      dragPreview: this.core.dragPreview,
      lastPullCommand: this.core.lastPullCommand,
      reducedMotion: this.persistence.isReducedMotion(),
      debugOverlay: this.debugOverlay,
      statusBannerText: this.statusMessage
    });

    this.devPanel.update({
      seed: this.core.seed,
      state: this.core.state,
      fps: this.smoothedFps,
      frameDtMs: rawDtMs,
      stepsLastFrame: stepsRun,
      lastCommand: this.core.lastPullCommand,
      objects: this.core.objects,
      hasSavedArrangement: this.core.prePullSnapshot !== null
    });

    requestAnimationFrame((t) => this.loop(t));
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const boot = () => {
    new PullItApp();
  };
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}


//# sourceURL=main.ts