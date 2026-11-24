/**
 * The sign-in button label's rule, for the in-memory brain only: the brain's
 * own, @mantle/client-types src/sso-label.ts. Playwright loads the mocks
 * with Node, which does not strip types under node_modules, so the package
 * (TypeScript source) can be imported for types only here. This copy is held
 * to the package by client/web/lib/sso-setup.test.ts ("the e2e mock's copy").
 */

export const MOCK_SSO_LABEL_MAX = 60;

export const MOCK_SSO_LABEL_RE =
  /^(?=.{1,60}$)(?!.*(?:͏|ᅟ|ᅠ|ㅤ|ﾠ|[᠋-᠏]|[︀-️]|[\u{E0100}-\u{E01EF}]))(?=.*[\p{L}\p{N}])(?:[\p{L}\p{N}]\p{M}{0,4}|[ .,'’&()+-])+$/u;

export const MOCK_SSO_LABEL_REFUSED = `The label is 1 to ${MOCK_SSO_LABEL_MAX} characters: letters (with their accents), digits, spaces and . , - ' ’ & ( ) + only, with at least one letter or digit.`;

/** As ssoLabelValue: the value in NFC and trimmed, `null` for an empty one,
 *  `false` when it does not fit. */
export function mockSsoLabelValue(raw: string): string | null | false {
  const v = raw.normalize('NFC').trim();
  if (v === '') return null;
  return MOCK_SSO_LABEL_RE.test(v) ? v : false;
}
