import { describe, expect, it } from 'vitest';
import type { DeskItem } from '@/lib/home-desk';
import {
  GAP,
  MAX_ROW,
  MIN_ROW,
  PAD,
  carryBox,
  carryTarget,
  cellRect,
  measureDesk,
  rowsFor,
  type Carry,
} from './desk-geometry';

/** A desk 12 columns of 100px and rows of 100px, gaps and padding of 12. */
const m = { colW: 100, rowH: 100, width: 12 * 100 + 11 * GAP + 2 * PAD, height: 900 };
const step = 100 + GAP;

const carry = (origin: DeskItem, over: Partial<Carry> = {}): Carry => ({
  id: origin.id,
  mode: 'move',
  pointerId: 1,
  startX: 0,
  startY: 0,
  startScroll: 0,
  origin,
  dx: 0,
  dy: 0,
  started: true,
  ...over,
});

describe('measuring the desk', () => {
  it('shares the width among the columns and one screen among the rows', () => {
    const got = measureDesk(m.width, PAD * 2 + 8 * 90 + 7 * GAP);
    expect(got.colW).toBeCloseTo(100);
    expect(got.rowH).toBeCloseTo(90);
  });

  it('keeps rows inside their bounds on a very short or very tall screen', () => {
    expect(measureDesk(1000, 200).rowH).toBe(MIN_ROW);
    expect(measureDesk(1000, 5000).rowH).toBe(MAX_ROW);
  });

  it('places a cell and spans gaps inside a widget', () => {
    expect(cellRect({ x: 1, y: 2, w: 2, h: 1 }, m)).toEqual({
      left: PAD + step,
      top: PAD + 2 * step,
      width: 200 + GAP,
      height: 100,
    });
  });

  it('counts the whole rows content needs', () => {
    expect(rowsFor(100, m)).toBe(1);
    expect(rowsFor(101, m)).toBe(2);
    expect(rowsFor(2 * 100 + GAP, m)).toBe(2);
  });
});

describe('dropping a carried widget', () => {
  const clock: DeskItem = { id: 'clock', x: 0, y: 0, w: 3, h: 2 };
  const theme: DeskItem = { id: 'theme', x: 4, y: 0, w: 4, h: 2 };

  it('lands on the nearest cell', () => {
    const out = carryTarget([clock], carry(clock, { dx: 2 * step + 40, dy: 3 * step - 30 }), m);
    expect(out[0]).toMatchObject({ x: 2, y: 3 });
  });

  it('lands where the pointer is after the desk scrolled under it', () => {
    // The pointer moved one row; the desk scrolled four rows meanwhile.
    const c = carry(clock, { dy: step + 4 * step });
    expect(carryBox(c, m).top).toBe(PAD + 5 * step);
    expect(carryTarget([clock], c, m)[0]).toMatchObject({ y: 5 });
  });

  it('pushes what it lands on down', () => {
    const out = carryTarget([clock, theme], carry(clock, { dx: 4 * step }), m);
    expect(out.find((i) => i.id === 'theme')).toMatchObject({ y: 2 });
  });

  it('resizes to the nearest whole size', () => {
    const c = carry(theme, { mode: 'resize', dx: step + 20, dy: 2 * step - 20 });
    expect(carryTarget([theme], c, m)[0]).toMatchObject({ w: 5, h: 4 });
  });

  it('gives a content-sized widget a new width only', () => {
    const notes: DeskItem = { id: 'kind:notes', x: 0, y: 0, w: 6, h: 3 };
    const c = carry(notes, { mode: 'resize', dx: 2 * step, dy: 5 * step });
    expect(carryTarget([notes], c, m)[0]).toMatchObject({ w: 8, h: 3 });
  });
});
