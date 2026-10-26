import { describe, expect, it } from 'vitest';
import { clampedInt, oneOf, parseFlag, decodeStored, serialiseFlag } from './use-persisted-state';

/**
 * The pure core of the persisted-preference hook. The hook itself is three
 * lines of React around this; what can actually be wrong is the decision about
 * what a stored string means, and that needs no DOM to pin.
 */

describe('decodeStored', () => {
  const parseView = oneOf('list', 'grid', 'dual');

  it('takes a recognised stored value', () => {
    expect(decodeStored('grid', parseView, 'list')).toBe('grid');
    expect(decodeStored('dual', parseView, 'list')).toBe('dual');
  });

  it('falls back when nothing is stored', () => {
    expect(decodeStored(null, parseView, 'list')).toBe('list');
  });

  // A value written by an older build, or edited by hand, must not become the
  // view. The old code did `stored === 'grid' ? 'grid' : …'list'`, which had
  // this property by accident; here it is the contract.
  it('falls back on a value it does not recognise', () => {
    expect(decodeStored('tiles', parseView, 'list')).toBe('list');
    expect(decodeStored('', parseView, 'list')).toBe('list');
    expect(decodeStored('GRID', parseView, 'list')).toBe('list');
  });

  it('carries a non-string preference through its own parser', () => {
    const parseWidth = (s: string): number | null => {
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    expect(decodeStored('320', parseWidth, 240)).toBe(320);
    expect(decodeStored('-1', parseWidth, 240)).toBe(240);
    expect(decodeStored('wide', parseWidth, 240)).toBe(240);
  });
});

describe('oneOf', () => {
  it('accepts exactly its members', () => {
    const parse = oneOf('a', 'b');
    expect(parse('a')).toBe('a');
    expect(parse('b')).toBe('b');
    expect(parse('c')).toBeNull();
  });
});

describe('parseFlag / serialiseFlag', () => {
  it('round-trips both states', () => {
    expect(parseFlag(serialiseFlag(true))).toBe(true);
    expect(parseFlag(serialiseFlag(false))).toBe(false);
  });

  it('writes the shape the shells already had on disk', () => {
    // Four screens wrote '1'/'0' by hand before this was shared. Changing the
    // encoding would silently discard every preference already stored.
    expect(serialiseFlag(true)).toBe('1');
    expect(serialiseFlag(false)).toBe('0');
  });

  it('distinguishes a stored false from an absent key', () => {
    // The whole reason parse returns null rather than false: `decodeStored` has
    // to be able to tell "the user collapsed it" from "nothing is stored", and
    // for a flag whose fallback is true those are different screens.
    expect(parseFlag('0')).toBe(false);
    expect(parseFlag('')).toBeNull();
    expect(decodeStored(null, parseFlag, true)).toBe(true);
    expect(decodeStored('0', parseFlag, true)).toBe(false);
  });

  it('refuses anything that is not one of the two', () => {
    for (const junk of ['true', 'false', 'yes', '2', ' 1', '1 ', 'null']) {
      expect(parseFlag(junk)).toBeNull();
    }
  });
});

describe('clampedInt', () => {
  const parseWidth = clampedInt(180, 400);

  it('takes a width inside the bounds', () => {
    expect(parseWidth('224')).toBe(224);
  });

  it('CLAMPS out of range rather than rejecting it', () => {
    // Deliberate, and the opposite of what oneOf does: a rail saved at 900px
    // under older bounds should come back at the maximum, which is close to
    // what its owner chose. Rejecting would drop it to the default — a
    // different width, and a worse guess.
    expect(parseWidth('900')).toBe(400);
    expect(parseWidth('10')).toBe(180);
  });

  it('holds the bounds themselves', () => {
    expect(parseWidth('180')).toBe(180);
    expect(parseWidth('400')).toBe(400);
  });

  it('falls back on anything that is not a number', () => {
    for (const junk of ['', 'wide', 'null', 'NaN', 'Infinity']) {
      expect(parseWidth(junk)).toBeNull();
    }
  });

  it('reads a leading integer the way parseInt does, and still clamps it', () => {
    // parseInt('220px') is 220 — worth pinning, because it means a value
    // written with a unit by hand still resolves rather than falling back.
    expect(parseWidth('220px')).toBe(220);
  });

  it('does not let a negative escape the floor', () => {
    expect(parseWidth('-500')).toBe(180);
  });
});
