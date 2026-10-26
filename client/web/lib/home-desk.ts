/**
 * The Home desk: the Built-in home as a desk of widgets on a grid (Jason,
 * 2026-10-26: "like a desk, a real desk"). Every widget and every desk icon
 * (a pinned item) is a rectangle of whole cells on a DESK_COLS wide grid;
 * the person drags them anywhere and resizes them, and the desk remembers
 * where each one was put.
 *
 * A desk is free placement, not a flowing list: nothing falls up into an
 * empty space on its own (a gap on a desk is a gap someone left). A widget
 * dropped onto others pushes them down, and "Tidy up" is the one deliberate
 * move that closes the gaps.
 *
 * Pure: no React, no storage, so the rules are unit-tested (home-desk.test.ts).
 */
import { isTreeKind, TREE_KINDS, type TreeKind } from '@mantle/client-types/tree';

/** Columns across the desk. Positions are stored in these units. */
export const DESK_COLS = 12;
/** Rows the desk fills on one screen; more scroll. The row height is the
 *  screen's height over these, so the default desk uses the whole screen. */
export const DESK_SCREEN_ROWS = 8;
/** A kind widget's items: the default and the most. */
export const KIND_COUNT_DEFAULT = 5;
export const KIND_COUNT_MAX = 10;
export const KIND_COUNT_MIN = 1;

/** The desk tools: widgets that are not a list of one kind's items. */
export const DESK_TOOLS = [
  'clock',
  'calendar',
  'quick-note',
  'theme',
  'drift',
  'focus',
  'glance',
  'workspaces',
] as const;
export type DeskTool = (typeof DESK_TOOLS)[number];

/** The kinds a desk can hold a widget of. Secrets never sit on a desk. */
export const DESK_KINDS: readonly TreeKind[] = TREE_KINDS.filter((k) => k !== 'secrets');

/** A widget's id: a tool, `kind:<tree kind>`, or `pin:<item id>` (a desk
 *  icon). One of each: the id is also the widget's identity. */
export type DeskWidgetId = DeskTool | `kind:${TreeKind}` | `pin:${string}`;

export type DeskItem = { id: DeskWidgetId; x: number; y: number; w: number; h: number };

export type DeskPrefs = {
  v: 1;
  /** Every widget on the desk, desk icons included. Absent = off. */
  items: DeskItem[];
  /** Items a kind widget shows, pins included (KIND_COUNT_MIN..MAX). */
  counts: Partial<Record<TreeKind, number>>;
  /** Pinned items as desk icons. */
  icons: boolean;
  clock: 'digital' | 'analog';
};

type Size = { w: number; h: number };
/** `autoHeight`: the widget's height follows its content (the sticky
 *  notes); a person sets only its width. */
export type WidgetSpec = { size: Size; min: Size; max: Size; autoHeight?: boolean };

const spec = (w: number, h: number, min: Size, max: Size): WidgetSpec => ({
  size: { w, h },
  min,
  max,
});

export const TOOL_SPECS: Record<DeskTool, WidgetSpec> = {
  clock: spec(3, 2, { w: 2, h: 2 }, { w: 6, h: 5 }),
  calendar: spec(4, 4, { w: 3, h: 3 }, { w: 8, h: 7 }),
  'quick-note': spec(4, 2, { w: 3, h: 2 }, { w: 8, h: 5 }),
  theme: spec(4, 2, { w: 3, h: 2 }, { w: 8, h: 4 }),
  drift: spec(4, 2, { w: 2, h: 2 }, { w: 12, h: 8 }),
  focus: spec(3, 2, { w: 2, h: 2 }, { w: 5, h: 5 }),
  glance: spec(6, 2, { w: 3, h: 2 }, { w: 12, h: 4 }),
  workspaces: spec(3, 3, { w: 2, h: 2 }, { w: 6, h: 8 }),
};

const KIND_SPEC = spec(4, 3, { w: 2, h: 2 }, { w: 8, h: 8 });
const NOTES_SPEC = { ...spec(7, 3, { w: 3, h: 2 }, { w: 12, h: 16 }), autoHeight: true };
const ICON_SPEC = spec(1, 1, { w: 1, h: 1 }, { w: 1, h: 1 });

export function specOf(id: DeskWidgetId): WidgetSpec {
  if (id.startsWith('pin:')) return ICON_SPEC;
  if (id === 'kind:notes') return NOTES_SPEC;
  if (id.startsWith('kind:')) return KIND_SPEC;
  return TOOL_SPECS[id as DeskTool];
}

export function isPin(id: DeskWidgetId): id is `pin:${string}` {
  return id.startsWith('pin:');
}

