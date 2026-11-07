/**
 * Agent UI, the window's picture (`ui_look`; the brain's docs/agent-ui.md,
 * "Look"): the agent sees how the person's window looks, for "what do I do
 * here?" and "does this look right?". A read: no per-turn Allow, the page's
 * consent only, as `ui_screen`.
 *
 * One call:
 *
 *  1. The box: `work` is the `<main>` work area, `window` the viewport,
 *     `ref` one element from the last screen read (scrolled into view).
 *  2. The pixels. The desktop shell captures its own window (`capturePage`,
 *     app frames included). A browser redraws the page (modern-screenshot,
 *     as the area capture does) at the picture's final scale, leaving out
 *     the agent's own layers, and for `work` and `ref` the assistant panel.
 *     On the desktop too when the assistant panel covers the box: the
 *     capture would picture the chat, not the page.
 *  3. App frames, on a redraw: the page cannot read inside a sandboxed app
 *     frame, so each app frame in the box is asked to draw itself (one
 *     `look` over the app bridge, one `look.res` back, 2 s at most) and its
 *     picture is painted into its box. A frame that does not answer, or any
 *     other frame, stays blank and counts in `blankFrames`.
 *  4. Every secret field in the box (`isSecretField`: `data-secret`,
 *     passwords, one-time codes) is painted over.
 *  5. The size: a long side of at most 1568 px and at most 1.15 MP, never
 *     scaled up. A PNG, or a JPEG at 0.85 when the PNG is over 1 MB.
 *
 * Nothing is saved: the picture goes to the brain as the call's answer.
 */
import { canvasCrop, captureDesktop, desktopCanCapture, type Rect } from '../area-capture';
import { isSecretField } from './dom';
import { refuse, type AgentResult } from './model';

/** The picture's longest side, in pixels. */
export const LOOK_MAX_SIDE = 1568;
/** The picture's most pixels in all. */
export const LOOK_MAX_PIXELS = 1_150_000;
/** The picture's most bytes (the brain refuses more). */
export const LOOK_MAX_BYTES = 1024 * 1024;
/** How long an app frame has to draw itself. */
export const FRAME_WAIT_MS = 2000;

export type LookScope = 'work' | 'window' | 'ref';

export type LookResult = {
  route: string;
  title: string;
  scope: LookScope;
  width: number;
  height: number;
  /** Secret fields painted over. */
  blanked: number;
  /** Frames in the picture that drew blank. */
  blankFrames: number;
  image: { mimeType: 'image/png' | 'image/jpeg'; base64: string };
};

/** The picture's size for a source of `w` by `h` pixels: the same shape,
 *  scaled down to LOOK_MAX_SIDE and LOOK_MAX_PIXELS, never up. */
