/**
 * Which sound an app event makes, or none: the pure half of the wiring, so
 * the choices are pinned by events.test.ts. The places that call `play` keep
 * to three rules:
 *
 * - Sparing: a sound follows an event the person is waiting on (a chat line,
 *   a question, a run, a commit), never every click or toast.
 * - Never an echo: my own action seen again from another tab (a run I
 *   cancelled, a task I ticked) makes no sound. Where the client cannot tell
 *   mine from someone else's, it stays quiet.
 * - Whatever was already there when the page loaded is seeded, not sounded.
 */
import type { MessengerMention } from '@/lib/messenger/dto';
import type { SoundKind } from './recipes';

/** A chat line that pops: `mention` when it names me, else `message`
 *  (one or the other, never both). */
export function chatLineSound(
  message: { mentions?: readonly MessengerMention[] | null },
  me: string | null,
): 'mention' | 'message' {
  const named = !!me && (message.mentions ?? []).some((m) => m.kind === 'login' && m.id === me);
  return named ? 'mention' : 'message';
}

/**
 * The keys that are new since the last look. `seen` is null before the
 * first successful load: that load seeds it and nothing is new, so what was
 * waiting when the page opened makes no sound. Mutates and returns `seen`.
 */
export function freshKeys(
  seen: Set<string> | null,
  keys: readonly string[],
): { seen: Set<string>; fresh: string[] } {
  if (seen === null) return { seen: new Set(keys), fresh: [] };
  const fresh = keys.filter((k) => !seen.has(k));
  for (const k of fresh) seen.add(k);
  return { seen, fresh };
}

/** A run that left the active list, by the status it ended in: done is
 *  `complete`, failed is `danger`; cancelled or superseded (someone chose
 *  it, maybe me in another tab) is quiet. */
export function runEndSound(status: string | null | undefined): SoundKind | null {
  if (status === 'done' || status === 'completed') return 'complete';
  if (status === 'failed') return 'danger';
  return null;
}

/** The ids in `before` that are not in `after`: runs that stopped. */
export function goneIds(before: readonly string[], after: readonly string[]): string[] {
  const still = new Set(after);
  return before.filter((id) => !still.has(id));
}

/** The call's trouble, from one state to the next: the microphone or the
 *  speaker newly blocked is `warning`; a join that failed (joining straight
 *  back to idle) is `danger`. */
export function callTroubleSound(
  was: { phase: string; micBlocked: boolean; audioBlocked: boolean },
  now: { phase: string; micBlocked: boolean; audioBlocked: boolean },
): SoundKind | null {
  if (was.phase === 'joining' && now.phase === 'idle') return 'danger';
  if ((now.micBlocked && !was.micBlocked) || (now.audioBlocked && !was.audioBlocked)) {
    return 'warning';
  }
  return null;
}

/** A batch of uploads, once none is left to send: all through is
 *  `success`, any refused or failed is `warning`, all cancelled is quiet. */
export function uploadBatchSound(statuses: readonly string[]): SoundKind | null {
  if (statuses.some((s) => s === 'error' || s === 'conflict')) return 'warning';
  if (statuses.some((s) => s === 'done' || s === 'exists')) return 'success';
  return null;
}

/** A commit that did not go through: the item changed elsewhere (409, the
 *  editor reloads) is `warning`; anything else refused is `danger`. */
export function commitFailedSound(status: number | null | undefined): SoundKind {
  return status === 409 ? 'warning' : 'danger';
}

/** The Activity column's items, as much as the sounds need. */
type ActivityRow = { traceId: string; kind: string };

/** A conversation turn's end is the reply's own sound (`reply` or `danger`
 *  from the turn stream), so the Activity column does not sound it again. */
const ENDS_SOUNDED_ELSEWHERE = new Set(['responder_turn']);

/**
 * What changed in the Activity column between two snapshots. `known` is the
 * running items of the last look (id to kind), null before the first: that
 * look seeds it, so items already running at load make no sound.
 *
 * - `starts`: items running now that were not before (each sounds `start`).
 * - `ends`: items that stopped running, with their sound: in `failures` is
 *   `danger`, in `recent` is `complete`. One found in neither is quiet (it
 *   went by between two looks and the column does not say how it ended).
 */
export function activityChanges(
  known: ReadonlyMap<string, string> | null,
  snap: {
    active: readonly ActivityRow[];
    recent: readonly ActivityRow[];
    failures: readonly ActivityRow[];
  },
): {
  known: Map<string, string>;
  starts: string[];
  ends: { id: string; sound: 'complete' | 'danger' }[];
} {
  const next = new Map(snap.active.map((a) => [a.traceId, a.kind]));
  if (known === null) return { known: next, starts: [], ends: [] };
  const starts = [...next.keys()].filter((id) => !known.has(id));
  const failed = new Set(snap.failures.map((f) => f.traceId));
  const done = new Set(snap.recent.map((r) => r.traceId));
  const ends: { id: string; sound: 'complete' | 'danger' }[] = [];
  for (const [id, kind] of known) {
    if (next.has(id) || ENDS_SOUNDED_ELSEWHERE.has(kind)) continue;
    if (failed.has(id)) ends.push({ id, sound: 'danger' });
    else if (done.has(id)) ends.push({ id, sound: 'complete' });
  }
  return { known: next, starts, ends };
}

/** A new line in an assistant thread is a notice from the brain (it wrote to
 *  me), except where its reply sound already plays: on the assistant
 *  screen, where the turn stream sounds `reply`. */
export function agentLineSounds(pathname: string | null | undefined): boolean {
  return !/^\/assistant(\/|$)/.test(pathname ?? '');
}
