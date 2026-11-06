/**
 * The "Update In Progress" notice, as the client keeps it (pure). The brain
 * says whether it is on (GET /api/update-notice, public); while the brain
 * cannot be reached, the client holds the notice on its own last answer, so
 * the screen stays up through the restart and goes by itself once the brain
 * answers "off". The brain's own rule (a new version or an hour clears an
 * "on") lives brain-side; the client holds an "on" with no answer for an
 * hour from the last one at most.
 *
 * LOCAL COPY of @mantle/client-types dto/update-notice.ts `UpdateNoticeView`
 * until the contract pin moves past the release that ships it.
 */

/** GET /api/update-notice's answer. */
export type UpdateNoticeView = { on: boolean; version: string };

/** What one poll found. `unreachable`: no answer, a gateway error, or an
 *  answer that is not the brain's (a proxy's error page). A brain too old to
 *  have the route (404) is an answer: off. */
export type NoticeProbe = { kind: 'answer'; view: UpdateNoticeView } | { kind: 'unreachable' };

/** The last answer, kept across reloads (localStorage, per brain), so a
 *  page opened while the brain is down still knows the notice was on. */
export type Remembered = { on: boolean; at: number };

/** `off`: no notice. `on`: the brain says so. `down`: the brain cannot be
 *  reached and was last seen on. `done`: back and off (the screen finishes
 *  its bar, then the page reloads: a roll may have changed the interface,
 *  whether or not the brain's version moved). */
export type NoticePhase = 'off' | 'on' | 'down' | 'done';

export type NoticeState = {
  phase: NoticePhase;
  /** When the brain last said "on" (this tab's clock): the notice holds
   *  without an answer for an hour from then at most. */
  seenOnAt: number | null;
};

export const NOTICE_OFF: NoticeState = { phase: 'off', seenOnAt: null };

/** How long the notice holds with no answer from the brain, from its last
 *  "on": the brain's own limit (UPDATE_NOTICE_MAX_MS). */
export const REMEMBER_MAX_MS = 60 * 60 * 1000;

/** Poll every 15 s; every 5 s while the notice shows. */
export const POLL_MS = 15_000;
export const POLL_SHOWING_MS = 5_000;

/** The next state after a poll (pure). */
export function nextNotice(
  prev: NoticeState,
  probe: NoticeProbe,
  remembered: Remembered | null,
  now: number,
): NoticeState {
  if (prev.phase === 'done') return prev;
  if (probe.kind === 'unreachable') {
    const seenOnAt = prev.seenOnAt ?? (remembered?.on ? remembered.at : null);
    if (seenOnAt !== null && now - seenOnAt < REMEMBER_MAX_MS) return { phase: 'down', seenOnAt };
    return NOTICE_OFF;
  }
  if (probe.view.on) return { phase: 'on', seenOnAt: now };
  return prev.phase === 'on' || prev.phase === 'down' ? { ...prev, phase: 'done' } : NOTICE_OFF;
}

/** What to remember after a poll: an answer replaces it, no answer keeps the
 *  last one (pure). */
export function rememberAfter(
  probe: NoticeProbe,
  last: Remembered | null,
  now: number,
): Remembered | null {
  if (probe.kind === 'unreachable') return last;
  return { on: probe.view.on, at: now };
}

/** Read a poll's response (pure): `status` and the parsed body, or null when
 *  the body was not JSON. */
export function probeOf(status: number, body: unknown): NoticeProbe {
  if (status === 404) return { kind: 'answer', view: { on: false, version: '' } };
  if (status < 200 || status >= 300 || !body || typeof body !== 'object') {
    return { kind: 'unreachable' };
  }
  const { on, version } = body as Record<string, unknown>;
  if (typeof on !== 'boolean') return { kind: 'unreachable' };
  return { kind: 'answer', view: { on, version: typeof version === 'string' ? version : '' } };
}

/** The stored last answer, or null for anything else (pure). */
export function parseRemembered(raw: string | null): Remembered | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.on !== 'boolean') return null;
    if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
    return { on: v.on, at: v.at };
  } catch {
    return null;
  }
}

/** The bar's target, per phase: it creeps toward it and never quite stops
 *  (a long ease-out), then runs to the end when the update is done. */
export const STAGE: Record<
  Exclude<NoticePhase, 'off'>,
  { pct: number; ms: number; text: string }
> = {
  on: { pct: 45, ms: 60_000, text: 'Getting ready' },
  down: { pct: 90, ms: 180_000, text: 'Restarting services' },
  done: { pct: 100, ms: 600, text: 'All done' },
};
