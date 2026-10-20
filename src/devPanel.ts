import { DEFAULT_SIM_CONFIG } from './config.ts';
import type {
  GameState,
  PullGestureCommand,
  SimulationConfig,
  TableObject
} from './types.ts';

export interface DevPanelCallbacks {
  onApplySeed: (seed: number) => void;
  onToggleDebugOverlay: (enabled: boolean) => void;
  onUpdateConfig: (partial: Partial<SimulationConfig>) => void;
  onResetConfig: () => void;
  onReplayLastSwipe: () => void;
  onRunPresetSwipe: (preset: 'fast_straight' | 'slow_drag' | 'angled_jerk') => void;
}

export interface DevTelemetry {
  seed: number;
  state: GameState;
  fps: number;
  frameDtMs: number;
  stepsLastFrame: number;
  lastCommand: PullGestureCommand | null;
  objects: readonly TableObject[];
  hasSavedArrangement: boolean;
}

/**
 * Developer-only inspection and tuning panel.
 * Toggled via `D` / Backquote key, `?debug=1` URL query parameter, or the HUD Dev button.
 */
export class DeveloperPanel {
  private container: HTMLElement;
  private visible: boolean = false;
  private callbacks: DevPanelCallbacks;

  private seedInput!: HTMLInputElement;
  private stateSpan!: HTMLElement;
  private timingSpan!: HTMLElement;
  private gestureSpan!: HTMLElement;
  private objectsBody!: HTMLElement;
  private replayBtn!: HTMLButtonElement;
  private overlayCheckbox!: HTMLInputElement;

  private clothFricSlider!: HTMLInputElement;
  private woodFricSlider!: HTMLInputElement;
  private stabilitySlider!: HTMLInputElement;
  private dampingSlider!: HTMLInputElement;

  private clothFricVal!: HTMLElement;
  private woodFricVal!: HTMLElement;
  private stabilityVal!: HTMLElement;
  private dampingVal!: HTMLElement;

