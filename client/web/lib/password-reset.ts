/**
 * An admin's password reset for another login (Settings > Logins). Only a
 * password login has one: an admin or a member. A role this app does not
 * know is never offered anything, so Reset password shows for admins and
 * members only.
 * The brain refuses the rest with 400 `not-a-password-login`, and the toast
 * says its words.
 *
 * Pure: unit-tested (password-reset.test.ts).
 */
import { ApiError } from '@mantle/web-ui/api-fetch';
import type { PasswordResetRefused } from '@mantle/client-types';
import { knownRefusalText } from './login-refusals';

/** Reset password is offered for these roles only. */
export function canResetPassword(role: string): boolean {
  return role === 'admin' || role === 'member';
}

/** The brain refused: this login has no password (a role it does not
 *  reset). */
export function isNotAPasswordLogin(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 400 &&
    (err.body as Partial<PasswordResetRefused> | undefined)?.reason === 'not-a-password-login'
  );
}

export const NOT_A_PASSWORD_LOGIN = 'This login has no password to reset.';

/** The toast for a failed reset. */
export function resetPasswordErrorMessage(err: unknown): string {
  if (isNotAPasswordLogin(err)) {
    const body = (err as ApiError).body as Partial<PasswordResetRefused> | undefined;
    return body?.message || (err as ApiError).message || NOT_A_PASSWORD_LOGIN;
  }
  // A System user's login, reset by an Admin user outside System.
  const known = knownRefusalText(err);
  if (known) return known;
  return err instanceof ApiError && err.message ? err.message : 'Could not reset password';
}
