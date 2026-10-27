import { describe, expect, it } from 'vitest';
import {
  DESK_COLS,
  KIND_COUNT_MAX,
  addWidget,
  defaultDesk,
  deskBottom,
  deskFrom,
  deskItemHref,
  deskItemsFor,
  deskToWire,
  firstFree,
  moveWidget,
  overlaps,
  parseDesk,
  resizeWidget,
  STORED_COUNTS_MAX,
  STORED_ITEMS_MAX,
  tidy,
  withAutoHeights,
  withPins,
  type DeskItem,
} from './home-desk';

const noOverlap = (items: DeskItem[]) => {
  for (const a of items) for (const b of items) if (a !== b) expect(overlaps(a, b)).toBe(false);
};

describe('the default desk', () => {
  const desk = defaultDesk(['notes', 'pages', 'tasks', 'files']);

  it('fills one screen, nothing overlapping, the right edge clear for icons', () => {
    noOverlap(desk.items);
    expect(deskBottom(desk.items)).toBe(8);
    expect(desk.items.every((i) => i.x + i.w <= DESK_COLS - 1)).toBe(true);
  });

  it('holds the sticky notes, pages and tasks, and only kinds the brain serves', () => {
    expect(desk.items.map((i) => i.id)).toContain('kind:notes');
    expect(defaultDesk(['files']).items.map((i) => i.id)).not.toContain('kind:notes');
  });
});

describe('moving and resizing', () => {
  const a: DeskItem = { id: 'clock', x: 0, y: 0, w: 3, h: 2 };
  const b: DeskItem = { id: 'quick-note', x: 3, y: 0, w: 4, h: 2 };
  const c: DeskItem = { id: 'theme', x: 3, y: 2, w: 4, h: 2 };

  it('drops a widget where it is put, pushing what it lands on down', () => {
    const out = moveWidget([a, b, c], 'clock', 4, 1);
    expect(out.find((i) => i.id === 'clock')).toMatchObject({ x: 4, y: 1 });
    expect(out.find((i) => i.id === 'quick-note')!.y).toBe(3);
    expect(out.find((i) => i.id === 'theme')!.y).toBe(5);
    noOverlap(out);
  });

  it('leaves a gap where the widget was: a desk does not tidy itself', () => {
    const out = moveWidget([a, b], 'clock', 0, 5);
    expect(out.find((i) => i.id === 'quick-note')).toMatchObject({ x: 3, y: 0 });
  });

  it('keeps a widget on the desk and inside its own size bounds', () => {
    expect(moveWidget([a], 'clock', 20, -4)[0]).toMatchObject({ x: DESK_COLS - 3, y: 0 });
    expect(resizeWidget([a], 'clock', 1, 99)[0]).toMatchObject({ w: 2, h: 5 });
  });

  it('grows a widget by the right edge in place, never sliding it left', () => {
    const t: DeskItem = { id: 'theme', x: 8, y: 0, w: 4, h: 2 };
    expect(resizeWidget([t], 'theme', 6, 2)[0]).toEqual(t);
    const narrow: DeskItem = { ...t, x: 6 };
    expect(resizeWidget([narrow], 'theme', 8, 2)[0]).toMatchObject({ x: 6, w: 6 });
  });

  it('draws a content-sized widget at its rows without storing the push', () => {
    const notes: DeskItem = { id: 'kind:notes', x: 0, y: 0, w: 6, h: 3 };
    const below: DeskItem = { id: 'kind:pages', x: 0, y: 3, w: 4, h: 3 };
    const stored = [notes, below];
    const tall = withAutoHeights(stored, { 'kind:notes': 5 });
    expect(tall).toEqual([
      { ...notes, h: 5 },
      { ...below, y: 5 },
    ]);
    // Fewer rows again: what it pushed is back where it was put.
    expect(withAutoHeights(stored, { 'kind:notes': 3 })).toEqual(stored);
    expect(stored[1]).toEqual(below);
  });

  it('tidies by closing gaps upward, never sideways', () => {
    const out = tidy([
      { ...a, y: 4 },
      { ...b, y: 7 },
    ]);
    expect(out).toEqual([
      { ...a, y: 0 },
      { ...b, y: 0 },
    ]);
  });
});

