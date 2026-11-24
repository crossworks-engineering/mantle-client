/**
 * Key status on the fleet (docs/control-center.md in the mantle repo, "Key
 * status on the fleet"): for the Control Center's own box and each linked
 * box, which provider keys it holds, when each was set, whether its last
 * test passed, and a short print of the key. Never a key. Pure, so it is
 * unit-tested; the screen is app/(app)/admin/fleet/key-status.
 *
 * Every code the brain sends is looked up with `Object.hasOwn`, so a code
 * from a newer brain (or one named like an Object method) reads as a plain
 * fallback, never a crash.
 */
import type {
  FleetKeyBox,
  FleetKeyLine,
  FleetKeyState,
  FleetKeyStatus,
  FleetKeyTestAnswer,
} from '@mantle/client-types';
import { ApiError } from '@mantle/web-ui/api-fetch';
import { boxName, FLEET_KEY, FLEET_PATH } from './fleet';
import type { Tone } from './fleet-view';

export type { FleetKeyBox, FleetKeyLine, FleetKeyStatus, FleetKeyTestAnswer };

export const FLEET_KEY_STATUS_PATH = `${FLEET_PATH}/keys`;
export const FLEET_KEY_TEST_PATH = `${FLEET_PATH}/keys/test`;
/** Under FLEET_KEY: a Fleet refresh reads the key status again too. */
export const FLEET_KEY_STATUS_KEY = [...FLEET_KEY, 'key-status'];
/** The CC's own box in both routes. */
export const SELF_ID = 'self';

/** After a `pending` answer, the reads again (ms after the answer): two,
 *  then the screen waits for a person. */
export const PENDING_REREAD_MS = [8_000, 20_000] as const;

/** One answered box of Test now. */
export type TestedBox = FleetKeyTestAnswer['boxes'][number];

/** `table[code]`, only for the table's own keys. */
function lookup<T>(table: Readonly<Record<string, T>>, code: string | null | undefined): T | null {
  return code != null && Object.hasOwn(table, code) ? table[code]! : null;
}

/** How long ago `iso` was: "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ageText(iso: string | null, now: number = Date.now()): string {
  const at = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(at)) return 'unknown';
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** The box's name: "This box" for the Control Center's own. */
export function keyBoxName(box: Pick<FleetKeyBox, 'id' | 'url' | 'label'>): string {
  if (box.id === SELF_ID || box.url === null) return 'This box';
  return boxName({ url: box.url, label: box.label });
}

export type StateMark = 'tick' | 'cross' | 'dot' | 'none';

const STATES: Record<
  FleetKeyState,
  { tone: Tone | 'muted'; mark: StateMark; label: string; wantsTest: boolean }
> = {
  works: { tone: 'ok', mark: 'tick', label: 'Works', wantsTest: false },
  failed: { tone: 'bad', mark: 'cross', label: 'Failed', wantsTest: false },
  stale: { tone: 'muted', mark: 'dot', label: 'Set again since its last test', wantsTest: true },
  'not-tested': { tone: 'muted', mark: 'dot', label: 'Never tested', wantsTest: true },
  'no-test': { tone: 'muted', mark: 'none', label: 'This service has no test', wantsTest: false },
};

/** A line's state in plain words (`label` alone, `text` with the test
 *  time), and whether it asks for Test now. */
export function keyStateText(
  line: Pick<FleetKeyLine, 'state' | 'test'>,
  now: number = Date.now(),
): { tone: Tone | 'muted'; mark: StateMark; label: string; text: string; wantsTest: boolean } {
  const s = lookup<(typeof STATES)[FleetKeyState]>(STATES, line.state);
  if (!s) {
    return {
      tone: 'muted',
      mark: 'none',
      label: 'Unknown state',
      text: 'Unknown state',
      wantsTest: false,
    };
  }
  const tested = line.test ? `, tested ${ageText(line.test.at, now)}` : '';
  const text = line.state === 'works' || line.state === 'failed' ? `${s.label}${tested}` : s.label;
  return { tone: s.tone, mark: s.mark, label: s.label, text, wantsTest: s.wantsTest };
}

/** The Tested column: the last test, or "never". */
export function testedText(line: Pick<FleetKeyLine, 'test'>, now: number = Date.now()): string {
  if (!line.test) return 'never';
  return `${line.test.ok ? 'passed' : 'failed'} ${ageText(line.test.at, now)}`;
}

/** The print, or a plain "not shown": a short key, or one with odd
 *  characters, gives no print. */
export const printText = (print: string | null): string => print ?? 'not shown';

const KEYS_REASONS: Record<NonNullable<FleetKeyBox['keysReason']>, string> = {
  'old-box': 'Update this box to see its keys.',
  scope: 'This box refuses the Control Center.',
  'no-facts': 'Not read yet.',
  error: 'Key status failed on this box.',
  'bad-reply': 'This box sent key lines the Control Center cannot read.',
  'keys-area': "You need the Keys area to see this box's keys.",
};

/** Why a box shows no lines (`keys: null`). */
export function keysReasonText(code: string | null): string {
  return lookup(KEYS_REASONS, code) ?? 'This box sent no key lines.';
}

const READ_FAILS: Record<string, string> = {
  unreachable: 'Could not reach the box over HTTPS.',
  off: 'The box has no control lines in its .env.',
  sig: "The box and the Control Center do not trust each other's link key. Copy the key line to the box again.",
  time: 'The clocks of the box and the Control Center differ by more than 60 seconds.',
  'bad-reply': 'The box gave a reply the Control Center cannot read.',
  'reply-too-large': 'The reply of the box is larger than 4 MB.',
};

