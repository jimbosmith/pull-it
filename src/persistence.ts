/**
 * Local persistence with graceful fallback if browser storage is unavailable,
 * blocked by privacy settings, or throws QuotaExceeded / SecurityError.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PersistedData {
  bestScore: number;
  muted: boolean;
  reducedMotion: boolean;
  seenFirstRunHint: boolean;
}

const STORAGE_KEY = 'pull_it_save_v1';

export class PersistenceManager {
  private memoryFallback: PersistedData = {
    bestScore: 0,
    muted: false,
    reducedMotion: false,
    seenFirstRunHint: false
  };
  private storage: StorageLike | null = null;
  private storageAvailable = false;

  constructor(customStorage?: StorageLike | null) {
    if (customStorage !== undefined) {
      this.storage = customStorage;
    } else if (typeof window !== 'undefined') {
      try {
        this.storage = window.localStorage;
      } catch {
        this.storage = null;
      }
    }

    // Detect OS-level reduced motion preference if available
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          this.memoryFallback.reducedMotion = true;
        }
      } catch {
        // Ignore matchMedia errors
      }
    }

    this.load();
  }

  public isStorageAvailable(): boolean {
    return this.storageAvailable;
  }

  public load(): PersistedData {
    if (!this.storage) {
      this.storageAvailable = false;
      return { ...this.memoryFallback };
    }
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      this.storageAvailable = true;
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedData>;
        if (typeof parsed.bestScore === 'number' && Number.isFinite(parsed.bestScore) && parsed.bestScore >= 0) {
          this.memoryFallback.bestScore = Math.floor(parsed.bestScore);
        }
        if (typeof parsed.muted === 'boolean') {
          this.memoryFallback.muted = parsed.muted;
        }
        if (typeof parsed.reducedMotion === 'boolean') {
          this.memoryFallback.reducedMotion = parsed.reducedMotion;
        }
        if (typeof parsed.seenFirstRunHint === 'boolean') {
          this.memoryFallback.seenFirstRunHint = parsed.seenFirstRunHint;
        }
      }
    } catch {
      this.storageAvailable = false;
    }
    return { ...this.memoryFallback };
  }

  private save(): void {
    if (!this.storage) {
      this.storageAvailable = false;
      return;
    }
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.memoryFallback));
      this.storageAvailable = true;
    } catch {
      this.storageAvailable = false;
    }
  }

  public getBestScore(): number {
    return this.memoryFallback.bestScore;
  }

  public recordScore(score: number): boolean {
    const clean = Math.max(0, Math.floor(score));
    if (clean > this.memoryFallback.bestScore) {
      this.memoryFallback.bestScore = clean;
      this.save();
      return true;
    }
    return false;
  }

  public isMuted(): boolean {
    return this.memoryFallback.muted;
  }

  public setMuted(muted: boolean): void {
    this.memoryFallback.muted = muted;
    this.save();
  }

  public isReducedMotion(): boolean {
    return this.memoryFallback.reducedMotion;
  }

  public setReducedMotion(reduced: boolean): void {
    this.memoryFallback.reducedMotion = reduced;
    this.save();
  }

  public hasSeenFirstRunHint(): boolean {
    return this.memoryFallback.seenFirstRunHint;
  }

  public markFirstRunHintSeen(): void {
    this.memoryFallback.seenFirstRunHint = true;
    this.save();
  }
}
