// A small time-to-live cache. Expired entries are dropped whenever something new is stored.
export class TtlCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.entries = new Map(); // key -> { at, value }
  }

  // The value if it is younger than maxAgeMs (default: the cache's TTL), else undefined.
  get(key, maxAgeMs = this.ttlMs) {
    const entry = this.entries.get(key);
    return entry && Date.now() - entry.at < maxAgeMs ? entry.value : undefined;
  }

  set(key, value) {
    const now = Date.now();
    for (const [k, entry] of this.entries) {
      if (now - entry.at > this.ttlMs) this.entries.delete(k);
    }
    this.entries.set(key, { at: now, value });
    return value;
  }

  delete(key) {
    this.entries.delete(key);
  }

  ageOf(key) {
    const entry = this.entries.get(key);
    return entry ? Date.now() - entry.at : Infinity;
  }

  timeOf(key) {
    return this.entries.get(key)?.at ?? null;
  }

  // Fresh values, newest first, no older than maxAgeMs.
  *recent(maxAgeMs) {
    const now = Date.now();
    for (const entry of [...this.entries.values()].reverse()) {
      if (now - entry.at <= maxAgeMs) yield entry.value;
    }
  }

  // Load through the cache; concurrent callers for the same key share one load.
  async getOrLoad(key, load) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    this.pending ??= new Map();
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = (async () => {
      try {
        return this.set(key, await load());
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, promise);
    return promise;
  }
}
