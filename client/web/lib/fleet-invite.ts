/**
 * Add a person to a box from Fleet > Users (mantle docs/control-center.md,
 * "Add a person from the CC"). The Control Center asks one linked box for a
 * member invite; the box makes it with its own invite code. The person opens
 * the link and sets their own password. A person only: the route asks the
 * CC Admin's own password.
 *
 * POST /api/fleet/invite, one of:
 *  - `{ do: 'invite', boxId, email, password }`;
 *  - `{ do: 'answers', callIds }`: invites still on their way.
 * The reply: `{ invites, pending, gone }`, each invite with the link ONCE.
 * The link is never stored here: it lives in the dialog's state until the
 * dialog closes.
 */
import { apiSend } from '@mantle/web-ui/api-fetch';
import { FLEET_PATH } from './fleet';
import { boxName } from './fleet';
import { peopleReasonText, type FleetPeopleBox, type Person } from './fleet-people';
import { toolReasonText } from './fleet-tool';

export const FLEET_INVITE_PATH = `${FLEET_PATH}/invite`;
/** Asks again for an invite still on its way, this many times (each read
 *  waits up to 25 seconds at the CC). */
export const INVITE_FOLLOW_UPS = 4;
/** The box's own cap on an email. */
export const INVITE_EMAIL_MAX = 320;
/** How long an invite lives (the box's rule). */
export const INVITE_HOURS = 72;

/** One box's answer to an invite: the link once, or why not. */
export type FleetInvite = {
  callId: string;
  boxId: string;
  email: string;
  ok: boolean;
  reason?: string;
  link?: string;
  expiresAt?: string;
};

export type FleetInviteAnswers = { invites: FleetInvite[]; pending: string[]; gone: string[] };

export type FleetInviteAsk =
  | { do: 'invite'; boxId: string; email: string; password: string }
  | { do: 'answers'; callIds: string[] };

export type InviteSend = (body: FleetInviteAsk) => Promise<unknown>;
const defaultSend: InviteSend = (body) => apiSend(FLEET_INVITE_PATH, 'POST', body);

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The route's reply, held to its shape. */
export function parseInviteAnswers(raw: unknown): FleetInviteAnswers {
  const top = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const invites = (Array.isArray(top.invites) ? top.invites : []).filter(
    (a): a is FleetInvite =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as FleetInvite).callId === 'string' &&
      typeof (a as FleetInvite).boxId === 'string' &&
      typeof (a as FleetInvite).ok === 'boolean',
  );
  return { invites, pending: strings(top.pending), gone: strings(top.gone) };
}

/** One invite, then the follow-ups while it is still on its way. */
export async function sendInvite(
  boxId: string,
  email: string,
  password: string,
  send: InviteSend = defaultSend,
  followUps: number = INVITE_FOLLOW_UPS,
): Promise<FleetInviteAnswers> {
  const first = parseInviteAnswers(await send({ do: 'invite', boxId, email, password }));
  const invites = [...first.invites];
  const gone = [...first.gone];
  let pending = [...first.pending];
  for (let round = 0; pending.length > 0 && round < followUps; round++) {
    const r = parseInviteAnswers(await send({ do: 'answers', callIds: pending }));
    invites.push(...r.invites);
    gone.push(...r.gone);
    pending = r.pending;
  }
  return { invites, pending, gone };
}

// --- the words -------------------------------------------------------------------

/** A plain address, as the box's own invite screen takes one. */
const ADDRESS_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Why a typed email cannot be invited, or null. */
export function emailProblem(email: string): string | null {
  const e = email.trim();
  if (!e) return 'Enter an email address.';
  if (e.length > INVITE_EMAIL_MAX) return `An email is at most ${INVITE_EMAIL_MAX} characters.`;
  if (!ADDRESS_RE.test(e)) return 'Enter an email address like name@example.com.';
  return null;
}

/** Why a box did not make the invite. */
export function inviteReasonText(code: string | null | undefined): string {
  switch (code) {
    case 'email-has-login':
      return 'This email already has a login on that box.';
    case 'email-was-client':
      return 'This email was a client login on that box. The box does not invite it again.';
    case 'no-email':
      return 'The box did not take this email address.';
    case 'scope':
      return 'This box does not take user calls from the Control Center (MANTLE_CONTROL_CENTER_SCOPE=none).';
    case 'bad-call':
      return 'This box runs an older release. Update the box, then try again.';
    case 'key':
    case 'bad-reply':
      return 'The box answered, but the link could not be read. Make a new invite: it replaces this one.';
    case 'gone':
      return 'The answer was lost (the Control Center restarted, or another read took it). Make a new invite: it replaces any open one.';
    case 'pending':
      return 'The box did not answer in time. Look again later; a new invite replaces the old one.';
    default:
      return toolReasonText(code ?? null);
  }
}

