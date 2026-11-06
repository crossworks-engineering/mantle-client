/**
 * The pure half of the window capture (kept out of index.ts so a test can
 * pin it without Electron): which rectangle a page may ask to capture.
 *
 * The page sends viewport CSS pixels. Anything that is not four finite
 * numbers is refused; the rest is rounded and clamped to the window's
 * content size, so a page can never ask for pixels outside its own window.
 */

export type CaptureRect = { x: number; y: number; width: number; height: number };

/** The smallest side worth capturing (the page refuses smaller first). */
export const MIN_CAPTURE_SIDE = 8;

export function captureRect(
  raw: unknown,
  content: { width: number; height: number },
): CaptureRect | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, w, h } = raw as Record<string, unknown>;
  const nums = [x, y, w, h];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const left = Math.min(Math.max(0, Math.floor(x as number)), content.width);
  const top = Math.min(Math.max(0, Math.floor(y as number)), content.height);
  const width = Math.min(Math.ceil(w as number), content.width - left);
  const height = Math.min(Math.ceil(h as number), content.height - top);
  if (width < MIN_CAPTURE_SIDE || height < MIN_CAPTURE_SIDE) return null;
  return { x: left, y: top, width, height };
}
