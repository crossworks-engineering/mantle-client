import { describe, expect, it } from 'vitest';
import {
  COMPANY_SIGN_IN_HREF,
  LABEL_HELP,
  SSO_LABEL_REFUSED,
  TEST_TONE_CLASS,
  UNCLEAR_SAID,
  labelChange,
  labelLockedText,
  labelSourceText,
  labelStart,
  signInButtonText,
  SSO_LABEL_MAX,
  ssoLabelValue,
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

  it('names the Entra case on unclear, and marks it a warning, not a failure', () => {
    const { tone, text } = testOutcomeText('unclear');
    expect(tone).toBe('warn');
    expect(text.startsWith(UNCLEAR_SAID)).toBe(true);
    expect(TEST_TONE_CLASS).toEqual({
      ok: '',
      warn: 'text-warning-ink',
      bad: 'text-destructive-ink',
    });
    expect(text).toContain('With Microsoft Entra this is normal when Assignment required? is Yes');
    expect(text).toContain('a real sign-in is the real test');
    for (const o of OUTCOMES) {
      expect(testOutcomeText(o).tone).toBe(o === 'ok' ? 'ok' : o === 'unclear' ? 'warn' : 'bad');
    }
    expect(testOutcomeText('a-new-code' as SsoSetupTestOutcome).tone).toBe('bad');
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

describe('the sign-in button label', () => {
  it("holds the pattern: 1 to 60 characters, letters, digits, spaces and . , - ' & ( ) +", () => {
    expect(ssoLabelValue('  Contoso Ltd.  ')).toBe('Contoso Ltd.');
    expect(ssoLabelValue("O'Brien & Sons (SA) + Co, Pty-Ltd")).toBe(
      "O'Brien & Sons (SA) + Co, Pty-Ltd",
    );
    expect(ssoLabelValue('Ünïcödé 日本')).toBe('Ünïcödé 日本');
    expect(ssoLabelValue('x'.repeat(SSO_LABEL_MAX))).toBe('x'.repeat(SSO_LABEL_MAX));
    expect(ssoLabelValue('x'.repeat(SSO_LABEL_MAX + 1))).toBe(false);
    expect(ssoLabelValue('   ')).toBeNull();
    expect(ssoLabelValue('')).toBeNull();
    // The new rule (a583fd267): NFC, combining marks after a letter or digit,
    // and the curly apostrophe.
    expect(ssoLabelValue('हिन्दी')).toBe('हिन्दी');
    expect(ssoLabelValue('தமிழ்')).toBe('தமிழ்');
    expect(ssoLabelValue('عَرَبِيّ')).toBe('عَرَبِيّ');
    expect(ssoLabelValue('Tiếng Việt')).toBe('Tiếng Việt');
    expect(ssoLabelValue('Cafe\u0301')).toBe('Caf\u00e9');
    expect(ssoLabelValue('O’Neil')).toBe('O’Neil');
    for (const bad of [
      '--',
      '<b>x</b>',
      'a\nb',
      'a/b',
      'a@b',
      'a:b',
      '...',
      '\u0301a',
      'a\u200bb',
      'a\u00a0b',
      'Sign 🙂',
    ]) {
      expect(ssoLabelValue(bad)).toBe(false);
    }
    // 87084099e: what shows nothing is refused, and at most 4 marks on one
    // letter or digit.
    for (const blank of [
      'a\u034Fb',
      'a\uFE0Fb',
      'a\uFE00b',
      'a\u{E0100}b',
      'a\u180Bb',
      'a\u115Fb',
      'a\u1160b',
      'a\u3164b',
      'a\uFFA0b',
    ]) {
      expect(ssoLabelValue(blank)).toBe(false);
    }
    expect(ssoLabelValue('ภาษาไทย')).toBe('ภาษาไทย');
    expect(ssoLabelValue('עִבְרִית')).toBe('עִבְרִית');
    expect(ssoLabelValue('x\u0300\u0301\u0302\u0303')).not.toBe(false);
    expect(ssoLabelValue('x\u0300\u0301\u0302\u0303\u0304')).toBe(false);
  });

  it('sends a change only, clears with an empty field, and refuses what does not fit', () => {
    const row = { label: 'Contoso', labelFrom: 'row' as const };
    const none = { label: 'Single sign-on', labelFrom: 'none' as const };
    expect(labelStart(row)).toBe('Contoso');
    expect(labelStart(none)).toBe('');
    expect(labelStart({ label: 'From env', labelFrom: 'env' })).toBe('');
    expect(labelChange(row, ' Contoso ')).toEqual({ send: null, warn: null });
    expect(labelChange(row, 'Contoso Ltd')).toEqual({ send: 'Contoso Ltd', warn: null });
    expect(labelChange(row, '  ')).toEqual({ send: '', warn: null });
    expect(labelChange(none, '')).toEqual({ send: null, warn: null });
    expect(labelChange(none, 'Contoso')).toEqual({ send: 'Contoso', warn: null });
    expect(labelChange(none, 'Cafe\u0301')).toEqual({ send: 'Caf\u00e9', warn: null });
    // A value that does not fit is still sent: the brain judges. The form warns.
    expect(labelChange(none, ' <Contoso> ')).toEqual({
      send: '<Contoso>',
      warn: SSO_LABEL_REFUSED,
    });
  });

  it('says where the label comes from, and why it cannot be set here', () => {
    expect(labelSourceText('env')).toContain('.env');
    expect(labelSourceText('row')).toContain('setup screen');
    expect(labelSourceText('none')).toBe('The default.');
    expect(signInButtonText('Contoso')).toBe('Sign in with Contoso');
    expect(labelLockedText({ mode: 'off', labelFrom: 'none' })).toContain('not off');
    expect(labelLockedText({ mode: 'optional' })).toContain('older release');
    expect(labelLockedText({ mode: 'required', labelFrom: 'env' })).toContain('MANTLE_OIDC_LABEL');
    expect(labelLockedText({ mode: 'required', labelFrom: 'row' })).toBeNull();
    expect(LABEL_HELP).toContain('Single sign-on');
    expect(SSO_LABEL_REFUSED).toBe(
      "The label is 1 to 60 characters: letters (with their accents), digits, spaces and . , - ' ’ & ( ) + only, with at least one letter or digit.",
    );
    expect(LABEL_HELP).toContain("' ’ &");
  });
});
