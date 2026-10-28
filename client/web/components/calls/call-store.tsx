'use client';

/**
 * The tab's one call session (lib/calls/session.ts) as a store the shell,
 * the dock, the ring card and the chat header read: `useCallState()` for
 * the state, `callSession()` for the verbs. Made once per tab, like the
 * messenger's receipts; a call survives every route change because the
 * session lives here, not in a screen.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { desktopShell } from '@mantle/web-ui/desktop-shell';
import { callsApi, leaveOnUnload } from '@/lib/calls/api';
import { livekitRoom } from '@/lib/calls/room';
import { CallSession, IDLE, type CallState } from '@/lib/calls/session';

let session: CallSession | null = null;

/** The tab's session (made on first use, on the client only). */
export function callSession(): CallSession {
  if (!session) {
    session = new CallSession({
      api: {
        start: (id, device) => callsApi.start(id, { device }),
        token: callsApi.token,
        leave: callsApi.leave,
        end: callsApi.end,
        removeParticipant: callsApi.removeParticipant,
      },
      room: livekitRoom,
      device: desktopShell() ? 'desktop' : 'web',
    });
  }
  return session;
}

const serverSnapshot = (): CallState => IDLE;

export function useCallState(): CallState {
  const s = typeof window === 'undefined' ? null : callSession();
  return useSyncExternalStore(
    s ? s.subscribe : () => () => {},
    s ? s.snapshot : serverSnapshot,
    serverSnapshot,
  );
}

/**
 * Headless, mounted once by the messenger shell: a tab on its way out
 * leaves the call with what a leaving page may still send (the brain's
 * reconciler is the truth if that never lands).
 */
export function CallUnloadGuard() {
  useEffect(() => {
    const onHide = () => callSession().unloadNow(leaveOnUnload);
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);
  return null;
}
