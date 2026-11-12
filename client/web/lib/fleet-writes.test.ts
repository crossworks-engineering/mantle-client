import { describe, expect, it } from 'vitest';
import type { FleetBox } from './fleet';
import {
  answerText,
  changeLabel,
  FLEET_SETTINGS_PATH,
  fleetWritesOffered,
  LABEL,
  parseSlugs,
  PROVIDER,
  sentText,
  SLUG,
  writeUpdatePending,
  type FleetWriteAnswer,
  type FleetWriteChange,
} from './fleet-writes';

const box = { url: 'https://b', label: null } as never as FleetBox;
const stamp = { by: 'a@x', at: '2026-11-10T00:00:00.000Z' };
const answer = (
  c: FleetWriteChange,
  ok: boolean,
  was: string | null,
  reason: string | null,
): FleetWriteAnswer => ({ ...c, ...stamp, ok, was, reason, done: stamp.at });
const model: FleetWriteChange = { kind: 'agentModel', slug: 'coder', model: 'new' };
const pool: FleetWriteChange = {
  kind: 'poolEntry',
  pool: 'agents',
  name: 'Model A',
  routes: [{ provider: 'openrouter', model: 'vendor/a' }],
};
const on: FleetWriteChange = { kind: 'updateNotice', on: true };
const off: FleetWriteChange = { kind: 'updateNotice', on: false };
const group: FleetWriteChange = { kind: 'workerGroup', slug: 'review', members: ['a', 'b'] };
const workerModel: FleetWriteChange = {
  kind: 'workerModel',
  worker: 'vision',
  provider: 'openrouter',
  model: 'new',
};

describe('fleet writes (phase 4)', () => {
  it('posts the settings to their route', () => {
    expect(FLEET_SETTINGS_PATH).toBe('/api/fleet/settings');
  });

  it('is offered by a brain whose box rows carry writeJob', () => {
    expect(fleetWritesOffered([box])).toBe(false);
    expect(fleetWritesOffered([{ ...box, writeJob: null }])).toBe(true);
    expect(fleetWritesOffered([])).toBe(false);
  });

  it('reads again while a box has changes waiting', () => {
    expect(writeUpdatePending(undefined)).toBe(false);
    expect(writeUpdatePending([{ ...box, writeJob: null }])).toBe(false);
    expect(writeUpdatePending([{ ...box, writeJob: { changes: [] } }])).toBe(false);
    expect(writeUpdatePending([{ ...box, writeJob: { changes: [{ ...on, ...stamp }] } }])).toBe(
      true,
    );
  });

  it('names each change', () => {
    expect(changeLabel(model)).toBe('coder to new');
    expect(changeLabel(pool)).toBe('Pool entry Model A in agents');
    expect(changeLabel(on)).toBe('Update notice on');
    expect(changeLabel(off)).toBe('Update notice off');
    expect(changeLabel(group)).toBe('Worker group review');
    expect(changeLabel(workerModel)).toBe('vision worker to new');
  });

  it('says what an agent model answered', () => {
    expect(answerText(answer(model, true, 'old', null))).toEqual({
      tone: 'ok',
      text: 'Set. It was old.',
    });
    expect(answerText(answer(model, true, 'new', null)).text).toBe(
      'No change: it was set already.',
    );
    expect(answerText(answer(model, true, null, null)).text).toBe('Set.');
    expect(answerText(answer(model, false, null, 'agent')).text).toContain('no shipped agent');
    expect(answerText(answer(model, false, 'old', 'policy')).text).toBe(
      'The model policy of this box does not allow it. It keeps old.',
    );
  });

  it("says what a worker's model answered", () => {
    expect(answerText(answer(workerModel, true, 'old', null)).text).toBe('Set. It was old.');
    expect(answerText(answer(workerModel, true, 'new', null)).text).toBe(
      'No change: it was set already.',
    );
    expect(answerText(answer(workerModel, false, null, 'worker')).text).toContain(
      'no default worker of this kind',
    );
    expect(answerText(answer(workerModel, false, 'old', 'policy')).text).toBe(
      'The model policy of this box does not allow it. It keeps old.',
    );
    expect(answerText(answer(workerModel, false, 'old', 'provider')).text).toBe(
      'This box runs the worker on another provider. It keeps old.',
    );
    expect(answerText(answer(workerModel, false, 'old', 'model')).text).toBe(
      'The provider does not list this model for this kind of worker. It keeps old.',
    );
  });

  it('says what the other writes answered', () => {
    expect(answerText(answer(pool, true, 'added', null)).text).toBe(
      'Added at the end of the pool.',
    );
    expect(answerText(answer(pool, true, 'updated', null)).text).toBe(
      'Updated: the entry was there.',
    );
    expect(answerText(answer(on, true, 'off', null)).text).toBe('On. Logins wait on this box.');
    expect(answerText(answer(off, true, 'on', null)).text).toBe('Off. Logins work again.');
    expect(answerText(answer(on, true, 'on', null)).text).toBe('No change: it was on already.');
    expect(answerText(answer(group, true, 'added', null)).text).toBe('Made.');
    expect(answerText(answer(group, true, 'updated', null)).text).toBe(
      'Updated: the group was there.',
    );
  });

  it('says each reason in plain words', () => {
    const why = (reason: string) => answerText(answer(pool, false, null, reason));
    expect(why('pool').text).toBe('This box has no pool with this id. Nothing was set.');
    expect(why('fit').text).toContain('does not fit the pool');
    expect(answerText(answer(group, false, null, 'members')).text).toContain(
      'not an enabled worker',
    );
    expect(why('expired').text).toContain('dropped');
    expect(why('unreachable').text).toContain('Not confirmed');
    expect(why('bad-call').text).toContain('a release behind');
    expect(why('http-429').text).toBe('Too many changes at once. Nothing was set. Send it again.');
    expect(why('refused').text).toBe('The box refused it. Nothing was set.');
    expect(why('error').text).toBe('The call failed. Nothing was set.');
    expect(why('sig').text).toBe(
      'The box holds another key. Copy the key line again. Nothing was set.',
    );
    expect(why('http-500').text).toBe('The box answered HTTP 500. Nothing was set.');
    expect(why('fit').tone).toBe('bad');
  });

  it('says which boxes were not queued', () => {
    expect(sentText(2, 2)).toBe('Sent to 2 boxes. Each box makes the change at its next run.');
    expect(sentText(1, 1)).toBe('Sent to 1 box. Each box makes the change at its next run.');
    expect(sentText(3, 2)).toContain('1 box not queued: 40 changes wait there already.');
  });

  it('reads the slugs typed in one box', () => {
    expect(parseSlugs(' Extractor, summarizer  extractor\nvision ')).toEqual([
      'extractor',
      'summarizer',
      'vision',
    ]);
    expect(parseSlugs('  ')).toEqual([]);
  });

  it('holds names to the brain patterns', () => {
    expect(SLUG.test('review-panel')).toBe(true);
    expect(SLUG.test('Review')).toBe(false);
    expect(SLUG.test('-a')).toBe(false);
    expect(PROVIDER.test('openrouter')).toBe(true);
    expect(PROVIDER.test('open router')).toBe(false);
    expect(LABEL.test('Claude Sonnet 5')).toBe(true);
    expect(LABEL.test("Ünïcode (beta) & co's")).toBe(true);
    expect(LABEL.test(' lead space')).toBe(false);
    expect(LABEL.test('a'.repeat(121))).toBe(false);
  });
});
