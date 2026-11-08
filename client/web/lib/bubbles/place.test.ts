import { describe, expect, it } from 'vitest';
import { AVATAR_OVERHANG, EDGE_DEPTH, clampPlace, parsePlace } from './place';

const box = { w: 320, h: 100, vw: 1280, vh: 800 };

describe('parsePlace', () => {
  it('reads a stored place', () => {
    expect(parsePlace('{"x":10,"y":20}')).toEqual({ x: 10, y: 20 });
  });

  it('reads anything else as none', () => {
    for (const raw of [null, '', '{', '{"x":1}', '{"x":"1","y":2}', '{"x":null,"y":2}', 'null']) {
      expect(parsePlace(raw)).toBeNull();
    }
  });
});

describe('clampPlace', () => {
  it('leaves a place on screen alone', () => {
    expect(clampPlace({ x: 100, y: 100 }, box)).toEqual({ x: 100, y: 100 });
  });

  it('keeps the avatar on screen at the top left', () => {
    expect(clampPlace({ x: -50, y: -50 }, box)).toEqual({
      x: AVATAR_OVERHANG,
      y: AVATAR_OVERHANG,
    });
  });

  it('keeps the card and its edges on screen at the bottom right', () => {
    expect(clampPlace({ x: 5000, y: 5000 }, box)).toEqual({
      x: 1280 - 320,
      y: 800 - 100 - EDGE_DEPTH,
    });
  });

  it('keeps the top left in a window too small for the stack', () => {
    expect(clampPlace({ x: 5000, y: 5000 }, { ...box, vw: 200, vh: 50 })).toEqual({
      x: AVATAR_OVERHANG,
      y: AVATAR_OVERHANG,
    });
  });
});
