import { describe, expect, it } from 'vitest';
import type { FleetBox } from './fleet';
import type { FleetMatrixRow } from './fleet-matrix';
import {
  currentModel,
  FLEET_MODELS_PATH,
  fleetModelsOffered,
  MODEL_ID,
  modelChangeText,
  modelUpdatePending,
  shippedSlugs,
} from './fleet-models';

const box = { url: 'https://b', label: null } as never as FleetBox;
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

  it('is offered by a brain whose box rows carry modelJob', () => {
    expect(fleetModelsOffered([box])).toBe(false);
    expect(fleetModelsOffered([{ ...box, modelJob: null }])).toBe(true);
    expect(fleetModelsOffered([])).toBe(false);
  });

  it('reads again while a box waits', () => {
    expect(modelUpdatePending(undefined)).toBe(false);
    expect(modelUpdatePending([{ ...box, modelJob: null }])).toBe(false);
    expect(
      modelUpdatePending([
        { ...box, modelJob: { changes: [{ slug: 'coder', model: 'm' }], by: 'a@x', at: 'x' } },
      ]),
    ).toBe(true);
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

  it('says what each change answered', () => {
    const r = (ok: boolean, was: string | null, reason: string | null) => ({
      slug: 'coder',
      model: 'new',
      ok,
      was,
      reason,
    });
    expect(modelChangeText(r(true, 'old', null))).toEqual({ tone: 'ok', text: 'Set. It was old.' });
    expect(modelChangeText(r(true, 'new', null)).text).toBe('No change: it was set already.');
    expect(modelChangeText(r(true, null, null)).text).toBe('Set.');
    expect(modelChangeText(r(false, null, 'agent')).text).toContain('no shipped agent');
    expect(modelChangeText(r(false, 'old', 'policy')).text).toBe(
      'The model policy of this box does not allow it. It keeps old.',
    );
    expect(modelChangeText(r(false, null, 'expired')).text).toContain('dropped');
    expect(modelChangeText(r(false, null, 'unreachable')).text).toBe(
      'This box cannot reach the box over HTTPS. Nothing was set.',
    );
    expect(modelChangeText(r(false, null, 'error')).text).toBe('The call failed. Nothing was set.');
    expect(modelChangeText(r(false, null, 'policy')).tone).toBe('bad');
  });
});
