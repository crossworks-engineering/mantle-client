/**
 * POST /api/fleet/invite on the in-memory brain (mantle
 * docs/control-center.md, "Add a person from the CC"): the box makes a
 * member invite and the Control Center hands its link back once. The state
 * hangs off the fleet object, so mock-fleet.ts keeps its own shape.
 */
import { SSO_PASSWORD, type MockFleet } from './mock-fleet';

export type InviteState = {
  /** What a box answers instead of an invite, by box id (e.g. scope,
   *  email-has-login, bad-call). */
  refusals: Record<string, string>;
  /** Emails a fleet ban names: the CC refuses them (409 banned). */
  banned: string[];
  /** Every body sent, the password left out. */
  sent: Record<string, unknown>[];
  /** The links handed out, each once. */
  links: string[];
};

const states = new WeakMap<MockFleet, InviteState>();

/** The invite state of `f` (made on first use). */
export function inviteState(f: MockFleet): InviteState {
  let s = states.get(f);
  if (!s) {
    s = { refusals: {}, banned: [], sent: [], links: [] };
    states.set(f, s);
  }
  return s;
}

let n = 0;
/** A made-up code of the box's alphabet. */
const code = () => {
  n += 1;
  return `Kvw${String(n).padStart(4, '2')}abcdefghj`.slice(0, 16);
};

export function inviteAnswer(
  f: MockFleet,
  body: Record<string, unknown>,
): { status: number; body: unknown } {
  if (!f.toolOn) return { status: 404, body: { error: 'not found' } };
  const s = inviteState(f);
  const { password, ...rest } = body;
  s.sent.push(rest);
  if (body.do === 'answers') {
    return { status: 200, body: { invites: [], pending: [], gone: body.callIds ?? [] } };
  }
  if (password !== SSO_PASSWORD) {
    return { status: 403, body: { code: 'password', error: 'That password is not correct.' } };
  }
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  if (s.banned.includes(email)) {
    return {
      status: 409,
      body: { code: 'banned', error: 'A fleet ban names that email. Lift the ban first.' },
    };
  }
  const box = f.boxes.find((b) => b.id === body.boxId);
  if (!box) return { status: 400, body: { error: 'No linked box has that id.' } };
  const callId = `c1c1c1c1-0000-4000-8000-${String(s.sent.length).padStart(12, '0')}`;
  const refused = s.refusals[box.id];
  if (refused) {
    return {
      status: 200,
      body: {
        invites: [{ callId, boxId: box.id, email, ok: false, reason: refused }],
        pending: [],
        gone: [],
      },
    };
  }
  const link = `${new URL(box.url).origin}/invite#code=${code()}`;
  s.links.push(link);
  const expiresAt = new Date(Date.now() + 72 * 3600_000).toISOString();
  return {
    status: 200,
    body: {
      invites: [{ callId, boxId: box.id, email, ok: true, link, expiresAt }],
      pending: [],
      gone: [],
    },
  };
}
