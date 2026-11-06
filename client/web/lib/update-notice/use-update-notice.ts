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
  type NoticeProbe,
  type NoticeState,
  type Remembered,
} from './state';

/** How long the finished bar shows before the page reloads. */
const DONE_HOLD_MS = 900;
/** A poll that has not answered by then counts as no answer. */
const POLL_TIMEOUT_MS = 8_000;
/** Before the reload: ask the page's own origin until it answers (a roll
 *  restarts the interface too), every 2 s, for a minute at most. */
const UI_WAIT_STEP_MS = 2_000;
const UI_WAIT_TRIES = 30;

/** Per brain: the desktop app reaches several from one origin. */
const storeKey = () => `mantle.updateNotice:${apiUrl('')}`;

function readRemembered(): Remembered | null {
  try {
    return parseRemembered(window.localStorage.getItem(storeKey()));
  } catch {
    return null;
  }
}

function writeRemembered(r: Remembered | null): void {
  try {
    if (r) window.localStorage.setItem(storeKey(), JSON.stringify(r));
  } catch {
    // private mode or full storage: the notice still works for this page
  }
}

/** One poll. A raw fetch, not apiFetch: the route is public, and an odd
 *  answer mid-restart must never bounce the user to the sign-in page. */
async function probe(): Promise<NoticeProbe> {
  try {
    const res = await fetch(apiUrl('/api/update-notice'), {
      cache: 'no-store',
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    const body: unknown = await res.json().catch(() => null);
    return probeOf(res.status, body);
  } catch {
    return { kind: 'unreachable' };
  }
}

/** Whether the page's own origin serves again (any answer but a gateway
 *  error), so the reload does not land on the front door's error page. */
async function uiServes(): Promise<boolean> {
  try {
    const res = await fetch('/env.js', {
      cache: 'no-store',
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    return res.status < 502 || res.status > 504;
  } catch {
    return false;
  }
}

/**
 * The notice's state, polled while the tab is visible (every 15 s, every 5 s
 * while it shows). When it is done it holds the full bar a moment, waits
 * until the page's own origin answers, then reloads the page: the update may
 * have changed the interface, whether or not the brain's version moved.
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
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });
    const reloadWhenServed = async () => {
      await wait(DONE_HOLD_MS);
      for (let i = 0; i < UI_WAIT_TRIES && !stopped && !(await uiServes()); i++) {
        await wait(UI_WAIT_STEP_MS);
      }
      if (!stopped) window.location.reload();
    };
    const tick = async () => {
      const p = await probe();
      if (stopped) return;
      const now = Date.now();
      const remembered = readRemembered();
      const next = nextNotice(stateRef.current, p, remembered, now);
      writeRemembered(rememberAfter(p, remembered, now));
      const finished = next.phase === 'done' && stateRef.current.phase !== 'done';
      stateRef.current = next;
      setState(next);
      if (finished) return void reloadWhenServed();
      if (next.phase === 'done') return;
      const showing = next.phase === 'on' || next.phase === 'down';
      timer = setTimeout(() => void tick(), showing ? POLL_SHOWING_MS : POLL_MS);
    };
    // Done already (the tab was hidden mid-way): finish the reload.
    if (stateRef.current.phase === 'done') void reloadWhenServed();
    else void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [visible]);

  return state;
}
