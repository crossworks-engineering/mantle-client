/**
 * Follow one pointer gesture until it ends. The one drag helper of the floating
 * things (the Assistant popout, the bubble stack).
 *
 * The listeners go on the WINDOW, not the element, so a fast drag that outruns
 * the pointer keeps tracking instead of dropping the box wherever the cursor
 * happened to leave it. A cancelled gesture (a touch the browser took back) ends
 * it the same way.
 */
export function trackPointer(onMove: (e: PointerEvent) => void, onEnd: () => void): void {
  const end = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    onEnd();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
