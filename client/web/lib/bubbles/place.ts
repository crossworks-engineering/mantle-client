/**
 * Where the bubble stack sits, once it has been dragged: in this browser, for
 * this login. Until then it sits with the bottom-right dock. Pure parse and
 * clamp, pinned by place.test.ts.
 */

export type BubblePlace = { x: number; y: number };

const PLACE_PREFIX = 'mantle_bubbles_place_v1:';
/** The avatar stands this far out over the card's top-left corner. */
export const AVATAR_OVERHANG = 12;
/** The stack's edges show this far under the card. */
export const EDGE_DEPTH = 16;
/** A press that moves less than this is a click, not a drag. */
export const DRAG_SLOP = 4;

/** A stored place: anything unreadable reads as none. */
export function parsePlace(raw: string | null | undefined): BubblePlace | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<BubblePlace> | null;
    return typeof v?.x === 'number' &&
      typeof v.y === 'number' &&
      Number.isFinite(v.x) &&
      Number.isFinite(v.y)
      ? { x: v.x, y: v.y }
      : null;
  } catch {
    return null;
  }
}

/** The whole stack on screen, with its avatar and its edges: there is no
 *  taskbar to get it back from. A window too small for it keeps the top-left. */
export function clampPlace(
  p: BubblePlace,
  box: { w: number; h: number; vw: number; vh: number },
): BubblePlace {
  const maxX = box.vw - box.w;
  const maxY = box.vh - box.h - EDGE_DEPTH;
  return {
    x: Math.max(AVATAR_OVERHANG, Math.min(p.x, maxX)),
    y: Math.max(AVATAR_OVERHANG, Math.min(p.y, maxY)),
  };
}

export function readPlace(login: string): BubblePlace | null {
  try {
    return parsePlace(window.localStorage.getItem(`${PLACE_PREFIX}${login}`));
  } catch {
    return null;
  }
}

export function writePlace(login: string, p: BubblePlace): void {
  try {
    window.localStorage.setItem(`${PLACE_PREFIX}${login}`, JSON.stringify(p));
  } catch {
    /* private mode: the place lasts for the visit */
  }
}
