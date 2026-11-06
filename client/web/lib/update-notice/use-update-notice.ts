'use client';

import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '@mantle/web-ui/api-fetch';
import { useDocumentVisible } from '@/lib/use-document-visible';
import {
  NOTICE_OFF,
  POLL_MS,
  POLL_SHOWING_MS,
  nextNotice,
  parseRemembered,
  probeOf,
  rememberAfter,
  reloadsWhenDone,
  type NoticeProbe,
  type NoticeState,
  type Remembered,
} from './state';

const STORE_KEY = 'mantle.updateNotice';
/** How long the finished bar shows before the screen goes. */
const DONE_HOLD_MS = 900;

function readRemembered(): Remembered | null {
  try {
    return parseRemembered(window.localStorage.getItem(STORE_KEY));
  } catch {
    return null;
  }
}

function writeRemembered(r: Remembered | null): void {
  try {
    if (r) window.localStorage.setItem(STORE_KEY, JSON.stringify(r));
  } catch {
    // private mode or full storage: the notice still works for this page
  }
}

/** One poll. A raw fetch, not apiFetch: the route is public, and an odd
 *  answer mid-restart must never bounce the user to the sign-in page. */
async function probe(): Promise<{ probe: NoticeProbe; version: string }> {
  try {
    const res = await fetch(apiUrl('/api/update-notice'), { cache: 'no-store' });
    const body: unknown = await res.json().catch(() => null);
    const p = probeOf(res.status, body);
    return { probe: p, version: p.kind === 'answer' ? p.view.version : '' };
  } catch {
    return { probe: { kind: 'unreachable' }, version: '' };
  }
}

/**
 * The notice's state, polled while the tab is visible (every 15 s, every 5 s
 * while it shows). When it is done it holds the full bar a moment, then
 * reloads the page if the box came back on another version, else goes.
 */
export function useUpdateNotice(): NoticeState {
  const [state, setState] = useState<NoticeState>(NOTICE_OFF);
  // The effect's own copy: every change goes through it, and render reads
  // the state.
  const stateRef = useRef<NoticeState>(NOTICE_OFF);
  const visible = useDocumentVisible();

  useEffect(() => {
    if (!visible) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const { probe: p, version } = await probe();
      if (stopped) return;
      const now = Date.now();
      const remembered = readRemembered();
      const next = nextNotice(stateRef.current, p, remembered, now);
      writeRemembered(rememberAfter(p, remembered, now));
      if (next.phase === 'done' && stateRef.current.phase !== 'done') {
        const reload = reloadsWhenDone(next, version);
        setTimeout(() => {
          if (reload) {
            window.location.reload();
            return;
          }
          stateRef.current = NOTICE_OFF;
          setState(NOTICE_OFF);
        }, DONE_HOLD_MS);
      }
      stateRef.current = next;
      setState(next);
      const showing = next.phase === 'on' || next.phase === 'down';
      timer = setTimeout(() => void tick(), showing ? POLL_SHOWING_MS : POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [visible]);

  return state;
}
