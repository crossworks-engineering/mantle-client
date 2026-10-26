import { describe, expect, it } from 'vitest';
import {
  DESK_COLS,
  KIND_COUNT_MAX,
  addWidget,
  defaultDesk,
  deskBottom,
  deskItemHref,
  deskItemsFor,
  firstFree,
  moveWidget,
  overlaps,
  parseDesk,
  resizeWidget,
  tidy,
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
