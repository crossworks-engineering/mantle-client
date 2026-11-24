/**
 * Company sign-in's setup screen on the in-memory brain, in the brain's shapes
 * and refusals (docs/oidc-sign-in.md in the mantle repo). A spec sets `mode`,
 * as the box's .env would, and `testOutcome`, as the provider would.
 */

// The label's rule: the one the client mirrors from the brain.
import { SSO_LABEL_REFUSED, ssoLabelValue } from '../../client/web/lib/sso-setup';

export type MockSsoSetup = {
  mode: 'off' | 'setup' | 'optional' | 'required';
  envSecret: boolean;
  envScim: 'hash' | 'off' | null;
  /** The secret saved, to prove it never comes back. */
  secret: string | null;
  token: string | null;
  tokensMade: number;
  testOutcome: string;
  tests: number;
  envMissing: string[];
  /** The button label set on the screen (null: none), the .env's (wins),
   *  and false for a brain before the label. */
  label: string | null;
  envLabel: string | null;
  labelOn: boolean;
  /** Each save that went through: a secret sent, and the label sent. */
  saves: { secret?: true; label?: string }[];
  /** What the status read answers instead (405: a brain before the screen). */
  statusAnswer: number | null;
  /** A status read waits on this: a box that does not answer. */
  statusHold: Promise<void> | null;
  /** What a write answers instead: the hold's 403 or the one 429. */
  writeRefusal: { status: number; body: unknown } | null;
};

export const newMockSsoSetup = (): MockSsoSetup => ({
  mode: 'off',
  envSecret: false,
  envScim: null,
  secret: null,
  token: null,
  tokensMade: 0,
  testOutcome: 'ok',
  tests: 0,
  envMissing: [],
  label: null,
  envLabel: null,
  labelOn: true,
  saves: [],
  statusAnswer: null,
  statusHold: null,
  writeRefusal: null,
});

const ADMIN = 'admin@example.invalid';
const AT = '2026-11-06T08:00:00.000Z';

function statusOf(s: MockSsoSetup) {
  if (s.mode === 'off') return { mode: 'off' };
  return {
    mode: s.mode,
    issuer: 'https://login.microsoftonline.com/7d8b2c4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f/v2.0',
    clientId: 'the-client-id',
    redirectUri: 'https://brain.example.invalid/api/auth/oidc/callback',
    scimUrl: 'https://brain.example.invalid/scim/v2',
    envMissing: s.envMissing,
    ...(s.labelOn
      ? {
          label: s.envLabel ?? s.label ?? 'Single sign-on',
          labelFrom: s.envLabel ? 'env' : s.label ? 'row' : 'none',
        }
      : {}),
    secret: s.envSecret ? 'env' : s.secret ? 'row' : 'none',
    scim: s.envScim === 'hash' ? 'env' : s.envScim === 'off' ? 'env-off' : s.token ? 'row' : 'none',
    secretSet: s.secret ? { by: ADMIN, at: AT } : null,
    scimSet: s.token ? { by: ADMIN, at: AT } : null,
  };
}

const closed = {
  status: 403,
  body: { error: 'The setup screen is locked.', code: 'setup-closed' },
};
const wrong = {
  status: 403,
  body: { error: 'That password is not correct. Try again.', code: 'password' },
};

export function ssoSetupAnswer(
  s: MockSsoSetup,
  path: string,
  method: string,
  body: { secret?: string; label?: string; password?: string },
  password: string,
): { status: number; body: unknown } | null {
  if (path === '/api/users/sso-setup' && method === 'GET') {
    if (s.statusAnswer) return { status: s.statusAnswer, body: { error: 'no' } };
    return { status: 200, body: statusOf(s) };
  }
  if (method !== 'GET' && s.writeRefusal) return s.writeRefusal;
  if (path === '/api/users/sso-setup' && method === 'PUT') {
    // The brain's order: off, a secret outside setup, the .env, the label's
    // pattern, then the password. A save applies all of it or none.
    if (s.mode === 'off') return closed;
    if (body.secret !== undefined && s.mode !== 'setup') return closed;
    if (body.secret !== undefined && s.envSecret) {
      return {
        status: 409,
        body: { error: 'The box .env holds the client secret.', code: 'env-wins' },
      };
    }
    if (body.label !== undefined && s.envLabel) {
      return { status: 409, body: { error: 'The box .env holds the label.', code: 'env-wins' } };
    }
    const typed = body.label === undefined ? undefined : ssoLabelValue(body.label);
    if (typed === false) return { status: 400, body: { error: SSO_LABEL_REFUSED } };
    const label = typed === undefined ? undefined : (typed ?? '');
    if (body.password !== password) return wrong;
    if (body.secret !== undefined) s.secret = body.secret;
    if (label !== undefined) s.label = label || null;
    s.saves.push({ ...(body.secret !== undefined ? { secret: true } : {}), label });
    return { status: 200, body: statusOf(s) };
  }
  if (path === '/api/users/sso-setup/test' && method === 'POST') {
    if (s.mode !== 'setup') return closed;
    s.tests += 1;
    return { status: 200, body: { outcome: s.testOutcome } };
  }
  if (path === '/api/users/sso-setup/scim-token' && method === 'POST') {
    if (s.mode !== 'setup') return closed;
    if (s.envScim) {
      return {
        status: 409,
        body: { error: 'The box .env holds the SCIM token setting.', code: 'env-wins' },
      };
    }
    if (body.password !== password) return wrong;
    s.tokensMade += 1;
    s.token = `made-scim-token-${s.tokensMade}`;
    return { status: 200, body: { token: s.token } };
  }
  return null;
}
