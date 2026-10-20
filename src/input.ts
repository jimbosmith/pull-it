import type { PointerSample, PullGestureCommand, SimulationConfig } from './types.ts';

export interface GestureAnalysisResult {
  valid: boolean;
  cancelReason?: string;
  command?: PullGestureCommand;
}

export interface LiveDragPreview {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  clampedDirX: number;
  clampedDirY: number;
  angleDeg: number;
  strokeLengthNorm: number;
  willCancel: boolean;
}

/**
 * Pure, frame-rate-independent analyzer that converts timestamped pointer samples
 * into a deterministic PullGestureCommand.
 *
 * Key design choices for real mouse & touch usability:
 * 1. Ignores stationary hold/aim dwell at the start or end of a gesture so players
 *    who grab the handle, aim using the directional arrow, and release are not
 *    penalized as if they dragged at 0 m/s.
 * 2. Resamples the active movement onto a uniform 4ms timeline and uses a wide
 *    smoothing kernel so integer pixel quantization from mice never creates
 *    artificial jerk spikes.
 */
export function analyzeGestureSamples(
  samples: readonly PointerSample[],
  config: SimulationConfig
): GestureAnalysisResult {
  if (samples.length < 2) {
    return { valid: false, cancelReason: 'Tap cancelled — pull the handle downward' };
  }

  const firstRaw = samples[0];
  const lastRaw = samples[samples.length - 1];
  const dxTotal = lastRaw.worldX - firstRaw.worldX;
  const dyTotal = lastRaw.worldY - firstRaw.worldY;

  // Comfortable phone/mouse stroke reference: ~0.28m in world space (~95 CSS px)
  const normRefMeters = config.tableHalfLength * 0.64;
  const netDisplacementMeters = Math.hypot(dxTotal, dyTotal);
  const strokeLengthNorm = netDisplacementMeters / normRefMeters;

  // Must pull generally downward (+Y) and exceed minimum stroke threshold
  if (dyTotal < 0.022 || strokeLengthNorm < config.minSwipeStrokeNorm) {
    return {
      valid: false,
      cancelReason: 'Pull further down from the handle to whip the cloth'
    };
  }

  // Isolate the active movement window (5% to 95% of net displacement from start)
  // This cleanly strips out any time spent holding the mouse still before or after moving!
  let startIdx = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const distFromStart = Math.hypot(
      samples[i].worldX - firstRaw.worldX,
      samples[i].worldY - firstRaw.worldY
    );
    if (distFromStart <= netDisplacementMeters * 0.06) {
      startIdx = i;
    } else {
      break;
    }
  }

  let endIdx = samples.length - 1;
  for (let i = samples.length - 1; i > startIdx + 1; i--) {
    const distFromEnd = Math.hypot(
      samples[i].worldX - lastRaw.worldX,
      samples[i].worldY - lastRaw.worldY
    );
    if (distFromEnd <= netDisplacementMeters * 0.05) {
      endIdx = i;
    } else {
      break;
    }
  }

  const activeSamples = samples.slice(startIdx, endIdx + 1);
  const first = activeSamples[0];
  const last = activeSamples[activeSamples.length - 1];
  const activeDtMs = Math.max(14, last.timeMs - first.timeMs);

  // Resample active trajectory onto a fixed 4ms grid for frame-rate invariance (30/60/120fps)
  const sampleStepMs = 4;
  const gridCount = Math.max(6, Math.min(240, Math.floor(activeDtMs / sampleStepMs) + 1));
  const gridX: number[] = new Array(gridCount);
  const gridY: number[] = new Array(gridCount);

  let srcIdx = 0;
  for (let g = 0; g < gridCount; g++) {
    const tMs = first.timeMs + (g / (gridCount - 1)) * activeDtMs;
    while (srcIdx < activeSamples.length - 2 && activeSamples[srcIdx + 1].timeMs < tMs) {
      srcIdx++;
    }
    const s0 = activeSamples[srcIdx];
    const s1 = activeSamples[srcIdx + 1];
    const span = Math.max(1e-5, s1.timeMs - s0.timeMs);
    const alpha = Math.max(0, Math.min(1, (tMs - s0.timeMs) / span));
    gridX[g] = s0.worldX + (s1.worldX - s0.worldX) * alpha;
    gridY[g] = s0.worldY + (s1.worldY - s0.worldY) * alpha;
  }

  // Compute smoothed velocities using a wider window (up to 6 grid steps = 24ms)
  // to eliminate 1-pixel mouse quantization jitter
  const halfWin = Math.max(1, Math.min(6, Math.floor((gridCount - 1) / 3)));
  const stepSec = activeDtMs / (gridCount - 1) / 1000;

  const speeds: number[] = [];
  let dirWeightX = 0;
  let dirWeightY = 0;

  for (let g = halfWin; g < gridCount - halfWin; g++) {
    const dt = Math.max(1e-4, 2 * halfWin * stepSec);
    const vx = (gridX[g + halfWin] - gridX[g - halfWin]) / dt;
    const vy = (gridY[g + halfWin] - gridY[g - halfWin]) / dt;
    const s = Math.hypot(vx, vy);
    speeds.push(s);
    dirWeightX += vx * (0.5 + g / gridCount);
    dirWeightY += vy * (0.5 + g / gridCount);
  }

  if (speeds.length === 0) {
    const fallbackDt = activeDtMs / 1000;
    const vx = (last.worldX - first.worldX) / fallbackDt;
    const vy = (last.worldY - first.worldY) / fallbackDt;
    speeds.push(Math.hypot(vx, vy));
    dirWeightX = vx;
    dirWeightY = vy;
  }

  // Sort speeds to find the top-quartile active whip speed (robust against slow aim phases)
  const sortedSpeeds = [...speeds].sort((a, b) => a - b);
  const p75Speed = sortedSpeeds[Math.floor((sortedSpeeds.length - 1) * 0.75)];
  const meanSpeed = speeds.reduce((acc, v) => acc + v, 0) / speeds.length;

  // Blend active mean speed and 75th-percentile whip speed
  const measuredSpeedMps = meanSpeed * 0.55 + p75Speed * 0.45;
  const normalizedSpeed = measuredSpeedMps / normRefMeters;

  // Compute direction from overall stroke vector blended with velocity-weighted vector
  const rawAngleRad = Math.atan2(
    dxTotal * 0.6 + dirWeightX * 0.02,
    Math.max(0.001, dyTotal * 0.6 + dirWeightY * 0.02)
  );
  const rawAngleDeg = (rawAngleRad * 180) / Math.PI;
  const maxAngle = config.maxPullAngleDeg;
  const clampedAngleDeg = Math.max(-maxAngle, Math.min(maxAngle, rawAngleDeg));
  const clampedAngleRad = (clampedAngleDeg * Math.PI) / 180;

  const dirX = Math.sin(clampedAngleRad);
  const dirY = Math.cos(clampedAngleRad);

  // Compute macroscopic path straightness & speed steadiness (immune to 1-2px mouse noise)
  // Measure maximum perpendicular deviation from the straight line between first and last sample
  const lineLen = Math.max(0.01, Math.hypot(dxTotal, dyTotal));
  const ux = dxTotal / lineLen;
  const uy = dyTotal / lineLen;
  let maxPerpDevMeters = 0;
  for (let g = 0; g < gridCount; g++) {
    const relX = gridX[g] - firstRaw.worldX;
    const relY = gridY[g] - firstRaw.worldY;
    const perp = Math.abs(relX * uy - relY * ux);
    if (perp > maxPerpDevMeters) {
      maxPerpDevMeters = perp;
    }
  }

  // Ignore small hand tremor (< 12mm in world space, ~4px on screen)
  const lateralWobblePenalty = Math.max(0, (maxPerpDevMeters - 0.012) * 14.0);

  // Measure macroscopic speed stutter (large drops/reversals across smoothed segments)
  let peakAccel = 0;
  let stutterAccum = 0;
  for (let i = 1; i < speeds.length; i++) {
    const dv = speeds[i] - speeds[i - 1];
    const accel = Math.abs(dv) / Math.max(0.004, stepSec);
    if (accel > peakAccel) peakAccel = accel;
    // Only count large velocity reversals (> 0.65 m/s drop between smoothed windows)
    if (dv < -0.65 && i < speeds.length - 2) {
      stutterAccum += Math.abs(dv) * 0.45;
    }
  }

  // Unlimited speed penalty: extreme violent yanks (> 9.5 norm units/s) add cloth snap
  const excessSpeedTurbulence = Math.max(0, (normalizedSpeed - 9.5) * 0.12);

  const jerkMetric = Math.min(
    1.5,
    lateralWobblePenalty + stutterAccum + excessSpeedTurbulence
  );

  // Map gesture speed to bounded physical cloth extraction speed
  // Normalized speed ~1.4 or below = slow drag; ~3.0 - 6.0 = brisk whip
  const speedRatio = Math.max(0, Math.min(1, (normalizedSpeed - 1.35) / 4.6));
  const extractionSpeedMps =
    config.minExtractionSpeedMps +
    speedRatio * (config.maxExtractionSpeedMps - config.minExtractionSpeedMps);

  const totalClothTravelMeters = config.tableHalfLength * 2.05;
  const extractionDurationSec = totalClothTravelMeters / extractionSpeedMps;

  return {
    valid: true,
    command: {
      dirX,
      dirY,
      angleDeg: clampedAngleDeg,
      normalizedSpeed,
      extractionSpeedMps,
      peakAccel,
      jerkMetric,
      strokeLengthNorm,
      extractionDurationSec,
      samples: samples.map((s) => ({ ...s }))
    }
  };
}

