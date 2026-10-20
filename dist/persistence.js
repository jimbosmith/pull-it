/**
 * Local persistence with graceful fallback if browser storage is unavailable,
 * blocked by privacy settings, or throws QuotaExceeded / SecurityError.
 */

                              
                                      
                                            
 

                                
                    
                 
                         
                            
 

const STORAGE_KEY = 'pull_it_save_v1';

export class PersistenceManager {
          memoryFallback                = {
    bestScore: 0,
    muted: false,
    reducedMotion: false,
    seenFirstRunHint: false
  };
          storage                     = null;
          storageAvailable = false;

  constructor(customStorage                     ) {
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

         isStorageAvailable()          {
    return this.storageAvailable;
  }

         load()                {
    if (!this.storage) {
      this.storageAvailable = false;
      return { ...this.memoryFallback };
    }
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      this.storageAvailable = true;
      if (raw) {
        const parsed = JSON.parse(raw)                          ;
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

          save()       {
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

         getBestScore()         {
    return this.memoryFallback.bestScore;
  }

         recordScore(score        )          {
    const clean = Math.max(0, Math.floor(score));
    if (clean > this.memoryFallback.bestScore) {
      this.memoryFallback.bestScore = clean;
      this.save();
      return true;
    }
    return false;
  }

         isMuted()          {
    return this.memoryFallback.muted;
  }

         setMuted(muted         )       {
    this.memoryFallback.muted = muted;
    this.save();
  }

         isReducedMotion()          {
    return this.memoryFallback.reducedMotion;
  }

         setReducedMotion(reduced         )       {
    this.memoryFallback.reducedMotion = reduced;
    this.save();
  }

         hasSeenFirstRunHint()          {
    return this.memoryFallback.seenFirstRunHint;
  }

         markFirstRunHintSeen()       {
    this.memoryFallback.seenFirstRunHint = true;
    this.save();
  }
}


//# sourceURL=persistence.ts