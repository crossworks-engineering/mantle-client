/**
 * Where a drop of files from the desktop lands, free of React so it can be
 * unit-tested. One rule for every view of the Files screen: an element
 * that takes a drop names its folder in `data-drop-path` (a tree folder
 * row, a child folder card, a pane of the two-pane view); the nearest one
 * under the pointer wins, and anywhere else the drop goes to the folder the
 * screen is in (the `?path=` it shows, which a search, Recent or an open
 * file keeps).
 *
 * Pure: pinned by file-drop.test.ts.
 */

/** The attribute a drop target names its folder path in. */
export const DROP_PATH_ATTR = 'data-drop-path';

/** Whether a drag carries files (from the desktop). A drag of text, a link
 *  or a row inside the page is not an upload and shows no drop zone. */
export function isFileDrag(types: ArrayLike<string> | null | undefined): boolean {
  if (!types) return false;
  for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
  return false;
}

/**
 * The drag depth after one event. A drag fires `dragenter` on each child it
 * crosses and `dragleave` on the one it left, so a plain "leave = hide"
 * flickers the zone on every child border. Counting enters against leaves,
 * the zone hides only when the count is back to 0. A drop or the end of a
 * drag clears it.
 */
export function dragDepth(depth: number, event: 'enter' | 'leave' | 'end'): number {
  if (event === 'enter') return depth + 1;
  if (event === 'leave') return Math.max(0, depth - 1);
  return 0;
}

/** The part of an element `dropPathAt` reads (a DOM Element has it). */
type Closest = { closest: (selector: string) => { getAttribute: (n: string) => string | null } | null };

/** The folder path a drop at `target` lands in: the nearest drop target's,
 *  else `fallback` (the folder the screen is in). */
export function dropPathAt(target: unknown, fallback: string): string {
  const el = target as Partial<Closest> | null;
  if (!el || typeof el.closest !== 'function') return fallback;
  const hit = el.closest(`[${DROP_PATH_ATTR}]`);
  return hit?.getAttribute(DROP_PATH_ATTR) || fallback;
}

/**
 * A folder path as the words of its breadcrumb: the root as `rootName`, each
 * folder below by its title when `titleOf` knows it, else its path segment
 * (underscores read as dashes, as the Files header shows them).
 * `files.work.q3_reports` -> ['Files', 'work', 'q3-reports'].
 */
export function folderCrumbs(
  path: string,
  titleOf?: (path: string) => string | null | undefined,
  rootName = 'Files',
): string[] {
  const segments = path.split('.').filter(Boolean);
  return segments.map((seg, i) => {
    if (i === 0) return rootName;
    const title = titleOf?.(segments.slice(0, i + 1).join('.'));
    return title || seg.replace(/_/g, '-');
  });
}

/** One line for a breadcrumb: "Files › work › reports". */
export function crumbText(crumbs: readonly string[]): string {
  return crumbs.join(' › ');
}
