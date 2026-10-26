'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '@mantle/web-ui/lib/utils';
import {
  DESK_COLS,
  DESK_SCREEN_ROWS,
  deskBottom,
  isPin,
  moveWidget,
  resizeWidget,
  specOf,
  type DeskItem,
  type DeskWidgetId,
} from '@/lib/home-desk';

/**
 * The desk's grid: places every widget on whole cells, follows the pointer
 * while one is carried, and shows the others making way before it lands.
 *
 * - A widget is picked up by its handle (anything marked `data-desk-handle`:
 *   a widget's title bar, a desk icon whole) once the pointer has moved a
 *   few pixels, so a click on a desk icon still opens it.
 * - While carried it floats under the pointer, lifted and tilted a little;
 *   a dashed outline marks the cells it will take and the rest of the desk
 *   rearranges live (lib/home-desk `moveWidget`).
 * - The corner grip resizes, in whole cells, within the widget's bounds.
 * - From the keyboard, on a widget's grip: arrows move it a cell, Shift with
 *   an arrow resizes it.
 * - Below the md breakpoint there is no room for a desk: the widgets stack
 *   in reading order (top to bottom, left to right) and nothing drags.
 */

const PAD = 12;
const GAP = 12;
const MIN_ROW = 64;
const MAX_ROW = 132;
/** Pixels the pointer moves before a press becomes a carry. */
const SLOP = 5;
const NARROW = 768;

type Metrics = { colW: number; rowH: number; width: number; height: number };

type Carry = {
  id: DeskWidgetId;
  mode: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  origin: DeskItem;
  /** The carried widget's top-left (move) or size (resize) in px, live. */
  px: { left: number; top: number; width: number; height: number };
  started: boolean;
};

type DeskCtx = {
  carrying: DeskWidgetId | null;
  /** Move or resize from the keyboard (the widget's grip). */
  nudge: (id: DeskWidgetId, e: ReactKeyboardEvent) => boolean;
  /** A widget whose height follows its content (the sticky notes) reports
   *  the px it needs; the desk gives it that many whole rows. */
  fitHeight: (id: DeskWidgetId, px: number) => void;
  /** Start a resize from a widget's corner grip. */
  startResize: (id: DeskWidgetId, e: ReactPointerEvent) => void;
  narrow: boolean;
};

const Ctx = createContext<DeskCtx | null>(null);

export function useDeskGrid(): DeskCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDeskGrid outside DeskGrid');
  return ctx;
}

