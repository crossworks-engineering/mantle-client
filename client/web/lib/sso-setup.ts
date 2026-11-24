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
  secret: 'env' | 'row' | 'none';
  scim: 'env' | 'env-off' | 'row' | 'none';
  secretSet: SsoSetupSetter | null;
  scimSet: SsoSetupSetter | null;
};

export type SsoSetupStatus = { mode: 'off' } | SsoSetupOn;

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
