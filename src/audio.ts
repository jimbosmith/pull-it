import type { FailureCause, ObjectType } from './types.ts';

/**
 * Procedural Web Audio synthesizer and optional haptics controller.
 * Requires zero external audio assets and initializes strictly on user gesture.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private noiseBuffer: AudioBuffer | null = null;
  private lastCollisionSoundMs: number = 0;

  constructor(initialMuted: boolean = false) {
    this.muted = initialMuted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  /**
   * Call inside any pointerdown / click handler to initialize or resume AudioContext.
   */
  public unlock(): void {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.ctx) {
        this.ctx = new AudioCtx();
        this.createNoiseBuffer();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
    } catch {
      // AudioContext blocked or unsupported
    }
  }

  private createNoiseBuffer(): void {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate;
    const length = Math.floor(sampleRate * 0.8);
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      // Soft pink-ish filtering for realistic linen fabric texture
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2 + white * 0.18) * 0.65;
    }
    this.noiseBuffer = buffer;
  }

  private vibrate(pattern: number | number[]): void {
    if (this.muted || typeof navigator === 'undefined') return;
    try {
      if (typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignore haptics errors on unsupported browsers
    }
  }

  public playHandleGrab(): void {
    if (this.muted || !this.ctx || !this.noiseBuffer) return;
    try {
      const now = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(520, now);
      filter.Q.setValueAtTime(2.2, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      src.start(now);
      src.stop(now + 0.1);
      this.vibrate(8);
    } catch {
      // Ignore audio errors
    }
  }

  public playCancel(): void {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.095);
    } catch {
      // Ignore
    }
  }

  public playClothWhoosh(speedMps: number, durationSec: number): void {
    if (this.muted || !this.ctx || !this.noiseBuffer) return;
    try {
      const now = this.ctx.currentTime;
      const dur = Math.max(0.12, Math.min(0.65, durationSec * 1.15));
      const speedNorm = Math.max(0, Math.min(1, (speedMps - 0.5) / 4.0));

      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const startFreq = 350 + speedNorm * 450;
      const peakFreq = 900 + speedNorm * 1600;
      filter.frequency.setValueAtTime(startFreq, now);
      filter.frequency.exponentialRampToValueAtTime(peakFreq, now + dur * 0.45);
      filter.frequency.exponentialRampToValueAtTime(280, now + dur);
      filter.Q.setValueAtTime(1.4, now);

      const gain = this.ctx.createGain();
      const peakGain = 0.16 + speedNorm * 0.14;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(peakGain, now + dur * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      src.start(now);
      src.stop(now + dur + 0.02);
      this.vibrate(15);
    } catch {
      // Ignore
    }
  }

  public playCollision(impactSpeed: number, typeA: ObjectType, typeB?: ObjectType): void {
    if (this.muted || !this.ctx) return;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - this.lastCollisionSoundMs < 45) return;
    this.lastCollisionSoundMs = nowMs;

    try {
      const now = this.ctx.currentTime;
      const volume = Math.min(0.22, Math.max(0.02, impactSpeed * 0.28));
      const isGlass = typeA === 'glass' || typeB === 'glass';

      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const baseFreq = isGlass ? 1480 : typeA === 'bowl' ? 680 : typeA === 'plate' ? 820 : 540;
      osc1.type = 'sine';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(baseFreq, now);
      osc2.frequency.setValueAtTime(baseFreq * 1.58, now);

      const decay = isGlass ? 0.16 : 0.09;
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + decay + 0.01);
      osc2.stop(now + decay + 0.01);
    } catch {
      // Ignore
    }
  }

  public playSpawnPop(): void {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(310, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.065);

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.085);
    } catch {
      // Ignore
    }
  }

  public playSuccess(closeCall: boolean = false): void {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const notes = closeCall ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        const start = now + idx * 0.065;
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.26);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(start);
        osc.stop(start + 0.28);
      });
      this.vibrate(closeCall ? [12, 30, 18] : 15);
    } catch {
      // Ignore
    }
  }

  public playFailure(cause: FailureCause): void {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      // Low table/floor thud
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(cause === 'fell_off_edge' ? 140 : 185, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.32);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.36);

      // Ceramic/glass clatter harmonics
      const clinkFreqs = [880, 1140, 620];
      clinkFreqs.forEach((f, idx) => {
        if (!this.ctx) return;
        const cOsc = this.ctx.createOscillator();
        const cGain = this.ctx.createGain();
        cOsc.type = 'sine';
        const t0 = now + 0.04 + idx * 0.045;
        cOsc.frequency.setValueAtTime(f, t0);
        cOsc.frequency.exponentialRampToValueAtTime(f * 0.72, t0 + 0.14);

        cGain.gain.setValueAtTime(0.08, t0);
        cGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);

        cOsc.connect(cGain);
        cGain.connect(this.ctx.destination);
        cOsc.start(t0);
        cOsc.stop(t0 + 0.16);
      });

      this.vibrate([30, 40, 60]);
    } catch {
      // Ignore
    }
  }
}
