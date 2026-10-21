/**
 * The item each workspace section last had open, so entering the section
 * opens it again (Jason, 2026-10-03: "For workspace items, always load the
 * last page, note or file the user opened").
 *
 * - Per section, per login, per brain. The key names the brain's origin and
 *   the login (an admin's email, a member's login id), so on a shared device
 *   one login's last item never opens for another, and a login is only ever
 *   sent to an item the brain says it can read (the read below).
 * - In this browser's localStorage, a per-viewer convenience like the card
 *   density or the rail width. Not on the profile: it follows the device you
 *   were working on, not the person.
 * - Restored only on ENTRY to a section's bare index (`/pages`, nothing in
 *   the query) from outside it. A link to an item, or any query (`?q=`, a
 *   folder, a tag), wins; so does going from an item back to its own list,
 *   which is why the route before this one is tracked (`noteRoute`).
 * - An item that is gone or no longer readable is forgotten, and the normal
 *   index shows instead.
 *
 * Pure apart from the module-level route trail, so the rules are unit-tested
 * (last-opened.test.ts) without a DOM.
 */
import { ApiError } from '@mantle/web-ui/api-fetch';

/** The sections that remember, by their index path. */
export const LAST_OPENED_SECTIONS = ['pages', 'notes', 'files', 'tables', 'draw'] as const;
export type LastOpenedSection = (typeof LAST_OPENED_SECTIONS)[number];

const PREFIX = 'jackdaw_last_opened_v1:';

/** Ids are uuids today; anything outside this shape is not one we wrote. */
const ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

export type LastOpenedStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function lastOpenedKey(brain: string, login: string, section: LastOpenedSection): string {
  return `${PREFIX}${encodeURIComponent(brain)}:${encodeURIComponent(login)}:${section}`;
}

/** The remembered id, or null. Storage can be blocked, junk or hand-edited:
 *  none of that may take the screen down, so every miss is just null. */
export function readLastOpened(store: LastOpenedStore | null, key: string): string | null {
  try {
    const raw = store?.getItem(key) ?? null;
    return raw && ID_SHAPE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function rememberLastOpened(store: LastOpenedStore | null, key: string, id: string): void {
  if (!ID_SHAPE.test(id)) return;
  try {
    store?.setItem(key, id);
  } catch {
    // Quota or blocked storage: the section just opens on its list.
  }
}

export function forgetLastOpened(store: LastOpenedStore | null, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    // Blocked storage: nothing was kept to forget.
  }
}

/** The section a pathname belongs to: its index or anything under it. */
export function sectionOf(pathname: string | null): LastOpenedSection | null {
  if (!pathname) return null;
  const first = pathname.split('/')[1] ?? '';
  return (LAST_OPENED_SECTIONS as readonly string[]).includes(first)
    ? (first as LastOpenedSection)
    : null;
}

/**
 * Should entering `pathname?search` open the remembered item? Only the bare
 * index of the section, with nothing in the query, and only when the route
 * before it was outside the section: from `/pages/<id>` back to `/pages` is a
 * deliberate trip to the list.
 */
export function shouldRestore(
  section: LastOpenedSection,
  pathname: string,
  search: string,
  from: string | null,
): boolean {
  if (pathname !== `/${section}`) return false;
  if (search.replace(/^\?/, '') !== '') return false;
  return sectionOf(from) !== section;
}

// ─── The route before this one ────────────────────────────────────────────
// The app shell reports every pathname (noteRoute). A page reading the trail
// during its own first render or effect may run before or after the shell's
// effect for the same navigation, so `routeBefore` answers for both orders.

let trail: { prev: string | null; cur: string | null } = { prev: null, cur: null };

export function noteRoute(pathname: string): void {
  if (trail.cur === pathname) return;
  trail = { prev: trail.cur, cur: pathname };
}

export function routeBefore(pathname: string): string | null {
  return trail.cur === pathname ? trail.prev : trail.cur;
}

/** Tests only. */
export function resetRouteTrail(): void {
  trail = { prev: null, cur: null };
}

// ─── Is the item still there, and where does it open? ─────────────────────

/** Where to go, or why not: `gone` forgets the entry, `unknown` (a network
 *  blip, a 500) keeps it and shows the list this once. */
export type RestoreOutcome = { href: string } | 'gone' | 'unknown';

/** A 4xx on the item read means it is deleted, moved out of reach or no
 *  longer this login's to read. Anything else may pass. */
export function failureOutcome(err: unknown): 'gone' | 'unknown' {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? 'gone' : 'unknown';
}

type FetchJson = (path: string) => Promise<unknown>;

/** The restore of every login (W6b: one set of screens and routes): read
 *  the item the way its screen will, in the login's scope, then build the
 *  same URL the screen's own links build. A login that may not read it (a
 *  4xx) forgets it. */
export async function itemRestore(
  section: LastOpenedSection,
  id: string,
  fetchJson: FetchJson,
): Promise<RestoreOutcome> {
  const enc = encodeURIComponent(id);
  try {
    switch (section) {
      case 'pages':
        await fetchJson(`/api/pages/${enc}`);
        return { href: `/pages/${enc}` };
      case 'draw':
        await fetchJson(`/api/draws/${enc}`);
        // The drawing's own address: open to look at, the folders beside it;
        // the editor is one click on (`?edit=1`).
        return { href: `/draw/${enc}` };
      case 'notes':
        await fetchJson(`/api/notes/${enc}`);
        return { href: `/notes/${enc}` };
      case 'tables':
        await fetchJson(`/api/tables/${enc}`);
        return { href: `/tables/${enc}` };
      case 'files': {
        const body = (await fetchJson(`/api/files/files/${enc}`)) as {
          file?: { parentPath?: unknown };
        };
        const parent = body?.file?.parentPath;
        if (typeof parent !== 'string' || !parent) return 'unknown';
        const sp = new URLSearchParams({ path: parent, file: id });
        return { href: `/files?${sp.toString()}` };
      }
    }
  } catch (err) {
    return failureOutcome(err);
  }
}
