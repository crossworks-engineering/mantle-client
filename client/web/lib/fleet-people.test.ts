import { describe, expect, it } from 'vitest';
import type { FleetBan, FleetBox } from './fleet';
import { answerText, changeLabel, type FleetWriteAnswer } from './fleet-writes';
import {
  bulkPlan,
  cellStatus,
  copyPlan,
  describeChange,
  filterCounts,
  filterPeople,
  FLEET_MEMBERS_PATH,
  FLEET_PEOPLE_KEY,
  FLEET_PEOPLE_PATH,
  groupPeople,
  membersSentText,
  membershipGrid,
  memberHistory,
  peopleReasonText,
  type FleetPeopleBox,
  type FleetPeopleLogin,
} from './fleet-people';

const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const recent = '2026-11-10T08:00:00.000Z';
const old = '2026-09-01T08:00:00.000Z';

const login = (p: Partial<FleetPeopleLogin> & { id: string; email: string }): FleetPeopleLogin => ({
  name: null,
  role: 'member',
  owner: false,
  disabled: false,
  archived: false,
  lastSignInAt: recent,
  createdAt: old,
  workspaces: [],
  ...p,
});

const boxA: FleetPeopleBox = {
  id: 'a',
  url: 'https://a.example.com',
  label: 'Alpha',
  lastOkAt: recent,
  lastReason: null,
  peopleReason: null,
  logins: null,
  people: {
    schema: 1,
    at: '2026-11-12T11:00:00.000Z',
    workspaces: [
      { id: 'a-admin', name: 'Admin', admin: true },
      { id: 'a-proj', name: 'Projects', admin: false },
      { id: 'a-ops', name: 'Ops', admin: false },
      { id: 'a-only', name: 'Only on A', admin: false },
    ],
    logins: [
      login({
        id: 'a1',
        email: 'Ann@Example.com',
        name: 'Ann',
        role: 'admin',
        workspaces: [
          { id: 'a-admin', moderator: true },
          { id: 'a-proj', moderator: true },
          { id: 'a-only', moderator: false },
        ],
      }),
      login({ id: 'a2', email: 'bob@example.com', lastSignInAt: old }),
      login({ id: 'a3', email: 'owner@example.com', owner: true, role: 'admin' }),
    ],
  },
};

const boxB: FleetPeopleBox = {
  id: 'b',
  url: 'https://b.example.com',
  label: null,
  lastOkAt: recent,
  lastReason: null,
  peopleReason: null,
  logins: null,
  people: {
    schema: 1,
    at: '2026-11-12T11:00:00.000Z',
    workspaces: [
      { id: 'b-admin', name: 'Admin', admin: true },
      { id: 'b-proj', name: 'projects', admin: false },
      { id: 'b-ops', name: 'Ops', admin: false },
    ],
    logins: [
      login({
        id: 'b1',
        email: 'ann@example.com',
        workspaces: [{ id: 'b-ops', moderator: false }],
      }),
      login({ id: 'b3', email: 'carol@example.com', disabled: true, lastSignInAt: null }),
    ],
  },
};

const boxOld: FleetPeopleBox = {
  id: 'c',
  url: 'https://c.example.com',
  label: 'Old',
  lastOkAt: recent,
  lastReason: null,
  people: null,
  peopleReason: 'bad-call',
  logins: [
    {
      id: 'c1',
      email: 'ann@example.com',
      owner: false,
      disabled: false,
      archived: false,
      marked: false,
    },
    {
      id: 'c2',
      email: 'dan@example.com',
      owner: false,
      disabled: false,
      archived: false,
      marked: false,
    },
  ],
};

const boxes = [boxA, boxB, boxOld];
const ban = (emails: string[], lifted = false): FleetBan => ({
  id: emails.join(),
  kind: 'disable',
  emails,
  issuer: null,
  oid: null,
  reason: null,
  madeBy: 'it@example.com',
  madeAt: recent,
  liftedBy: lifted ? 'it@example.com' : null,
  liftedAt: lifted ? recent : null,
  boxesMatched: 1,
  loginsMatched: 1,
  ownerIds: [],
});

