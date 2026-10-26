/**
 * The desk grid's pixel geometry and the drag arithmetic: where a cell is on
 * screen, and where a carried widget lands. Pure, so a drop is unit-tested
 * (desk-geometry.test.ts) without a pointer.
 */
import {
  DESK_COLS,
  DESK_SCREEN_ROWS,
  moveWidget,
  resizeWidget,
  specOf,
  type DeskItem,
  type DeskWidgetId,
} from '@/lib/home-desk';

export const PAD = 12;
export const GAP = 12;
export const MIN_ROW = 64;
export const MAX_ROW = 132;
/** Pixels the pointer moves before a press becomes a carry. */
export const SLOP = 5;

export type Metrics = { colW: number; rowH: number; width: number; height: number };

/** Columns share the desk's width; rows share one screen's height (within
 *  bounds), so the default desk fills the screen. */
export function measureDesk(width: number, height: number): Metrics {
  const colW = Math.max(24, (width - PAD * 2 - GAP * (DESK_COLS - 1)) / DESK_COLS);
  const fill = (height - PAD * 2 - GAP * (DESK_SCREEN_ROWS - 1)) / DESK_SCREEN_ROWS;
  const rowH = Math.min(MAX_ROW, Math.max(MIN_ROW, fill));
  return { colW, rowH, width, height };
}

export type Box = { left: number; top: number; width: number; height: number };

export function cellRect(item: Pick<DeskItem, 'x' | 'y' | 'w' | 'h'>, m: Metrics): Box {
  return {
    left: PAD + item.x * (m.colW + GAP),
    top: PAD + item.y * (m.rowH + GAP),
    width: item.w * m.colW + (item.w - 1) * GAP,
    height: item.h * m.rowH + (item.h - 1) * GAP,
  };
}

/** Whole rows a content-sized widget needs for `px` of content. */
export function rowsFor(px: number, m: Metrics): number {
  return Math.ceil((px + GAP) / (m.rowH + GAP));
}

export type Carry = {
  id: DeskWidgetId;
  mode: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  /** The desk's scrollTop when the widget was picked up. */
  startScroll: number;
  /** The widget as it stood when picked up. */
  origin: DeskItem;
  /** How far the pointer has carried it, in desk px: the pointer's travel
   *  plus however far the desk has scrolled under it since. */
  dx: number;
  dy: number;
  started: boolean;
};

/** The carried widget's box under the pointer. */
export function carryBox(c: Carry, m: Metrics): Box {
  const base = cellRect(c.origin, m);
  if (c.mode === 'move') return { ...base, left: base.left + c.dx, top: base.top + c.dy };
  return {
    ...base,
    width: Math.max(m.colW, base.width + c.dx),
    height: Math.max(m.rowH, base.height + c.dy),
  };
}

/** The desk if the carried widget were dropped now: the cell nearest its
 *  box, or the size nearest it (a content-sized widget takes a new width
 *  only), the rest making way. */
export function carryTarget(items: readonly DeskItem[], c: Carry, m: Metrics): DeskItem[] {
  const box = carryBox(c, m);
  if (c.mode === 'move') {
    const x = Math.round((box.left - PAD) / (m.colW + GAP));
    const y = Math.round((box.top - PAD) / (m.rowH + GAP));
    return moveWidget(items, c.id, x, y);
  }
  const w = Math.round((box.width + GAP) / (m.colW + GAP));
  const h = specOf(c.id).autoHeight ? c.origin.h : Math.round((box.height + GAP) / (m.rowH + GAP));
  return resizeWidget(items, c.id, w, h);
}
