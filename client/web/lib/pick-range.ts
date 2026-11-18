/**
 * The one pick rule of every list that picks rows for a move (the item
 * tree, the Files list and its thumbnails): cmd or ctrl toggles one row and
 * makes it the anchor; shift picks every row from the anchor to the clicked
 * one, in screen order, and adds them to the pick. A plain click is the
 * list's own (it opens the row).
 *
 * Pure: pinned by pick-range.test.ts.
 */

/** The ids from `anchorId` to `toId`, both included, in the order given.
 *  An anchor no longer on screen picks the clicked row alone; a clicked row
 *  that is not in the list picks nothing. */
export function rangeBetween(ids: readonly string[], anchorId: string, toId: string): string[] {
  const a = ids.indexOf(anchorId);
  const b = ids.indexOf(toId);
  if (a < 0 || b < 0) return b < 0 ? [] : [toId];
  return ids.slice(Math.min(a, b), Math.max(a, b) + 1);
}

export type PickHow = {
  /** Cmd or ctrl held: add or drop this one row. */
  toggle: boolean;
  /** Shift held: the range from the anchor. */
  range: boolean;
};

/** What a modified click turns the pick into, and the anchor after it. A
 *  shift-click with no anchor yet acts as a toggle (it sets the anchor). */
export function pickClick(
  picked: ReadonlySet<string>,
  order: readonly string[],
  anchor: string | null,
  id: string,
  how: PickHow,
): { picked: Set<string>; anchor: string | null } {
  if (how.range && anchor !== null) {
    const next = new Set(picked);
    for (const one of rangeBetween(order, anchor, id)) next.add(one);
    return { picked: next, anchor };
  }
  const next = new Set(picked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { picked: next, anchor: id };
}

/** Whether a click picks (a modifier is held) rather than opens. */
export function isPickClick(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey || e.shiftKey;
}

/** The pick with only the rows still on screen: a pick you can no longer
 *  see is a pick you will regret acting on. Same set back when nothing
 *  left, so nothing redraws. */
export function keepOnScreen(
  picked: ReadonlySet<string>,
  order: readonly string[],
): ReadonlySet<string> {
  if (picked.size === 0) return picked;
  const on = new Set(order);
  for (const id of picked) {
    if (!on.has(id)) return new Set([...picked].filter((x) => on.has(x)));
  }
  return picked;
}

/** The pick without `ids` (what a delete acted on): a delete of a file
 *  outside the pick leaves the pick as it was, the same set back. */
export function withoutPicks(
  picked: ReadonlySet<string>,
  ids: readonly string[],
): ReadonlySet<string> {
  if (!ids.some((id) => picked.has(id))) return picked;
  const gone = new Set(ids);
  return new Set([...picked].filter((x) => !gone.has(x)));
}
