'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, LogOut, RotateCw } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { cn } from '@mantle/web-ui/lib/utils';
import { performSignOut } from '@mantle/web-ui/sign-out';
// Relative, not '@/': the node test runner renders these (shell-screens.test.ts).
import { shellRetryDelayMs, type ShellProbeFailure } from '../../lib/shell-probe';

/**
 * The neutral screens the app shell shows while it has no shell to render
 * (phase W5c): while GET /api/shell has not answered, and when it could not
 * be asked. None of them makes a request of its own beyond sign-out, and
 * none carries the rail, the nav or a page.
 */
function NeutralFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background p-4 text-foreground">
      {children}
    </div>
  );
}

/** The settings-card shell (ui-style-guide §6e): a title block over a body.
 *  `alert`: a failure the screen reader announces, focused on mount so the
 *  keyboard starts at it. */
function NeutralCard({
  title,
  alert = false,
  children,
}: {
  title: string;
  alert?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (alert) ref.current?.focus();
  }, [alert]);
  return (
    <section
      ref={ref}
      role={alert ? 'alert' : undefined}
      tabIndex={alert ? -1 : undefined}
      className="w-full max-w-md rounded-xl border border-border bg-card text-card-foreground outline-none"
    >
      <div className="border-b border-border p-4 md:p-5">
        <h1 className="text-base font-semibold">{title}</h1>
      </div>
      <div className="space-y-4 p-4 md:p-5">{children}</div>
    </section>
  );
}

/** Ends the session the plain way (POST /api/auth/logout, via the shared
 *  sign-out) and goes to /login. A full navigation, so nothing of this shell
 *  survives it. */
export function NeutralSignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      // A sign-out is the user's own (lib/agent-ui).
      data-agent-risk="session"
      onClick={async () => {
        setBusy(true);
        await performSignOut();
        window.location.assign('/login');
      }}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
      Sign out
    </Button>
  );
}

/** How long the loading screen waits before it offers Sign out: a slow
 *  first answer is normal, a stuck one must not trap the login. */
export const LOADING_SIGN_OUT_AFTER_MS = 4_000;

/** Until the shell has answered. Sign out joins it after `signOutAfterMs`
 *  (0: from the start). */
export function ShellLoadingScreen({
  signOutAfterMs = LOADING_SIGN_OUT_AFTER_MS,
}: {
  signOutAfterMs?: number;
}) {
  const [slow, setSlow] = useState(signOutAfterMs <= 0);
  useEffect(() => {
    if (signOutAfterMs <= 0) return;
    const t = setTimeout(() => setSlow(true), signOutAfterMs);
    return () => clearTimeout(t);
  }, [signOutAfterMs]);
  return (
    <NeutralFrame>
      <div className="flex flex-col items-center gap-4">
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading…
        </p>
        {slow ? <NeutralSignOutButton /> : null}
      </div>
    </NeutralFrame>
  );
}

/** What the failed screen says, by how the probe failed. Never "the brain
 *  did not answer" for an answer (a 500, a 403): that one says only that the
 *  workspace did not load. */
export const PROBE_FAILURE_TEXT: Record<ShellProbeFailure, string> = {
  offline: 'This device is offline. The workspace loads once the connection is back.',
  unreachable: 'The brain could not be reached. Check the connection.',
  error: 'Something went wrong while loading it.',
};

/** The shell could not be loaded (offline, unreachable, a 500): keep asking.
 *  It retries on its own with a backoff (2, 4, 8, then every 15 s) for as
 *  long as it shows, and Try again asks at once. The card is an alert and
 *  takes focus, so a screen reader hears it and the keyboard starts at it. */
export function ShellProbeFailedScreen({
  failure = 'error',
  retrying = false,
  onRetry,
}: {
  failure?: ShellProbeFailure;
  /** A retry is in flight. */
  retrying?: boolean;
  onRetry: () => void;
}) {
  const retry = useRef(onRetry);
  useEffect(() => {
    retry.current = onRetry;
  }, [onRetry]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      setAttempt((a) => a + 1);
      retry.current();
    }, shellRetryDelayMs(attempt));
    return () => clearTimeout(t);
  }, [attempt]);
  return (
    <NeutralFrame>
      <NeutralCard title="Could not load your workspace" alert>
        <p className="text-sm text-muted-foreground">{PROBE_FAILURE_TEXT[failure]}</p>
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className={cn('size-3.5', retrying && 'animate-spin')} aria-hidden />
          Reconnecting…
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onRetry} disabled={retrying}>
            <RotateCw aria-hidden />
            Try again
          </Button>
          <NeutralSignOutButton />
        </div>
      </NeutralCard>
    </NeutralFrame>
  );
}

/**
 * The shell's own gate: the whole shell, chrome and page, renders once
 * GET /api/shell has answered. Until then a neutral full-window screen:
 * loading, or (when the probe failed) the failure card with Try again.
 */
export function ShellGate({
  ready,
  failure,
  retrying,
  onRetry,
  children,
}: {
  /** The shell has answered with data. */
  ready: boolean;
  /** How the probe failed, or null while it has not. */
  failure: ShellProbeFailure | null;
  retrying?: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (ready) return <>{children}</>;
  if (failure) {
    return <ShellProbeFailedScreen failure={failure} retrying={retrying} onRetry={onRetry} />;
  }
  return <ShellLoadingScreen />;
}
