import { describe, expect, it } from 'vitest';
import {
  alertFix,
  alertHeadline,
  alertHref,
  alertImpact,
  alertProbes,
  alertTitle,
  alertsTitle,
  nextTryText,
  providerAlertsOf,
  type ProviderAlert,
} from './provider-alerts';

const NOW = new Date('2026-10-04T10:00:00');

const outage = (over: Partial<ProviderAlert> = {}): ProviderAlert => ({
  subject: 'embedding',
  code: 'quota',
  permanent: true,
  reason: 'The provider account has no credits or quota left.',
  provider: 'openai',
  model: 'text-embedding-3-large',
  since: new Date('2026-10-04T08:14:00').toISOString(),
  paused: true,
  nextProbeAt: new Date('2026-10-04T10:20:00').toISOString(),
  waiting: 30,
  ...over,
});

describe('provider alert words (the 2026-10-04 no-credits case)', () => {
  it('says what fails, since when, why, what it does, and how many wait', () => {
    const a = outage();
    expect(alertHeadline(a, NOW)).toMatch(
      // The time is in the viewer's locale (08:14, or 08:14 AM).
      /^Embeddings are failing since \d{1,2}:\d\d(?:\s?[AP]M)?: The provider account has no credits or quota left\.$/,
    );
    expect(alertImpact(a)).toBe(
      'New files are not indexed and search has less context. 30 items wait.',
    );
    expect(alertImpact(outage({ waiting: 1 }))).toMatch(/1 item waits\.$/);
    expect(alertImpact(outage({ waiting: null }))).not.toMatch(/wait/);
  });

  it('gives the fix by error code, and where', () => {
    expect(alertFix(outage())).toMatch(/Add credits to the OpenAI account/);
    expect(alertFix(outage({ code: 'auth' }))).toMatch(/Check the API key in Settings, Keys/);
    expect(alertFix(outage({ code: 'model' }))).toMatch(/Pick a model/);
    expect(alertFix(outage({ code: 'workspace', provider: 'anthropic' }))).toBe(
      'Add or check the Anthropic workspace id on the key in Settings, Keys.',
    );
    expect(alertFix(outage({ code: 'server', permanent: false }))).toMatch(/retries by itself/);
    expect(alertHref(outage())).toBe('/settings/embedding');
    expect(alertHref(outage({ subject: 'extraction' }))).toBe('/settings/ai-workers');
  });

  it('names the decider and the box policy, with their own fix and no "Try again"', () => {
    const d = outage({
      subject: 'decision',
      code: 'privacy_route',
      waiting: null,
      paused: false,
      nextProbeAt: null,
    });
    expect(alertHeadline(d, NOW)).toMatch(/^The decider is failing since /);
    expect(alertImpact(d)).toMatch(/run without the decider/);
    expect(alertFix(d)).toMatch(/lower its privacy level.*never lowers it by itself.*press Test/);
    expect(alertFix({ ...d, code: 'timeout' })).toMatch(/Raise the decider's timeout/);
    expect(alertHref(d)).toBe('/settings/ai-workers');
    expect(alertProbes(d)).toBe(false);
    const p = outage({ subject: 'model_policy', code: 'policy', waiting: null });
    expect(alertTitle(p)).toBe('The box policy blocked a model');
    expect(alertProbes(p)).toBe(false);
    expect(alertProbes(outage())).toBe(true);
  });

  it('a subject this client does not know does not break the words', () => {
    const u = outage({ subject: 'speech' as never, waiting: null });
    expect(alertTitle(u)).toBe('A model provider is failing');
    expect(alertImpact(u)).toBe('');
  });

  it('says when the brain tries again', () => {
    expect(nextTryText(outage(), NOW)).toBe('The brain tries again in 20 min.');
    expect(nextTryText(outage({ nextProbeAt: null }), NOW)).toBeNull();
  });
});

describe('provider alerts on GET /api/embedding/recover', () => {
  it('reads the alerts the brain sends', () => {
    const a = outage();
    expect(providerAlertsOf({ alerts: [a] })).toEqual([a]);
  });

  it('adds otherAlerts, the subjects an older client does not know', () => {
    const a = outage();
    const d = outage({ subject: 'decision', code: 'auth' });
    expect(providerAlertsOf({ alerts: [a], otherAlerts: [d] })).toEqual([a, d]);
    expect(providerAlertsOf({ alerts: [], otherAlerts: [d] })).toEqual([d]);
    // An older brain sends no otherAlerts.
    expect(providerAlertsOf({ alerts: [a], otherAlerts: 'x' })).toEqual([a]);
  });

  it('a brain before 0230, or no answer, sends none', () => {
    expect(providerAlertsOf({})).toEqual([]);
    expect(providerAlertsOf({ alerts: 'x' })).toEqual([]);
    expect(providerAlertsOf(null)).toEqual([]);
    expect(providerAlertsOf(undefined)).toEqual([]);
  });
});

describe('the rail label for several outages', () => {
  it('names one subject, the embedding pair, or says something generic', () => {
    const e = outage({ subject: 'embedding' });
    const x = outage({ subject: 'extraction' });
    const d = outage({ subject: 'decision' });
    expect(alertsTitle([])).toBe('');
    expect(alertsTitle([d])).toBe('The decider is failing');
    expect(alertsTitle([e, x])).toBe('Embeddings and extraction are failing');
    expect(alertsTitle([d, e])).toBe('Several model calls are failing');
    expect(alertsTitle([d, e, x])).toBe('Several model calls are failing');
  });
});
