import { describe, expect, it } from 'vitest';

import {
  deciderLastFailureOf,
  deciderPrivacyOf,
  deciderPrivacyParams,
  lastFailureHeadline,
  lastFailureNote,
  lastFailureState,
  type DeciderLastFailure,
} from './decider';

describe('deciderPrivacyOf: the twin of the brain read', () => {
  it('no setting is zdr; the old zdr: false is no_training', () => {
    expect(deciderPrivacyOf({})).toBe('zdr');
    expect(deciderPrivacyOf(null)).toBe('zdr');
    expect(deciderPrivacyOf({ zdr: false })).toBe('no_training');
    expect(deciderPrivacyOf({ privacy: 'no_training' })).toBe('no_training');
  });

  it('the stricter key wins, and an unknown value is zdr', () => {
    expect(deciderPrivacyOf({ privacy: 'no_training', zdr: true })).toBe('zdr');
    expect(deciderPrivacyOf({ privacy: 'zdr', zdr: false })).toBe('zdr');
    expect(deciderPrivacyOf({ privacy: 'off' })).toBe('zdr');
    expect(deciderPrivacyOf({ zdr: 'no' })).toBe('zdr');
  });

  it('what the form writes reads back as what the box said', () => {
    expect(deciderPrivacyOf(deciderPrivacyParams(true))).toBe('zdr');
    expect(deciderPrivacyOf(deciderPrivacyParams(false))).toBe('no_training');
  });
});

describe('the last failure', () => {
  const now = new Date('2026-11-03T10:00:00');
  const f = (over: Partial<DeciderLastFailure> = {}): DeciderLastFailure => ({
    code: 'timeout',
    permanent: false,
    reason: 'The provider does not answer in time.',
    provider: 'openrouter',
    model: '~typesafe/jev-latest',
    since: '2026-11-03T08:00:00',
    lastAt: '2026-11-03T09:00:00',
    count: 4,
    shown: true,
    resolvedAt: null,
    current: true,
    ...over,
  });

  it('reads it off the config answer, null on an older brain', () => {
    expect(deciderLastFailureOf({ deciderLastFailure: f() })).toMatchObject({ code: 'timeout' });
    expect(deciderLastFailureOf({ nativeDocProviders: [] })).toBeNull();
    expect(deciderLastFailureOf({ deciderLastFailure: null })).toBeNull();
    expect(deciderLastFailureOf(undefined)).toBeNull();
  });

  it('says still failing, a blip so far, or fixed since', () => {
    expect(lastFailureHeadline(f(), now)).toMatch(/^Failing on ~typesafe\/jev-latest since /);
    expect(lastFailureHeadline(f({ resolvedAt: '2026-11-03T09:30:00' }), now)).toMatch(
      /^Last failure on ~typesafe\/jev-latest at .*It works again since /,
    );
    expect(lastFailureHeadline(f({ shown: false }), now)).toMatch(
      /^A decision failed on ~typesafe\/jev-latest at /,
    );
  });

  it('is red only while open, an alert (or permanent) and current', () => {
    expect(lastFailureState(f())).toBe('failing');
    expect(lastFailureState(f({ shown: false, permanent: true }))).toBe('failing');
    expect(lastFailureState(f({ shown: false }))).toBe('blip');
    expect(lastFailureState(f({ current: false }))).toBe('idle');
    expect(lastFailureState(f({ resolvedAt: '2026-11-03T09:30:00' }))).toBe('fixed');
    // A brain without `current` counts it as current.
    expect(lastFailureState(f({ current: undefined as unknown as boolean }))).toBe('failing');
  });

  it('says what runs without it only in the red state', () => {
    expect(lastFailureNote(f())).toMatch(/^Search and chat run without the decider/);
    expect(lastFailureNote(f())).toMatch(/never lowers the privacy level/);
    expect(lastFailureNote(f())).not.toMatch(/retry/);
    expect(lastFailureNote(f({ shown: false }))).toMatch(/shows as an alert if it lasts 10/);
    expect(lastFailureNote(f({ current: false }))).not.toMatch(/Search and chat/);
    expect(lastFailureNote(f({ resolvedAt: '2026-11-03T09:30:00' }))).toBeNull();
  });
});
