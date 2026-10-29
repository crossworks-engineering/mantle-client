/**
 * One sound per event across this browser's tabs: two windows that both see a
 * run start (each polls the same brain) must not both chime. The first tab to
 * claim an event's key plays; the others find the claim and stay quiet.
 * Claims live in localStorage (shared by the tabs of one origin) and expire
 * after ONCE_TTL_MS, so the store stays small. Pure apart from the storage
 * it is handed; pinned by once.test.ts.
 */

export const ONCE_KEY = 'mantle_sounds_once_v1';
/** Long enough for every tab's next look at the same event (the slowest poll
 *  is the collapsed Activity column's minute), short enough to stay small. */
export const ONCE_TTL_MS = 5 * 60_000;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function readClaims(store: Store): Record<string, number> {
  try {
    const raw = store.getItem(ONCE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Whether this tab may sound the event `key`: true the first time any tab
 *  asks within the TTL, false after. No storage (private mode, a throw)
 *  answers true: a double chime beats a missing one. */
export function claimOnce(store: Store | null, key: string, now = Date.now()): boolean {
  if (!store) return true;
  const claims = readClaims(store);
  const at = claims[key];
  if (typeof at === 'number' && now - at < ONCE_TTL_MS) return false;
  const kept: Record<string, number> = {};
  for (const [k, t] of Object.entries(claims)) {
    if (typeof t === 'number' && now - t < ONCE_TTL_MS) kept[k] = t;
  }
  kept[key] = now;
  try {
    store.setItem(ONCE_KEY, JSON.stringify(kept));
  } catch {
    /* full or blocked: still play */
  }
  return true;
}
