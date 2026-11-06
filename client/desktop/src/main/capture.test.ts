import { describe, expect, it } from 'vitest';
import {
  CAPTURE_MIN_INTERVAL_MS,
  CAPTURE_REFUSED,
  captureForEvent,
  captureRect,
  createCaptureLimiter,
  type CaptureEvent,
  type CaptureRect,
  type CaptureWindow,
} from './capture';

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

  it("scales the page's CSS pixels by its zoom", () => {
    expect(captureRect({ x: 10, y: 20, w: 100, h: 50 }, content, 1.5)).toEqual({
      x: 15,
      y: 30,
      width: 150,
      height: 75,
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

describe('createCaptureLimiter', () => {
  it('one capture a window per interval; each window its own', () => {
    let t = 10_000;
    const limiter = createCaptureLimiter(CAPTURE_MIN_INTERVAL_MS, () => t);
    const a = {};
    const b = {};
    expect(limiter.take(a)).toBe(true);
    expect(limiter.take(a)).toBe(false);
    expect(limiter.take(b)).toBe(true);
    t += CAPTURE_MIN_INTERVAL_MS - 1;
    expect(limiter.take(a)).toBe(false);
    t += 1;
    expect(limiter.take(a)).toBe(true);
    expect(CAPTURE_MIN_INTERVAL_MS).toBe(1000);
  });
});

describe('captureForEvent (the desktop:capture handler)', () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  type FakeEvent = CaptureEvent & { asked: CaptureRect[]; thisApp: boolean };
  const mainFrame = { url: 'app://mantle/' };

  const eventOf = (
    over: Partial<{ senderFrame: unknown; thisApp: boolean; zoom: number }> = {},
  ) => {
    const asked: CaptureRect[] = [];
    const event: FakeEvent = {
      asked,
      thisApp: over.thisApp ?? true,
      senderFrame: 'senderFrame' in over ? over.senderFrame : mainFrame,
      sender: {
        mainFrame,
        getZoomFactor: () => over.zoom ?? 1,
        capturePage: async (rect) => {
          asked.push(rect);
          return { toPNG: () => PNG };
        },
      },
    };
    return event;
  };
  const windowOf = (destroyed = false): CaptureWindow => ({
    isDestroyed: () => destroyed,
    getContentSize: () => [1200, 800],
  });
  const depsOf = (win: CaptureWindow | null, now = () => 0) => ({
    isThisApp: (e: FakeEvent) => e.thisApp,
    windowOf: () => win,
    limiter: createCaptureLimiter(CAPTURE_MIN_INTERVAL_MS, now),
  });
  const area = { x: 10, y: 20, w: 100, h: 50 };

  it("captures the window's own pixels in the asked area, as PNG bytes", async () => {
    const event = eventOf({ zoom: 2 });
    const out = await captureForEvent(event, area, depsOf(windowOf()));
    expect([...out]).toEqual([...PNG]);
    expect(event.asked).toEqual([{ x: 20, y: 40, width: 200, height: 100 }]);
  });

  it('refuses a page that is not this app, a subframe, and no frame at all', async () => {
    for (const [name, event] of [
      ['foreign origin', eventOf({ thisApp: false })],
      ['subframe', eventOf({ senderFrame: { url: 'app://mantle/frame' } })],
      ['no frame', eventOf({ senderFrame: null })],
    ] as const) {
      await expect(captureForEvent(event, area, depsOf(windowOf())), name).rejects.toThrow(
        CAPTURE_REFUSED.notThisApp,
      );
      expect(event.asked, name).toEqual([]);
    }
  });

  it('refuses a destroyed window and no window', async () => {
    for (const win of [windowOf(true), null]) {
      const event = eventOf();
      await expect(captureForEvent(event, area, depsOf(win))).rejects.toThrow(
        CAPTURE_REFUSED.noWindow,
      );
      expect(event.asked).toEqual([]);
    }
  });

  it('refuses a bad area, and a refusal spends no slot', async () => {
    const deps = depsOf(windowOf());
    for (const raw of [null, { x: 0, y: 0, w: 4, h: 100 }, { x: '0', y: 0, w: 100, h: 100 }]) {
      const event = eventOf();
      await expect(captureForEvent(event, raw, deps)).rejects.toThrow(CAPTURE_REFUSED.invalidArea);
      expect(event.asked).toEqual([]);
    }
    // The bad ones spent nothing: the next good one runs.
    await expect(captureForEvent(eventOf(), area, deps)).resolves.toBeInstanceOf(Uint8Array);
  });

  it('one capture a second per window: a second one at once is refused, then runs', async () => {
    let t = 50_000;
    const win = windowOf();
    const deps = depsOf(win, () => t);
    await captureForEvent(eventOf(), area, deps);
    const fast = eventOf();
    await expect(captureForEvent(fast, area, deps)).rejects.toThrow(CAPTURE_REFUSED.tooSoon);
    expect(fast.asked).toEqual([]);
    t += CAPTURE_MIN_INTERVAL_MS;
    const later = eventOf();
    await captureForEvent(later, area, deps);
    expect(later.asked).toHaveLength(1);
  });
});
