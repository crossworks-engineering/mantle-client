/**
 * App frames in a page redraw. modern-screenshot redraws the page from its
 * DOM, and the page cannot read inside a sandboxed app frame (an opaque
 * origin), so a frame comes out blank. Each app frame in the box is asked to
 * draw itself instead (one `look` over the app bridge, one `look.res` back,
 * 2 s at most; the brain's frame document answers it, app-frame-html.ts
 * LOOK_LISTENER) and its picture is painted into its box.
 *
 * Used by both page redraws: the area capture (lib/area-capture.ts) and
 * `ui_look` (lib/agent-ui/look.ts). A frame that does not answer (a
 * present's canvas frame has no listener yet), or any other frame, stays
 * blank. The desktop shell needs none of this: its capturePage takes the
 * window's real pixels, frames included.
 */
import type { Rect } from './area-capture';

/** How long an app frame has to draw itself. */
export const FRAME_WAIT_MS = 2000;

/** The area two boxes share (empty when they do not meet). */
export function overlap(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
    h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y),
  };
}

/** `r` (viewport CSS pixels) in the picture's pixels: `box` maps to the
 *  whole picture at `k` picture pixels per CSS pixel. */
export function toPicture(r: Rect, box: Rect, k: number): Rect {
  return { x: (r.x - box.x) * k, y: (r.y - box.y) * k, w: r.w * k, h: r.h * k };
}

/** The part of a frame's box on show in the picture: cut to the picture's
 *  box and to the scrolling area it sits in. Null when none of it is. */
export function shownPart(frame: Rect, box: Rect, area: Rect | null): Rect | null {
  const shown = overlap(overlap(frame, box), area ?? box);
  return shown.w > 0 && shown.h > 0 ? shown : null;
}

/** One app frame's picture of itself (a PNG data URL), or null when it does
 *  not answer in `waitMs`. */
export function askFrame(
  frame: HTMLIFrameElement,
  scale: number,
  waitMs = FRAME_WAIT_MS,
): Promise<string | null> {
  const win = frame.contentWindow;
  if (!win) return Promise.resolve(null);
  const id = `look-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return new Promise((resolve) => {
    const done = (v: string | null) => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(v);
    };
    const onMessage = (e: MessageEvent) => {
      const m = e.data as Record<string, unknown> | null;
      if (e.source !== win || !m || m.v !== 1 || m.kind !== 'look.res' || m.id !== id) return;
      const url = m.ok === true && typeof m.dataUrl === 'string' ? m.dataUrl : '';
      done(url.startsWith('data:image/png;base64,') ? url : null);
    };
    const timer = setTimeout(() => done(null), waitMs);
    window.addEventListener('message', onMessage);
    win.postMessage({ v: 1, kind: 'look', id, scale }, '*');
  });
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the frame picture did not load'));
    img.src = src;
  });

const rectOf = (el: Element): Rect => {
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};

/** An app frame in the picture: its box, and the part of it on show. */
export type FrameSpot = { frame: HTMLIFrameElement; rect: Rect; shown: Rect };

/** The frames in `box`, read before the pixels are taken, leaving out any
 *  frame inside an element that `skip` (a selector) matches. */
export function frameSpots(box: Rect, skip: string): FrameSpot[] {
  const spots: FrameSpot[] = [];
  for (const frame of document.querySelectorAll('iframe')) {
    if (skip && frame.closest(skip)) continue;
    const rect = rectOf(frame);
    const main = frame.closest('main');
    const shown = shownPart(rect, box, main ? rectOf(main) : null);
    if (shown) spots.push({ frame, rect, shown });
  }
  return spots;
}

/** Each app frame's own picture painted into the part of its box on show;
 *  any other frame, or one that does not answer, stays blank. Returns how
 *  many stayed blank. */
export async function paintFrames(
  spots: FrameSpot[],
  box: Rect,
  k: number,
  out: HTMLCanvasElement,
): Promise<number> {
  const ctx = out.getContext('2d')!;
  const drawn = await Promise.all(
    spots.map(async ({ frame, rect, shown }) => {
      if (frame.getAttribute('sandbox') !== 'allow-scripts') return false;
      const url = await askFrame(frame, k);
      if (!url) return false;
      try {
        const img = await loadImage(url);
        const p = toPicture(rect, box, k);
        const c = toPicture(shown, box, k);
        ctx.save();
        ctx.beginPath();
        ctx.rect(c.x, c.y, c.w, c.h);
        ctx.clip();
        ctx.drawImage(img, p.x, p.y, p.w, p.h);
        ctx.restore();
        return true;
      } catch {
        return false;
      }
    }),
  );
  return drawn.filter((ok) => !ok).length;
}