/** Why the last read failed, or null: it did not. The old lines stay. */
export function readFailText(code: string | null): string | null {
  if (code === null) return null;
  const known = lookup(READ_FAILS, code);
  if (known) return known;
  const http = /^http-(\d{3})$/.exec(code);
  return http ? `The box answered HTTP ${http[1]}.` : 'The last read failed.';
}

/** The failed read's callout: why, and what the lines below are. No lines,
 *  no word of them; no read time, no age. */
export function readFailNote(
  box: Pick<FleetKeyBox, 'reason' | 'at' | 'keys'>,
  now: number = Date.now(),
): string | null {
  const why = readFailText(box.reason);
  if (why === null) return null;
  if (box.keys === null || box.keys.length === 0) return why;
  return box.at
    ? `${why} The lines below are from the read before, ${ageText(box.at, now)}.`
    : `${why} The lines below are from an earlier read.`;
}

const TESTED: Record<string, { tone: Tone; text: string }> = {
  ok: { tone: 'ok', text: 'Tested just now.' },
  scope: { tone: 'bad', text: 'This box refuses the Control Center. Nothing was tested.' },
  'bad-call': { tone: 'warn', text: 'This box is a release behind: update the box to test here.' },
  unreachable: { tone: 'bad', text: 'Could not reach the box. Nothing was tested.' },
  'http-500': { tone: 'bad', text: 'A test could not run on that box.' },
  busy: { tone: 'warn', text: 'The box is busy: 10 calls already wait. Try again later.' },
  pending: { tone: 'wait', text: 'No answer yet. Reading again shortly.' },
  'keys-area': { tone: 'bad', text: "You need the Keys area to test this box's keys." },
  error: { tone: 'bad', text: 'The test failed on this box.' },
};

/** A box's Test now answer in plain words. An unknown code (a newer brain)
 *  gets a safe generic text. */
export function testAnswerText(code: string): { tone: Tone; text: string } {
  return lookup(TESTED, code) ?? { tone: 'bad', text: 'The box did not finish the test.' };
}

/** A failed Test now call (the route itself, not a box). */
export function testCallFailText(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) {
    return 'Too many tests. Try again in a few minutes.';
  }
  return 'Could not run the test. Try again.';
}

/** Whether Test now can help this box: not on a box that refuses the CC,
 *  one a release behind, or the CC's own without the Keys area. */
export function canTest(box: Pick<FleetKeyBox, 'keysReason'>): boolean {
  return (
    box.keysReason !== 'old-box' && box.keysReason !== 'scope' && box.keysReason !== 'keys-area'
  );
}

/** Whether any line of the box asks for a test (stale or never tested). */
export function boxWantsTest(box: Pick<FleetKeyBox, 'keys'>): boolean {
  return (box.keys ?? []).some((l) => keyStateText(l).wantsTest);
}

/** Whether the answer asks for a read again (a box still `pending`). */
export const answerPending = (answer: FleetKeyTestAnswer): boolean =>
  answer.boxes.some((b) => b.tested === 'pending');

/** The status with the boxes of a Test now answer put in (by id): their
 *  fresh lines, the rest as they were. `tested` is kept apart. */
export function withTested(status: FleetKeyStatus, answer: FleetKeyTestAnswer): FleetKeyStatus {
  const fresh = new Map(answer.boxes.map(({ tested, ...box }) => (void tested, [box.id, box])));
  return { boxes: status.boxes.map((b) => fresh.get(b.id) ?? b) };
}

/** Each box's Test now answer, by id. */
export function testedById(answer: FleetKeyTestAnswer): Record<string, string> {
  return Object.fromEntries(answer.boxes.map((b) => [b.id, b.tested]));
}

/** Where the key set last for a service is: its box and when. */
export type LastSetKey = { box: string; at: string };

/**
 * The lines that hold another key than the one set last for their service,
 * by `${boxId}:${service}`, each with where that one is. Neutral on purpose:
 * a fleet may keep a key of its own on each box (spend kept apart). Only
 * prints are compared: a line, or the line set last, with no print is never
 * marked (the keys cannot be compared); the same print set at another time
 * is the same key.
 */
export function differentKeys(boxes: readonly FleetKeyBox[]): Map<string, LastSetKey> {
  const last = new Map<string, { t: number; at: string; box: string; print: string | null }>();
  for (const b of boxes) {
    for (const l of b.keys ?? []) {
      const t = new Date(l.setAt).getTime();
      if (Number.isNaN(t)) continue;
      const n = last.get(l.service);
      if (!n || t > n.t)
        last.set(l.service, { t, at: l.setAt, box: keyBoxName(b), print: l.print });
    }
  }
  const out = new Map<string, LastSetKey>();
  for (const b of boxes) {
    for (const l of b.keys ?? []) {
      const n = last.get(l.service);
      if (!n || n.print === null || l.print === null || l.print === n.print) continue;
      out.set(`${b.id}:${l.service}`, { box: n.box, at: n.at });
    }
  }
  return out;
}

/** A box card's line: its key count and the worst state, or its reason. */
export function boxSummary(box: Pick<FleetKeyBox, 'keys' | 'keysReason'>): {
  tone: Tone | 'muted';
  text: string;
} {
  if (box.keys === null) return { tone: 'muted', text: keysReasonText(box.keysReason) };
  const n = box.keys.length;
  if (n === 0) return { tone: 'muted', text: 'Holds no keys.' };
  const keys = n === 1 ? '1 key' : `${n} keys`;
  const failed = box.keys.filter((l) => l.state === 'failed').length;
  if (failed > 0) return { tone: 'bad', text: `${keys}, ${failed} failed` };
  const untested = box.keys.filter((l) => keyStateText(l).wantsTest).length;
  if (untested > 0) return { tone: 'warn', text: `${keys}, ${untested} to test` };
  return { tone: 'ok', text: `${keys}, all fine` };
}
