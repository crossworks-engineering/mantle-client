/**
 * The window capture (`desktop:capture`), kept out of index.ts so a test can
 * pin it without Electron: which rectangle a page may ask to capture, and
 * the handler itself with what it needs of Electron stood in.
 *
 * The page sends viewport CSS pixels; at a page zoom other than 100% they
 * are scaled to the window's. Anything that is not four finite numbers is
 * refused; the rest is rounded and clamped to the window's content size, so
 * a page can never ask for pixels outside its own window.
 *
 * The handler answers only this app's UI in the window's main frame (never
 * a frame inside it, never a page a navigation swapped in), only a window
 * that is still there, and at most one capture a window per second: a
 * person drags, looks and saves, so a page asking faster is a loop.
 */

export type CaptureRect = { x: number; y: number; width: number; height: number };

/** The smallest side worth capturing (the page refuses smaller first). */
export const MIN_CAPTURE_SIDE = 8;

export function captureRect(
  raw: unknown,
  content: { width: number; height: number },
  zoom = 1,
): CaptureRect | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, w, h } = raw as Record<string, unknown>;
  const nums = [x, y, w, h];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  // The page's CSS pixels are the window's at its zoom.
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const left = Math.min(Math.max(0, Math.floor((x as number) * z)), content.width);
  const top = Math.min(Math.max(0, Math.floor((y as number) * z)), content.height);
  const width = Math.min(Math.ceil((w as number) * z), content.width - left);
  const height = Math.min(Math.ceil((h as number) * z), content.height - top);
  if (width < MIN_CAPTURE_SIDE || height < MIN_CAPTURE_SIDE) return null;
  return { x: left, y: top, width, height };
}

/** The least time between two captures of one window. */
export const CAPTURE_MIN_INTERVAL_MS = 1000;

/** One capture a window per interval: `take` says whether this one may run
 *  now, and counts it when it may. Keyed by the window itself, so a closed
 *  window's slot goes with it. */
export type CaptureLimiter = { take(win: object): boolean };

export function createCaptureLimiter(
  minIntervalMs = CAPTURE_MIN_INTERVAL_MS,
  now: () => number = Date.now,
): CaptureLimiter {
  const last = new WeakMap<object, number>();
  return {
    take(win) {
      const t = now();
      const prev = last.get(win);
      if (prev !== undefined && t - prev < minIntervalMs) return false;
      last.set(win, t);
      return true;
    },
  };
}

/** What the handler reads of the IPC event (Electron's IpcMainInvokeEvent). */
export type CaptureEvent = {
  sender: {
    mainFrame: unknown;
    getZoomFactor(): number;
    capturePage(rect: CaptureRect): Promise<{ toPNG(): Uint8Array }>;
  };
  senderFrame: unknown;
};

/** What the handler reads of the asking window (Electron's BrowserWindow). */
export type CaptureWindow = { isDestroyed(): boolean; getContentSize(): number[] };

export type CaptureDeps<E extends CaptureEvent> = {
  /** The sender is this app's UI (index.ts vaultProfileFor: the window's
   *  profile, and its frame still on the app's origin). */
  isThisApp(event: E): boolean;
  /** The window of the sender, or null. */
  windowOf(event: E): CaptureWindow | null;
  limiter: CaptureLimiter;
};

/** The refusals, each its own words (the page shows them). */
export const CAPTURE_REFUSED = {
  notThisApp: 'capture: not this app',
  noWindow: 'capture: no window',
  invalidArea: 'capture: invalid area',
  tooSoon: 'Another capture just ran. Try again in a moment.',
} as const;

/** The `desktop:capture` handler: the asking window's own pixels in the
 *  rectangle the page asked for, as PNG bytes. Throws a refusal otherwise. */
export async function captureForEvent<E extends CaptureEvent>(
  event: E,
  raw: unknown,
  deps: CaptureDeps<E>,
): Promise<Uint8Array> {
  if (!deps.isThisApp(event)) throw new Error(CAPTURE_REFUSED.notThisApp);
  // Only the page itself, never a frame inside it.
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error(CAPTURE_REFUSED.notThisApp);
  }
  const win = deps.windowOf(event);
  if (!win || win.isDestroyed()) throw new Error(CAPTURE_REFUSED.noWindow);
  const [width = 0, height = 0] = win.getContentSize();
  const rect = captureRect(raw, { width, height }, event.sender.getZoomFactor());
  if (!rect) throw new Error(CAPTURE_REFUSED.invalidArea);
  // Last, so a refused request spends nothing: the slot is the capture's.
  if (!deps.limiter.take(win)) throw new Error(CAPTURE_REFUSED.tooSoon);
  const image = await event.sender.capturePage(rect);
  return new Uint8Array(image.toPNG());
}