/**
 * Helper to create a synthetic deterministic gesture for testing or developer presets.
 */
export function createSyntheticGestureSamples(options: {
  startX?: number;
  startY?: number;
  endX: number;
  endY: number;
  durationMs: number;
  sampleRateHz?: number;
  wobbleAmplitudeX?: number;
  stutter?: boolean;
}): PointerSample[] {
  const startX = options.startX ?? 0;
  const startY = options.startY ?? 0.46;
  const rate = options.sampleRateHz ?? 60;
  const count = Math.max(3, Math.round((options.durationMs / 1000) * rate) + 1);
  const samples: PointerSample[] = [];

  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    const progress = options.stutter
      ? u + 0.18 * Math.sin(u * Math.PI * 5)
      : 0.25 * u + 0.75 * u * u;
    const clampedP = Math.max(0, Math.min(1.05, progress));
    const wobble = (options.wobbleAmplitudeX ?? 0) * Math.sin(u * Math.PI * 3);
    const wx = startX + (options.endX - startX) * clampedP + wobble;
    const wy = startY + (options.endY - startY) * clampedP;
    samples.push({
      worldX: wx,
      worldY: wy,
      screenX: wx * 400,
      screenY: wy * 400,
      timeMs: i * (options.durationMs / (count - 1))
    });
  }
  return samples;
}
