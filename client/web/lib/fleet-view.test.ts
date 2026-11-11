import { describe, expect, it } from 'vitest';
import type { FleetBox, FleetOverview } from './fleet';
import type { FleetMatrixRow } from './fleet-matrix';
import {
  boxesText,
  ccHref,
  changeCounts,
  changeRows,
  fleetIssues,
  lastOfKind,
  linkState,
} from './fleet-view';

const AT = '2026-11-11T10:00:00.000Z';
const NOW = Date.parse(AT) + 5_000;

const box = (over: Partial<FleetBox> = {}): FleetBox => ({
  id: 'a',
  url: 'https://box-a.example.invalid',
  label: 'Box A',
  addedBy: 'ada@example.invalid',
  createdAt: AT,
  lastRunAt: AT,
  lastOkAt: AT,
  lastReason: null,
  loginCount: 4,
  ...over,
});

const overview = (over: Partial<FleetOverview> = {}): FleetOverview => ({
  service: { publicKey: 'k', fingerprint: 'f', lastTickAt: AT },
  envLines: null,
  boxes: [box()],
  bans: [],
  results: [],
  ...over,
});

const stamp = { by: 'ada@example.invalid', at: AT };

describe('linkState', () => {
  it('says linked, waiting or not linked', () => {
    expect(linkState(box()).label).toBe('Linked');
    expect(linkState(box({ lastOkAt: null })).label).toBe('Waiting');
    expect(linkState(box({ lastReason: 'sig' }))).toEqual({ tone: 'bad', label: 'Not linked' });
  });
});

describe('fleetIssues', () => {
  it('is empty when all is good', () => {
    expect(fleetIssues(overview(), [], NOW)).toEqual([]);
  });

  it('names a stopped control service and a box that does not answer, problems first', () => {
    const data = overview({
      service: { publicKey: 'k', fingerprint: 'f', lastTickAt: null },
      boxes: [
        box({
          writeResult: {
            results: [
              {
                kind: 'updateNotice',
                on: true,
                ...stamp,
                ok: false,
                was: null,
                reason: 'refused',
                done: AT,
              },
            ],
          },
        }),
        box({ id: 'b', label: 'Box B', lastReason: 'sig', lastOkAt: null }),
      ],
    });
    const issues = fleetIssues(data, [], NOW);
    expect(issues.map((i) => i.id)).toEqual(['service-stopped', 'link-b', 'writes-a']);
    expect(issues.map((i) => i.tone)).toEqual(['bad', 'bad', 'warn']);
    expect(issues[1]!.href).toBe('/admin/fleet/boxes?box=b');
    expect(issues[2]!.title).toBe('Box A refused 1 change');
  });

  it('reads the matrix: a failed backup, and old facts on a box that still answers', () => {
    const row: FleetMatrixRow = {
      id: 'a',
      url: 'https://box-a.example.invalid',
      label: 'Box A',
      lastOkAt: AT,
      lastReason: null,
      facts: {
        schema: 1,
        at: '2026-11-10T10:00:00.000Z',
        status: null,
        signIn: 'off',
        agents: [],
        workers: [],
        counts: { workspaces: 1, apps: 0 },
        backup: { lastRunAt: AT, ok: false, lastSuccessAt: null },
      },
      factsReason: null,
    };
    expect(fleetIssues(overview(), [row], NOW).map((i) => i.id)).toEqual(['backup-a', 'facts-a']);
  });

  it('names an active ban that matched an owner, not a lifted one', () => {
    const ban = {
      id: 'ban1',
      kind: 'disable' as const,
      emails: ['x@example.invalid'],
      issuer: null,
      oid: null,
      reason: null,
      madeBy: null,
      madeAt: AT,
      liftedBy: null,
      liftedAt: null,
      boxesMatched: 1,
      loginsMatched: 1,
      ownerIds: [],
    };
    const results = [{ banId: 'ban1', boxId: 'a', matched: 1, ownerIds: ['o'], updatedAt: AT }];
    expect(fleetIssues(overview({ bans: [ban], results }), [], NOW).map((i) => i.id)).toEqual([
      'owner-ban1',
    ]);
    const lifted = { ...ban, liftedAt: AT };
    expect(fleetIssues(overview({ bans: [lifted], results }), [], NOW)).toEqual([]);
  });
});

describe('lastOfKind', () => {
  const answer = {
    kind: 'updateNotice' as const,
    on: true,
    ...stamp,
    ok: true,
    was: 'off',
    reason: null,
    done: AT,
  };
  it('is null for a box never sent one', () => {
    expect(lastOfKind(box(), 'updateNotice')).toBe(null);
  });
  it('gives the last answer of that kind only', () => {
    const b = box({ writeResult: { results: [answer] } });
    expect(lastOfKind(b, 'updateNotice')).toMatchObject({ tone: 'ok', label: 'Update notice on' });
    expect(lastOfKind(b, 'poolEntry')).toBe(null);
  });
  it('what waits wins over an older answer', () => {
    const b = box({
      writeJob: { changes: [{ kind: 'updateNotice', on: false, ...stamp }] },
      writeResult: { results: [answer] },
    });
    expect(lastOfKind(b, 'updateNotice')).toMatchObject({
      tone: 'wait',
      label: 'Update notice off',
    });
  });
});

describe('changeRows and changeCounts', () => {
  const b = box({
    writeJob: { changes: [{ kind: 'updateNotice', on: false, ...stamp }] },
    writeResult: {
      results: [
        {
          kind: 'agentModel',
          slug: 'coder',
          model: 'm',
          ...stamp,
          ok: true,
          was: null,
          reason: null,
          done: '2026-11-11T09:00:00.000Z',
        },
        {
          kind: 'workerGroup',
          slug: 'g',
          members: ['x'],
          ...stamp,
          ok: false,
          was: null,
          reason: 'members',
          done: AT,
        },
      ],
    },
  });
  it('lists what waits first, then the answers newest first', () => {
    const rows = changeRows([b]);
    expect(rows.map((r) => r.label)).toEqual(['Update notice off', 'Worker group g', 'coder to m']);
    expect(rows.map((r) => r.waiting)).toEqual([true, false, false]);
    expect(rows[1]!.tone).toBe('bad');
  });
  it('counts them', () => {
    expect(changeCounts(b)).toEqual({ waiting: 1, refused: 1, done: 2 });
    expect(changeCounts(box())).toEqual({ waiting: 0, refused: 0, done: 0 });
  });
});

describe('words', () => {
  it('counts boxes and builds a screen address', () => {
    expect(boxesText(1)).toBe('1 box');
    expect(boxesText(3)).toBe('3 boxes');
    expect(ccHref('matrix')).toBe('/admin/fleet/matrix');
    expect(ccHref('boxes', 'a b')).toBe('/admin/fleet/boxes?box=a%20b');
  });
});
