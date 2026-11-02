import { describe, expect, it } from 'vitest';
import { passwordOutcome, validatePasswordForm } from './member-password';

describe('validatePasswordForm', () => {
  const ok = { current: 'old-password', next: 'new-password-1', confirm: 'new-password-1' };

  it('accepts a complete form', () => {
    expect(validatePasswordForm(ok)).toEqual({});
  });

  it('needs the current password', () => {
    expect(validatePasswordForm({ ...ok, current: '' }).current).toBeDefined();
  });

  it('needs at least 8 characters on a brain from before the rule', () => {
    expect(validatePasswordForm({ ...ok, next: 'short77', confirm: 'short77' }).next).toMatch(
      /at least 8/,
    );
    expect(validatePasswordForm({ ...ok, next: 'eight888', confirm: 'eight888' })).toEqual({});
  });

  it('refuses the current password as the new one', () => {
    expect(
      validatePasswordForm({
        current: 'same-password',
        next: 'same-password',
        confirm: 'same-password',
      }).next,
    ).toMatch(/different/);
  });

  it('needs the two new passwords to match', () => {
    expect(validatePasswordForm({ ...ok, confirm: 'new-password-2' }).confirm).toBeDefined();
  });

  it('does not also flag the confirmation while the new password itself is wrong', () => {
    const e = validatePasswordForm({ ...ok, next: 'short', confirm: '' });
    expect(e.next).toBeDefined();
    expect(e.confirm).toBeUndefined();
  });
});

describe('passwordOutcome', () => {
  it('a 200 is done', () => {
    expect(passwordOutcome(200, { ok: true })).toEqual({ kind: 'ok' });
  });

  it('a wrong current password stays on the form, never a sign-out', () => {
    expect(passwordOutcome(401, { error: 'Current password is incorrect.' }).kind).toBe(
      'wrong-current',
    );
  });

  it('any other 401 is a dead session', () => {
    expect(passwordOutcome(401, { error: 'Not signed in.' })).toEqual({ kind: 'signed-out' });
    expect(passwordOutcome(401, null)).toEqual({ kind: 'signed-out' });
  });

  it('the hourly limit and a rule say the brain’s words', () => {
    expect(
      passwordOutcome(429, { error: 'Too many password change attempts. Try again later.' }),
    ).toEqual({ kind: 'error', message: 'Too many password change attempts. Try again later.' });
    expect(
      passwordOutcome(400, { error: 'New password must be different from the current one.' }),
    ).toEqual({
      kind: 'error',
      message: 'New password must be different from the current one.',
    });
  });

  it('anything else is a plain failure', () => {
    expect(passwordOutcome(500, {}).kind).toBe('error');
    expect(passwordOutcome(403, { error: 'forbidden', reason: 'member-login' }).kind).toBe('error');
  });
});

describe('after a password change', () => {
  it('says other devices were signed out (the brain ends every other session)', async () => {
    const { PASSWORD_CHANGED } = await import('./member-password');
    expect(PASSWORD_CHANGED).toBe('Password changed. Other devices were signed out.');
  });
});
