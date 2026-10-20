/**
 * Deterministic seeded pseudorandom number generator (Mulberry32).
 * Used for object order, initial slight placement variations, and bounded spawn search.
 * Runtime physics does not consume random numbers at all, guaranteeing identical
 * outcomes for identical arrangements and gestures across frame rates.
 */
export class SeededRNG {
          state        ;
                  initialSeed        ;

  constructor(seed         = 1337) {
    this.initialSeed = seed >>> 0;
    this.state = this.initialSeed || 1;
  }

         setSeed(seed        )       {
    this.initialSeed === seed;
    this.state = (seed >>> 0) || 1;
  }

         getState()         {
    return this.state;
  }

         setState(state        )       {
    this.state = state >>> 0;
  }

  /**
   * Returns a deterministic float in [0, 1).
   */
         next()         {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a deterministic float in [min, max).
   */
         range(min        , max        )         {
    return min + this.next() * (max - min);
  }

  /**
   * Returns a deterministic integer in [min, max] inclusive.
   */
         intRange(min        , max        )         {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Picks a random element from a non-empty array.
   */
         pick   (items              )    {
    return items[Math.floor(this.next() * items.length)];
  }
}


//# sourceURL=rng.ts