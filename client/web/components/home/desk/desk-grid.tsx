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
  useSyncExternalStore,
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
  withAutoHeights,
  type DeskItem,
  type DeskWidgetId,
} from '@/lib/home-desk';
import {
  GAP,
  PAD,
  SLOP,
  carryBox,
  carryTarget,
  cellRect,
  measureDesk,
  rowsFor,
  type Carry,
  type Metrics,
} from './desk-geometry';

/**
 * The desk's grid: places every widget on whole cells, follows the pointer
 * while one is carried, and shows the others making way before it lands.
 *
 * - A widget is picked up by its handle (anything marked `data-desk-handle`:
 *   a widget's title bar, a desk icon whole) once the pointer has moved a
 *   few pixels, so a click on a desk icon still opens it.
 * - While carried it floats under the pointer, lifted and tilted a little;
 *   a dashed outline marks the cells it will take and the rest of the desk
 *   rearranges live (desk-geometry `carryTarget`). Near the desk's edge the
 *   desk scrolls, and the widget stays under the pointer.
 * - The corner grip resizes, in whole cells, within the widget's bounds.
 * - From the keyboard, on a widget's grip: arrows move it a cell, Shift with
 *   an arrow resizes it (a desk icon: Alt with an arrow).
 * - A widget whose height follows its content (the sticky notes) is drawn at
 *   the rows it needs; what it pushes is pushed only as drawn, so when it
 *   needs fewer rows again everything goes back where it was put.
 * - On a phone (below the md breakpoint) the widgets stack in reading order
 *   and nothing drags.
 */

/** Below md: the phone layout. The viewport decides, not the desk's own
 *  width, so a panel opened beside the desk never flips it to the phone
 *  layout (which would remount every widget mid-edit). */
const PHONE = '(max-width: 767px)';

function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

