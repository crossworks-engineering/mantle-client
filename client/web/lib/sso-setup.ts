/**
 * The company sign-in and SCIM setup screen's model (Admin > Company
 * sign-in; docs/oidc-sign-in.md in the mantle repo). The types mirror the
 * brain's DTOs in @mantle/client-types, which reach this repo with the next
 * published contract. Pure, so it is unit-tested.
 */
export const SSO_SETUP_PATH = '/api/users/sso-setup';
export const SSO_SETUP_KEY = ['sso-setup'];
export const COMPANY_SIGN_IN_HREF = '/admin/company-sign-in';

export type SsoSetupSetter = { by: string | null; at: string };

export type SsoSetupOn = {
  mode: 'setup' | 'optional' | 'required';
  issuer: string;
  clientId: string;
  redirectUri: string;
  scimUrl: string;
  envMissing: string[];
  /** The sign-in button's label in use, and where it comes from. Absent
   *  from a brain before the label (mantle 0399). */
  label?: string;
  labelFrom?: SsoLabelFrom;
  secret: 'env' | 'row' | 'none';
  scim: 'env' | 'env-off' | 'row' | 'none';
  secretSet: SsoSetupSetter | null;
  scimSet: SsoSetupSetter | null;
};

export type SsoSetupStatus = { mode: 'off' } | SsoSetupOn;

/** PUT /api/users/sso-setup: a secret (setup only), a label (any mode but
 *  off; '' clears it), or both, with the person's own password. */
export type SsoSetupBody = { secret?: string; label?: string; password: string };

export type SsoSetupTestOutcome =
  | 'ok'
  | 'secret-refused'
  | 'unclear'
  | 'unreachable'
  | 'issuer-mismatch'
  | 'env-missing'
  | 'no-secret'
  | 'secret-unreadable';

/** The `unclear` Test: Entra with Assignment required? on Yes gives the app
 *  no token of its own, so a good secret reads so too (mantle
 *  docs/oidc-entra.md, "The Test button and Assignment required"). */
const UNCLEAR_TEXT =
  'The provider did not say the secret is wrong, but it gave no token either. With Microsoft Entra this is normal when Assignment required? is Yes on the app: then nothing is wrong, and a real sign-in is the real test. If Assignment required? is No, check the app registration.';

/** Plain words for each code the Test answers. `good`: nothing to fix here.
 *  `tone`: ok, warn (`unclear`: maybe nothing to fix, a real sign-in tells)
 *  or bad. */
export function testOutcomeText(outcome: SsoSetupTestOutcome): {
  good: boolean;
  tone: 'ok' | 'warn' | 'bad';
  text: string;
} {
  const bad = (text: string) => ({ good: false, tone: 'bad' as const, text });
  switch (outcome) {
    case 'ok':
      return {
        good: true,
        tone: 'ok',
        text: 'The provider accepted the client id and secret. This does not prove a sign-in: the redirect URI and the assignment of people show only at a real sign-in, after the lock.',
      };
    case 'secret-refused':
      return bad('The provider refused the client. Check the secret and the client id.');
    case 'unclear':
      return { good: false, tone: 'warn', text: UNCLEAR_TEXT };
    case 'unreachable':
      return bad(
        'The provider did not give a usable answer. Check the issuer and that this box can reach it.',
      );
    case 'issuer-mismatch':
      return bad(
        'The provider names another issuer. A real sign-in would fail. The issuer must be corrected in the box .env.',
      );
    case 'env-missing':
      return bad('The issuer, the client id or the public URL is not in the box .env.');
    case 'no-secret':
      return bad('No client secret is set yet. Save one first.');
    case 'secret-unreadable':
      return bad(
        'The stored secret cannot be opened. Enter it again. If this repeats, ask the box operator.',
      );
    // A code from a newer brain.
    default:
      return bad(
        'The provider answered with another error. It did not say the secret is wrong. Check the app registration.',
      );
  }
}

/** Where the client secret comes from, in plain words. */
export function secretSourceText(status: SsoSetupOn): string {
  if (status.secret === 'env') return 'From the box .env.';
  if (status.secret === 'row') return 'Set on this screen. It is sealed and never shown.';
  return 'Not set.';
}

