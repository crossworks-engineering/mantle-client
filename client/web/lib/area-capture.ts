/**
 * Area screenshots: drag a rectangle over the app, capture exactly those
 * pixels, save them to Files (POST /api/screenshots) and, optionally, hand
 * the saved file to the assistant as context.
 *
 * Two ways to get the pixels, neither asks the user for anything:
 *
 *  - The desktop shell captures its own window (`mantleDesktop.capture`,
 *    Electron's capturePage).
 *  - A browser redraws the app's own page into a canvas (modern-screenshot's
 *    domToCanvas) and crops it. No screen share: Mantle only ever pictures
 *    its own page. Known limits, by design: a cross-origin frame or image
 *    can come out blank, a playing video or a WebGL canvas (the Desk's Drift)
 *    black, and backdrop-filter can look different.
 *
 * A screenshot is saved as if the user had taken the picture to Files and
 * uploaded it: a plain file at the top of Files in the workspace the
 * switcher shows (/api/screenshots is a create route, so apiFetch adds the
 * switcher's `?ws=`, lib/create-workspace.ts; "All my workspaces" lets the
 * brain pick the user's own create home). It has that workspace's rights:
 * everyone who reads the workspace reads it. The brain names where it
 * landed (`landedIn`), and its image model reads the picture to make it
 * searchable.
 */
import { apiFetch } from '@mantle/web-ui/api-fetch';
import { desktopShell } from '@mantle/web-ui/desktop-shell';
import { APP_VERSION } from '@mantle/web-ui/version';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

/** The smallest area worth saving, in CSS pixels per side. A click without
 *  a drag is a cancel, not a 1 px screenshot. */
export const MIN_CAPTURE_PX = 8;

/** The rectangle between two drag points, clamped to the viewport, in whole
 *  CSS pixels. */
export function dragRect(a: Point, b: Point, view: Size): Rect {
  const clamp = (v: number, max: number) => Math.min(Math.max(0, v), max);
  const x1 = clamp(Math.min(a.x, b.x), view.w);
  const y1 = clamp(Math.min(a.y, b.y), view.h);
  const x2 = clamp(Math.max(a.x, b.x), view.w);
  const y2 = clamp(Math.max(a.y, b.y), view.h);
  const x = Math.floor(x1);
  const y = Math.floor(y1);
  return { x, y, w: Math.ceil(x2) - x, h: Math.ceil(y2) - y };
}

export function usableRect(r: Rect): boolean {
  return r.w >= MIN_CAPTURE_PX && r.h >= MIN_CAPTURE_PX;
}

/** A viewport rectangle in the pixels of a canvas drawn from `root` (the
 *  rendered element's box in viewport CSS pixels): moved by the root's
 *  origin, scaled by the canvas over the root, clamped to the canvas. */
export function canvasCrop(rect: Rect, root: Rect, canvas: Size): Rect {
  const sx = canvas.w / root.w;
  const sy = canvas.h / root.h;
  const x = Math.min(Math.max(0, Math.round((rect.x - root.x) * sx)), canvas.w);
  const y = Math.min(Math.max(0, Math.round((rect.y - root.y) * sy)), canvas.h);
  return {
    x,
    y,
    w: Math.max(1, Math.min(Math.round(rect.w * sx), canvas.w - x)),
    h: Math.max(1, Math.min(Math.round(rect.h * sy), canvas.h - y)),
  };
}

