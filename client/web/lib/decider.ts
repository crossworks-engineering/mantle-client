/**
 * The decider worker's screen (mantle docs/decisions.md "Failures an admin
 * sees" and "The Test button"): its privacy level, its last failure and its
 * Test result. Pure helpers only: no DOM here.
 *
 * The types mirror `DeciderLastFailure` and `DecisionTestResult` in
 * @mantle/client-types (mantle decider plan Part 3): declared here until the
 * pinned contract package carries them.
 */

/** The decider's last failure (the `decision` provider alert, open or
 *  closed). `reason` is fixed text the brain picks by code. */
export type DeciderLastFailure = {
  code: string;
  permanent: boolean;
  reason: string;
  provider: string | null;
  model: string | null;
  /** When this run of failures started, and the latest one (ISO). */
  since: string;
  lastAt: string;
  count: number;
  /** Admins see it as an alert now. */
  shown: boolean;
  /** When a decision worked again (ISO); null while it still fails. */
  resolvedAt: string | null;
  /** The open row is about the decider that runs now (enabled, a use on,
   *  the same model). False once closed, and when no decision runs that
   *  could close it. */
  current: boolean;
};

/** One Test click: one request to the saved model, sent as production
 *  sends it. */
export type DecisionTestResult = {
  model: string;
  provider: string;
  privacy: DeciderPrivacy;
  timeoutMs: number;
  ms: number;
} & (
  | {
      ok: true;
      adapter: string;
      tokensIn: number | null;
      costUsd: number | null;
      answers: Record<string, unknown>;
    }
  | {
      ok: false;
      code: string;
      reason: string;
      /** The provider's or the adapter's own words, for a settings admin. */
      detail: string | null;
    }
);

export type DeciderPrivacy = 'zdr' | 'no_training';

/**
 * The privacy level the brain reads from the worker's params, the twin of
 * mantle `deciderPrivacy()` (packages/decisions/src/privacy.ts): the new key
 * `privacy`, else the old `zdr` (true is zdr, false is no_training); when
 * the two disagree the stricter wins, and an unknown value is zdr.
 */
export function deciderPrivacyOf(
  params: Record<string, unknown> | null | undefined,
): DeciderPrivacy {
  const privacy = params?.privacy;
  const zdr = params?.zdr;
  if (privacy !== undefined && privacy !== 'zdr' && privacy !== 'no_training') return 'zdr';
  if (zdr !== undefined && typeof zdr !== 'boolean') return 'zdr';
  if (privacy === 'zdr' || zdr === true) return 'zdr';
  if (privacy === 'no_training' || zdr === false) return 'no_training';
  return 'zdr';
}

/** What the form writes for the "Request zero data retention" box: both
 *  keys, in step, so neither can keep an older, stricter value alive. */
export function deciderPrivacyParams(zdrTicked: boolean): {
  privacy: DeciderPrivacy;
  zdr: boolean;
} {
  return zdrTicked ? { privacy: 'zdr', zdr: true } : { privacy: 'no_training', zdr: false };
}

/** The last failure in a GET /api/ai-workers/config answer, or null (none,
 *  or a brain before decider Part 3). */
export function deciderLastFailureOf(config: unknown): DeciderLastFailure | null {
  const f = (config as { deciderLastFailure?: unknown } | null | undefined)?.deciderLastFailure;
  return f && typeof f === 'object' ? (f as DeciderLastFailure) : null;
}

/**
 * How the screen shows it: `failing` (red: open, an admin sees it as an
 * alert, and it is about the decider that runs now), `blip` (open, not an
 * alert yet), `idle` (open, but no decision runs that could close it) or
 * `fixed` (closed). A brain without `current` counts as current.
 */
export type LastFailureState = 'failing' | 'blip' | 'idle' | 'fixed';

export function lastFailureState(f: DeciderLastFailure): LastFailureState {
  if (f.resolvedAt) return 'fixed';
  if (f.current === false) return 'idle';
  return f.shown || f.permanent ? 'failing' : 'blip';
}

/** The privacy level in words. */
export function privacyText(p: DeciderPrivacy): string {
  return p === 'zdr' ? 'zero data retention' : 'no training (retention allowed)';
}

/** "3 Nov, 08:14" (or "08:14" today). */
export function whenText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

/** The headline: still failing, a blip so far, or fixed since. */
export function lastFailureHeadline(f: DeciderLastFailure, now?: Date): string {
  const on = f.model ? ` on ${f.model}` : '';
  if (f.resolvedAt) {
    return `Last failure${on} at ${whenText(f.lastAt, now)}. It works again since ${whenText(f.resolvedAt, now)}.`;
  }
  if (lastFailureState(f) === 'blip')
    return `A decision failed${on} at ${whenText(f.lastAt, now)}.`;
  return `Failing${on} since ${whenText(f.since, now)} (last at ${whenText(f.lastAt, now)}).`;
}

/** The line under the reason, by state; null for a fixed failure. */
export function lastFailureNote(f: DeciderLastFailure): string | null {
  switch (lastFailureState(f)) {
    case 'failing':
      return 'Search and chat run without the decider until it works. Fix the cause, then press Test below to check the fix. The brain never lowers the privacy level.';
    case 'blip':
      return 'The brain keeps calling it; it shows as an alert if it lasts 10 minutes.';
    case 'idle':
      return 'No decision runs on it now (the worker or every use is off, or another decider runs), so it is not an alert. Test checks it before you switch it on.';
    default:
      return null;
  }
}