/** Where the SCIM token comes from, in plain words. */
export function scimSourceText(status: SsoSetupOn): string {
  if (status.scim === 'env') return 'From the box .env.';
  if (status.scim === 'env-off') return 'Stopped by the box .env.';
  if (status.scim === 'row') return 'Made on this screen. Only its hash is kept.';
  return 'Not made.';
}

/** The Company sign-in entry stays in the nav only while the brain says the
 *  mode is on. The sidebar and the search palette both ask this. */
export function companySignInOffered(href: string, show: boolean): boolean {
  return show || href !== COMPANY_SIGN_IN_HREF;
}

export function withCompanySignIn<G extends { items: { href: string }[] }>(
  groups: readonly G[],
  show: boolean,
): G[] {
  if (show) return [...groups];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => companySignInOffered(i.href, show)) }))
    .filter((g) => g.items.length > 0);
}

// --- the sign-in button's label ----------------------------------------------------------

/** Where the label in use comes from: MANTLE_OIDC_LABEL in the box .env (it
 *  wins), the setup row (set on a setup screen, the box's own or a Control
 *  Center's), or neither (the default). */
export type SsoLabelFrom = 'env' | 'row' | 'none';

/* The label's rule, as @mantle/client-types src/sso-label.ts has it (mantle
 * 0399). Mirrored here until the pin carries it; then import SSO_LABEL_MAX,
 * SSO_LABEL_RE and ssoLabelValue from there and drop these. The brain checks
 * it again and is the judge. */

/** The most characters of a label. */
export const SSO_LABEL_MAX = 60;

/** The label's pattern, applied to the trimmed value. */
export const SSO_LABEL_RE = /^(?=.*[\p{L}\p{N}])[\p{L}\p{N} .,'&()+-]{1,60}$/u;

/** A label as typed: trimmed, `null` for an empty one (clear the label), or
 *  `false` when it does not fit the pattern. */
export function ssoLabelValue(raw: string): string | null | false {
  const v = raw.trim();
  if (v === '') return null;
  return SSO_LABEL_RE.test(v) ? v : false;
}

/** The field's help: what the label is, its rule, and the default. */
export const LABEL_HELP = `The word on the sign-in button: Sign in with … Up to ${SSO_LABEL_MAX} characters: letters, digits, spaces and . , - ' & ( ) +. Leave it empty for the default, Single sign-on.`;

/** A label that does not fit, in the brain's own words. */
export const LABEL_REFUSED = `The label is 1 to ${SSO_LABEL_MAX} characters: letters, digits, spaces and . , - ' & ( ) + only.`;

/** The button as people see it. */
export function signInButtonText(label: string): string {
  return `Sign in with ${label}`;
}

/** Where the label in use comes from, in plain words. */
export function labelSourceText(from: SsoLabelFrom): string {
  if (from === 'env') return 'From the box .env.';
  if (from === 'row') return 'Set on a setup screen.';
  return 'The default.';
}

/** Why the label cannot be set here now, or null when it can: the mode is
 *  off, the box .env holds it, or the box runs a release before the label. */
export function labelLockedText(status: {
  mode: 'off' | 'setup' | 'optional' | 'required';
  labelFrom?: SsoLabelFrom;
}): string | null {
  if (status.mode === 'off') return 'The label can be set once the mode is not off.';
  if (status.labelFrom === undefined)
    return 'The box runs an older release without the button label. Update it to set the label here.';
  if (status.labelFrom === 'env')
    return 'The box .env holds it (MANTLE_OIDC_LABEL), which always wins. Change it there.';
  return null;
}

/** What the field starts with: the label set on a screen, else empty (the
 *  default or the .env value shows as the placeholder). */
export function labelStart(status: { label?: string; labelFrom?: SsoLabelFrom }): string {
  return status.labelFrom === 'row' ? (status.label ?? '') : '';
}

/** What a save sends for the label as typed: the trimmed value, '' to clear
 *  it, or nothing (`send: null`) when it does not change or does not fit
 *  (`error` says why). */
export function labelChange(
  status: { label?: string; labelFrom?: SsoLabelFrom },
  typed: string,
): { send: string | null; error: string | null } {
  const v = ssoLabelValue(typed);
  if (v === false) return { send: null, error: LABEL_REFUSED };
  const next = v ?? '';
  return { send: next === labelStart(status) ? null : next, error: null };
}