export function kindOf(id: DeskWidgetId): TreeKind | null {
  if (!id.startsWith('kind:')) return null;
  const k = id.slice(5);
  return isTreeKind(k) ? k : null;
}

/** Whether `id` names a widget this client knows (a stored desk can hold
 *  one a later build dropped). */
export function isWidgetId(id: unknown): id is DeskWidgetId {
  if (typeof id !== 'string') return false;
  if (id.startsWith('pin:')) return /^pin:[A-Za-z0-9_-]{1,128}$/.test(id);
  if (id.startsWith('kind:')) {
    const k = id.slice(5);
    return isTreeKind(k) && (DESK_KINDS as readonly string[]).includes(k);
  }
  return (DESK_TOOLS as readonly string[]).includes(id);
}

// ── Geometry ───────────────────────────────────────────────────────────────

export function overlaps(a: DeskItem, b: DeskItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The rows the desk's lowest widget reaches. */
export function deskBottom(items: readonly DeskItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Size held to the widget's own bounds and the desk's width, the position
 *  kept on the desk. */
export function fit(item: DeskItem): DeskItem {
  const s = specOf(item.id);
  const w = clamp(Math.round(item.w), s.min.w, Math.min(s.max.w, DESK_COLS));
  const h = clamp(Math.round(item.h), s.min.h, s.max.h);
  const x = clamp(Math.round(item.x), 0, DESK_COLS - w);
  const y = Math.max(0, Math.round(item.y));
  return { id: item.id, x, y, w, h };
}

/**
 * Settle the desk around `fixedId`, which keeps the spot it was given: every
 * widget it lands on moves down just below it, and so on for what those land
 * on. Widgets nobody touched stay exactly where they were.
 */
export function settle(items: readonly DeskItem[], fixedId: DeskWidgetId): DeskItem[] {
  const out = items.map((i) => ({ ...i }));
  const queue: DeskWidgetId[] = [fixedId];
  // Bounded: each push moves a widget strictly down, so this ends; the cap
  // only guards against a stored desk nobody could have made.
  for (let guard = 0; queue.length > 0 && guard < 10_000; guard++) {
    const moverId = queue.shift()!;
    const mover = out.find((i) => i.id === moverId);
    if (!mover) continue;
    for (const other of out) {
      if (other.id === mover.id || other.id === fixedId) continue;
      if (!overlaps(mover, other)) continue;
      other.y = mover.y + mover.h;
      queue.push(other.id);
    }
  }
  return out;
}

/** Put `id` at (x, y), the rest making way. */
export function moveWidget(
  items: readonly DeskItem[],
  id: DeskWidgetId,
  x: number,
  y: number,
): DeskItem[] {
  const next = items.map((i) => (i.id === id ? fit({ ...i, x, y }) : i));
  return settle(next, id);
}

/** Give `id` the size w × h (within its bounds), the rest making way. It
 *  grows from where it stands: never wider than the room to its right, so a
 *  widget by the edge does not slide left as it grows. */
export function resizeWidget(
  items: readonly DeskItem[],
  id: DeskWidgetId,
  w: number,
  h: number,
): DeskItem[] {
  const next = items.map((i) =>
    i.id === id ? fit({ ...i, w: Math.min(w, DESK_COLS - i.x), h }) : i,
  );
  return settle(next, id);
}

/**
 * The desk as drawn: the stored desk with each content-sized widget at the
 * rows its content needs (`auto`), the rest making way. Drawn, not stored:
 * when the content shrinks again (or the screen grows taller, so fewer rows
 * hold it) what it pushed goes back to where the person put it.
 */
export function withAutoHeights(
  items: readonly DeskItem[],
  auto: Readonly<Partial<Record<DeskWidgetId, number>>>,
): DeskItem[] {
  let out = [...items];
  for (const item of items) {
    const h = auto[item.id];
    if (h === undefined || h === item.h) continue;
    const s = specOf(item.id);
    out = settle(
      out.map((i) => (i.id === item.id ? { ...i, h: clamp(h, s.min.h, s.max.h) } : i)),
      item.id,
    );
  }
  return out;
}

function freeAt(items: readonly DeskItem[], probe: DeskItem): boolean {
  return probe.x + probe.w <= DESK_COLS && !items.some((i) => overlaps(i, probe));
}

/**
 * The first free spot for a widget of `size`: row by row from the top left,
 * like reaching for the first clear patch of desk. `fromRight` scans each
 * row from the right edge instead, column by column, which is where desk
 * icons line up (as on a computer's desktop).
 */
export function firstFree(
  items: readonly DeskItem[],
  id: DeskWidgetId,
  size: Size,
  fromRight = false,
): DeskItem {
  const limit = deskBottom(items) + size.h + 1;
  if (fromRight) {
    for (let x = DESK_COLS - size.w; x >= 0; x--) {
      for (let y = 0; y < limit; y++) {
        const probe = { id, x, y, ...size };
        if (freeAt(items, probe)) return probe;
      }
    }
  }
  for (let y = 0; y < limit; y++) {
    for (let x = 0; x + size.w <= DESK_COLS; x++) {
      const probe = { id, x, y, ...size };
      if (freeAt(items, probe)) return probe;
    }
  }
  return { id, x: 0, y: limit, ...size };
}

/** Put a widget on the desk at its default size, in the first free spot.
 *  Already there: the desk is unchanged. */
export function addWidget(items: readonly DeskItem[], id: DeskWidgetId): DeskItem[] {
  if (items.some((i) => i.id === id)) return [...items];
  return [...items, firstFree(items, id, specOf(id).size, isPin(id))];
}

export function removeWidget(items: readonly DeskItem[], id: DeskWidgetId): DeskItem[] {
  return items.filter((i) => i.id !== id);
}

/**
 * Close every gap: each widget, top to bottom, rises as far as it can
 * without landing on another. Left-right places never change.
 */
export function tidy(items: readonly DeskItem[]): DeskItem[] {
  const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: DeskItem[] = [];
  for (const item of order) {
    let y = item.y;
    while (y > 0 && !placed.some((p) => overlaps(p, { ...item, y: y - 1 }))) y--;
    placed.push({ ...item, y });
  }
  return items.map((i) => placed.find((p) => p.id === i.id)!);
}

/**
 * The desk icons follow the person's pins: a newly pinned item gets an icon
 * in the first free spot down the right edge, an icon whose item is no
 * longer pinned goes. `pins` undefined: not known yet, the icons stay as
 * they were. `complete` false: some kind's pins could not be read, so an
 * icon missing from `pins` may only be unknown; it keeps its spot rather
 * than losing it on the next save.
 */
export function withPins(
  items: readonly DeskItem[],
  pins: readonly string[] | undefined,
  icons: boolean,
  complete = true,
): DeskItem[] {
  if (!icons) return items.filter((i) => !isPin(i.id));
  if (pins === undefined) return [...items];
  const want = new Set(pins.map((p) => `pin:${p}` as const));
  let out = complete ? items.filter((i) => !isPin(i.id) || want.has(i.id)) : [...items];
  for (const id of want) out = addWidget(out, id);
  return out;
}

// ── Defaults ───────────────────────────────────────────────────────────────

/**
 * A fresh desk, for anyone: the time, a place to jot, the calendar, the last
 * notes as sticky notes, the pages and tasks being worked on, and the look
 * of the room. The right-hand column stays clear for desk icons. A kind
 * this brain does not serve leaves its patch of desk empty.
 */
export function defaultDesk(kinds: readonly TreeKind[]): DeskPrefs {
  const has = (k: TreeKind) => kinds.includes(k);
  const items: DeskItem[] = [
    { id: 'clock', x: 0, y: 0, w: 3, h: 2 },
    { id: 'quick-note', x: 3, y: 0, w: 4, h: 2 },
    { id: 'calendar', x: 7, y: 0, w: 4, h: 4 },
    ...(has('notes') ? [{ id: 'kind:notes' as const, x: 0, y: 2, w: 7, h: 3 }] : []),
    ...(has('pages') ? [{ id: 'kind:pages' as const, x: 0, y: 5, w: 4, h: 3 }] : []),
    ...(has('tasks') ? [{ id: 'kind:tasks' as const, x: 4, y: 5, w: 3, h: 3 }] : []),
    { id: 'theme', x: 7, y: 4, w: 4, h: 2 },
    { id: 'drift', x: 7, y: 6, w: 4, h: 2 },
  ];
  return { v: 1, items, counts: {}, icons: true, clock: 'digital' };
}

export function countFor(prefs: Pick<DeskPrefs, 'counts'>, kind: TreeKind): number {
  return prefs.counts[kind] ?? KIND_COUNT_DEFAULT;
}

/**
 * A stored desk, or null when it is not one this client can use. Storage is
 * user-writable and outlives every release, so each widget is checked on
 * its own: one bad entry drops that widget, not the desk. Two widgets that
 * share a spot (hand-edited, or a size a later build grew) are settled.
 */
export function parseDesk(raw: string | null): DeskPrefs | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return deskFrom(data);
}

/** `parseDesk` for a value already parsed (the profile's, from the shell). */
export function deskFrom(data: unknown): DeskPrefs | null {
  if (!data || typeof data !== 'object' || (data as { v?: unknown }).v !== 1) return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.items)) return null;
  const seen = new Set<string>();
  let items: DeskItem[] = [];
  for (const raw of d.items as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (!isWidgetId(r.id) || seen.has(r.id)) continue;
    const nums = [r.x, r.y, r.w, r.h];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    seen.add(r.id);
    items.push(
      fit({ id: r.id, x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number }),
    );
  }
  for (const i of [...items]) items = settle(items, i.id);
  const counts: Partial<Record<TreeKind, number>> = {};
  if (d.counts && typeof d.counts === 'object') {
    for (const [k, n] of Object.entries(d.counts as Record<string, unknown>)) {
      if (isTreeKind(k) && typeof n === 'number' && Number.isFinite(n)) {
        counts[k] = clamp(Math.round(n), KIND_COUNT_MIN, KIND_COUNT_MAX);
      }
    }
  }
  return {
    v: 1,
    items,
    counts,
    icons: d.icons !== false,
    clock: d.clock === 'analog' ? 'analog' : 'digital',
  };
}

