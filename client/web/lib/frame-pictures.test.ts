import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shownPart } from './frame-pictures';

/**
 * App frames in a page redraw (lib/frame-pictures.ts): which part of a frame
 * is in the picture, and both page redraws ask the frames. No DOM here (the
 * repo tests logic only).
 */

describe('the part of a frame in the picture', () => {
  const area = { x: 100, y: 100, w: 400, h: 300 };

  it('a frame half inside the area gives the part they share', () => {
    expect(shownPart({ x: 300, y: 50, w: 400, h: 200 }, area, null)).toEqual({
      x: 300,
      y: 100,
      w: 200,
      h: 150,
    });
  });

  it('a frame outside the area is not in the picture', () => {
    expect(shownPart({ x: 600, y: 100, w: 100, h: 100 }, area, null)).toBeNull();
  });

  it('the part scrolled out of the work area is left out', () => {
    const main = { x: 0, y: 150, w: 1000, h: 1000 };
    expect(shownPart({ x: 100, y: 0, w: 400, h: 400 }, area, main)).toEqual({
      x: 100,
      y: 150,
      w: 400,
      h: 250,
    });
  });
});

describe('both page redraws ask the app frames to draw themselves', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('the area capture paints the frames in (a mini app came out blank)', () => {
    const src = read('./area-capture.ts');
    expect(src).toMatch(/frameSpots\(rect, '\[data-capture-layer\]'\)/);
    expect(src).toMatch(/await paintFrames\(spots, rect,/);
  });

  it('ui_look does too', () => {
    const src = read('./agent-ui/look.ts');
    expect(src).toMatch(/blankFrames = await paintFrames\(spots, box, k, out\)/);
  });
});
