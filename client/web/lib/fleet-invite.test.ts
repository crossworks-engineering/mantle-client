import { describe, expect, it } from 'vitest';
import {
  canAddSomewhere,
  emailProblem,
  INVITED_TEXT,
  inviteReasonText,
  inviteRefusalText,
  inviteTargets,
  LINK_ONCE_TEXT,
  markText,
  openMarks,
  parseInviteAnswers,
  REPLACE_TEXT,
  sendInvite,
  withMark,
  type FleetInviteAsk,
  type InviteMark,
} from './fleet-invite';
import type { FleetPeopleBox, FleetPeopleLogin } from './fleet-people';

const NOW = Date.parse('2026-11-13T10:00:00.000Z');
const login = (email: string): FleetPeopleLogin => ({
  id: `${email}-id`,
  email,
  name: null,
  role: 'member',
  owner: false,
  disabled: false,
  archived: false,
  lastSignInAt: null,
  createdAt: null,
  workspaces: [],
});
const box = (id: string, label: string, emails: string[], over: Partial<FleetPeopleBox> = {}) =>
  ({
    id,
    url: `https://${label.toLowerCase()}.example.invalid`,
    label,
    lastOkAt: null,
    lastReason: null,
    people: {
      schema: 1,
      at: '2026-11-13T09:59:00.000Z',
      workspaces: [],
      logins: emails.map(login),
    },
    peopleReason: null,
    logins: null,
    ...over,
  }) as FleetPeopleBox;

const A = box('a', 'Alpha', ['sam.lee@example.com']);
const B = box('b', 'Bravo', []);
const C = box('c', 'Charlie', [], { people: null, peopleReason: 'unreachable' });
const D = box('d', 'Delta', []);

describe('the words', () => {
  it('names each box reason in plain words', () => {
    expect(inviteReasonText('email-has-login')).toBe('This email already has a login on that box.');
    expect(inviteReasonText('email-was-client')).toMatch(/client login/);
    expect(inviteReasonText('scope')).toMatch(/MANTLE_CONTROL_CENTER_SCOPE=none/);
    expect(inviteReasonText('bad-call')).toBe(
      'This box runs an older release. Update the box, then try again.',
    );
    expect(inviteReasonText('gone')).toMatch(/replaces/);
    expect(inviteReasonText('pending')).toMatch(/did not answer in time/);
    // A transport code reads as the admin channel's words.
    expect(inviteReasonText('busy')).toMatch(/busy/);
  });

  it('names the refusals of the Control Center itself', () => {
    expect(inviteRefusalText('banned', 'x')).toBe(
      'A fleet ban names this email. Lift the ban first.',
    );
    expect(inviteRefusalText('password', 'x')).toMatch(/password is not correct/);
    expect(inviteRefusalText(undefined, 'fallback')).toBe('fallback');
  });

  it('says the link is shown once, for 72 hours, and that a new invite replaces the old', () => {
    expect(LINK_ONCE_TEXT).toMatch(/^Shown once; valid 72 hours\./);
    expect(REPLACE_TEXT).toMatch(/replaces the open one/);
    expect(INVITED_TEXT).toBe('Invited, not joined yet');
  });

  it('checks an email as the box does', () => {
    expect(emailProblem('')).toBe('Enter an email address.');
    expect(emailProblem('  ')).toBe('Enter an email address.');
    expect(emailProblem('no-at-sign')).toMatch(/like name@example\.com/);
    expect(emailProblem('a@b')).toMatch(/like name@example\.com/);
    expect(emailProblem('a b@example.com')).toMatch(/like/);
    expect(emailProblem(`${'x'.repeat(320)}@example.com`)).toMatch(/at most 320/);
    expect(emailProblem(' Sam.Lee@Example.com ')).toBeNull();
  });
});

