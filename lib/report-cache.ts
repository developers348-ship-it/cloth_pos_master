/**
 * A module-scoped cache for report payloads, so returning to a report page
 * shows the last result immediately instead of an empty table.
 *
 * The reports page is a client component: navigating away unmounts it and
 * throws its rows away, so every visit paid the full round trip to the database
 * before anything appeared. This keeps the last payload alive for as long as
 * the tab is open — the page renders it on mount and refetches underneath, then
 * swaps in the fresh rows (stale-while-revalidate).
 *
 * One entry per namespace, not one per query: the point is "show me what I was
 * just looking at", and a single slot can't grow without bound. The `key`
 * records which filters produced the value, so a caller can tell a hit for the
 * filters it is about to request from a leftover under different ones.
 *
 * In-memory only. A full page reload starts empty, which is what you want —
 * nothing here is ever the source of truth.
 */

type Entry = { key: string; value: unknown; at: number };

const store = new Map<string, Entry>();

/**
 * The cached payload for `namespace`, or null. With a `key`, returns the value
 * only when it was stored under that exact key; without one, returns whatever
 * is there — that is how a page shows something on mount, before session data
 * has arrived and the real key can be built.
 */
export function readReportCache<T>(namespace: string, key?: string): T | null {
  const entry = store.get(namespace);
  if (!entry) return null;
  if (key !== undefined && entry.key !== key) return null;
  return entry.value as T;
}

/** True when the cached entry for `namespace` was stored under `key`. */
export function isReportCacheFresh(namespace: string, key: string): boolean {
  return store.get(namespace)?.key === key;
}

export function writeReportCache<T>(namespace: string, key: string, value: T): void {
  store.set(namespace, { key, value, at: Date.now() });
}

/** Drops a namespace's entry (or everything), forcing the next visit to load. */
export function clearReportCache(namespace?: string): void {
  if (namespace) store.delete(namespace);
  else store.clear();
}
