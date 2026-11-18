/**
 * The optional Sync service: email and contacts. The brain says whether it is
 * on in GET /api/shell `features.sync`; while it is off, the client hides the
 * screens that need it and gates a typed link to one with a plain card.
 * Linking a mailbox or a calendar feed is the Sync service's own screen
 * (/settings/sync, a sandboxed frame): no provider code in this client.
 *
 * The rule is one check: hidden only when the brain says `sync: false`. A
 * brain before the field sends nothing, and then nothing hides.
 *
 * Pure helpers only: no DOM here.
 */
import type { Tour } from './tour/model';

/** The screens that need Sync. A local list until the contract carries a
 *  per-row service field. */
export const SYNC_HREFS: ReadonlySet<string> = new Set(['/inbox', '/contacts', '/settings/sync']);

export const SYNC_OFF_TITLE = 'Sync is turned off';
export const SYNC_OFF_TEXT =
  'Email, contacts and mail accounts need the Sync service. An admin can turn it on in Settings > Services.';

/**
 * `features.sync` on GET /api/shell, until the pinned contract package
 * (@mantle/client-types) carries it.
 */
export type SyncShellFeatures = { sync?: boolean };

/** Whether the shell says Sync is off: only an explicit `false`. True, a
 *  missing field, a shell without `features` and no shell at all keep it on. */
export function syncOffOf(shell: unknown): boolean {
  if (shell === null || typeof shell !== 'object') return false;
  const features = (shell as { features?: SyncShellFeatures | null }).features;
  return features?.sync === false;
}

/** Whether `href` is a Sync screen (the screen itself or one under it). */
export function isSyncPath(href: string): boolean {
  for (const h of SYNC_HREFS) {
    if (href === h || href.startsWith(`${h}/`) || href.startsWith(`${h}?`)) return true;
  }
  return false;
}

/** Whether the nav offers `href`. The sidebar and the search palette ask this. */
export function syncOffered(href: string, off: boolean): boolean {
  return !off || !isSyncPath(href);
}

/** The nav without the Sync rows while it is off. A hidden href leaves a
 *  collapsible group's cold-start head too, and a group left empty goes. */
export function withSync<G extends { items: { href: string }[]; defaultHead?: readonly string[] }>(
  groups: readonly G[],
  off: boolean,
): G[] {
  if (!off) return [...groups];
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => syncOffered(i.href, off)),
      ...(g.defaultHead ? { defaultHead: g.defaultHead.filter((h) => syncOffered(h, off)) } : {}),
    }))
    .filter((g) => g.items.length > 0);
}

/** A tour without the stops on a Sync screen while it is off. */
export function tourWithSync(tour: Tour, off: boolean): Tour {
  if (!off) return tour;
  const onSync = (s: Tour['steps'][number]) =>
    isSyncPath(s.route) || (!!s.target?.startsWith('nav:') && isSyncPath(s.target.slice(4)));
  return { ...tour, steps: tour.steps.filter((s) => !onSync(s)) };
}
