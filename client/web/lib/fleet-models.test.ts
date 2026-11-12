import { describe, expect, it } from 'vitest';
import type { FleetMatrixRow } from './fleet-matrix';
import type { FleetBox } from './fleet';
import type { FleetWriteAnswer } from './fleet-writes';
import {
  canCopy,
  compareLines,
  agentChange,
  copyAllLines,
  currentModel,
  currentWorkerModel,
  defaultPair,
  FLEET_MODELS_PATH,
  MAX_MODEL_CHANGES,
  MODEL_ID,
  shippedSlugs,
  workerChange,
  workerKinds,
  workerKindSettable,
  writeAnswer,
  writeWaiting,
} from './fleet-models';

const agent = (slug: string | null, model: string) => ({
  slug,
  role: 'agent',
  provider: 'openrouter',
  model,
  enabled: true,
  assigned: slug === null,
});
const row = (agents: ReturnType<typeof agent>[] | null): FleetMatrixRow => ({
  id: 'r',
  url: 'https://b',
  label: null,
  lastOkAt: null,
  lastReason: null,
  factsReason: null,
  facts: agents ? ({ agents, workers: [] } as never) : null,
});

describe('set an agent model on the fleet (phase 4)', () => {
  it('posts to the models route', () => {
    expect(FLEET_MODELS_PATH).toBe('/api/fleet/models');
  });

  it('offers the shipped slugs the matrix names, each once', () => {
    expect(
      shippedSlugs([
        row([agent('writer', 'a'), agent(null, 'b')]),
        row([agent('coder', 'c'), agent('writer', 'd')]),
        row(null),
      ]),
    ).toEqual(['coder', 'writer']);
  });

  it('reads the current model per box', () => {
    expect(currentModel(row([agent('coder', 'vendor/m-1')]), 'coder')).toBe('vendor/m-1');
    expect(currentModel(row([agent('coder', 'x')]), 'writer')).toBeNull();
    expect(currentModel(row(null), 'coder')).toBeNull();
  });

  it('holds a model id to the brain pattern', () => {
    expect(MODEL_ID.test('anthropic/claude-x:beta')).toBe(true);
    expect(MODEL_ID.test('inherit')).toBe(true);
    expect(MODEL_ID.test('')).toBe(false);
    expect(MODEL_ID.test('has space')).toBe(false);
    expect(MODEL_ID.test('-lead')).toBe(false);
    expect(MODEL_ID.test('a'.repeat(201))).toBe(false);
  });
});

describe('agent models, two boxes', () => {
  const at = (id: string, url: string) => ({ id, url });

  it('opens on this box when it is linked, then the first other box', () => {
    const rows = [at('a', 'https://a.example'), at('b', 'https://b.example:443/')];
    expect(defaultPair(rows, 'https://b.example')).toEqual(['b', 'a']);
    expect(defaultPair(rows, 'https://cc.example')).toEqual(['a', 'b']);
    expect(defaultPair(rows, null)).toEqual(['a', 'b']);
    expect(defaultPair([at('a', 'https://a.example')], null)).toEqual(['a', null]);
    expect(defaultPair([], null)).toEqual([null, null]);
    expect(defaultPair([at('x', 'not a url'), at('y', 'https://y')], 'https://y')).toEqual([
      'y',
      'x',
    ]);
  });

  it('marks the agents that differ, and those on one box only', () => {
    const left = row([agent('coder', 'm-1'), agent('writer', 'w'), agent('chat', 'c')]);
    const right = row([agent('coder', 'm-2'), agent('writer', 'w')]);
    const lines = compareLines(['chat', 'coder', 'writer'], left, right);
    expect(lines).toEqual([
      { key: 'chat', left: 'c', right: null, differs: false, oneSided: true },
      { key: 'coder', left: 'm-1', right: 'm-2', differs: true, oneSided: false },
      { key: 'writer', left: 'w', right: 'w', differs: false, oneSided: false },
    ]);
    expect(compareLines(['coder'], left, undefined)[0]).toMatchObject({
      right: null,
      differs: false,
    });
  });

  it('copies only a model the brain takes, onto a box that runs the agent', () => {
    const lines = compareLines(
      ['a', 'b', 'c', 'd'],
      row([agent('a', 'm-1'), agent('b', ''), agent('c', 'same'), agent('d', 'x')]),
      row([agent('a', 'm-2'), agent('b', 'm-3'), agent('c', 'same')]),
    );
    expect(canCopy(lines[0]!, 'left')).toBe(true);
    expect(canCopy(lines[1]!, 'left')).toBe(false); // no model to give
    expect(canCopy(lines[1]!, 'right')).toBe(true);
    expect(canCopy(lines[2]!, 'left')).toBe(false); // the same already
    expect(canCopy(lines[3]!, 'left')).toBe(false); // not on the other box
    expect(copyAllLines(lines, 'left')).toEqual([{ key: 'a', model: 'm-1' }]);
    expect(copyAllLines(lines, 'right')).toEqual([
      { key: 'a', model: 'm-2' },
      { key: 'b', model: 'm-3' },
    ]);
    // An item the fleet may not set is left out.
    expect(copyAllLines(lines, 'right', (k) => k !== 'a')).toEqual([{ key: 'b', model: 'm-3' }]);
  });

  it('sends at most the route cap in one request', () => {
    const slugs = Array.from({ length: 25 }, (_, i) => `s${i}`);
    const lines = compareLines(
      slugs,
      row(slugs.map((s) => agent(s, 'l'))),
      row(slugs.map((s) => agent(s, 'r'))),
    );
    expect(copyAllLines(lines, 'left')).toHaveLength(MAX_MODEL_CHANGES);
  });

  it('reads what waits and the answer since a send', () => {
    const stamp = { by: 'x', at: '2026-11-12T10:00:00.000Z' };
    const answer = (slug: string, ok: boolean, atIso: string): FleetWriteAnswer => ({
      kind: 'agentModel',
      slug,
      model: 'm',
      by: 'x',
      at: atIso,
      ok,
      was: 'old',
      reason: ok ? null : 'policy',
      done: atIso,
    });
    const box = {
      id: 'b',
      writeJob: { changes: [{ kind: 'agentModel', slug: 'coder', model: 'm', ...stamp }] },
      writeResult: {
        results: [
          answer('writer', true, '2026-11-12T09:00:00.000Z'),
          answer('writer', false, '2026-11-12T10:05:00.000Z'),
          { kind: 'updateNotice', on: true, ...stamp, ok: true, was: null, reason: null, done: '' },
        ],
      },
    } as unknown as FleetBox;
    expect(writeWaiting(box, agentChange('coder'))).toBe(true);
    expect(writeWaiting(box, agentChange('writer'))).toBe(false);
    expect(writeWaiting(box, workerChange('coder'))).toBe(false);
    expect(writeWaiting(undefined, agentChange('coder'))).toBe(false);
    const since = Date.parse('2026-11-12T10:00:00.000Z');
    expect(writeAnswer(box, agentChange('writer'), since)?.reason).toBe('policy');
    expect(writeAnswer(box, agentChange('writer'), since + 3_600_000)).toBeNull();
    expect(writeAnswer(box, agentChange('coder'), 0)).toBeNull();
    expect(writeAnswer(box, workerChange('writer'), 0)).toBeNull();
  });
});

