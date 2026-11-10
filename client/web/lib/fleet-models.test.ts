import { describe, expect, it } from 'vitest';
import type { FleetMatrixRow } from './fleet-matrix';
import { currentModel, FLEET_MODELS_PATH, MODEL_ID, shippedSlugs } from './fleet-models';

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
