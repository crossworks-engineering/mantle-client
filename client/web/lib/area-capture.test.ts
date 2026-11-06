import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  dragRect,
  frameCrop,
  frameIsThisTab,
  screenshotMeta,
  usableRect,
  MIN_CAPTURE_PX,
} from './area-capture';
import { isCreateRoute } from './create-workspace';

const view = { w: 1000, h: 800 };

describe('dragRect', () => {
  it('spans the two points whichever way the drag went', () => {
    expect(dragRect({ x: 300, y: 200 }, { x: 100, y: 50 }, view)).toEqual({
      x: 100,
      y: 50,
      w: 200,
      h: 150,
    });
  });

  it('clamps to the viewport and rounds outwards to whole pixels', () => {
    expect(dragRect({ x: -20, y: 10.4 }, { x: 1200.2, y: 99.6 }, view)).toEqual({
      x: 0,
      y: 10,
      w: 1000,
      h: 90,
    });
  });

  it('a click without a drag is not usable', () => {
    expect(usableRect(dragRect({ x: 5, y: 5 }, { x: 5, y: 5 }, view))).toBe(false);
    expect(usableRect({ x: 0, y: 0, w: MIN_CAPTURE_PX, h: MIN_CAPTURE_PX })).toBe(true);
  });
});

describe('frameCrop', () => {
  it('scales a viewport rectangle to a frame at device scale', () => {
    expect(frameCrop({ x: 100, y: 50, w: 200, h: 100 }, view, { w: 2000, h: 1600 })).toEqual({
      x: 200,
      y: 100,
      w: 400,
      h: 200,
    });
  });

  it('never reaches past the frame', () => {
    const c = frameCrop({ x: 900, y: 700, w: 400, h: 400 }, view, { w: 1000, h: 800 });
    expect(c.x + c.w).toBeLessThanOrEqual(1000);
    expect(c.y + c.h).toBeLessThanOrEqual(800);
  });
});

describe('frameIsThisTab', () => {
  it('takes a frame of the viewport shape', () => {
    expect(frameIsThisTab({ w: 2000, h: 1600 }, view)).toBe(true);
    expect(frameIsThisTab({ w: 2010, h: 1600 }, view)).toBe(true);
  });

  it('refuses a screen or window of another shape', () => {
    expect(frameIsThisTab({ w: 3840, h: 1080 }, view)).toBe(false);
    expect(frameIsThisTab({ w: 0, h: 0 }, view)).toBe(false);
  });
});

describe('screenshotMeta', () => {
  const base = {
    pathname: '/tasks',
    title: 'Tasks',
    item: null,
    workspaceId: null,
    rect: { x: 1, y: 2, w: 30, h: 40 },
    view,
    dpr: 2,
    desktop: false,
    now: new Date('2026-11-06T10:00:00Z'),
  };

  it('carries the screen, the area and where it was taken', () => {
    expect(screenshotMeta(base)).toMatchObject({
      route: '/tasks',
      screen: 'Tasks',
      itemId: null,
      itemTitle: null,
      workspaceId: null,
      capturedAt: '2026-11-06T10:00:00.000Z',
      viewport: { w: 1000, h: 800 },
      dpr: 2,
      rect: { x: 1, y: 2, w: 30, h: 40 },
      shell: 'web',
    });
    expect(screenshotMeta(base)).not.toHaveProperty('note');
  });

  it("cuts long text to the brain's caps instead of being refused", () => {
    const m = screenshotMeta({
      ...base,
      title: 'x'.repeat(500),
      note: `  ${'n'.repeat(3000)}  `,
      item: { id: '0b8c7f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f', label: 't'.repeat(400) },
    });
    expect(m.screen).toHaveLength(200);
    expect(m.note).toHaveLength(2000);
    expect(m.itemTitle).toHaveLength(300);
    expect(m.itemId).toBe('0b8c7f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f');
  });

  it('sends ids only when they are ids, and clamps the scale', () => {
    const m = screenshotMeta({
      ...base,
      item: { id: 'email-row-7', label: 'Mail' },
      workspaceId: 'not-an-id',
      dpr: 40,
      desktop: true,
    });
    expect(m.itemId).toBeNull();
    expect(m.itemTitle).toBe('Mail');
    expect(m.workspaceId).toBeNull();
    expect(m.dpr).toBe(8);
    expect(m.shell).toBe('desktop');
  });
});

describe('where a screenshot lands', () => {
  it('is not a create route, so the switcher never puts it in a shared workspace', () => {
    expect(isCreateRoute('/api/screenshots')).toBe(false);
  });
});

describe('the old element picker is gone', () => {
  it('the rail shows the area capture, not the Highlight button', () => {
    const rail = readFileSync(
      fileURLToPath(new URL('../components/layout/rail/rail-toolbar.tsx', import.meta.url)),
      'utf8',
    );
    expect(rail).toContain('<CaptureButton');
    expect(rail).not.toContain('HighlightButton');
  });
});
