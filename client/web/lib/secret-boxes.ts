/**
 * The secret boxes of the page, kept out of every picture of it: an agent's
 * look (lib/agent-ui/look.ts) and a person's area screenshot
 * (lib/area-capture.ts), which is saved to Files and read by a model.
 *
 * Two lines, the same for both:
 *
 *  1. While the pixels are taken, `<html>` carries `LOOK_MARK` and one style
 *     rule (app/globals.css) stops the page painting any secret box. The
 *     rule is the style's, not a read of the page, so a value that turns up
 *     at any moment of a slow capture is never painted.
 *  2. Each box, as read before and after the pixels, is painted over.
 *
 * A secret box is what `isSecretField` names: `data-secret`, a password, a
 * one-time code.
 */
import type { Rect } from './area-capture';
import { toPicture } from './frame-pictures';
import { isSecretField } from './agent-ui/dom';

const rectOf = (el: Element): Rect => {
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};

const meets = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The secret fields in `box` (`isSecretField`). A field inside a marked
 *  wrapper is covered by the wrapper's box. */
export function secretRects(box: Rect): Rect[] {
  const out: Rect[] = [];
  for (const el of document.querySelectorAll('[data-secret], input')) {
    if (!isSecretField(el)) continue;
    if (el.tagName === 'INPUT' && el.parentElement?.closest('[data-secret]')) continue;
    const r = rectOf(el);
    if (r.w > 0 && r.h > 0 && meets(r, box)) out.push(r);
  }
  return out;
}

/** The mark on `<html>` while a picture is taken. One style rule
 *  (app/globals.css) stops the page painting any secret box while it is
 *  set; the layout stays, so nothing moves. */
export const LOOK_MARK = 'data-agent-look';

/** The longest the mark stays on for one picture. A redraw that waits on a
 *  slow image must not leave a person's fields unpainted. */
export const UNPAINTED_MAX_MS = 10_000;

/**
 * What every page redraw passes to modern-screenshot, so the picture and the
 * boxes painted over it agree:
 *  - a scrolled pane is drawn at its scroll offset, as the person sees it
 *    (off by default in the library: the clone then starts at the pane's
 *    top, and a box read at its scrolled place is painted over the wrong
 *    spot);
 *  - a slow image or font is given up after half the mark's deadline and
 *    drawn blank, so one slow resource does not fail the whole picture.
 */
export const REDRAW_OPTIONS = {
  features: { restoreScrollPosition: true },
  timeout: UNPAINTED_MAX_MS / 2,
} as const;

/** The pixels did not come within `UNPAINTED_MAX_MS`: there is no picture. */
export class SecretsUnpaintedTimeout extends Error {
  constructor() {
    super('The picture took too long. Try again.');
    this.name = 'SecretsUnpaintedTimeout';
  }
}

/** Pictures being taken now: the mark stays until the last one ends. */
let looking = 0;

/** Two animation frames, so the mark's style is painted before the pixels
 *  are read (a desktop shell captures the window as drawn). A quarter of a
 *  second at most: a hidden window draws no frame. */
const painted = () =>
  new Promise<void>((resolve) => {
    const done = setTimeout(resolve, 250);
    const frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: () => void) => setTimeout(fn, 0);
    frame(() =>
      frame(() => {
        clearTimeout(done);
        resolve();
      }),
    );
  });

/**
 * Take the pixels with no secret box painted. A box that turns up after
 * this starts (a person clicks Reveal while a capture waits its turn) is not
 * painted either, whatever the delay. The mark comes off when the pixels are
 * in, on a failure, and after `maxMs` at the latest: then this throws
 * `SecretsUnpaintedTimeout` and the caller has no picture.
 */
export async function withSecretsUnpainted<T>(
  take: () => Promise<T>,
  maxMs: number = UNPAINTED_MAX_MS,
): Promise<T> {
  const root = document.documentElement;
  looking += 1;
  root.setAttribute(LOOK_MARK, '');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await painted();
    const taking = take();
    // A take that ends after the deadline: its failure is nobody's.
    taking.catch(() => undefined);
    return await Promise.race([
      taking,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SecretsUnpaintedTimeout()), maxMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    looking -= 1;
    if (looking === 0) root.removeAttribute(LOOK_MARK);
  }
}

/** The boxes to paint over: those read before the pixels and those read
 *  after, each once. A box that came, went or moved meanwhile is covered
 *  where it was and where it is. */
export function secretsAround(before: Rect[], after: Rect[]): Rect[] {
  const seen = new Set<string>();
  const out: Rect[] = [];
  for (const r of [...before, ...after]) {
    const key = `${r.x},${r.y},${r.w},${r.h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Paint over each secret box. `box` maps to the whole picture at `k`
 *  picture pixels per CSS pixel. */
export function blankSecrets(rects: Rect[], box: Rect, k: number, out: HTMLCanvasElement): void {
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#808080';
  for (const r of rects) {
    const p = toPicture(r, box, k);
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }
}
