// Oddiy xotiradagi "fixed window" cheklagich. Bitta instans uchun yetarli;
// bir nechta instans bo'lsa Redis kabi umumiy omborga o'tkazing.
export function createRateLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map();

  const sweep = (t) => {
    for (const [k, e] of hits) if (e.reset <= t) hits.delete(k);
  };

  return {
    hit(key) {
      const t = now();
      let e = hits.get(key);
      if (!e || e.reset <= t) {
        e = { count: 0, reset: t + windowMs };
        hits.set(key, e);
        if (hits.size > 10000) sweep(t);
      }
      e.count += 1;
      return {
        allowed: e.count <= max,
        limit: max,
        remaining: Math.max(0, max - e.count),
        retryAfterSec: Math.max(1, Math.ceil((e.reset - t) / 1000)),
      };
    },
    clear() { hits.clear(); },
    size() { return hits.size; },
  };
}
