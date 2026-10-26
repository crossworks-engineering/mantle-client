'use client';

import { useCallback, useEffect, useState } from 'react';
import { readStored, writeStored } from './safe-storage';

/**
 * A preference that survives a reload, read WITHOUT breaking hydration.
 *
 * The pattern this replaces is everywhere in the app and is a real bug, not a
 * style question:
 *
 *     useState(() => localStorage.getItem('files:view') ?? 'list')
 *
 * The root layout is `force-dynamic`, so that component renders on the server —
 * where there is no `localStorage` — and again on the client, where there is.
 * Two different first renders is precisely what a hydration mismatch is: React
 * keeps the server's markup and the client's state, and the screen shows a
 * value nobody chose until something else happens to re-render it. The lazy
 * initialiser is also unguarded, and `localStorage` ACCESS (not just its
 * contents) throws in a browser set to block site data — which took the whole
 * member surface to the error page once already.
 *
 * So: render the fallback on both sides, then adopt the stored value in an
 * effect, which only ever runs on the client and only after hydration has
 * matched. The cost is one extra render for anyone who has a stored preference;
 * the alternative is a screen that is occasionally wrong and a crash in a
 * privacy-hardened browser.
 */

/**
 * Decide what a stored string means — the whole of the logic, kept pure so it
 * can be tested without a DOM.
 *
 * `parse` returns `null` for anything it does not recognise, which covers a
 * value written by an older build, a hand-edited one, and the `null` that
 * comes back when the key is absent.
 */
export function decodeStored<T>(
  raw: string | null,
  parse: (s: string) => T | null,
  fallback: T,
): T {
  if (raw === null) return fallback;
  const parsed = parse(raw);
  return parsed === null ? fallback : parsed;
}

/** One of a fixed set of strings — the common case, and its own parser. */
export function oneOf<T extends string>(...allowed: readonly T[]) {
  return (s: string): T | null => (allowed.includes(s as T) ? (s as T) : null);
}

/**
 * A flag stored as `'1'`/`'0'` — what every shell in this app already writes.
 * Anything else is not a choice anyone made, so the fallback stands.
 *
 * Here rather than beside each caller because there are four of them, and four
 * hand-rolled copies of a two-value codec is how they drift.
 */
export function parseFlag(raw: string): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

export function serialiseFlag(on: boolean): string {
  return on ? '1' : '0';
}

/**
 * An integer pinned inside bounds. Storage is hand-editable and survives a
 * build that changed the bounds, so an out-of-range number is CLAMPED rather
 * than rejected — a rail saved at 900px should come back at the maximum, not
 * at the default, which is a different width from the one the user chose.
 * Junk that is not a number at all falls back.
 */
export function clampedInt(min: number, max: number) {
  return (raw: string): number | null => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(max, Math.max(min, parsed));
  };
}

/**
 * `key` null: not known yet (a per-login key before the shell answers).
 * Nothing is read or written until it is; the value is the fallback, or a
 * choice made meanwhile, for this page only. A new key takes ITS stored
 * value (or the fallback), whatever the last key held.
 */
export function usePersistedState<T>(
  key: string | null,
  fallback: T,
  parse: (s: string) => T | null,
  serialise: (v: T) => string = String,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  // After hydration, not during it. No storage (lib/safe-storage reads
  // null): the fallback stands, which is a working screen.
  useEffect(() => {
    if (key === null) return;
    setValue(decodeStored(readStored(key), parse, fallback));
    // Deliberately once per key: re-running on a new `parse` identity would
    // stamp the stored value back over a choice the user just made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (v: T) => {
      setValue(v);
      // Private mode: the choice holds for this session and no longer.
      if (key !== null) writeStored(key, serialise(v));
    },
    [key, serialise],
  );

  return [value, set];
}