function cellRect(item: DeskItem, m: Metrics) {
  return {
    left: PAD + item.x * (m.colW + GAP),
    top: PAD + item.y * (m.rowH + GAP),
    width: item.w * m.colW + (item.w - 1) * GAP,
    height: item.h * m.rowH + (item.h - 1) * GAP,
  };
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function DeskGrid({
  items,
  onChange,
  renderItem,
  className,
}: {
  items: readonly DeskItem[];
  /** A finished move or resize: the whole desk as it now stands. */
  onChange: (items: DeskItem[]) => void;
  renderItem: (item: DeskItem) => ReactNode;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  // The scroller is a different element in the stacked (narrow) layout, so
  // the measuring follows whichever one is mounted.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    scroller.current = node;
    setScrollEl(node);
  }, []);
  const [m, setM] = useState<Metrics | null>(null);
  const [carry, setCarry] = useState<Carry | null>(null);
  const carryRef = useRef<Carry | null>(null);
  carryRef.current = carry;
  /** What fitHeight reads: the latest desk, never a stale render's. */
  const latest = useRef({ items, onChange, m: null as Metrics | null, narrow: false });
  /** A carry that ended on a desk icon must not also open it. */
  const swallowClick = useRef(false);

  useLayoutEffect(() => {
    const el = scrollEl;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      const colW = Math.max(24, (width - PAD * 2 - GAP * (DESK_COLS - 1)) / DESK_COLS);
      const fill = (height - PAD * 2 - GAP * (DESK_SCREEN_ROWS - 1)) / DESK_SCREEN_ROWS;
      const rowH = Math.min(MAX_ROW, Math.max(MIN_ROW, fill));
      setM({ colW, rowH, width, height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollEl]);

  const narrow = m !== null && m.width < NARROW;
  latest.current = { items, onChange, m, narrow };

  const fitHeight = useCallback((id: DeskWidgetId, px: number) => {
    const { items: now, onChange: save, m: metrics, narrow: stacked } = latest.current;
    if (!metrics || stacked || carryRef.current?.started) return;
    const item = now.find((i) => i.id === id);
    if (!item) return;
    const s = specOf(id);
    const rows = Math.ceil((px + GAP) / (metrics.rowH + GAP));
    const h = Math.min(s.max.h, Math.max(s.min.h, rows));
    if (h !== item.h) save(resizeWidget(now, id, item.w, h));
  }, []);

  /** Where the carried widget would land, from its live px box. */
  const target = useMemo((): DeskItem[] | null => {
    if (!carry?.started || !m) return null;
    const { origin, px } = carry;
    if (carry.mode === 'move') {
      const x = Math.round((px.left - PAD) / (m.colW + GAP));
      const y = Math.round((px.top - PAD) / (m.rowH + GAP));
      return moveWidget(items, origin.id, x, y);
    }
    const w = Math.round((px.width + GAP) / (m.colW + GAP));
    const h = Math.round((px.height + GAP) / (m.rowH + GAP));
    return resizeWidget(items, origin.id, w, h);
  }, [carry, items, m]);

  const shown = target ?? items;

  const finish = useCallback(
    (commit: boolean) => {
      const c = carryRef.current;
      if (c?.started && commit && target) onChange(target);
      if (c?.started) {
        // The click a drop makes (if the browser makes one) comes in this
        // same turn; after it, clicks are clicks again.
        swallowClick.current = true;
        setTimeout(() => {
          swallowClick.current = false;
        }, 0);
      }
      setCarry(null);
    },
    [onChange, target],
  );

  // Pointer tracking lives on the window while a carry is open, so a fast
  // flick off the widget (or off the desk) does not drop it mid-air.
  useEffect(() => {
    if (!carry) return;
    const onMove = (e: PointerEvent) => {
      const c = carryRef.current;
      if (!c || e.pointerId !== c.pointerId || !m) return;
      const dx = e.clientX - c.startX;
      const dy = e.clientY - c.startY;
      if (!c.started && Math.hypot(dx, dy) < SLOP) return;
      // A carry is not a text selection: drop what the press began selecting.
      if (!c.started) window.getSelection()?.removeAllRanges();
      const base = cellRect(c.origin, m);
      const next: Carry =
        c.mode === 'move'
          ? { ...c, started: true, px: { ...base, left: base.left + dx, top: base.top + dy } }
          : {
              ...c,
              started: true,
              px: {
                ...base,
                width: Math.max(m.colW, base.width + dx),
                height: Math.max(m.rowH, base.height + dy),
              },
            };
      setCarry(next);
      // Near the desk's top or bottom edge, the desk scrolls to follow.
      const el = scroller.current;
      if (el) {
        const r = el.getBoundingClientRect();
        if (e.clientY > r.bottom - 48) el.scrollTop += 14;
        else if (e.clientY < r.top + 48) el.scrollTop -= 14;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== carryRef.current?.pointerId) return;
      finish(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [carry, finish, m]);

  const begin = (id: DeskWidgetId, mode: Carry['mode'], e: ReactPointerEvent) => {
    if (narrow || !m || e.button !== 0) return;
    const origin = items.find((i) => i.id === id);
    if (!origin) return;
    const rect = cellRect(origin, m);
    setCarry({
      id,
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin,
      px: rect,
      started: false,
    });
  };

  const onPointerDown = (id: DeskWidgetId) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!t.closest('[data-desk-handle]')) return;
    // Controls inside a title bar keep their own clicks; the grip carries.
    const grip = t.closest('[data-desk-grip]');
    if (!grip && t.closest('button, input, textarea, select, [role="slider"], [data-no-drag]')) {
      return;
    }
    begin(id, 'move', e);
  };

  const ctx = useMemo<DeskCtx>(
    () => ({
      carrying: carry?.started ? carry.id : null,
      narrow,
      fitHeight,
      startResize: (id, e) => {
        e.stopPropagation();
        e.preventDefault();
        begin(id, 'resize', e);
      },
      nudge: (id, e) => {
        const step = ARROWS[e.key];
        if (!step) return false;
        const item = items.find((i) => i.id === id);
        if (!item) return false;
        e.preventDefault();
        onChange(
          e.shiftKey
            ? resizeWidget(items, id, item.w + step[0], item.h + step[1])
            : moveWidget(items, id, item.x + step[0], item.y + step[1]),
        );
        return true;
      },
    }),
    // `begin` reads items and m, both deps here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [carry?.started, carry?.id, narrow, items, onChange, m, fitHeight],
  );

  const ordered = useMemo(() => [...shown].sort((a, b) => a.y - b.y || a.x - b.x), [shown]);

  if (narrow) {
    const icons = ordered.filter((i) => isPin(i.id));
    const widgets = ordered.filter((i) => !isPin(i.id));
    return (
      <Ctx.Provider value={ctx}>
        <div ref={scrollRef} className={cn('h-full overflow-y-auto scrollbar-thin', className)}>
          <div className="flex flex-col gap-3 p-3">
            {/* On a phone the desk icons sit together in one row, like a
                home screen, ahead of the widgets. */}
            {icons.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {icons.map((item) => (
                  <div key={item.id} className="h-24 w-20">
                    {renderItem(item)}
                  </div>
                ))}
              </div>
            ) : null}
            {widgets.map((item) => (
              <div key={item.id} style={{ minHeight: item.h * 88 }} className="flex flex-col">
                {renderItem(item)}
              </div>
            ))}
          </div>
        </div>
      </Ctx.Provider>
    );
  }

  const rows = Math.max(DESK_SCREEN_ROWS, deskBottom(shown) + (carry?.started ? 2 : 0));
  const innerHeight = m ? PAD * 2 + rows * m.rowH + (rows - 1) * GAP : undefined;
  const placeholder = carry?.started && target ? target.find((i) => i.id === carry.id) : null;

  return (
    <Ctx.Provider value={ctx}>
      <div
        ref={scrollRef}
        className={cn(
          'relative h-full overflow-y-auto overflow-x-hidden scrollbar-thin',
          carry && 'select-none',
          className,
        )}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="relative" style={{ height: innerHeight }}>
          {/* The desk's cells, faintly, while something is being carried. */}
          {m && carry?.started ? <DeskCells m={m} rows={rows} /> : null}
          {m && placeholder ? (
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-xl border-2 border-dashed border-primary/60 bg-primary/10 transition-all duration-150"
              style={cellRect(placeholder, m)}
            />
          ) : null}
          {m
            ? shown.map((item) => {
                const isCarried = carry?.started && carry.id === item.id;
                const rect = cellRect(item, m);
                const style: CSSProperties = isCarried
                  ? {
                      left: carry.px.left,
                      top: carry.px.top,
                      width: carry.mode === 'resize' ? carry.px.width : rect.width,
                      height: carry.mode === 'resize' ? carry.px.height : rect.height,
                      zIndex: 30,
                      transform: carry.mode === 'move' ? 'rotate(-1.2deg) scale(1.02)' : undefined,
                    }
                  : rect;
                return (
                  <div
                    key={item.id}
                    data-desk-item={item.id}
                    onPointerDown={onPointerDown(item.id)}
                    className={cn(
                      'absolute flex flex-col',
                      isCarried
                        ? 'cursor-grabbing select-none drop-shadow-2xl'
                        : 'transition-[left,top,width,height] duration-200 ease-out',
                    )}
                    style={style}
                  >
                    {renderItem(item)}
                  </div>
                );
              })
            : null}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function DeskCells({ m, rows }: { m: Metrics; rows: number }) {
  const cells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < DESK_COLS; x++) {
      cells.push(
        <div
          key={`${x}:${y}`}
          className="absolute rounded-lg bg-foreground/[0.035]"
          style={cellRect({ id: 'clock', x, y, w: 1, h: 1 }, m)}
        />,
      );
    }
  }
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {cells}
    </div>
  );
}
