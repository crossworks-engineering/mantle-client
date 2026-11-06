import { describe, expect, it } from 'vitest';
import {
  COMPANY_SIGN_IN_HREF,
  scimSourceText,
  secretSourceText,
  testOutcomeText,
  withCompanySignIn,
  type SsoSetupOn,
  type SsoSetupTestOutcome,
} from './sso-setup';

const on = (over: Partial<SsoSetupOn>): SsoSetupOn => ({
  mode: 'setup',
  issuer: 'https://idp.example.invalid',
  clientId: 'mantle',
  redirectUri: 'https://brain.example.invalid/api/auth/oidc/callback',
  scimUrl: 'https://brain.example.invalid/scim/v2',
  envMissing: [],
  secret: 'none',
  scim: 'none',
  secretSet: null,
  scimSet: null,
  ...over,
});

describe('testOutcomeText', () => {
  const OUTCOMES: SsoSetupTestOutcome[] = [
    'ok',
    'secret-refused',
    'unclear',
    'unreachable',
    'issuer-mismatch',
    'env-missing',
    'no-secret',
    'secret-unreadable',
  ];

  it('has plain words for each code, and only ok is good', () => {
    for (const o of OUTCOMES) {
      const { good, text } = testOutcomeText(o);
      expect(text.length).toBeGreaterThan(10);
      expect(good).toBe(o === 'ok');
    }
  });

  it('a code from a newer brain still answers, and is not good', () => {
    const { good, text } = testOutcomeText('a-new-code' as SsoSetupTestOutcome);
    expect(good).toBe(false);
    expect(text.length).toBeGreaterThan(10);
  });

  it('says a pass does not prove a sign-in', () => {
    expect(testOutcomeText('ok').text).toContain('does not prove a sign-in');
  });

  it('says the secret is not called wrong when the provider did not say so', () => {
    expect(testOutcomeText('unclear').text).toContain('did not say the secret is wrong');
  });
});

describe('the sources', () => {
  it('name each place a secret can come from', () => {
    expect(secretSourceText(on({ secret: 'env' }))).toContain('.env');
    expect(secretSourceText(on({ secret: 'row' }))).toContain('never shown');
    expect(secretSourceText(on({ secret: 'none' }))).toBe('Not set.');
  });

  it('name each place a token can come from', () => {
    expect(scimSourceText(on({ scim: 'env' }))).toContain('.env');
    expect(scimSourceText(on({ scim: 'env-off' }))).toContain('Stopped');
    expect(scimSourceText(on({ scim: 'row' }))).toContain('hash');
    expect(scimSourceText(on({ scim: 'none' }))).toBe('Not made.');
  });
});

describe('withCompanySignIn', () => {
  const groups = [
    { label: 'Settings', items: [{ href: '/settings/users' }, { href: COMPANY_SIGN_IN_HREF }] },
    { label: 'Solo', items: [{ href: COMPANY_SIGN_IN_HREF }] },
  ];

  it('keeps the entry while the mode is on', () => {
    expect(withCompanySignIn(groups, true)).toEqual(groups);
  });

  it('drops the entry, and a group it leaves empty, while the mode is off', () => {
    expect(withCompanySignIn(groups, false)).toEqual([
      { label: 'Settings', items: [{ href: '/settings/users' }] },
    ]);
  });
});
