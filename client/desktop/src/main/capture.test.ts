import { describe, expect, it } from 'vitest';
import { captureRect } from './capture';

const content = { width: 1200, height: 800 };

describe('captureRect', () => {
  it('rounds a viewport rectangle to whole pixels', () => {
    expect(captureRect({ x: 10.6, y: 20.2, w: 100.1, h: 50.5 }, content)).toEqual({
      x: 10,
      y: 20,
      width: 101,
      height: 51,
    });
  });

  it('clamps to the window, never outside it', () => {
    expect(captureRect({ x: -50, y: -10, w: 5000, h: 5000 }, content)).toEqual({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
    });
    expect(captureRect({ x: 1190, y: 0, w: 100, h: 100 }, content)).toEqual({
      x: 1190,
      y: 0,
      width: 10,
      height: 100,
    });
  });

  it('refuses anything that is not four finite numbers, or too small', () => {
    for (const raw of [
      null,
      'x',
      { x: 0, y: 0, w: 100 },
      { x: 0, y: 0, w: Number.NaN, h: 10 },
      { x: '0', y: 0, w: 100, h: 100 },
      { x: 0, y: 0, w: 4, h: 100 },
      { x: 1199, y: 0, w: 100, h: 100 },
    ]) {
      expect(captureRect(raw, content)).toBeNull();
    }
  });
});