/**
 * The desk to show on a brain that keeps it on the login's profile, and
 * whether to save it there now.
 *
 * The profile's desk wins whenever there is one (arranged on another device,
 * say), and this browser's copy is just retired. Only into an EMPTY profile
 * (`profile` null: never saved) does a desk this browser kept before the
 * desk roamed move up, and only once per brain and login: `migrated` says
 * this browser already moved (or tried to move) its desk up, so a stale local
 * copy is never offered again, whatever the profile says later. Neither: the
 * default desk, saved only when the person first changes it.
 */
export function roamingDesk(
  profile: unknown,
  local: string | null,
  kinds: readonly TreeKind[],
  migrated = false,
): { prefs: DeskPrefs; upload: boolean } {
  const fromProfile = profile == null ? null : deskFrom(profile);
  if (fromProfile) return { prefs: fromProfile, upload: false };
  const fromHere = profile === null && !migrated ? parseDesk(local) : null;
  if (fromHere) return { prefs: fromHere, upload: true };
  return { prefs: defaultDesk(kinds), upload: false };
}

// ── What a kind widget lists ───────────────────────────────────────────────

/**
 * A kind widget's items: the person's pins first (they asked for those), then
 * what they opened last, then the newest, without repeats, `count` in all.
 */
export function deskItemsFor<T extends { id: string }>(
  count: number,
  pinned: readonly T[],
  recent: readonly T[],
  newest: readonly T[] = [],
): Array<T & { pinned: boolean }> {
  const out: Array<T & { pinned: boolean }> = [];
  const seen = new Set<string>();
  const take = (list: readonly T[], isPinned: boolean) => {
    for (const it of list) {
      if (out.length >= count) return;
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({ ...it, pinned: isPinned });
    }
  };
  take(pinned, true);
  take(recent, false);
  take(newest, false);
  return out;
}

