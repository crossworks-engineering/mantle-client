import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@mantle/web-ui/api-fetch';
import {
  NOT_A_PASSWORD_LOGIN,
  canResetPassword,
  isNotAPasswordLogin,
  resetPasswordErrorMessage,
} from './password-reset';
import { SYSTEM_USER_TARGET_TEXT } from './login-refusals';

/**
 * Settings > Logins, Reset password (audit A29, decision a): offered for an
 * admin or a member only, never a client (link sign-in) or a role this app
 * does not know; the brain's 400 `not-a-password-login` says its words.
 */
describe('Reset password', () => {
  it('is offered for admins and members only', () => {
    expect(canResetPassword('admin')).toBe(true);
    expect(canResetPassword('member')).toBe(true);
    for (const role of ['client', 'owner', 'guest', '']) {
      expect(canResetPassword(role), role).toBe(false);
    }
  });

  it("says the brain's words when it refuses a login with no password", () => {
    const words = 'A client login has no password. It signs in with a link.';
    const err = new ApiError(words, 400, {
      error: words,
      reason: 'not-a-password-login',
      message: words,
    });
    expect(isNotAPasswordLogin(err)).toBe(true);
    expect(resetPasswordErrorMessage(err)).toBe(words);
    // Without words of its own, it still says why.
    const bare = new ApiError('', 400, { reason: 'not-a-password-login' });
    expect(resetPasswordErrorMessage(bare)).toBe(NOT_A_PASSWORD_LOGIN);
  });

  it("a System user's login: Only a System user can change it", () => {
    const err = new ApiError('x', 403, { error: 'x', code: 'system_user_target' });
    expect(isNotAPasswordLogin(err)).toBe(false);
    expect(resetPasswordErrorMessage(err)).toBe(SYSTEM_USER_TARGET_TEXT);
  });

  it('any other failure: its message, or a plain fallback', () => {
    expect(isNotAPasswordLogin(new ApiError('Too short.', 400, { reason: 'weak' }))).toBe(false);
    expect(resetPasswordErrorMessage(new ApiError('Too short.', 400, {}))).toBe('Too short.');
    expect(resetPasswordErrorMessage(new Error('x'))).toBe('Could not reset password');
  });
});

describe('Settings > Logins uses it', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../app/(app)/settings/users/users-client.tsx', import.meta.url)),
    'utf8',
  );

  it('shows Reset password for a password login only', () => {
    expect(src).toContain('{canResetPassword(user.role) && (');
    expect(src).not.toContain("{user.role !== 'client' && (");
  });

  it("toasts the brain's refusal and closes the dialog on not-a-password-login", () => {
    expect(src).toContain('toast.error(resetPasswordErrorMessage(err));');
    expect(src).toMatch(/if \(isNotAPasswordLogin\(err\)\) \{[\s\S]*?onOpenChange\(false\);/);
  });
});
