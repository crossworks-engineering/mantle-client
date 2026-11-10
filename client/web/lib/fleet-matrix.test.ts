import { describe, expect, it } from 'vitest';
import type { FleetBox } from './fleet';
import {
  agentName,
  backupTone,
  countText,
  factsAge,
  factsReasonText,
  FLEET_MATRIX_KEY,
  fleetMatrixOffered,
  healthLabel,
  healthLevel,
  modelsInUse,
  signInLabel,
  type FleetFacts,
} from './fleet-matrix';
import type { BoxStatus } from './status';

const status = (over: Partial<BoxStatus> = {}): BoxStatus => ({
  schema: 1,
  ts: '2026-11-10T00:00:00Z',
  build: { version: '0.500.42', gitSha: null, buildTime: null },
  process: { uptimeSec: 1, heapUsedBytes: 1, rssBytes: 1 },
  host: {
    scope: 'host',
    cpuLoadPct: 10,
    loadAvg: [0, 0, 0],
    cores: 4,
    mem: { usedBytes: 1, totalBytes: 2, usedPct: 50 },
    disk: { usedBytes: 1, totalBytes: 2, freeBytes: 1, usedPct: 40 },
  },
  postgres: { up: true, dbSizeBytes: 1, connections: 1, cacheHitPct: 99 },
  services: {
    objectStore: true,
    parser: { up: true, running: 0, queued: 0 },
    browser: null,
    documents: true,
    embedder: null,
    sandboxes: true,
    network: true,
  },
  spend: null,
  capacity: null,
  extraction: null,
  logins: null,
  degraded: [],
  ...over,
});

describe('the fleet matrix (phase 3)', () => {
  it('reads under the Fleet key, so a Fleet refresh reads it too', () => {
    expect(FLEET_MATRIX_KEY).toEqual(['fleet', 'matrix']);
  });

  it('is offered by a brain whose box rows carry factsAt', () => {
    const box = { url: 'https://b', label: null } as never as FleetBox;
    expect(fleetMatrixOffered([box])).toBe(false);
    expect(fleetMatrixOffered([{ ...box, factsAt: null }])).toBe(true);
    expect(fleetMatrixOffered([])).toBe(false);
  });

  it('says how current the facts are', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    const facts = { at: '2026-11-10T11:55:00Z' } as FleetFacts;
    expect(factsAge({ facts: null, factsReason: null }, now)).toBe('none');
    expect(factsAge({ facts: null, factsReason: 'time' }, now)).toBe('none');
    expect(factsAge({ facts, factsReason: null }, now)).toBe('fresh');
    expect(factsAge({ facts, factsReason: 'unreachable' }, now)).toBe('stale');
    expect(
      factsAge({ facts: { ...facts, at: '2026-11-10T11:40:00Z' }, factsReason: null }, now),
    ).toBe('stale');
    expect(factsAge({ facts: { ...facts, at: 'garbage' }, factsReason: null }, now)).toBe('stale');
  });

  it('has words for each read failure', () => {
    expect(factsReasonText(null)).toBeNull();
    expect(factsReasonText('error')).toBe('The last read failed on this box.');
    expect(factsReasonText('not-https')).toBe('The box address is not HTTPS.');
    expect(factsReasonText('bad-reply')).toBe('The box gave a reply this box cannot read.');
    expect(factsReasonText('http-502')).toBe('The box answered HTTP 502.');
    expect(factsReasonText('new-code')).toBe('The last read failed.');
  });

  it('reads the health from the status numbers', () => {
    expect(healthLevel(null)).toBe('unknown');
    expect(healthLevel(status())).toBe('ok');
    expect(
      healthLevel(
        status({
          postgres: { up: false, dbSizeBytes: null, connections: null, cacheHitPct: null },
        }),
      ),
    ).toBe('crit');
    expect(healthLevel(status({ degraded: ['host.cpu'] }))).toBe('warn');
    const s = status();
    expect(healthLevel({ ...s, services: { ...s.services, embedder: false } })).toBe('warn');
    expect(
      healthLevel({
        ...s,
        services: { ...s.services, parser: { up: false, running: null, queued: null } },
      }),
    ).toBe('warn');
    expect(
      healthLevel({
        ...s,
        host: { ...s.host, disk: { usedBytes: 9, totalBytes: 10, freeBytes: 1, usedPct: 95 } },
      }),
    ).toBe('crit');
    expect(healthLabel('ok')).toBe('Healthy');
    expect(healthLabel('warn')).toBe('Warning');
    expect(healthLabel('crit')).toBe('Down');
    expect(healthLabel('unknown')).toBe('Not known');
  });

  it('names the sign-in mode, the backup and each agent', () => {
    expect(signInLabel('off')).toBe('Off');
    expect(signInLabel('optional')).toBe('Optional');
    expect(signInLabel('required')).toBe('Required');
    expect(backupTone(null)).toBe('none');
    expect(backupTone({ lastRunAt: 'x', ok: true, lastSuccessAt: 'x' })).toBe('ok');
    expect(backupTone({ lastRunAt: 'x', ok: false, lastSuccessAt: null })).toBe('bad');
    const a = { role: 'agent', provider: 'p', model: 'm', enabled: true };
    expect(agentName({ ...a, slug: 'coder', assigned: false })).toBe('coder');
    expect(agentName({ ...a, slug: null, assigned: true })).toBe('Own assistant');
    expect(agentName({ ...a, slug: null, assigned: false })).toBe('Custom agent');
  });

  it('lists each model in use once, most used first, without the ones off', () => {
    const agent = (model: string, enabled = true) => ({
      slug: null,
      role: 'agent',
      provider: 'openrouter',
      model,
      enabled,
      assigned: false,
    });
    expect(
      modelsInUse({
        agents: [agent('b'), agent('a'), agent('b'), agent('c', false), agent('')],
        workers: [
          { kind: 'extract', provider: 'openrouter', model: 'a', enabled: true },
          { kind: 'x', provider: 'openai', model: 'a', enabled: true },
        ],
      }),
    ).toEqual([
      { provider: 'openrouter', model: 'a', uses: 2 },
      { provider: 'openrouter', model: 'b', uses: 2 },
      { provider: 'openai', model: 'a', uses: 1 },
    ]);
  });

  it('counts with the ones off', () => {
    expect(countText(1, 0, 'agent')).toBe('1 agent');
    expect(countText(3, 1, 'agent')).toBe('3 agents (1 off)');
    expect(countText(0, 0, 'worker')).toBe('0 workers');
  });
});