/** What the person sees once the box made the invite. */
export const LINK_ONCE_TEXT = `Shown once; valid ${INVITE_HOURS} hours. Copy it now and send it to the person. They set their own password.`;

/** The note before an invite is sent. */
export const REPLACE_TEXT =
  'A new invite for the same email on the same box replaces the open one: the old link stops working.';

/** The mark on a box after an invite, until a people read finds the login. */
export const INVITED_TEXT = 'Invited, not joined yet';

/** A refusal at the Control Center itself (the route's 4xx), in words. */
export function inviteRefusalText(code: string | null | undefined, fallback: string): string {
  switch (code) {
    case 'banned':
      return 'A fleet ban names this email. Lift the ban first.';
    case 'password':
      return 'That password is not correct. Try again.';
    case 'busy':
      return 'Too many invites are waiting. Try again in a few minutes.';
    default:
      return fallback;
  }
}

// --- which boxes can take this person ---------------------------------------------

/** One linked box as the Add dialog offers it. */
export type InviteTarget = {
  boxId: string;
  label: string;
  available: boolean;
  /** Why it is not available. */
  why: string | null;
};

/**
 * Every linked box, for an invite of `email`: available when the box sent
 * a current people list, it holds no login with that email, and it did not
 * answer `bad-call` to an invite before (`older`). The others say why. A
 * box where the email is a login comes last.
 */
export function inviteTargets(
  email: string,
  boxes: readonly FleetPeopleBox[],
  older: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
): InviteTarget[] {
  const want = email.trim().toLowerCase();
  const out = boxes.map((b): InviteTarget => {
    const label = boxName(b);
    const has =
      (b.people?.logins ?? b.logins ?? []).some((l) => l.email.trim().toLowerCase() === want) &&
      want !== '';
    if (has) return { boxId: b.id, label, available: false, why: 'Has a login here.' };
    if (older.has(b.id.toLowerCase())) {
      return { boxId: b.id, label, available: false, why: inviteReasonText('bad-call') };
    }
    const why = peopleReasonText(b, now);
    if (why !== null) return { boxId: b.id, label, available: false, why };
    return { boxId: b.id, label, available: true, why: null };
  });
  const rank = (t: InviteTarget) => (t.available ? 0 : t.why === 'Has a login here.' ? 2 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** Whether `person` could be added to any box. */
export function canAddSomewhere(
  person: Pick<Person, 'email'>,
  boxes: readonly FleetPeopleBox[],
  older?: ReadonlySet<string>,
): boolean {
  return inviteTargets(person.email, boxes, older).some((t) => t.available);
}

// --- the marks left after an invite -------------------------------------------------

/** An invite this screen sent: the box, the email, and when it ends. Never
 *  the link. */
export type InviteMark = { boxId: string; email: string; at: string; expiresAt: string };

/** The marks with a new one in: one per box and email (a new invite
 *  replaces the old one). */
export function withMark(marks: readonly InviteMark[], mark: InviteMark): InviteMark[] {
  const key = (m: InviteMark) => `${m.boxId.toLowerCase()}|${m.email.toLowerCase()}`;
  return [...marks.filter((m) => key(m) !== key(mark)), mark];
}

/** The marks still open: not ended, and no people read of that box found a
 *  login with that email yet. */
export function openMarks(
  marks: readonly InviteMark[],
  boxes: readonly FleetPeopleBox[],
  now: number = Date.now(),
): InviteMark[] {
  const byId = new Map(boxes.map((b) => [b.id.toLowerCase(), b]));
  return marks.filter((m) => {
    if (Date.parse(m.expiresAt) <= now) return false;
    const b = byId.get(m.boxId.toLowerCase());
    const logins = b?.people?.logins ?? b?.logins ?? [];
    return !logins.some((l) => l.email.trim().toLowerCase() === m.email.toLowerCase());
  });
}

/** The line a mark shows: the box, and when the invite ends. */
export function markText(mark: InviteMark, boxes: readonly FleetPeopleBox[]): string {
  const b = boxes.find((x) => x.id.toLowerCase() === mark.boxId.toLowerCase());
  const ends = new Date(mark.expiresAt);
  return `${b ? boxName(b) : 'A box'}: ${INVITED_TEXT}. The link ends ${ends.toISOString().slice(0, 16).replace('T', ' ')} UTC.`;
}
