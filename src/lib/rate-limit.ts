import { headers } from "next/headers";

/**
 * In-memory sliding-window rate limiter. Deliberately not Redis: the app runs
 * as a single long-lived Railway container, so one process sees all traffic.
 * If that ever changes, this file is the one thing to swap.
 *
 * Each key keeps the timestamps of its recent hits; a hit is allowed when
 * fewer than `limit` timestamps remain inside the window.
 */
const buckets = new Map<string, number[]>();

// A scan endpoint hammered by a bot would otherwise fill the map forever.
const MAX_KEYS = 10_000;

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  let hits = buckets.get(key);
  if (!hits) {
    if (buckets.size >= MAX_KEYS) {
      // Drop the stalest bucket rather than refusing service to new keys.
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    hits = [];
    buckets.set(key, hits);
  }

  // Prune expired hits in place.
  let i = 0;
  while (i < hits.length && hits[i] <= cutoff) i++;
  if (i > 0) hits.splice(0, i);

  if (hits.length >= limit) {
    return { ok: false, retryAfterMs: hits[0] + windowMs - now };
  }
  hits.push(now);
  // Refresh insertion order so the LRU eviction above drops truly stale keys.
  buckets.delete(key);
  buckets.set(key, hits);
  return { ok: true, retryAfterMs: 0 };
}

/**
 * Caller IP as Railway's proxy reports it. Falls back to "local" in dev where
 * the header is absent — which conveniently exercises the limiter in testing.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "local";
}

/** Test hook — the battery resets state between cases. */
export function _resetRateLimits() {
  buckets.clear();
}
