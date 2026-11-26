/** Fixed-window limiter, keyed by caller. Small and in-memory: one rover, one operator. */
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      // Opportunistic cleanup so the map cannot grow without bound.
      if (hits.size > 1000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}