  constructor(container: HTMLElement, callbacks: DevPanelCallbacks, initialSeed: number) {
    this.container = container;
    this.callbacks = callbacks;
    this.buildDOM(initialSeed);

    // Check URL parameter ?debug=1 or ?dev=1
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug') === '1' || params.get('dev') === '1') {
        this.setVisible(true);
      }
    }
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public toggle(): void {
    this.setVisible(!this.visible);
  }

  public setVisible(show: boolean): void {
    this.visible = show;
    this.container.hidden = !show;
  }

  private buildDOM(initialSeed: number): void {
    this.container.innerHTML = `
      <div class="dev-header">
        <strong>DEVELOPER TELEMETRY &amp; TUNING</strong>
        <button type="button" class="dev-close-btn" id="dev-close-btn" title="Close (D)">✕</button>
      </div>
      <div class="dev-grid">
        <div class="dev-row">
          <label for="dev-seed-input">Fixed Seed:</label>
          <input type="number" id="dev-seed-input" value="${initialSeed}" step="1" />
          <button type="button" id="dev-apply-seed-btn">Reset w/ Seed</button>
        </div>
        <div class="dev-row">
          <span>State: <strong id="dev-state-val">title</strong></span>
          <span>Timing: <strong id="dev-timing-val">60 fps (16.7ms)</strong></span>
        </div>
        <div class="dev-row">
          <span>Last Gesture: <span id="dev-gesture-val">None</span></span>
        </div>
        <div class="dev-row">
          <label class="dev-checkbox-label">
            <input type="checkbox" id="dev-overlay-chk" />
            Show Footprints, Support Bounds &amp; Velocities
          </label>
        </div>
        <div class="dev-sliders">
          <div class="dev-slider-row">
            <label for="dev-cloth-fric">Cloth Friction (<span id="dev-cloth-fric-val">1.00</span>x)</label>
            <input type="range" id="dev-cloth-fric" min="0.2" max="2.5" step="0.05" value="1.0" />
          </div>
          <div class="dev-slider-row">
            <label for="dev-wood-fric">Wood Friction (<span id="dev-wood-fric-val">1.00</span>x)</label>
            <input type="range" id="dev-wood-fric" min="0.2" max="2.5" step="0.05" value="1.0" />
          </div>
          <div class="dev-slider-row">
            <label for="dev-stability">Stability Scale (<span id="dev-stability-val">1.00</span>x)</label>
            <input type="range" id="dev-stability" min="0.3" max="2.5" step="0.05" value="1.0" />
          </div>
          <div class="dev-slider-row">
            <label for="dev-damping">Tilt Damping (<span id="dev-damping-val">1.00</span>x)</label>
            <input type="range" id="dev-damping" min="0.3" max="2.5" step="0.05" value="1.0" />
          </div>
        </div>
        <div class="dev-actions">
          <button type="button" id="dev-replay-btn" disabled>Replay Last Swipe</button>
          <button type="button" id="dev-preset-fast">Test Fast Whip</button>
          <button type="button" id="dev-preset-slow">Test Slow Drag</button>
          <button type="button" id="dev-preset-angled">Test Angled Pull</button>
          <button type="button" id="dev-reset-tuning-btn">Reset Tuning</button>
        </div>
        <div class="dev-table-wrap">
          <table class="dev-obj-table">
            <thead>
              <tr>
                <th>ID/Type</th>
                <th>Pos (m)</th>
                <th>Vel (m/s)</th>
                <th>Tilt (deg)</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody id="dev-objects-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    this.seedInput = this.container.querySelector('#dev-seed-input') as HTMLInputElement;
    this.stateSpan = this.container.querySelector('#dev-state-val') as HTMLElement;
    this.timingSpan = this.container.querySelector('#dev-timing-val') as HTMLElement;
    this.gestureSpan = this.container.querySelector('#dev-gesture-val') as HTMLElement;
    this.objectsBody = this.container.querySelector('#dev-objects-tbody') as HTMLElement;
    this.replayBtn = this.container.querySelector('#dev-replay-btn') as HTMLButtonElement;
    this.overlayCheckbox = this.container.querySelector('#dev-overlay-chk') as HTMLInputElement;

    this.clothFricSlider = this.container.querySelector('#dev-cloth-fric') as HTMLInputElement;
    this.woodFricSlider = this.container.querySelector('#dev-wood-fric') as HTMLInputElement;
    this.stabilitySlider = this.container.querySelector('#dev-stability') as HTMLInputElement;
    this.dampingSlider = this.container.querySelector('#dev-damping') as HTMLInputElement;

    this.clothFricVal = this.container.querySelector('#dev-cloth-fric-val') as HTMLElement;
    this.woodFricVal = this.container.querySelector('#dev-wood-fric-val') as HTMLElement;
    this.stabilityVal = this.container.querySelector('#dev-stability-val') as HTMLElement;
    this.dampingVal = this.container.querySelector('#dev-damping-val') as HTMLElement;

    const closeBtn = this.container.querySelector('#dev-close-btn') as HTMLButtonElement;
    closeBtn.addEventListener('click', () => this.setVisible(false));

    const applySeedBtn = this.container.querySelector('#dev-apply-seed-btn') as HTMLButtonElement;
    applySeedBtn.addEventListener('click', () => {
      const parsed = parseInt(this.seedInput.value, 10);
      if (Number.isFinite(parsed)) {
        this.callbacks.onApplySeed(parsed);
      }
    });

    this.overlayCheckbox.addEventListener('change', () => {
      this.callbacks.onToggleDebugOverlay(this.overlayCheckbox.checked);
    });

    const bindSlider = (
      slider: HTMLInputElement,
      valEl: HTMLElement,
      key: keyof SimulationConfig
    ) => {
      slider.addEventListener('input', () => {
        const num = parseFloat(slider.value);
        valEl.textContent = num.toFixed(2);
        this.callbacks.onUpdateConfig({ [key]: num });
      });
    };

    bindSlider(this.clothFricSlider, this.clothFricVal, 'clothFrictionScale');
    bindSlider(this.woodFricSlider, this.woodFricVal, 'woodFrictionScale');
    bindSlider(this.stabilitySlider, this.stabilityVal, 'stabilityScale');
    bindSlider(this.dampingSlider, this.dampingVal, 'dampingScale');

    this.replayBtn.addEventListener('click', () => {
      this.callbacks.onReplayLastSwipe();
    });

    this.container
      .querySelector('#dev-preset-fast')
      ?.addEventListener('click', () => this.callbacks.onRunPresetSwipe('fast_straight'));
    this.container
      .querySelector('#dev-preset-slow')
      ?.addEventListener('click', () => this.callbacks.onRunPresetSwipe('slow_drag'));
    this.container
      .querySelector('#dev-preset-angled')
      ?.addEventListener('click', () => this.callbacks.onRunPresetSwipe('angled_jerk'));

    this.container.querySelector('#dev-reset-tuning-btn')?.addEventListener('click', () => {
      this.clothFricSlider.value = String(DEFAULT_SIM_CONFIG.clothFrictionScale);
      this.woodFricSlider.value = String(DEFAULT_SIM_CONFIG.woodFrictionScale);
      this.stabilitySlider.value = String(DEFAULT_SIM_CONFIG.stabilityScale);
      this.dampingSlider.value = String(DEFAULT_SIM_CONFIG.dampingScale);
      this.clothFricVal.textContent = DEFAULT_SIM_CONFIG.clothFrictionScale.toFixed(2);
      this.woodFricVal.textContent = DEFAULT_SIM_CONFIG.woodFrictionScale.toFixed(2);
      this.stabilityVal.textContent = DEFAULT_SIM_CONFIG.stabilityScale.toFixed(2);
      this.dampingVal.textContent = DEFAULT_SIM_CONFIG.dampingScale.toFixed(2);
      this.callbacks.onResetConfig();
    });
  }

  public update(telemetry: DevTelemetry): void {
    if (!this.visible) return;

    this.stateSpan.textContent = telemetry.state;
    this.timingSpan.textContent = `${Math.round(telemetry.fps)} fps (${telemetry.frameDtMs.toFixed(1)}ms, ${telemetry.stepsLastFrame} step)`;

    if (telemetry.lastCommand) {
      const c = telemetry.lastCommand;
      this.gestureSpan.textContent = `${c.extractionSpeedMps.toFixed(2)} m/s | ${c.angleDeg.toFixed(1)}° | dur ${(c.extractionDurationSec * 1000).toFixed(0)}ms | jerk ${c.jerkMetric.toFixed(2)}`;
    } else {
      this.gestureSpan.textContent = 'None';
    }

    this.replayBtn.disabled = !telemetry.hasSavedArrangement || !telemetry.lastCommand;

    const rowsHtml = telemetry.objects
      .map((o) => {
        const speed = Math.hypot(o.vx, o.vy);
        const tiltDeg = (Math.hypot(o.tiltX, o.tiltY) * 180) / Math.PI;
        const critDeg = (o.criticalTiltRad * 180) / Math.PI;
        return `<tr>
          <td>#${o.id} ${o.type}</td>
          <td>${o.x.toFixed(3)}, ${o.y.toFixed(3)}</td>
          <td>${speed.toFixed(3)}</td>
          <td>${tiltDeg.toFixed(1)}° / ${critDeg.toFixed(0)}°</td>
          <td>${o.state}</td>
        </tr>`;
      })
      .join('');
    this.objectsBody.innerHTML = rowsHtml;
  }
}