describe('which boxes can take this person', () => {
  it('a box with a login for the email, an old list or an older release is not available, with why', () => {
    const t = inviteTargets('SAM.LEE@example.com', [A, B, C, D], new Set(['d']), NOW);
    expect(t.map((x) => [x.label, x.available])).toEqual([
      ['Bravo', true],
      ['Charlie', false],
      ['Delta', false],
      ['Alpha', false],
    ]);
    expect(t.find((x) => x.label === 'Alpha')!.why).toBe('Has a login here.');
    expect(t.find((x) => x.label === 'Delta')!.why).toMatch(/older release/);
    expect(t.find((x) => x.label === 'Charlie')!.why).toBeTruthy();
  });

  it('a person on 8 boxes can be added to the ninth only', () => {
    const boxes = Array.from({ length: 9 }, (_, i) =>
      box(`b${i}`, `Box ${i + 1}`, i < 8 ? ['sam.lee@example.com'] : []),
    );
    const t = inviteTargets('sam.lee@example.com', boxes);
    expect(t.filter((x) => x.available).map((x) => x.label)).toEqual(['Box 9']);
    expect(canAddSomewhere({ email: 'sam.lee@example.com' }, boxes)).toBe(true);
    expect(canAddSomewhere({ email: 'sam.lee@example.com' }, boxes.slice(0, 8))).toBe(false);
  });

  it('a box a release behind (ban list only) still counts its logins', () => {
    const old = box('o', 'Old', [], {
      people: null,
      peopleReason: 'tool',
      logins: [
        {
          id: '1',
          email: 'sam.lee@example.com',
          owner: false,
          disabled: false,
          archived: false,
          marked: false,
        },
      ],
    });
    expect(inviteTargets('sam.lee@example.com', [old])[0]!.why).toBe('Has a login here.');
  });
});

describe('the marks left after an invite', () => {
  const mark = (
    boxId: string,
    email: string,
    expiresAt = '2026-11-16T10:00:00.000Z',
  ): InviteMark => ({
    boxId,
    email,
    at: '2026-11-13T10:00:00.000Z',
    expiresAt,
  });

  it('a new invite for the same box and email replaces the mark', () => {
    const one = withMark([], mark('b', 'new@example.com', '2026-11-16T09:00:00.000Z'));
    const two = withMark(one, mark('B', 'NEW@example.com'));
    expect(two).toHaveLength(1);
    expect(two[0]!.expiresAt).toBe('2026-11-16T10:00:00.000Z');
    expect(withMark(two, mark('a', 'new@example.com'))).toHaveLength(2);
  });

  it('a mark ends when a people read finds the login, or when the invite ends', () => {
    const marks = [
      mark('b', 'new@example.com'),
      mark('a', 'sam.lee@example.com'),
      mark('b', 'old@example.com', '2026-11-13T09:00:00.000Z'),
    ];
    expect(openMarks(marks, [A, B], NOW).map((m) => m.email)).toEqual(['new@example.com']);
  });

  it('a mark says the box and when the link ends, never a link', () => {
    const text = markText(mark('b', 'new@example.com'), [A, B]);
    expect(text).toBe('Bravo: Invited, not joined yet. The link ends 2026-11-16 10:00 UTC.');
    expect(text).not.toMatch(/#code=/);
  });
});

describe('the ask', () => {
  it('sends the invite, then asks for the answers still on their way', async () => {
    const sent: FleetInviteAsk[] = [];
    const replies: unknown[] = [
      { invites: [], pending: ['c1'], gone: [] },
      { invites: [], pending: ['c1'], gone: [] },
      {
        invites: [
          {
            callId: 'c1',
            boxId: 'b',
            email: 'new@example.com',
            ok: true,
            link: 'https://bravo.example.invalid/invite#code=x',
            expiresAt: 'z',
          },
        ],
        pending: [],
        gone: [],
      },
    ];
    const r = await sendInvite('b', 'new@example.com', 'pw', async (body) => {
      sent.push(body);
      return replies.shift();
    });
    expect(sent[0]).toEqual({ do: 'invite', boxId: 'b', email: 'new@example.com', password: 'pw' });
    expect(sent.slice(1)).toEqual([
      { do: 'answers', callIds: ['c1'] },
      { do: 'answers', callIds: ['c1'] },
    ]);
    expect(r.invites).toHaveLength(1);
    expect(r.pending).toEqual([]);
  });

  it('holds the reply to its shape', () => {
    expect(parseInviteAnswers(null)).toEqual({ invites: [], pending: [], gone: [] });
    expect(
      parseInviteAnswers({
        invites: [{ callId: 'x' }, { callId: 'y', boxId: 'b', ok: false }],
        pending: [1, 'p'],
      }),
    ).toEqual({ invites: [{ callId: 'y', boxId: 'b', ok: false }], pending: ['p'], gone: [] });
  });
});
