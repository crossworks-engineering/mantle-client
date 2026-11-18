import { describe, expect, it } from 'vitest';
import { isPickClick, keepOnScreen, pickClick, rangeBetween } from './pick-range';

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const none = new Set<string>();

describe('rangeBetween', () => {
  it('takes both ends and everything between, either way round', () => {
    expect(rangeBetween(ORDER, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(ORDER, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(ORDER, 'c', 'c')).toEqual(['c']);
  });

  it('picks the clicked row alone when the anchor is gone, nothing when the row is', () => {
    expect(rangeBetween(ORDER, 'gone', 'c')).toEqual(['c']);
    expect(rangeBetween(ORDER, 'a', 'gone')).toEqual([]);
  });
});

describe('pickClick', () => {
  it('cmd/ctrl toggles one row and makes it the anchor', () => {
    const one = pickClick(none, ORDER, null, 'b', { toggle: true, range: false });
    expect([...one.picked]).toEqual(['b']);
    expect(one.anchor).toBe('b');
    const off = pickClick(one.picked, ORDER, one.anchor, 'b', { toggle: true, range: false });
    expect([...off.picked]).toEqual([]);
  });

  it('shift adds the range from the anchor and keeps the anchor', () => {
    const first = pickClick(none, ORDER, null, 'b', { toggle: true, range: false });
    const ranged = pickClick(first.picked, ORDER, first.anchor, 'd', {
      toggle: false,
      range: true,
    });
    expect([...ranged.picked].sort()).toEqual(['b', 'c', 'd']);
    expect(ranged.anchor).toBe('b');
    // A second shift-click from the same anchor adds, never drops.
    const back = pickClick(ranged.picked, ORDER, ranged.anchor, 'a', {
      toggle: false,
      range: true,
    });
    expect([...back.picked].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('shift with no anchor yet acts as a toggle', () => {
    const r = pickClick(none, ORDER, null, 'c', { toggle: false, range: true });
    expect([...r.picked]).toEqual(['c']);
    expect(r.anchor).toBe('c');
  });

  it('never changes the set it was given', () => {
    const start = new Set(['a']);
    pickClick(start, ORDER, 'a', 'c', { toggle: false, range: true });
    expect([...start]).toEqual(['a']);
  });
});

describe('isPickClick', () => {
  it('is any of cmd, ctrl or shift', () => {
    const plain = { metaKey: false, ctrlKey: false, shiftKey: false };
    expect(isPickClick(plain)).toBe(false);
    expect(isPickClick({ ...plain, metaKey: true })).toBe(true);
    expect(isPickClick({ ...plain, ctrlKey: true })).toBe(true);
    expect(isPickClick({ ...plain, shiftKey: true })).toBe(true);
  });
});

describe('keepOnScreen', () => {
  it('drops picked rows that left the list, and keeps the same set when none did', () => {
    const picked = new Set(['a', 'x']);
    expect([...keepOnScreen(picked, ORDER)]).toEqual(['a']);
    const same = new Set(['a', 'b']);
    expect(keepOnScreen(same, ORDER)).toBe(same);
  });
});
