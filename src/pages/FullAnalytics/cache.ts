// ═══════════════════════════════════════════════════════════
// FullAnalytics — Cache (stale-while-revalidate)
//
// Only "All Time" data is cached.
// Date-range filtered results are NOT cached — they are
// computed client-side from the cached full dataset.
// ═══════════════════════════════════════════════════════════

export const CACHE_KEY_FULL_COST  = 'aegis:fullAnalytics:costData';
export const CACHE_KEY_FULL_USAGE = 'aegis:fullAnalytics:usageData';
export const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

/** Read a cached entry. Returns null if the key is missing or JSON is invalid. */
export function cacheGet<T>(key: string): { data: T; ts: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as { data: T; ts: number };
  } catch {
    return null;
  }
}

/** Write a value to the cache, annotated with the current timestamp. */
export function cacheSet(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // Silently ignore quota exceeded or other storage errors
  }
}

/**
 * Check whether a cached entry is still within the TTL window.
 * Returns false if the key is missing or the data is stale.
 */
export function cacheIsFresh(key: string): boolean {
  const entry = cacheGet<unknown>(key);
  if (!entry) return false;
  return Date.now() - entry.ts < CACHE_TTL_MS;
}