describe('placing', () => {
  it('finds the first free patch, top left', () => {
    const items: DeskItem[] = [{ id: 'clock', x: 0, y: 0, w: 3, h: 2 }];
    expect(firstFree(items, 'theme', { w: 4, h: 2 })).toMatchObject({ x: 3, y: 0 });
  });

  it('lines desk icons up down the right edge', () => {
    let items: DeskItem[] = defaultDesk(['notes']).items;
    items = addWidget(items, 'pin:a');
    items = addWidget(items, 'pin:b');
    expect(items.slice(-2)).toEqual([
      { id: 'pin:a', x: 11, y: 0, w: 1, h: 1 },
      { id: 'pin:b', x: 11, y: 1, w: 1, h: 1 },
    ]);
  });

  it('follows the pins: new ones appear, unpinned ones go, unknown keeps them', () => {
    const start: DeskItem[] = [{ id: 'pin:old', x: 2, y: 9, w: 1, h: 1 }];
    expect(withPins(start, undefined, true)).toEqual(start);
    const out = withPins(start, ['new'], true);
    expect(out.map((i) => i.id)).toEqual(['pin:new']);
    expect(withPins(start, ['old'], false)).toEqual([]);
  });

  it('keeps an icon whose pins could not be read, rather than losing its spot', () => {
    const start: DeskItem[] = [{ id: 'pin:maybe', x: 4, y: 9, w: 1, h: 1 }];
    expect(withPins(start, ['new'], true, false).map((i) => i.id)).toEqual([
      'pin:maybe',
      'pin:new',
    ]);
  });

  it('keeps a moved icon where it was put', () => {
    const moved = moveWidget(withPins([], ['x'], true), 'pin:x', 3, 6);
    expect(withPins(moved, ['x'], true)).toEqual([{ id: 'pin:x', x: 3, y: 6, w: 1, h: 1 }]);
  });
});

describe('a stored desk', () => {
  it('reads back what was written', () => {
    const desk = defaultDesk(['notes', 'pages']);
    expect(parseDesk(JSON.stringify(desk))).toEqual(desk);
  });

  it('drops junk entries one by one and settles overlaps', () => {
    const out = parseDesk(
      JSON.stringify({
        v: 1,
        items: [
          { id: 'clock', x: 0, y: 0, w: 3, h: 2 },
          { id: 'clock', x: 5, y: 5, w: 3, h: 2 },
          { id: 'nonsense', x: 0, y: 0, w: 1, h: 1 },
          { id: 'kind:secrets', x: 0, y: 0, w: 4, h: 3 },
          { id: 'theme', x: 0, y: 1, w: 4, h: 2 },
          { id: 'calendar', x: 'a', y: 0, w: 4, h: 4 },
        ],
        counts: { notes: 99, pages: 3, bogus: 2 },
      }),
    )!;
    expect(out.items.map((i) => i.id)).toEqual(['clock', 'theme']);
    noOverlap(out.items);
    expect(out.counts).toEqual({ notes: KIND_COUNT_MAX, pages: 3 });
    // A count this client does not know is carried through, never used.
    expect(out.restCounts).toEqual({ bogus: 2 });
  });

  it('is null for anything that is not a desk', () => {
    expect(parseDesk(null)).toBeNull();
    expect(parseDesk('{')).toBeNull();
    expect(parseDesk('{"v":2,"items":[]}')).toBeNull();
  });
});

describe('a kind widget', () => {
  const it3 = (...ids: string[]) => ids.map((id) => ({ id }));

  it('lists pins first, then recent, then newest, no repeats, count in all', () => {
    expect(deskItemsFor(4, it3('p1'), it3('r1', 'p1', 'r2'), it3('n1', 'n2'))).toEqual([
      { id: 'p1', pinned: true },
      { id: 'r1', pinned: false },
      { id: 'r2', pinned: false },
      { id: 'n1', pinned: false },
    ]);
  });

  it('opens each kind on its own route, a file through its folder', () => {
    expect(deskItemHref('pages', 'a b')).toBe('/pages/a%20b');
    expect(deskItemHref('apps', 'x')).toBe('/apps/x');
    expect(deskItemHref('files', 'x')).toBeNull();
  });
});

describe('the desk on the profile', () => {
  const kinds = ['notes', 'pages', 'tasks'] as const;
  const mine = {
    ...defaultDesk([...kinds]),
    items: [{ id: 'clock' as const, x: 4, y: 1, w: 3, h: 2 }],
    clock: 'analog' as const,
  };

  it('reads the desk GET /api/profile/home-desk answers', () => {
    expect(deskFrom(mine)).toEqual(mine);
  });

  it('is no desk for one it cannot read (the default is laid out instead)', () => {
    expect(deskFrom(null)).toBeNull();
    expect(deskFrom({ v: 2, items: [] })).toBeNull();
  });

  it("does not draw the profile desk's widgets this client does not know", () => {
    const later = { ...mine, items: [...mine.items, { id: 'weather', x: 0, y: 6, w: 3, h: 2 }] };
    expect(deskFrom(later)?.items).toEqual(mine.items);
  });
});

