/**
 * The Control Center broadcast (docs/control-center.md in the mantle repo,
 * "Broadcast"): one message from a CC Admin to every person on the boxes
 * picked, in the read-only Announcements chat on each box, with a push.
 * GET /api/fleet/broadcasts lists them with one mark per box; POST sends one.
 * A person sends it: an agent may only draft (control_broadcast).
 *
 * LOCAL COPY: the shapes below are copied from the mantle branch
 * claude/cc-broadcast-29b7cb (migration 0395, `ControlBroadcastMark` and
 * `control_broadcasts`). They go once a client-types release ships them. A
 * brain before it answers the route 404: the screen says so.
 * Pure, so it is unit-tested.
 */
import { boxName, FLEET_PATH, reasonText } from './fleet';
import type { Tone } from './fleet-view';

export const FLEET_BROADCASTS_PATH = `${FLEET_PATH}/broadcasts`;
export const FLEET_BROADCASTS_KEY = ['fleet', 'broadcasts'] as const;

/** The brain's caps (CONTROL_BROADCAST_BODY_MAX, _TITLE_MAX). */
export const BROADCAST_TEXT_MAX = 8000;
export const BROADCAST_TITLE_MAX = 200;

/** One box's mark: `at` once the box took it, else its last failure. */
export type FleetBroadcastMark =
  { at: string; was: 'new' | 'already' } | { reason: string; tried: string };

export type FleetBroadcast = {
  id: string;
  title: string | null;
  body: string;
  madeBy: string;
  madeAt: string;
  boxIds: string[];
  marks: Record<string, FleetBroadcastMark>;
};

export type FleetBroadcastBox = { id: string; url: string; label: string | null };

export type FleetBroadcastsAnswer = {
  broadcasts: FleetBroadcast[];
  boxes: FleetBroadcastBox[];
};

export type FleetBroadcastRequest = { title?: string; text: string; boxIds: string[] };

/** What is wrong with the text and title before a send, or null. */
export function broadcastIssue(title: string, text: string): string | null {
  if (text.trim() === '') return 'Write the message first.';
  if (text.trim().length > BROADCAST_TEXT_MAX) {
    return `The message is at most ${BROADCAST_TEXT_MAX} characters.`;
  }
  if (title.trim().length > BROADCAST_TITLE_MAX) {
    return `The title is at most ${BROADCAST_TITLE_MAX} characters.`;
  }
  return null;
}

/** The request body: the title only when one is typed. */
export function broadcastRequest(
  title: string,
  text: string,
  boxIds: readonly string[],
): FleetBroadcastRequest {
  const t = title.trim();
  return { ...(t ? { title: t } : {}), text: text.trim(), boxIds: [...boxIds] };
}

const took = (m: FleetBroadcastMark | undefined): m is { at: string; was: 'new' | 'already' } =>
  !!m && 'at' in m;

/** How many of its boxes took it. */
export function takenCount(b: FleetBroadcast): number {
  return b.boxIds.filter((id) => took(b.marks[id])).length;
}

/** Whether a box of any broadcast still waits (the screen reads again). */
export function broadcastPending(list: readonly FleetBroadcast[] | undefined): boolean {
  return (list ?? []).some((b) => takenCount(b) < b.boxIds.length);
}

/** What one box's mark says. */
export function markLine(
  b: FleetBroadcast,
  boxId: string,
): { tone: Tone; text: string; reason: string | null } {
  const m = b.marks[boxId];
  if (took(m)) return { tone: 'ok', text: 'Delivered', reason: null };
  if (m && 'reason' in m) {
    return {
      tone: 'bad',
      text: 'Not delivered yet: it tries again at each run',
      reason: reasonText(m.reason === 'bad-call' ? null : m.reason) ?? oldBoxText(m.reason),
    };
  }
  return { tone: 'wait', text: 'Waiting for the next run', reason: null };
}

/** A box a release behind refuses the call (`bad-call`). */
function oldBoxText(code: string): string | null {
  return code === 'bad-call' ? 'The box is a release behind: it takes no broadcast yet.' : null;
}

/** A box card's line on the Broadcast screen: its word on the newest
 *  broadcast it was sent. Nothing when it was sent none. */
export function boxBroadcastLine(
  list: readonly FleetBroadcast[] | undefined,
  boxId: string,
): { tone: Tone; text: string } | null {
  const last = (list ?? []).find((b) => b.boxIds.includes(boxId));
  if (!last) return null;
  const m = markLine(last, boxId);
  return { tone: m.tone, text: `Last broadcast: ${m.text.split(':')[0]}` };
}

/** A box's name as the list of a broadcast shows it: removed boxes too. */
export function broadcastBoxName(
  boxes: readonly FleetBroadcastBox[] | undefined,
  boxId: string,
): string {
  const box = (boxes ?? []).find((x) => x.id === boxId);
  return box ? boxName(box) : 'A box no longer linked';
}
