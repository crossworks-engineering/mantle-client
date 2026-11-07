import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOOK_MAX_PIXELS,
  LOOK_MAX_SIDE,
  askFrame,
  blankSecrets,
  fitSize,
  meets,
  onScreen,
  toPicture,
} from './look';

/**
 * `ui_look`, the window's half: the picture's size, its box, the secret
 * fields painted over and the app frame asked for its own picture. No DOM
 * here (the repo tests logic only): the page is stood in for.
 */

describe('the picture size', () => {
  it('keeps a small box as it is: never scaled up', () => {
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
  });

  it('a long side over 1568 px comes down to it, the shape kept', () => {
    const s = fitSize(3000, 400);
    expect(s.w).toBe(LOOK_MAX_SIDE);
    expect(Math.abs(s.w / s.h - 3000 / 400)).toBeLessThan(0.05);
  });

  it('a large retina window stays under 1.15 MP', () => {
    const s = fitSize(2880, 1620);
    expect(s.w * s.h).toBeLessThanOrEqual(LOOK_MAX_PIXELS);
    expect(Math.max(s.w, s.h)).toBeLessThanOrEqual(LOOK_MAX_SIDE);
    expect(s.w).toBeGreaterThan(1400);
  });
});

describe('the box', () => {
  const view = { w: 1280, h: 800 };
  it('is cut to the viewport', () => {
    expect(onScreen({ x: -10, y: 700, w: 300, h: 300 }, view)).toEqual({
      x: 0,
      y: 700,
      w: 290,
      h: 100,
    });
  });

  it('nothing of it on screen is null', () => {
    expect(onScreen({ x: 0, y: 900, w: 100, h: 100 }, view)).toBeNull();
  });

  it('two boxes meet only when they share area', () => {
    expect(meets({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(meets({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });

  it('a viewport box maps into the picture at its scale', () => {
    expect(
      toPicture({ x: 110, y: 60, w: 20, h: 10 }, { x: 100, y: 50, w: 200, h: 100 }, 2),
    ).toEqual({ x: 20, y: 20, w: 40, h: 20 });
  });
});

describe('secret fields are painted over', () => {
  afterEach(() => vi.unstubAllGlobals());

  const box = (x: number, y: number, w: number, h: number) => ({
    getBoundingClientRect: () => ({ x, y, width: w, height: h }),
  });

  it('every secret field in the box, once; a field inside a marked wrapper is the wrapper', () => {
    const wrapper = {
      tagName: 'DIV',
      closest: (s: string) => (s.includes('data-secret') ? wrapper : null),
      parentElement: null,
      ...box(10, 10, 100, 20),
    };
    const inner = {
      tagName: 'INPUT',
      type: 'text',
      getAttribute: () => null,
      closest: (s: string) => (s.includes('data-secret') ? wrapper : null),
      parentElement: wrapper,
      ...box(12, 12, 90, 16),
    };
    const password = {
      tagName: 'INPUT',
      type: 'password',
      getAttribute: () => null,
      closest: () => null,
      parentElement: { closest: () => null },
      ...box(10, 50, 100, 20),
    };
    const plain = {
      tagName: 'INPUT',
      type: 'text',
      getAttribute: () => null,
      closest: () => null,
      parentElement: { closest: () => null },
      ...box(10, 80, 100, 20),
    };
    const offBox = { ...password, ...box(900, 900, 50, 20) };
    vi.stubGlobal('document', {
      querySelectorAll: () => [wrapper, inner, password, plain, offBox],
    });
    const rects: number[][] = [];
    const out = {
      getContext: () => ({
        fillStyle: '',
        fillRect: (...r: number[]) => rects.push(r),
      }),
    } as unknown as HTMLCanvasElement;
    const n = blankSecrets({ x: 0, y: 0, w: 400, h: 300 }, 2, out);
    expect(n).toBe(2);
    expect(rects).toEqual([
      [20, 20, 200, 40],
      [20, 100, 200, 40],
    ]);
  });
});

describe('an app frame draws itself', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubWindow() {
    const listeners = new Set<(e: { source: unknown; data: unknown }) => void>();
    vi.stubGlobal('window', {
      addEventListener: (_t: string, fn: never) => listeners.add(fn),
      removeEventListener: (_t: string, fn: never) => listeners.delete(fn),
    });
    return {
      listeners,
      send: (source: unknown, data: unknown) => {
        for (const fn of [...listeners]) fn({ source, data });
      },
    };
  }

  it('one look to the frame, its one answer back', async () => {
    const w = stubWindow();
    const posted: Array<Record<string, unknown>> = [];
    const frameWin = { postMessage: (m: Record<string, unknown>) => posted.push(m) };
    const frame = { contentWindow: frameWin } as unknown as HTMLIFrameElement;
    const got = askFrame(frame, 1.5, 1000);
    expect(posted).toEqual([{ v: 1, kind: 'look', id: expect.any(String), scale: 1.5 }]);
    const id = posted[0]!.id;
    // Someone else, or another id: not the answer.
    w.send({}, { v: 1, kind: 'look.res', id, ok: true, dataUrl: 'data:image/png;base64,X' });
    w.send(frameWin, {
      v: 1,
      kind: 'look.res',
      id: 'other',
      ok: true,
      dataUrl: 'data:image/png;base64,Y',
    });
    w.send(frameWin, { v: 1, kind: 'look.res', id, ok: true, dataUrl: 'data:image/png;base64,Z' });
    expect(await got).toBe('data:image/png;base64,Z');
    expect(w.listeners.size).toBe(0);
  });

  it('a frame that does not answer in time, or fails, stays blank', async () => {
    vi.useFakeTimers();
    try {
      const w = stubWindow();
      const frame = {
        contentWindow: { postMessage: () => undefined },
      } as unknown as HTMLIFrameElement;
      const late = askFrame(frame, 1, 2000);
      vi.advanceTimersByTime(2000);
      expect(await late).toBeNull();
      expect(w.listeners.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    const w = stubWindow();
    const posted: Array<Record<string, unknown>> = [];
    const frameWin = { postMessage: (m: Record<string, unknown>) => posted.push(m) };
    const failed = askFrame({ contentWindow: frameWin } as unknown as HTMLIFrameElement, 1, 1000);
    w.send(frameWin, { v: 1, kind: 'look.res', id: posted[0]!.id, ok: false, error: 'no canvas' });
    expect(await failed).toBeNull();
  });

  it('only an image data URL counts as a picture', async () => {
    const w = stubWindow();
    const posted: Array<Record<string, unknown>> = [];
    const frameWin = { postMessage: (m: Record<string, unknown>) => posted.push(m) };
    const got = askFrame({ contentWindow: frameWin } as unknown as HTMLIFrameElement, 1, 1000);
    w.send(frameWin, {
      v: 1,
      kind: 'look.res',
      id: posted[0]!.id,
      ok: true,
      dataUrl: 'https://elsewhere.invalid/x.png',
    });
    expect(await got).toBeNull();
  });
});
