import { describe, expect, it } from 'vitest';
import type { FleetBan } from './fleet';
import {
  agoText,
  assignableWorkspaces,
  bulkPlan,
  cellChoices,
  boxLevel,
  cellStatus,
  copyPlan,
  describeChange,
  filterCounts,
  filterPeople,
  FLEET_PEOPLE_KEY,
  groupPeople,
  membershipGrid,
  memberAnswers,
  memberAnswerText,
  memberHistory,
  normName,
  wsLabel,
  parsePeople,
  peopleBoxes,
  peopleReasonText,
  sentSummary,
  skipText,
  staleNotes,
  toolCalls,
  withoutSent,
  withSending,
  type MemberAnswer,
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
  it('keeps its key under the Fleet key', () => {
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

  it('says where a cell change stands, from the calls themselves', () => {
    const change = { boxId: 'b', loginId: 'b1', workspaceId: 'b-proj', role: 'user' as const };
    expect(cellStatus([], [change], 'b', 'b1', 'b-proj')).toMatchObject({
      tone: 'wait',
      role: 'user',
      waiting: true,
    });
    expect(cellStatus([], [change], 'b', 'b1', 'b-ops')).toBeNull();
    const answers: MemberAnswer[] = [
      {
        boxId: 'b',
        loginId: 'b1',
        workspaceId: 'b-ops',
        role: 'none',
        outcome: 'refused',
        was: 'moderator',
        reason: 'last-moderator',
        done: '2026-11-12T11:30:00.000Z',
      },
    ];
    expect(cellStatus(answers, [], 'b', 'b1', 'b-ops')).toMatchObject({ tone: 'bad' });
    const hist = memberHistory(answers, [{ boxId: 'b', loginId: 'b1' }], boxes);
    expect(hist).toHaveLength(1);
    expect(hist[0]!.label).toBe('Remove ann@example.com from Ops on b.example.com');
    expect(memberHistory(answers, [{ boxId: 'a', loginId: 'a1' }], boxes)).toEqual([]);
  });

  it('words the workspace answers and the send', () => {
    const a = (
      role: 'user' | 'moderator' | 'none',
      outcome: MemberAnswer['outcome'],
      was: 'user' | 'moderator' | 'none' | null,
      reason: string | null,
    ): MemberAnswer => ({
      boxId: 'b',
      loginId: 'b1',
      workspaceId: 'b-ops',
      role,
      outcome,
      was,
      reason,
      done: recent,
    });
    expect(memberAnswerText(a('user', 'ok', 'none', null)).text).toBe('Added as a user.');
    expect(memberAnswerText(a('moderator', 'ok', 'user', null)).text).toBe('Now a Moderator.');
    expect(memberAnswerText(a('none', 'ok', 'user', null)).text).toBe('Removed.');
    expect(memberAnswerText(a('user', 'ok', 'user', null)).text).toBe(
      'No change: it was so already.',
    );
    for (const r of ['login', 'owner', 'workspace', 'admin', 'last-moderator', 'disabled', 'odd']) {
      const said = memberAnswerText(a('user', 'refused', null, r));
      expect(said.tone).toBe('bad');
      expect(said.text).toMatch(/Nothing was set\.$/);
      expect(boxLevel(a('user', 'refused', null, r))).toBe(false);
    }
    expect(memberAnswerText(a('user', 'not-run', null, 'scope')).text).toContain(
      'MANTLE_CONTROL_CENTER_SCOPE',
    );
    expect(memberAnswerText(a('user', 'not-run', null, 'tool')).text).toBe(
      'This box does not offer workspace_user_set to the Control Center yet (a box release, and the admin scope must include it). Nothing was set.',
    );
    expect(boxLevel(a('user', 'not-run', null, 'scope'))).toBe(true);
    // Unknown is never "Nothing was set".
    const unknown = memberAnswerText(a('user', 'unknown', null, 'pending'));
    expect(unknown.tone).toBe('warn');
    expect(unknown.text).toContain('Not confirmed: the box may still make this change.');
    expect(unknown.text).not.toContain('Nothing was set');
    expect(boxLevel(a('user', 'unknown', null, 'pending'))).toBe(false);
    expect(
      describeChange(
        { boxId: 'a', loginId: 'a2', workspaceId: 'a-proj', role: 'moderator' },
        boxes,
      ),
    ).toBe('bob@example.com in Projects as Moderator on Alpha');
    expect(sentSummary([a('user', 'ok', 'none', null), a('user', 'ok', 'none', null)])).toEqual({
      tone: 'ok',
      text: '2 changes made.',
    });
    expect(
      sentSummary([
        a('user', 'ok', 'none', null),
        a('user', 'refused', null, 'last-moderator'),
        a('user', 'not-run', null, 'busy'),
        a('user', 'unknown', null, 'timeout'),
      ]).text,
    ).toBe(
      '1 change made. 1 change refused by the box. 1 change not run: kept, to send again. 1 change not confirmed: the box may still make them.',
    );
    expect(peopleReasonText(boxOld)).toContain('release before Fleet users');
    expect(peopleReasonText(boxA)).toBeNull();
  });

  it('reads users_list answers, held to their shape (audit L5)', () => {
    const W = '11111111-1111-4111-8111-111111111111';
    const L1 = '22222222-2222-4222-8222-222222222222';
    const L2 = '33333333-3333-4333-8333-333333333333';
    const out = parsePeople({
      schema: 1,
      at: recent,
      workspaces: [
        { id: W, name: 'Ops', admin: false },
        { id: W, name: 'Ops again', admin: false },
        { id: 'not-a-uuid', name: 'x', admin: false },
        { id: '44444444-4444-4444-8444-444444444444', name: 'no flag' },
      ],
      logins: [
        {
          id: L1.toUpperCase(),
          email: 'Pat@Example.com',
          name: 'x'.repeat(500),
          role: 'member',
          owner: false,
          workspaces: [{ id: W }, { id: W, moderator: true }, { id: 'junk' }],
        },
        { id: L1, email: 'dup@example.com', owner: false },
        { id: L2, email: 'no-owner-flag@example.com' },
        { id: 'short', email: 'bad-id@example.com', owner: false },
      ],
    })!;
    expect(out.workspaces).toEqual([{ id: W, name: 'Ops', admin: false }]);
    expect(out.logins).toHaveLength(1);
    expect(out.logins[0]).toMatchObject({
      id: L1,
      email: 'pat@example.com',
      owner: false,
      workspaces: [{ id: W, moderator: false }],
    });
    expect(out.logins[0]!.name).toHaveLength(200);
    expect(parsePeople({ logins: [] })).toBeNull();
    expect(parsePeople('text')).toBeNull();
  });

  it("keeps a box's last good list when it did not answer (audit M2)", () => {
    const W = '11111111-1111-4111-8111-111111111111';
    const L1 = '22222222-2222-4222-8222-222222222222';
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const list = {
      schema: 1 as const,
      at: '2026-11-12T11:00:00.000Z',
      workspaces: [{ id: W, name: 'Ops', admin: false }],
      logins: [
        {
          id: L1,
          email: 'pat@example.com',
          name: null,
          role: 'member',
          owner: false,
          disabled: false,
          archived: false,
          lastSignInAt: null,
          createdAt: null,
          workspaces: [],
        },
      ],
    };
    const rows = [A, B].map((id) => ({
      id,
      url: `https://${id.slice(0, 4)}.example.invalid`,
      label: null,
      lastOkAt: null,
      lastReason: null,
    }));
    const read = peopleBoxes(
      rows,
      [
        { boxId: A, outcome: 'ok', output: list, reason: null },
        { boxId: B, outcome: 'not-run', output: undefined, reason: 'scope' },
      ],
      new Map([[B, list]]),
    );
    expect(read[0]).toMatchObject({ id: A, peopleReason: null });
    expect(read[0]!.people!.logins).toHaveLength(1);
    expect(read[1]).toMatchObject({ id: B, peopleReason: 'scope' });
    expect(read[1]!.people).toBe(list);
    expect(peopleReasonText(read[1]!, NOW)).toBe(
      'The last read failed (This box has not opened its admin tools to the Control Center (MANTLE_CONTROL_CENTER_SCOPE)). This list is from 1 hour ago.',
    );
    expect(staleNotes([{ boxId: B }, { boxId: A }], read, NOW)).toEqual([
      `bbbb.example.invalid: ${peopleReasonText(read[1]!, NOW)}`,
    ]);
    expect(
      peopleBoxes(rows, [{ boxId: A, outcome: 'ok', output: 'junk', reason: null }])[0],
    ).toMatchObject({ people: null, peopleReason: 'bad-reply' });
  });

  it('answers each change from its call (audit M1, L6)', () => {
    const changes = [
      { boxId: 'b', loginId: 'b1', workspaceId: 'b-proj', role: 'user' as const },
      { boxId: 'b', loginId: 'b1', workspaceId: 'b-ops', role: 'none' as const },
      { boxId: 'b', loginId: 'b2', workspaceId: 'b-ops', role: 'none' as const },
    ];
    const answered = memberAnswers(
      changes,
      {
        boxId: 'b',
        outcome: 'ok',
        reason: null,
        output: {
          results: [
            { loginId: 'b1', workspaceId: 'b-proj', ok: true, was: 'none' },
            // Any code: the call ran, so this is a refusal.
            { loginId: 'b1', workspaceId: 'b-ops', ok: false, reason: 'scope' },
          ],
        },
      },
      recent,
    );
    expect(answered.map((x) => [x.outcome, x.was, x.reason])).toEqual([
      ['ok', 'none', null],
      ['refused', null, 'scope'],
      ['unknown', null, 'bad-reply'],
    ]);
    // refused at the call level, without per-change rows: unknown (audit N1).
    const noRows = memberAnswers(changes, {
      boxId: 'b',
      outcome: 'unknown',
      output: undefined,
      reason: 'refused',
    });
    expect(noRows.every((x) => x.outcome === 'unknown')).toBe(true);
    expect(memberAnswerText(noRows[0]!).text).toBe(
      'The box refused the call. Not confirmed: the box may still make this change.',
    );
    const notRun = memberAnswers(changes, {
      boxId: 'b',
      outcome: 'not-run',
      output: undefined,
      reason: 'busy',
    });
    expect(notRun.every((x) => x.outcome === 'not-run' && boxLevel(x))).toBe(true);
    const pending = memberAnswers(changes, {
      boxId: 'b',
      outcome: 'unknown',
      output: undefined,
      reason: 'pending',
    });
    expect(pending.every((x) => x.outcome === 'unknown' && !boxLevel(x))).toBe(true);
    expect(memberAnswers(changes.slice(0, 1), undefined)[0]).toMatchObject({
      outcome: 'unknown',
      reason: 'pending',
    });
  });

  it('splits changes into calls: per box, at most 20 each', () => {
    const many = Array.from({ length: 45 }, (_, i) => ({
      boxId: i < 41 ? 'a' : 'b',
      loginId: `l${i}`,
      workspaceId: 'w',
      role: 'user' as const,
    }));
    expect(toolCalls(many).map((c) => [c.boxId, c.changes.length])).toEqual([
      ['a', 20],
      ['a', 20],
      ['a', 1],
      ['b', 4],
    ]);
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
    const said = memberAnswerText({
      boxId: 'b',
      loginId: 'b1',
      workspaceId: 'b-proj',
      role: 'user',
      outcome: 'refused',
      was: 'none',
      reason: 'disabled',
      done: recent,
    });
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

  it('keeps the changes in flight as a set (audit N2)', () => {
    const c1 = { boxId: 'a', loginId: 'a1', workspaceId: 'w1', role: 'user' as const };
    const c2 = { boxId: 'a', loginId: 'a1', workspaceId: 'w2', role: 'none' as const };
    const c3 = { boxId: 'b', loginId: 'b1', workspaceId: 'w1', role: 'moderator' as const };
    const one = withSending([], [c1, c2]);
    const two = withSending(one, [c3, c1]);
    expect(two).toEqual([c1, c2, c3]);
    // The first send ends: the second's change stays in flight.
    expect(withoutSent(two, [c1, c2])).toEqual([c3]);
  });

  it('names a login whose email is not unique on its box (audit N4)', () => {
    const twice: FleetPeopleBox = {
      ...boxB,
      people: {
        ...boxB.people!,
        logins: [...boxB.people!.logins, login({ id: 'b9-second', email: 'ann@example.com' })],
      },
    };
    expect(
      describeChange({ boxId: 'b', loginId: 'b1', workspaceId: 'b-ops', role: 'none' }, [twice]),
    ).toBe('Remove ann@example.com (login b1) from Ops on b.example.com');
    expect(
      describeChange({ boxId: 'b', loginId: 'b3', workspaceId: 'b-ops', role: 'user' }, [twice]),
    ).toBe('carol@example.com in Ops as User on b.example.com');
  });
});
