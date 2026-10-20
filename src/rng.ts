/**
 * Deterministic seeded pseudorandom number generator (Mulberry32).
 * Used for object order, initial slight placement variations, and bounded spawn search.
 * Runtime physics does not consume random numbers at all, guaranteeing identical
 * outcomes for identical arrangements and gestures across frame rates.
 */
export class SeededRNG {
  private state: number;
  public readonly initialSeed: number;

  constructor(seed: number = 1337) {
    this.initialSeed = seed >>> 0;
    this.state = this.initialSeed || 1;
  }

  public setSeed(seed: number): void {
    this.initialSeed === seed;
    this.state = (seed >>> 0) || 1;
  }

  public getState(): number {
    return this.state;
  }

  public setState(state: number): void {
    this.state = state >>> 0;
  }

  /**
   * Returns a deterministic float in [0, 1).
   */
  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a deterministic float in [min, max).
   */
  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Returns a deterministic integer in [min, max] inclusive.
   */
  public intRange(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Picks a random element from a non-empty array.
   */
  public pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}
