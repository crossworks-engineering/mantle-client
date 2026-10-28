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
 * A line found after a gap may be this old and still ring: a ring's time
 * with room for a clock that runs a little ahead of the brain's.
 */
export const GAP_RING_AGE_MS = RING_MS + 15_000;

/**
 * Whether a line rings here: a "call started" line, in a chat that is not
 * muted, not my own call (`mine`: the line names me, or this login started
 * it lately), while this tab is not in a call or ringing already (`busy`),
 * and, for a line found in a gap rather than heard live, not older than a
 * ring lasts (history after a reconnect). The chat being on screen does
 * not matter: a ring is answered, not read.
 */
export function shouldRing(s: {
  message: Pick<MessengerMessage, 'authorKind' | 'event' | 'deletedAt' | 'createdAt'>;
  muted: boolean;
  mine: boolean;
  busy: boolean;
  /** Heard on the stream now (true), or found in a gap (false). */
  live: boolean;
  now: number;
}): boolean {
  if (s.muted || s.mine || s.busy || s.message.deletedAt) return false;
  const e = callEventOf(s.message);
  if (!e || e.type !== 'call_started') return false;
  if (s.live) return true;
  const at = new Date(s.message.createdAt).getTime();
  if (!Number.isFinite(at)) return false;
  return s.now - at < GAP_RING_AGE_MS;
}

/**
 * The bookkeeping of the ringer, free of React: which line each chat was
 * last seen at (a gap carries no event, so the list says what moved), and
 * which lines were handled, so one seq is handled once across the event
 * path and the gap path, and a fetch that failed can be tried again.
 */
export class RingBook {
  private readonly last = new Map<string, number>();
  private readonly handled = new Set<string>();
  private baseline = false;

  constructor(private readonly keep = 200) {}

  /** The lines a fresh list says moved since the last one: none from the
   *  first list (what is already there is history, not a ring). */
  moved(rows: readonly { id: string; kind: string; lastSeq: number | null }[]): {
    c: string;
    seq: number;
  }[] {
    const out: { c: string; seq: number }[] = [];
    for (const r of rows) {
      if (r.kind === 'agent' || r.lastSeq === null) continue;
      const was = this.last.get(r.id) ?? 0;
      if (r.lastSeq > was) {
        this.last.set(r.id, r.lastSeq);
        if (this.baseline) out.push({ c: r.id, seq: r.lastSeq });
      }
    }
    this.baseline = true;
    return out;
  }

  /** An event named this seq: the list knows it now. */
  heard(c: string, seq: number): void {
    if (seq > (this.last.get(c) ?? 0)) this.last.set(c, seq);
  }

  /** Claim a line: true once, false while it is claimed. */
  claim(c: string, seq: number): boolean {
    const key = `${c}:${seq}`;
    if (this.handled.has(key)) return false;
    this.handled.add(key);
    if (this.handled.size > this.keep) {
      this.handled.delete(this.handled.values().next().value!);
    }
    return true;
  }

  /** The claim is given back (the fetch failed): the gap path may retry. */
  release(c: string, seq: number): void {
    this.handled.delete(`${c}:${seq}`);
  }
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

/**
 * The "call started" line a reader may still join: the newest call line of
 * the loaded window is a start (no end line after it), and it is younger
 * than the brain's cap allows (a very old start with no end in the window
 * is history the window does not show the end of). Its seq, or null.
 */
export function openCallSeq(
  messages: readonly Pick<MessengerMessage, 'authorKind' | 'event' | 'seq' | 'createdAt'>[],
  now: number,
  maxAgeMs: number = OPEN_CALL_MAX_AGE_MS,
): number | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    const e = callEventOf(m);
    if (!e) continue;
    if (e.type !== 'call_started') return null;
    const at = new Date(m.createdAt).getTime();
    return Number.isFinite(at) && now - at < maxAgeMs ? m.seq : null;
  }
  return null;
}

/** A start line older than this with no end in the window is not offered
 *  for joining (the brain's default cap is 240 minutes). */
export const OPEN_CALL_MAX_AGE_MS = 240 * 60_000;
