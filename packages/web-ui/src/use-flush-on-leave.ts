'use client';

import { useEffect, useRef } from 'react';
import { onSessionBounce } from './session-flush';

/**
 * Flush a debounced draft on every way out of an editor.
 *
 * The three draft editors — Pages, Draw, Tables — each grew their own version
 * of this effect, and they did not agree. Tables and Draw listened for
 * `visibilitychange`; Pages listened for nothing and relied on unmount alone,
 * so a reload or a tab close inside its debounce window lost the typing. None
 * of the three heard the session expiring, which is a full navigation and so
 * never unmounts anything. Same shape, three copies, three different sets of
 * holes — the failure this audit keeps finding.
 *
 * The four ways out, all now covered:
 *
 *   • in-app navigation — React unmounts and the cleanup runs;
 *   • the tab is hidden, reloaded or closed — `visibilitychange`, which is the
 *     signal the Page Lifecycle guidance says to trust;
 *   • `pagehide` as its backstop, for the engines where a tab teardown does not
 *     reliably deliver `visibilitychange` first;
 *   • the session expires — see `session-flush.ts`.
 *
 * `flush` must be safe to call repeatedly and in any order: several of these
 * fire together on a normal tab close. Every caller's save already no-ops when
 * nothing changed, which is what makes that true.
 *
 * `flush` may return a promise: the session bounce and a login switch wait
 * for it (capped, see `session-flush.ts`) before the credential changes.
 *
 * ⚠ `flush` should also clear its own debounce timer. It is called on paths
 * that are NOT unmount, where an armed timer would otherwise fire a redundant
 * save afterwards.
 */
export function useFlushOnLeave(flush: () => unknown): void {
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    const run = () => flushRef.current();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') run();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', run);
    const unregister = onSessionBounce(run);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', run);
      unregister();
      run();
    };
    // Once per mount: the callback is read through a ref, so a new `flush`
    // identity each render must not tear the listeners down and back up (which
    // would fire the cleanup's flush on every render).
  }, []);
}