/** Where an item of `kind` opens. Null for a file: its address needs its
 *  folder, which the caller looks up (lib/last-opened `itemRestore`). */
export function deskItemHref(kind: TreeKind, id: string): string | null {
  const enc = encodeURIComponent(id);
  switch (kind) {
    case 'files':
    case 'secrets':
      return null;
    case 'present':
      return `/present/${enc}`;
    case 'draw':
      return `/draw/${enc}`;
    default:
      return `/${kind}/${enc}`;
  }
}

/** A widget's name on the desk and in the settings panel. */
export const TOOL_LABELS: Record<DeskTool, { title: string; hint: string }> = {
  clock: { title: 'Clock', hint: 'The time, the date and a greeting' },
  calendar: { title: 'Calendar', hint: 'This month and what is coming up' },
  'quick-note': { title: 'Quick note', hint: 'Jot a note without leaving Home' },
  theme: { title: 'Theme', hint: 'Light, dark and the colour theme' },
  drift: { title: 'Drift', hint: 'The moving background, live' },
  focus: { title: 'Focus timer', hint: 'Work in focused stretches' },
  glance: { title: 'At a glance', hint: 'How much of each kind you have' },
  workspaces: { title: 'Workspaces', hint: 'Jump to any of your workspaces' },
};

export const KIND_LABELS: Record<TreeKind, string> = {
  files: 'Files',
  notes: 'Notes',
  pages: 'Pages',
  draw: 'Drawings',
  tables: 'Tables',
  formulas: 'Formulas',
  apps: 'Apps',
  tasks: 'Tasks',
  events: 'Events',
  contacts: 'Contacts',
  secrets: 'Secrets',
  recall: 'Recall',
  present: 'Canvases',
} as Record<TreeKind, string>;
