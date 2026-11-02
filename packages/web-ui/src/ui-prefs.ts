/**
 * The UI's own small preferences, kept by this page's origin: the sign-in
 * presence flag and layout state (rail widths and collapse, the spend range,
 * the assistant pick, panel layouts). The one place the UI keeps them.
 *
 * localStorage, not cookies. The brain never reads these values, and the
 * page reads them itself now that the UI is static files. A cookie worked on
 * every host but one: the desktop app on its own URL scheme
 * (mantle-ui://localhost), where WebKit keeps no cookies at all, so the
 * presence flag never stuck and every load went back to /login. localStorage
 * works on every host: the box, Electron and the Tauri shell.
 *
 * A value can carry an end time, as its cookie's Max-Age did. Values written
 * as cookies by an earlier build are moved here on first read, and the cookie
 * is dropped. This file is the only one allowed to touch document.cookie
 * (eslint.config.mjs), and only for that move.
 */

const PREFIX = 'mantle_pref:';

/** The sign-in presence flag (token-store sets it, the boot route guard reads
 *  it). The name of the cookie it once was, so an older build's cookie moves
 *  over. */
export const PRESENCE_PREF = 'mantle_authed';

type Stored = { v: string; exp?: number };

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The value as an earlier build left it in a cookie, or undefined. */
function cookieValue(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function dropCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** A cookie from an earlier build: keep its value here and drop the cookie.
 *  The cookie goes only once the value is kept: with storage full, it stays
 *  and is read again next time, rather than lost. */
function adoptCookie(name: string): string | undefined {
  const value = cookieValue(name);
  if (value === undefined) return undefined;
  if (writePref(name, value, adoptedMaxAge(name))) dropCookie(name);
  return value;
}

const DAY = 60 * 60 * 24;

/** How long a value moved over from a cookie is kept, by the Max-Age its
 *  cookie was written with (that cookie's own end is not readable): the
 *  presence flag 30 days, the sidebar a week, the panel layouts until
 *  cleared (they were session cookies, and are written without an end now),
 *  and the layout state a year. */
function adoptedMaxAge(name: string): number | undefined {
  if (name === PRESENCE_PREF) return 30 * DAY;
  if (name === 'sidebar:state') return 7 * DAY;
  if (name.startsWith('react-resizable-panels:')) return undefined;
  return 365 * DAY;
}

/** The value, or undefined when there is none or it has ended. */
export function readPref(name: string): string | undefined {
  const ls = storage();
  if (!ls) return undefined;
  let raw: string | null;
  try {
    raw = ls.getItem(PREFIX + name);
  } catch {
    return undefined;
  }
  if (raw === null) {
    try {
      return adoptCookie(name);
    } catch {
      return undefined;
    }
  }
  try {
    const stored = JSON.parse(raw) as Stored | null;
    if (!stored || typeof stored.v !== 'string') return undefined;
    if (typeof stored.exp === 'number' && stored.exp <= Date.now()) {
      ls.removeItem(PREFIX + name);
      return undefined;
    }
    return stored.v;
  } catch {
    return undefined;
  }
}

/** Keep a value, for `maxAgeSeconds` when given (else until cleared). False
 *  when it could not be kept: no storage, or storage full or refused. */
export function writePref(name: string, value: string, maxAgeSeconds?: number): boolean {
  const ls = storage();
  if (!ls) return false;
  const stored: Stored =
    maxAgeSeconds === undefined
      ? { v: value }
      : { v: value, exp: Date.now() + maxAgeSeconds * 1000 };
  try {
    ls.setItem(PREFIX + name, JSON.stringify(stored));
    return true;
  } catch {
    /* storage full or refused: the preference just won't persist */
    return false;
  }
}

/** Forget a value, and any cookie an earlier build left for it. */
export function clearPref(name: string): void {
  try {
    storage()?.removeItem(PREFIX + name);
    dropCookie(name);
  } catch {
    /* nothing to clear */
  }
}