/** What rides with a screenshot (the brain's allowlist, the same caps). */
export type ScreenshotMeta = {
  route: string;
  screen: string;
  itemId: string | null;
  itemTitle: string | null;
  workspaceId: string | null;
  capturedAt: string;
  viewport: Size;
  dpr: number;
  rect: Rect;
  appVersion: string;
  shell: 'web' | 'desktop';
  note?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `s` trimmed and cut to at most `n` UTF-16 code units (the brain's caps
 *  count those) by whole code points, so a cut never splits an emoji into a
 *  lone surrogate, which the brain's jsonb refuses. */
const cut = (s: string, n: number) => {
  let out = '';
  for (const ch of s.trim()) {
    if (out.length + ch.length > n) break;
    out += ch;
  }
  return out;
};

/** The meta for a capture, cut to the brain's caps so a long title or note
 *  is shortened here rather than refused there. Only the path is sent, never
 *  the query: a search box's text is not the screen's name. */
export function screenshotMeta(input: {
  pathname: string;
  title: string;
  item: { id: string; label: string } | null;
  workspaceId: string | null;
  rect: Rect;
  view: Size;
  dpr: number;
  desktop: boolean;
  note?: string;
  now?: Date;
}): ScreenshotMeta {
  const note = input.note ? cut(input.note, 2000) : '';
  return {
    route: cut(input.pathname, 500) || '/',
    screen: cut(input.title, 200),
    itemId: input.item && UUID.test(input.item.id) ? input.item.id : null,
    itemTitle: input.item ? cut(input.item.label, 300) || null : null,
    workspaceId: input.workspaceId && UUID.test(input.workspaceId) ? input.workspaceId : null,
    capturedAt: (input.now ?? new Date()).toISOString(),
    viewport: { w: Math.round(input.view.w), h: Math.round(input.view.h) },
    dpr: Math.min(8, Math.max(0.5, input.dpr || 1)),
    rect: input.rect,
    appVersion: cut(APP_VERSION, 40),
    shell: input.desktop ? 'desktop' : 'web',
    ...(note ? { note } : {}),
  };
}

export type SavedScreenshot = {
  file: { id: string; filename: string; sizeBytes: number; mimeType: string };
  landedIn: { id: string; name: string } | null;
};

/** The brain's upload cap for a screenshot. */
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

/** Save a captured PNG to Files (the switcher's workspace: apiFetch's
 *  create-route rewrite adds `?ws=`). */
export async function saveScreenshot(png: Blob, meta: ScreenshotMeta): Promise<SavedScreenshot> {
  if (png.size > MAX_SCREENSHOT_BYTES) {
    throw new Error('The area is too large to save (over 10 MB). Capture a smaller area.');
  }
  const fd = new FormData();
  fd.set('meta', JSON.stringify(meta));
  fd.set('file', new File([png], 'screenshot.png', { type: 'image/png' }));
  // FormData body: apiFetch (not apiSend) so the multipart boundary survives.
  return apiFetch<SavedScreenshot>('/api/screenshots', { method: 'POST', body: fd });
}

/** Whether this shell can capture its own window (no prompt). */
export function desktopCanCapture(): boolean {
  return typeof desktopShell()?.capture === 'function';
}

/** The desktop shell's capture of a viewport rectangle, as a PNG. */
export async function captureDesktop(rect: Rect): Promise<Blob> {
  const capture = desktopShell()?.capture;
  if (!capture) throw new Error('This app cannot capture its window.');
  const bytes = await capture(rect);
  if (!bytes || bytes.byteLength === 0) throw new Error('The capture came back empty.');
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });
}

/** The page's own capture of a viewport rectangle, as a PNG: the body is
 *  redrawn at the device scale, leaving out the selection layer, and cut to
 *  the rectangle. */
export async function captureWeb(rect: Rect): Promise<Blob> {
  const { domToCanvas } = await import('modern-screenshot');
  const root = document.body;
  const box = root.getBoundingClientRect();
  const drawn = await domToCanvas(root, {
    scale: window.devicePixelRatio || 1,
    // The page's own background under everything, so a band the redraw
    // leaves unpainted (the top of the content area) is not transparent.
    backgroundColor: getComputedStyle(root).backgroundColor,
    filter: (node) => !(node instanceof Element && node.hasAttribute('data-capture-layer')),
  });
  const crop = canvasCrop(
    rect,
    { x: box.x, y: box.y, w: box.width, h: box.height },
    {
      w: drawn.width,
      h: drawn.height,
    },
  );
  const canvas = document.createElement('canvas');
  canvas.width = crop.w;
  canvas.height = crop.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the capture.');
  ctx.drawImage(drawn, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The capture could not be saved as PNG.'))),
      'image/png',
    ),
  );
}

/** The words for a capture that failed or was turned down. */
export function captureErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'The capture failed.';
  // The desktop shell's refusal comes wrapped by Electron's IPC: its own
  // words only.
  return err.message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}
