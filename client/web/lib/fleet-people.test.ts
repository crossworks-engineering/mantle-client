import { describe, expect, it } from 'vitest';
import type { FleetBan, FleetBox } from './fleet';
import { answerText, changeLabel, type FleetWriteAnswer } from './fleet-writes';
import {
  agoText,
  assignableWorkspaces,
  bulkPlan,
  cellChoices,
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
  normName,
  wsLabel,
  peopleReasonText,
  skipText,
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
    expect(proj.cells['a:a1']).toMatchObject({
      state: 'moderator',
      lock: null,
      workspaceId: 'a-proj',
    });
    expect(proj.cells['b:b1']).toMatchObject({
      state: 'none',
      workspaceId: 'b-proj',
      loginId: 'b1',
    });
    expect(proj.cells['c:c1']).toEqual({ kind: 'missing' });
    expect(g.rows.find((r) => r.name === 'Only on A')!.cells['b:b1']).toEqual({ kind: 'missing' });
    expect(g.rows[0]!.cells['a:a1']).toMatchObject({ lock: 'admin' });
    const owner = groupPeople(boxes).find((p) => p.email === 'owner@example.com')!;
    const og = membershipGrid(owner, boxes);
    expect(og.rows.find((r) => r.name === 'Ops')!.cells['a:a3']).toMatchObject({ lock: 'owner' });
  });

  it('plans a copy of workspaces from one box to another', () => {
    const ann = groupPeople(boxes).find((p) => p.email === 'ann@example.com')!;
    const plan = copyPlan(ann, 'a:a1', 'b:b1', boxes);
    expect(plan.changes).toEqual([
      { boxId: 'b', loginId: 'b1', workspaceId: 'b-proj', role: 'moderator' },
    ]);
    expect(plan.skipped).toEqual([
      { name: 'Admin', why: 'admin' },
      { name: 'Only on A', why: 'missing' },
    ]);
    // Ops is only on b: a copy never removes.
    expect(copyPlan(ann, 'b:b1', 'a:a1', boxes).changes).toEqual([
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

  it('never merges or copies a name two workspaces share on one box (audit M1)', () => {
    const dupA: FleetPeopleBox = {
      ...boxA,
      people: {
        ...boxA.people!,
        workspaces: [...boxA.people!.workspaces, { id: 'a-ops2', name: '  OPS ', admin: false }],
        logins: boxA.people!.logins.map((l) =>
          l.id === 'a1'
            ? { ...l, workspaces: [...l.workspaces, { id: 'a-ops2', moderator: false }] }
            : l,
        ),
      },
    };
    const set = [dupA, boxB];
    expect(normName('  OPS ')).toBe(normName('Ops'));
    const ann = groupPeople(set).find((p) => p.email === 'ann@example.com')!;
    const g = membershipGrid(ann, set);
    // Box A's two Ops each have a row of their own; the shared Ops row says so for A.
    const own = g.rows.filter((r) => r.ambiguous);
    expect(own.map((r) => r.cells['a:a1'])).toEqual([
      expect.objectContaining({ workspaceId: expect.stringMatching(/^a-ops/) }),
      expect.objectContaining({ workspaceId: expect.stringMatching(/^a-ops/) }),
    ]);
    const shared = g.rows.find((r) => !r.ambiguous && normName(r.name) === 'ops')!;
    expect(shared.cells['a:a1']).toEqual({ kind: 'ambiguous', count: 2 });
    expect(shared.cells['b:b1']).toMatchObject({ workspaceId: 'b-ops', state: 'user' });
    // A to B: the duplicated name is skipped, never sent.
    const ab = copyPlan(ann, 'a:a1', 'b:b1', set);
    expect(ab.changes.map((c) => c.workspaceId)).toEqual(['b-proj']);
    const skip = ab.skipped.find((x) => x.why === 'ambiguous')!;
    expect(skip).toMatchObject({ box: 'Alpha', count: 2 });
    expect(skipText(skip)).toContain('2 workspaces are named');
    // B to A: B's Ops would land on one of two on A: skipped too.
    const ba = copyPlan(ann, 'b:b1', 'a:a1', set);
    expect(ba.changes).toEqual([]);
    expect(ba.skipped).toEqual([{ name: 'Ops', why: 'ambiguous', box: 'Alpha', count: 2 }]);
  });

  it('keeps two logins of one box apart (audit L1)', () => {
    const twice: FleetPeopleBox = {
      ...boxB,
      people: {
        ...boxB.people!,
        logins: [
          ...boxB.people!.logins,
          // Emails arrive lowercase: the second login has the same one.
          login({
            id: 'b9',
            email: 'ann@example.com',
            createdAt: '2026-10-01T00:00:00.000Z',
            workspaces: [{ id: 'b-proj', moderator: true }],
          }),
        ],
      },
    };
    const set = [boxA, twice];
    const ann = groupPeople(set).find((p) => p.email === 'ann@example.com')!;
    const g = membershipGrid(ann, set);
    expect(g.columns.map((c) => c.key)).toEqual(['a:a1', 'b:b1', 'b:b9']);
    expect(g.columns.filter((c) => c.boxId === 'b').map((c) => c.label)).toEqual([
      'b.example.com (login b1, made 2026-09-01)',
      'b.example.com (login b9, made 2026-10-01)',
    ]);
    const proj = g.rows.find((r) => normName(r.name) === 'projects')!;
    expect(proj.cells['b:b1']).toMatchObject({ loginId: 'b1', state: 'none' });
    expect(proj.cells['b:b9']).toMatchObject({ loginId: 'b9', state: 'moderator' });
    const plan = bulkPlan([ann], 'b', 'b-proj', 'user', set);
    expect(plan.changes).toEqual([
      { boxId: 'b', loginId: 'b1', workspaceId: 'b-proj', role: 'user' },
      { boxId: 'b', loginId: 'b9', workspaceId: 'b-proj', role: 'user' },
    ]);
  });

  it('gives a disabled login no workspace, but lets it be taken out (audit L2)', () => {
    const off: FleetPeopleBox = {
      ...boxB,
      people: {
        ...boxB.people!,
        logins: boxB.people!.logins.map((l) => (l.id === 'b1' ? { ...l, disabled: true } : l)),
      },
    };
    const set = [boxA, off];
    const ann = groupPeople(set).find((p) => p.email === 'ann@example.com')!;
    const g = membershipGrid(ann, set);
    const proj = g.rows.find((r) => normName(r.name) === 'projects')!;
    expect(proj.cells['b:b1']).toMatchObject({ state: 'none', lock: 'disabled' });
    const ops = g.rows.find((r) => normName(r.name) === 'ops')!.cells['b:b1'];
    expect(ops).toMatchObject({ state: 'user', lock: null, removeOnly: true });
    expect(cellChoices(ops as never)).toEqual(['user', 'none']);
    expect(copyPlan(ann, 'a:a1', 'b:b1', set).skipped).toContainEqual({
      name: 'Projects',
      why: 'disabled',
    });
    expect(bulkPlan([ann], 'b', 'b-proj', 'user', set).skipped).toEqual([
      { email: 'ann@example.com', why: 'disabled' },
    ]);
    expect(bulkPlan([ann], 'b', 'b-ops', 'none', set).changes).toEqual([
      { boxId: 'b', loginId: 'b1', workspaceId: 'b-ops', role: 'none' },
    ]);
    const said = answerText({
      kind: 'workspaceMember',
      loginId: 'b1',
      workspaceId: 'b-proj',
      role: 'user',
      by: 'it@example.com',
      at: recent,
      done: recent,
      ok: false,
      was: 'none',
      reason: 'disabled',
    } as FleetWriteAnswer);
    expect(said.text).toContain(
      'This login is disabled on that box. Lift the ban or enable it first.',
    );
  });

  it('marks a name two workspaces share wherever it is chosen (audit 2, item 1)', () => {
    const two: FleetPeopleBox = {
      ...boxA,
      people: {
        ...boxA.people!,
        workspaces: [...boxA.people!.workspaces, { id: 'a-opz9', name: 'ops', admin: false }],
        logins: boxA.people!.logins.map((l) =>
          l.id === 'a2' ? { ...l, workspaces: [{ id: 'a-opz9', moderator: false }] } : l,
        ),
      },
    };
    const w1 = two.people!.workspaces.find((w) => w.id === 'a-ops')!;
    const w2 = two.people!.workspaces.find((w) => w.id === 'a-opz9')!;
    expect(wsLabel(two.people, w1)).toBe('Ops (0 people, id a-ops)');
    expect(wsLabel(two.people, w2)).toBe('ops (1 person, id a-opz)');
    expect(
      wsLabel(
        two.people,
        two.people!.workspaces.find((w) => w.id === 'a-proj')!,
      ),
    ).toBe('Projects');
    const labels = assignableWorkspaces(two).map((w) => w.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain('Ops (0 people, id a-ops)');
    expect(
      describeChange({ boxId: 'a', loginId: 'a2', workspaceId: 'a-opz9', role: 'user' }, [two]),
    ).toBe('bob@example.com in ops (1 person, id a-opz) as User on Alpha');
    const bob = groupPeople([two]).find((p) => p.email === 'bob@example.com')!;
    const own = membershipGrid(bob, [two]).rows.filter((r) => r.ambiguous);
    expect(own.map((r) => r.label).sort()).toEqual([
      'Ops (0 people, id a-ops)',
      'ops (1 person, id a-opz)',
    ]);
  });

  it('says when a kept list is old (audit 2, item 4)', () => {
    const now = Date.parse('2026-11-12T12:00:00.000Z');
    const kept = { ...boxA, peopleReason: 'unreachable' };
    expect(peopleReasonText(kept, now)).toBe(
      'The last read failed (This box cannot reach the box over HTTPS). This list is from 1 hour ago.',
    );
    expect(agoText('2026-11-12T11:59:30.000Z', now)).toBe('just now');
    expect(agoText('2026-11-09T12:00:00.000Z', now)).toBe('3 days ago');
  });
});