type DeskCtx = {
  carrying: DeskWidgetId | null;
  /** Move or resize from the keyboard (the widget's grip). */
  nudge: (id: DeskWidgetId, e: ReactKeyboardEvent) => boolean;
  /** A widget whose height follows its content (the sticky notes) reports
   *  the px it needs; the desk draws it that many whole rows tall. */
  fitHeight: (id: DeskWidgetId, px: number) => void;
  /** The row height in px (it follows the screen's height), so a widget that
   *  fits its content measures again when the rows change. */
  rowH: number | null;
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
  // The scroller is a different element in the phone layout, so the
  // measuring follows whichever one is mounted.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    scroller.current = node;
    setScrollEl(node);
  }, []);
  const narrow = useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
  const [m, setM] = useState<Metrics | null>(null);
  const [carry, setCarry] = useState<Carry | null>(null);
  /** Rows each content-sized widget needs right now (drawn, never stored). */
  const [auto, setAuto] = useState<Partial<Record<DeskWidgetId, number>>>({});
  /** A carry that ended on a desk icon must not also open it. */
  const swallowClick = useRef(false);

  // The desk as drawn: content-sized widgets at their rows, the rest settled.
  const base = useMemo(() => withAutoHeights(items, auto), [items, auto]);

  // What the window listeners and the drop read: always this render's.
  const live = useRef({ base, m, onChange, carry });
  live.current = { base, m, onChange, carry };

  useLayoutEffect(() => {
    const el = scrollEl;
    if (!el) return;
    const measure = () => setM(measureDesk(el.clientWidth, el.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollEl]);

  const fitHeight = useCallback((id: DeskWidgetId, px: number) => {
    const { m: metrics, carry: c } = live.current;
    if (!metrics || c?.started) return;
    const s = specOf(id);
    const rows = Math.min(s.max.h, Math.max(s.min.h, rowsFor(px, metrics)));
    setAuto((a) => (a[id] === rows ? a : { ...a, [id]: rows }));
  }, []);

  const target = useMemo(
    () => (carry?.started && m ? carryTarget(base, carry, m) : null),
    [carry, base, m],
  );
  const shown = target ?? base;

  const carrying = carry !== null;
  // Pointer tracking lives on the window while a carry is open, so a fast
  // flick off the widget (or off the desk) does not drop it mid-air. It is
  // subscribed once per carry and reads everything from `live`, so a drop
  // always lands where the last move put it.
  useEffect(() => {
    if (!carrying) return;
    const finish = (commit: boolean) => {
      const { carry: c, base: now, m: metrics, onChange: save } = live.current;
      if (c?.started) {
        if (commit && metrics) save(carryTarget(now, c, metrics));
        // The click a drop makes (if the browser makes one) comes in this
        // same turn; after it, clicks are clicks again.
        swallowClick.current = true;
        setTimeout(() => {
          swallowClick.current = false;
        }, 0);
      }
      setCarry(null);
    };
    const onMove = (e: PointerEvent) => {
      const c = live.current.carry;
      if (!c || e.pointerId !== c.pointerId) return;
      const el = scroller.current;
      const moved = Math.hypot(e.clientX - c.startX, e.clientY - c.startY);
      if (!c.started && moved < SLOP) return;
      // A carry is not a text selection: drop what the press began selecting.
      if (!c.started) window.getSelection()?.removeAllRanges();
      // Near the desk's top or bottom edge, the desk scrolls to follow.
      if (el) {
        const r = el.getBoundingClientRect();
        if (e.clientY > r.bottom - 48) el.scrollTop += 14;
        else if (e.clientY < r.top + 48) el.scrollTop -= 14;
      }
      const scrolled = el ? el.scrollTop - c.startScroll : 0;
      setCarry({
        ...c,
        started: true,
        dx: e.clientX - c.startX,
        dy: e.clientY - c.startY + scrolled,
      });
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === live.current.carry?.pointerId) finish(true);
    };
    // The browser took the pointer (a touch turned into a scroll, a system
    // gesture): the widget goes back where it was, nothing lands half-way.
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId === live.current.carry?.pointerId) finish(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [carrying]);

  const begin = useCallback(
    (id: DeskWidgetId, mode: Carry['mode'], e: ReactPointerEvent) => {
      const { base: now, m: metrics } = live.current;
      if (narrow || !metrics || e.button !== 0) return;
      const origin = now.find((i) => i.id === id);
      if (!origin) return;
      setCarry({
        id,
        mode,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startScroll: scroller.current?.scrollTop ?? 0,
        origin,
        dx: 0,
        dy: 0,
        started: false,
      });
    },
    [narrow],
  );

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
      rowH: m?.rowH ?? null,
      startResize: (id, e) => {
        e.stopPropagation();
        e.preventDefault();
        begin(id, 'resize', e);
      },
      nudge: (id, e) => {
        const step = ARROWS[e.key];
        if (!step) return false;
        const now = live.current.base;
        const item = now.find((i) => i.id === id);
        if (!item) return false;
        e.preventDefault();
        const dh = specOf(id).autoHeight ? 0 : step[1];
        live.current.onChange(
          e.shiftKey
            ? resizeWidget(now, id, item.w + step[0], item.h + dh)
            : moveWidget(now, id, item.x + step[0], item.y + step[1]),
        );
        return true;
      },
    }),
    [carry?.started, carry?.id, narrow, fitHeight, m?.rowH, begin],
  );

  /** Reading order of the desk as it stands (not as it is being dragged):
   *  the order Tab walks and the phone stacks. */
  const order = useMemo(
    () => [...base].sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.id),
    [base],
  );

  if (narrow) {
    const ordered = order.map((id) => base.find((i) => i.id === id)!);
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
  const shownById = new Map(shown.map((i) => [i.id, i]));

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
            ? order.map((id) => {
                const item = shownById.get(id);
                if (!item) return null;
                const isCarried = carry?.started && carry.id === id;
                const rect = cellRect(item, m);
                let style: CSSProperties = rect;
                if (isCarried) {
                  const box = carryBox(carry, m);
                  style = {
                    left: box.left,
                    top: box.top,
                    width: carry.mode === 'resize' ? box.width : rect.width,
                    height:
                      carry.mode === 'resize' && !specOf(id).autoHeight ? box.height : rect.height,
                    zIndex: 30,
                    transform: carry.mode === 'move' ? 'rotate(-1.2deg) scale(1.02)' : undefined,
                  };
                }
                return (
                  <div
                    key={id}
                    data-desk-item={id}
                    onPointerDown={onPointerDown(id)}
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
          style={cellRect({ x, y, w: 1, h: 1 }, m)}
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
