/**
 * The ring (calls plan page 886126b4 section 5): a "call started" system
 * line on the normal messenger stream rings the chat's other people, for
 * RING_MS, as a card in the app and an OS notice from a hidden desktop
 * window. The pure half: which line rings, its words, and the call lines
 * the transcript shows. Pinned by ring.test.ts.
 */
import type { MessengerEvent, MessengerMessage } from '@/lib/messenger/dto';
import { RING_MS } from './session';

type EventLine = Pick<MessengerMessage, 'authorKind' | 'event'>;

/** The call event a system line carries, or null for every other row. */
export function callEventOf(m: EventLine | null | undefined): MessengerEvent | null {
  if (!m || m.authorKind !== 'system') return null;
  const e = m.event;
  if (!e || typeof e !== 'object' || typeof e.callId !== 'string') return null;
  switch (e.type) {
    case 'call_started':
      return { type: 'call_started', callId: e.callId };
    case 'call_ended':
    case 'call_cap':
      return {
        type: e.type,
        callId: e.callId,
        seconds: typeof e.seconds === 'number' && e.seconds >= 0 ? e.seconds : 0,
        participants:
          typeof e.participants === 'number' && e.participants >= 0 ? e.participants : 0,
      };
    default:
      return null;
  }
}

/**
 * Whether a line rings here: a "call started" line, in a chat that is not
 * muted, while this tab is not in a call or ringing already (`busy`; the
 * caller's own tab is joining, so its own line never rings), and not older
 * than a ring lasts (a line found in a gap after a reconnect is history).
 * The chat being on screen does not matter: a ring is answered, not read.
 */
export function shouldRing(s: {
  message: Pick<MessengerMessage, 'authorKind' | 'event' | 'deletedAt' | 'createdAt'>;
  muted: boolean;
  busy: boolean;
  now: number;
}): boolean {
  if (s.muted || s.busy || s.message.deletedAt) return false;
  const e = callEventOf(s.message);
  if (!e || e.type !== 'call_started') return false;
  const at = new Date(s.message.createdAt).getTime();
  if (!Number.isFinite(at)) return false;
  return s.now - at < RING_MS;
}

/**
 * Who started the call, from the line the brain writes ("Ann Lee started a
 * call."): the event names the call, not the caller, in P1.
 */
export function callerNameOf(m: Pick<MessengerMessage, 'body' | 'authorName'>): string {
  if (m.authorName) return m.authorName;
  const match = /^(.+?) started a call\.?$/.exec(m.body.trim());
  return match?.[1]?.trim() || 'Someone';
}

/** The ring's words: "Ann Lee is calling", or "Ann Lee started a call in Design". */
export function ringText(
  callerName: string,
  groupTitle: string | null,
): { title: string; body: string } {
  return groupTitle
    ? { title: `${callerName} started a call in ${groupTitle}`, body: 'Answer to join' }
    : { title: `${callerName} is calling`, body: 'Answer to join' };
}

/** "12 s", "1 min", "12 min", "1 h 05 min". */
export function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, '0')} min`;
}

/** "3 people", "1 person". */
export function peopleLabel(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/**
 * The transcript's call line: what the brain wrote for a start, and for an
 * end the duration and the head count from the event. Null for a line that
 * is not a call's (the plain system line shows then).
 */
export function callLine(
  m: Pick<MessengerMessage, 'authorKind' | 'event' | 'body'>,
): { kind: MessengerEvent['type']; text: string } | null {
  const e = callEventOf(m);
  if (!e) return null;
  if (e.type === 'call_started') return { kind: e.type, text: m.body || 'A call started.' };
  const tail = `${durationLabel(e.seconds)}, ${peopleLabel(e.participants)}`;
  return {
    kind: e.type,
    text:
      e.type === 'call_cap' ? `Call ended at the time limit (${tail}).` : `Call ended (${tail}).`,
  };
}
