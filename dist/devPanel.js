import { DEFAULT_SIM_CONFIG } from './config.js?v=7';
             
            
                     
                   
             
                    

                                    
                                      
                                                   
                                                               
                            
                                
                                                                                    
 

                               
               
                   
              
                    
                         
                                         
                                  
                               
 

/**
 * Developer-only inspection and tuning panel.
 * Toggled via `D` / Backquote key, `?debug=1` URL query parameter, or the HUD Dev button.
 */
export class DeveloperPanel {
          container             ;
          visible          = false;
          callbacks                   ;

          seedInput                   ;
          stateSpan              ;
          timingSpan              ;
          gestureSpan              ;
          objectsBody              ;
          replayBtn                    ;
          overlayCheckbox                   ;

          clothFricSlider                   ;
          woodFricSlider                   ;
          stabilitySlider                   ;
          dampingSlider                   ;

          clothFricVal              ;
          woodFricVal              ;
          stabilityVal              ;
          dampingVal              ;

  constructor(container             , callbacks                   , initialSeed        ) {
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

         isVisible()          {
    return this.visible;
  }

         toggle()       {
    this.setVisible(!this.visible);
  }

         setVisible(show         )       {
    this.visible = show;
    this.container.hidden = !show;
  }

          buildDOM(initialSeed        )       {
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

    this.seedInput = this.container.querySelector('#dev-seed-input')                    ;
    this.stateSpan = this.container.querySelector('#dev-state-val')               ;
    this.timingSpan = this.container.querySelector('#dev-timing-val')               ;
    this.gestureSpan = this.container.querySelector('#dev-gesture-val')               ;
    this.objectsBody = this.container.querySelector('#dev-objects-tbody')               ;
    this.replayBtn = this.container.querySelector('#dev-replay-btn')                     ;
    this.overlayCheckbox = this.container.querySelector('#dev-overlay-chk')                    ;

    this.clothFricSlider = this.container.querySelector('#dev-cloth-fric')                    ;
    this.woodFricSlider = this.container.querySelector('#dev-wood-fric')                    ;
    this.stabilitySlider = this.container.querySelector('#dev-stability')                    ;
    this.dampingSlider = this.container.querySelector('#dev-damping')                    ;

    this.clothFricVal = this.container.querySelector('#dev-cloth-fric-val')               ;
    this.woodFricVal = this.container.querySelector('#dev-wood-fric-val')               ;
    this.stabilityVal = this.container.querySelector('#dev-stability-val')               ;
    this.dampingVal = this.container.querySelector('#dev-damping-val')               ;

    const closeBtn = this.container.querySelector('#dev-close-btn')                     ;
    closeBtn.addEventListener('click', () => this.setVisible(false));

    const applySeedBtn = this.container.querySelector('#dev-apply-seed-btn')                     ;
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
      slider                  ,
      valEl             ,
      key                        
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

         update(telemetry              )       {
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


//# sourceURL=devPanel.ts