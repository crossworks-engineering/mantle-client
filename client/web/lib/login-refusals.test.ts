import { describe, expect, it } from 'vitest';
import { ApiError } from '@mantle/web-ui/api-fetch';
import {
  CONTACT_WAS_CLIENT_TEXT,
  EMAIL_WAS_CLIENT_TEXT,
  FORMER_CLIENT_ENABLE_TEXT,
  SYSTEM_USER_TARGET_TEXT,
  bodyReason,
  formerClientText,
  knownRefusalText,
  loginRefusalText,
  refusalReason,
} from './login-refusals';

const refused = (reason: string | undefined, error = 'brain words', status = 409) =>
  new ApiError(error, status, { error, ...(reason ? { reason } : {}) });

describe('the former client refusals (W8), in plain words', () => {
  it('enabling a former client login', () => {
    expect(loginRefusalText(refused('former-client'), 'x')).toBe(FORMER_CLIENT_ENABLE_TEXT);
    expect(FORMER_CLIENT_ENABLE_TEXT).toMatch(/cannot be enabled again/);
  });

  it('a new login or an invite on the email or the contact of one', () => {
    expect(loginRefusalText(refused('email-was-client'), 'x')).toBe(EMAIL_WAS_CLIENT_TEXT);
    expect(loginRefusalText(refused('contact-was-client'), 'x')).toBe(CONTACT_WAS_CLIENT_TEXT);
  });

  it('any other refusal shows the brain words, else the fallback', () => {
    expect(loginRefusalText(refused('last-admin', 'Keep one admin.'), 'x')).toBe('Keep one admin.');
    expect(
      loginRefusalText(refused(undefined, 'A user with that email already exists.'), 'x'),
    ).toBe('A user with that email already exists.');
    expect(loginRefusalText(new ApiError('', 500), 'Could not save')).toBe('Could not save');
    expect(loginRefusalText(new ApiError('unauthorized', 401), 'Could not save')).toBe(
      'Could not save',
    );
    expect(loginRefusalText(new Error('boom'), 'Could not save')).toBe('Could not save');
  });

  it('reads the reason only from a brain refusal', () => {
    expect(refusalReason(refused('former-client'))).toBe('former-client');
    expect(refusalReason(refused(undefined))).toBeNull();
    expect(refusalReason(new Error('x'))).toBeNull();
    expect(formerClientText('contact-taken')).toBeNull();
    expect(formerClientText(undefined)).toBeNull();
  });

  it("a System user's login changed by an Admin user outside System (403 system_user_target)", () => {
    expect(SYSTEM_USER_TARGET_TEXT).toBe("Only a System user can change a System user's login.");
    const coded = new ApiError('brain words', 403, {
      error: 'brain words',
      code: 'system_user_target',
    });
    const reasoned = new ApiError('brain words', 403, {
      error: 'brain words',
      reason: 'system_user_target',
    });
    for (const err of [coded, reasoned]) {
      expect(refusalReason(err)).toBe('system_user_target');
      expect(knownRefusalText(err)).toBe(SYSTEM_USER_TARGET_TEXT);
      expect(loginRefusalText(err, 'Could not change the login')).toBe(SYSTEM_USER_TARGET_TEXT);
    }
    expect(bodyReason({ code: 'system_user_target' })).toBe('system_user_target');
    expect(bodyReason({ reason: 'former-client', code: 'x' })).toBe('former-client');
    expect(bodyReason(null)).toBeNull();
    expect(knownRefusalText(new ApiError('x', 403, { code: 'forbidden' }))).toBeNull();
  });

  it('says it plainly: no dashes, no codes', () => {
    for (const t of [
      FORMER_CLIENT_ENABLE_TEXT,
      EMAIL_WAS_CLIENT_TEXT,
      CONTACT_WAS_CLIENT_TEXT,
      SYSTEM_USER_TARGET_TEXT,
    ]) {
      expect(t).not.toMatch(/[\u2013\u2014]|-client|former-/);
    }
  });
});