describe('AI worker models, two boxes', () => {
  const w = (kind: string, model: string, def?: boolean) => ({
    kind,
    provider: 'openrouter',
    model,
    enabled: true,
    ...(def === undefined ? {} : { default: def }),
  });
  const box = (workers: ReturnType<typeof w>[] | null): FleetMatrixRow => ({
    id: 'r',
    url: 'https://b',
    label: null,
    lastOkAt: null,
    lastReason: null,
    factsReason: null,
    facts: workers ? ({ agents: [], workers } as never) : null,
  });

  it('names each kind once, sorted', () => {
    expect(
      workerKinds([
        box([w('vision', 'a'), w('extractor', 'b')]),
        box([w('vision', 'c')]),
        box(null),
      ]),
    ).toEqual(['extractor', 'vision']);
  });

  it('reads the worker that runs the kind: the flagged one, else the only one', () => {
    // Flagged (a rolled box).
    expect(
      currentWorkerModel(box([w('vision', 'a', false), w('vision', 'b', true)]), 'vision'),
    ).toBe('b');
    // Flags sent, none runs the kind: nothing to compare.
    expect(currentWorkerModel(box([w('vision', 'a', false)]), 'vision')).toBeNull();
    // A box before the flag: its one worker of the kind, else not known.
    expect(currentWorkerModel(box([w('vision', 'a')]), 'vision')).toBe('a');
    expect(currentWorkerModel(box([w('vision', 'a'), w('vision', 'b')]), 'vision')).toBeUndefined();
    expect(currentWorkerModel(box([w('vision', 'a')]), 'stt')).toBeNull();
    expect(currentWorkerModel(box(null), 'vision')).toBeNull();
  });

  it('compares by kind; a model not known never differs nor copies', () => {
    const left = box([w('vision', 'a', true), w('stt', 's-1', true), w('embedding', 'e-1', true)]);
    const right = box([w('vision', 'x'), w('vision', 'y'), w('stt', 's-2'), w('embedding', 'e-2')]);
    const lines = compareLines(['embedding', 'stt', 'vision'], left, right, currentWorkerModel);
    expect(lines[2]).toEqual({
      key: 'vision',
      left: 'a',
      right: undefined,
      differs: false,
      oneSided: false,
    });
    expect(canCopy(lines[2]!, 'left')).toBe(false);
    expect(lines[1]).toMatchObject({ differs: true });
    // Embedding is never set by the fleet.
    expect(workerKindSettable('embedding')).toBe(false);
    expect(workerKindSettable('stt')).toBe(true);
    expect(copyAllLines(lines, 'left', workerKindSettable)).toEqual([{ key: 'stt', model: 's-1' }]);
  });
});