describe('fleet people', () => {
  it('names its routes and keeps its key under the Fleet key', () => {
    expect(FLEET_PEOPLE_PATH).toBe('/api/fleet/people');
    expect(FLEET_MEMBERS_PATH).toBe('/api/fleet/members');
    expect(FLEET_PEOPLE_KEY[0]).toBe('fleet');
  });

  it('groups one person across boxes by email, without case', () => {
    const people = groupPeople(boxes, [ban(['bob@example.com']), ban(['ann@example.com'], true)]);
    const ann = people.find((p) => p.email === 'ann@example.com')!;
    expect(ann.logins.map((l) => l.boxId).sort()).toEqual(['a', 'b', 'c']);
    expect(ann.name).toBe('Ann');
    expect(ann.admin).toBe(true);
    expect(ann.full).toBe(false);
    expect(ann.bans).toHaveLength(0);
    expect(ann.memberships).toBe(4);
    const a = ann.logins.find((l) => l.boxId === 'a')!;
    expect(a.workspaces.map((w) => w.name)).toEqual(['Admin', 'Only on A', 'Projects']);
    const bob = people.find((p) => p.email === 'bob@example.com')!;
    expect(bob.bans).toHaveLength(1);
    expect(people.find((p) => p.email === 'carol@example.com')!.disabled).toBe(true);
  });

  it('filters and counts', () => {
    const people = groupPeople(boxes, [ban(['bob@example.com'])]);
    const ids = (f: Parameters<typeof filterPeople>[1], q = '') =>
      filterPeople(people, f, q, NOW).map((p) => p.email);
    expect(ids('banned')).toEqual(['bob@example.com']);
    expect(ids('admins')).toEqual(['ann@example.com', 'owner@example.com']);
    expect(ids('noWorkspace')).toEqual([
      'bob@example.com',
      'carol@example.com',
      'owner@example.com',
    ]);
    expect(ids('stale')).toEqual(['bob@example.com', 'carol@example.com']);
    expect(ids('oneBox')).toEqual([
      'bob@example.com',
      'carol@example.com',
      'dan@example.com',
      'owner@example.com',
    ]);
    expect(ids('disabled')).toEqual(['carol@example.com']);
    expect(ids('all', 'ann')).toEqual(['ann@example.com']);
    expect(ids('all', 'alpha bob')).toEqual(['bob@example.com']);
    const n = filterCounts(people, '', NOW);
    expect(n.all).toBe(5);
    expect(n.banned).toBe(1);
  });

  it('builds the membership grid box by box', () => {
    const ann = groupPeople(boxes).find((p) => p.email === 'ann@example.com')!;
    const g = membershipGrid(ann, boxes);
    expect(g.columns.map((c) => [c.boxId, c.full])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
    ]);
    expect(g.rows.map((r) => r.name)).toEqual(['Admin', 'Only on A', 'Ops', 'Projects']);
    const proj = g.rows.find((r) => r.name === 'Projects')!;
    expect(proj.cells.a).toMatchObject({ state: 'moderator', lock: null, workspaceId: 'a-proj' });
    expect(proj.cells.b).toMatchObject({ state: 'none', workspaceId: 'b-proj', loginId: 'b1' });
    expect(proj.cells.c).toEqual({ kind: 'missing' });
    expect(g.rows.find((r) => r.name === 'Only on A')!.cells.b).toEqual({ kind: 'missing' });
    expect(g.rows[0]!.cells.a).toMatchObject({ lock: 'admin' });
    const owner = groupPeople(boxes).find((p) => p.email === 'owner@example.com')!;
    const og = membershipGrid(owner, boxes);
    expect(og.rows.find((r) => r.name === 'Ops')!.cells.a).toMatchObject({ lock: 'owner' });
  });

  it('plans a copy of workspaces from one box to another', () => {
    const ann = groupPeople(boxes).find((p) => p.email === 'ann@example.com')!;
    const plan = copyPlan(ann, 'a', 'b', boxes);
    expect(plan.changes).toEqual([
      { boxId: 'b', loginId: 'b1', workspaceId: 'b-proj', role: 'moderator' },
    ]);
    expect(plan.skipped).toEqual([
      { name: 'Admin', why: 'admin' },
      { name: 'Only on A', why: 'missing' },
    ]);
    // Ops is only on b: a copy never removes.
    expect(copyPlan(ann, 'b', 'a', boxes).changes).toEqual([
      { boxId: 'a', loginId: 'a1', workspaceId: 'a-ops', role: 'user' },
    ]);
  });

  it('plans a bulk change and skips what it cannot do', () => {
    const people = groupPeople(boxes);
    const pick = people.filter((p) =>
      ['ann@example.com', 'bob@example.com', 'carol@example.com', 'owner@example.com'].includes(
        p.email,
      ),
    );
    const plan = bulkPlan(pick, 'a', 'a-proj', 'moderator', boxes);
    expect(plan.changes).toEqual([
      { boxId: 'a', loginId: 'a2', workspaceId: 'a-proj', role: 'moderator' },
    ]);
    expect(plan.skipped.map((s) => s.why).sort()).toEqual(['not-on-box', 'owner', 'same']);
    const dan = people.filter((p) => p.email === 'dan@example.com');
    expect(bulkPlan(dan, 'c', 'x', 'user', boxes).skipped[0]!.why).toBe('old');
  });

  it('says where a cell change stands', () => {
    const job = {
      writeJob: {
        changes: [
          {
            kind: 'workspaceMember' as const,
            loginId: 'b1',
            workspaceId: 'b-proj',
            role: 'user' as const,
            by: 'it@example.com',
            at: recent,
          },
        ],
      },
      writeResult: null,
    } as unknown as FleetBox;
    expect(cellStatus(job, 'b1', 'b-proj')).toMatchObject({ tone: 'wait', role: 'user' });
    expect(cellStatus(job, 'b1', 'b-ops')).toBeNull();
    const answered = {
      writeJob: null,
      writeResult: {
        results: [
          {
            kind: 'workspaceMember',
            loginId: 'b1',
            workspaceId: 'b-ops',
            role: 'none',
            by: 'it@example.com',
            at: recent,
            ok: false,
            was: 'moderator',
            reason: 'last-moderator',
            done: '2026-11-12T11:30:00.000Z',
          },
        ],
      },
    } as unknown as FleetBox;
    expect(cellStatus(answered, 'b1', 'b-ops', '2026-11-12T11:00:00.000Z')).toMatchObject({
      tone: 'bad',
    });
    const hist = memberHistory(
      [{ ...answered, id: 'b' } as FleetBox],
      [{ boxId: 'b', loginId: 'b1' }],
      boxes,
    );
    expect(hist).toHaveLength(1);
    expect(hist[0]!.label).toBe('Remove ann@example.com from Ops on b.example.com');
  });

  it('words the workspace answers and the send', () => {
    const base = {
      kind: 'workspaceMember' as const,
      loginId: 'b1',
      workspaceId: 'b-ops',
      by: 'it@example.com',
      at: recent,
      done: recent,
    };
    const a = (
      role: 'user' | 'moderator' | 'none',
      ok: boolean,
      was: string | null,
      reason: string | null,
    ) => ({ ...base, role, ok, was, reason }) as FleetWriteAnswer;
    expect(answerText(a('user', true, 'none', null)).text).toBe('Added as a user.');
    expect(answerText(a('moderator', true, 'user', null)).text).toBe('Now a Moderator.');
    expect(answerText(a('none', true, 'user', null)).text).toBe('Removed.');
    expect(answerText(a('user', true, 'user', null)).text).toBe('No change: it was so already.');
    for (const r of ['login', 'owner', 'workspace', 'admin', 'last-moderator']) {
      const said = answerText(a('user', false, null, r));
      expect(said.tone).toBe('bad');
      expect(said.text).not.toBe('The last run failed. Nothing was set.');
    }
    expect(changeLabel(a('none', true, null, null))).toBe('Removed from a workspace');
    expect(
      describeChange(
        { boxId: 'a', loginId: 'a2', workspaceId: 'a-proj', role: 'moderator' },
        boxes,
      ),
    ).toBe('bob@example.com in Projects as Moderator on Alpha');
    const ch = [
      { boxId: 'a', loginId: 'a2', workspaceId: 'a-proj', role: 'user' as const },
      { boxId: 'b', loginId: 'b1', workspaceId: 'b-ops', role: 'none' as const },
    ];
    expect(membersSentText(ch, ['a', 'b'])).toBe(
      'Sent 2 changes. Each box makes it at its next run.',
    );
    expect(membersSentText(ch, ['a'])).toContain('1 change not queued');
    expect(peopleReasonText(boxOld)).toContain('release before Fleet users');
    expect(peopleReasonText(boxA)).toBeNull();
  });
});