describe('widgets from a later build', () => {
  const later = (items: unknown[]) => ({
    v: 1,
    items: [{ id: 'clock', x: 0, y: 0, w: 3, h: 2 }, ...items],
    counts: {},
    icons: true,
    clock: 'digital',
  });
  const weather = { id: 'weather', x: 0, y: 6, w: 3, h: 2 };

  it('carries them through untouched, never drawn, and saves them back', () => {
    const desk = deskFrom(later([weather, { id: 'kind:maps', x: 4, y: 6, w: 5, h: 20 }]))!;
    expect(desk.items.map((i) => i.id)).toEqual(['clock']);
    expect(desk.rest).toEqual([weather, { id: 'kind:maps', x: 4, y: 6, w: 5, h: 20 }]);
    // A change here keeps them: the save carries every widget.
    const moved = { ...desk, items: moveWidget(desk.items, 'clock', 4, 0) };
    expect(deskToWire(moved).items).toEqual([
      { id: 'clock', x: 4, y: 0, w: 3, h: 2 },
      weather,
      { id: 'kind:maps', x: 4, y: 6, w: 5, h: 20 },
    ]);
    expect(parseDesk(JSON.stringify(deskToWire(moved)))).toEqual(moved);
  });

  it("carries only what the brain would keep, within the brain's bounds", () => {
    const desk = deskFrom(
      later([
        { id: 'w\u00e9ather', x: 0, y: 0, w: 1, h: 1 },
        { id: 'has space', x: 0, y: 0, w: 1, h: 1 },
        { id: 'x'.repeat(161), x: 0, y: 0, w: 1, h: 1 },
        { id: 'neg', x: -1, y: 0, w: 1, h: 1 },
        { id: 'half', x: 0.5, y: 0, w: 1, h: 1 },
        { id: 'far', x: 0, y: 10_001, w: 1, h: 1 },
        weather,
        { ...weather, x: 9 },
      ]),
    )!;
    expect(desk.rest).toEqual([weather]);
  });

  it('stops at the cap, drawn and carried together', () => {
    const many = Array.from({ length: STORED_ITEMS_MAX + 10 }, (_, i) => ({
      id: `later-${i}`,
      x: 0,
      y: i,
      w: 1,
      h: 1,
    }));
    const desk = deskFrom(later(many))!;
    expect(desk.items.length + (desk.rest?.length ?? 0)).toBe(STORED_ITEMS_MAX);
    expect(deskToWire(desk).items).toHaveLength(STORED_ITEMS_MAX);
  });

  it("carries counts it does not know through, within the brain's bounds", () => {
    const desk = deskFrom({
      ...later([]),
      counts: {
        notes: 4,
        weather: 3,
        'has space': 1,
        ['k'.repeat(33)]: 1,
        neg: -1,
        half: 0.5,
        far: 10_001,
        text: 'x',
      },
    })!;
    expect(desk.counts).toEqual({ notes: 4 });
    expect(desk.restCounts).toEqual({ weather: 3 });
    // A change here keeps them: the save carries every count.
    const changed = { ...desk, counts: { notes: 6 } };
    expect(deskToWire(changed).counts).toEqual({ notes: 6, weather: 3 });
    expect(parseDesk(JSON.stringify(deskToWire(changed)))).toEqual(changed);
  });

  it("stops the counts at the brain's cap, known ones first", () => {
    const counts: Record<string, number> = { notes: 4 };
    for (let i = 0; i < STORED_COUNTS_MAX + 5; i += 1) counts[`later-${i}`] = 1;
    const desk = deskFrom({ ...later([]), counts })!;
    expect(desk.counts).toEqual({ notes: 4 });
    expect(Object.keys(desk.restCounts ?? {})).toHaveLength(STORED_COUNTS_MAX - 1);
    expect(
      Object.keys(deskToWire({ ...desk, counts: { notes: 4, pages: 2 } }).counts),
    ).toHaveLength(STORED_COUNTS_MAX);
  });

  it('adds nothing to a desk without any', () => {
    const desk = defaultDesk(['notes']);
    expect(deskFrom(deskToWire(desk))).toEqual(desk);
    expect('rest' in deskFrom(deskToWire(desk))!).toBe(false);
    expect('restCounts' in deskFrom(deskToWire(desk))!).toBe(false);
  });
});