export function fitSize(w: number, h: number): { w: number; h: number } {
  const k = Math.min(
    1,
    LOOK_MAX_SIDE / Math.max(w, h),
    Math.sqrt(LOOK_MAX_PIXELS / Math.max(1, w * h)),
  );
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** `r` cut to the viewport, or null when nothing of it is on screen. */
export function onScreen(r: Rect, view: { w: number; h: number }): Rect | null {
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const right = Math.min(view.w, Math.ceil(r.x + r.w));
  const bottom = Math.min(view.h, Math.ceil(r.y + r.h));
  return right - x >= 1 && bottom - y >= 1 ? { x, y, w: right - x, h: bottom - y } : null;
}

/** Whether two boxes share any area. */
export function meets(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** `r` (viewport CSS pixels) in the picture's pixels: `box` maps to the
 *  whole picture at `k` picture pixels per CSS pixel. */
export function toPicture(r: Rect, box: Rect, k: number): Rect {
  return { x: (r.x - box.x) * k, y: (r.y - box.y) * k, w: r.w * k, h: r.h * k };
}

const rectOf = (el: Element): Rect => {
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};

const view = () => ({ w: window.innerWidth, h: window.innerHeight });

/** The box a scope pictures, in viewport CSS pixels, or null (nothing of it
 *  on screen). */
export function scopeBox(scope: LookScope, el: Element | null): Rect | null {
  if (scope === 'ref') {
    if (!el) return null;
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return onScreen(rectOf(el), view());
  }
  const main = scope === 'work' ? document.querySelector('main[data-tour="main"]') : null;
  return onScreen(main ? rectOf(main) : { x: 0, y: 0, ...view() }, view());
}

/** The assistant panel, when it is shown over part of `box`. */
function panelOver(box: Rect): boolean {
  const panel = document.querySelector('[data-assistant-panel]');
  if (!panel || panel.classList.contains('hidden')) return false;
  const r = rectOf(panel);
  return r.w > 0 && r.h > 0 && meets(r, box);
}

/** What the page redraw leaves out: the capture's own layer, the agent's
 *  layers, and for `work` and `ref` the assistant panel. */
function leftOut(scope: LookScope) {
  const sel =
    scope === 'window'
      ? '[data-capture-layer], [data-agent-host]'
      : '[data-capture-layer], [data-agent-host], [data-assistant-panel]';
  return (node: Node) => !(node instanceof Element && node.matches(sel));
}

/** The page redrawn at `k` picture pixels per CSS pixel, cut to `box`. */
async function redraw(box: Rect, k: number, scope: LookScope, out: HTMLCanvasElement) {
  const { domToCanvas } = await import('modern-screenshot');
  const root = document.body;
  const drawn = await domToCanvas(root, {
    scale: k,
    backgroundColor: getComputedStyle(root).backgroundColor,
    filter: leftOut(scope),
  });
  const crop = canvasCrop(box, rectOf(root), { w: drawn.width, h: drawn.height });
  out
    .getContext('2d')!
    .drawImage(drawn, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
}

/** The desktop shell's capture of `box`, drawn to the picture's size. One
 *  more try after a second when another capture just ran (the shell allows
 *  one a second per window). */
async function capture(box: Rect, out: HTMLCanvasElement) {
  let png: Blob;
  try {
    png = await captureDesktop(box);
  } catch (err) {
    if (!(err instanceof Error) || !/Another capture just ran/.test(err.message)) throw err;
    await new Promise((r) => setTimeout(r, 1000));
    png = await captureDesktop(box);
  }
  const bitmap = await createImageBitmap(png);
  out.getContext('2d')!.drawImage(bitmap, 0, 0, out.width, out.height);
  bitmap.close?.();
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
      done(url.startsWith('data:image/') ? url : null);
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

/** The frames in `box` drawn into the picture: an app frame asks for its
 *  own picture; any other frame, or one that does not answer, stays blank.
 *  Returns how many stayed blank. */
async function paintFrames(box: Rect, k: number, out: HTMLCanvasElement): Promise<number> {
  const frames = [...document.querySelectorAll('iframe')].filter((f) => {
    const r = rectOf(f);
    return r.w > 0 && r.h > 0 && meets(r, box) && !f.closest('[data-agent-host]');
  });
  const ctx = out.getContext('2d')!;
  const drawn = await Promise.all(
    frames.map(async (f) => {
      if (f.getAttribute('sandbox') !== 'allow-scripts') return false;
      const url = await askFrame(f, k);
      if (!url) return false;
      try {
        const img = await loadImage(url);
        const p = toPicture(rectOf(f), box, k);
        ctx.drawImage(img, p.x, p.y, p.w, p.h);
        return true;
      } catch {
        return false;
      }
    }),
  );
  return drawn.filter((ok) => !ok).length;
}

/** Paint over every secret field in `box`. Returns how many. */
export function blankSecrets(box: Rect, k: number, out: HTMLCanvasElement): number {
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#808080';
  let n = 0;
  for (const el of document.querySelectorAll('[data-secret], input')) {
    if (!isSecretField(el)) continue;
    // A field inside a marked wrapper is covered by the wrapper's box.
    if (el.tagName === 'INPUT' && el.parentElement?.closest('[data-secret]')) continue;
    const r = rectOf(el);
    if (r.w <= 0 || r.h <= 0 || !meets(r, box)) continue;
    const p = toPicture(r, box, k);
    ctx.fillRect(p.x, p.y, p.w, p.h);
    n += 1;
  }
  return n;
}

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The picture could not be encoded.'))),
      type,
      quality,
    ),
  );

const base64Of = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('The picture could not be read.'));
    r.readAsDataURL(b);
  });

/** The picture as the brain takes it: a PNG, or a JPEG at 0.85 when the PNG
 *  is over LOOK_MAX_BYTES; null when that is still too large. */
async function encode(out: HTMLCanvasElement): Promise<LookResult['image'] | null> {
  const png = await toBlob(out, 'image/png');
  if (png.size <= LOOK_MAX_BYTES) return { mimeType: 'image/png', base64: await base64Of(png) };
  const jpeg = await toBlob(out, 'image/jpeg', 0.85);
  if (jpeg.size <= LOOK_MAX_BYTES) return { mimeType: 'image/jpeg', base64: await base64Of(jpeg) };
  return null;
}

/** Take the window's picture for one `look` call. `el`: the `ref` scope's
 *  element (already found). */
export async function lookAt(
  scope: LookScope,
  el: Element | null,
): Promise<AgentResult<LookResult>> {
  const box = scopeBox(scope, el);
  if (!box) return refuse('not_found', 'Nothing of that is on the screen.');
  const dpr = window.devicePixelRatio || 1;
  const size = fitSize(box.w * dpr, box.h * dpr);
  const k = size.w / box.w;
  const out = document.createElement('canvas');
  out.width = size.w;
  out.height = size.h;
  let blankFrames = 0;
  if (desktopCanCapture() && (scope === 'window' || !panelOver(box))) {
    await capture(box, out);
  } else {
    await redraw(box, k, scope, out);
    blankFrames = await paintFrames(box, k, out);
  }
  const blanked = blankSecrets(box, k, out);
  const image = await encode(out);
  if (!image) return refuse('unsupported', 'The picture is too large. Look at a smaller part.');
  return {
    ok: true,
    route: location.pathname,
    title: document.title,
    scope,
    width: out.width,
    height: out.height,
    blanked,
    blankFrames,
    image,
  };
}
