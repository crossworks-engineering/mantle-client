import { clearPref, readPref, writePref } from '@mantle/web-ui/ui-prefs';

/**
 * Whether a login on this browser uses company sign-in: the sign-in screen
 * then shows that button first. A hint about the screen's order, and nothing
 * more: the page's origin keeps it, and it authenticates nothing.
 */
const PREF = 'mantle_oidc_linked';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export function browserUsesCompanySignIn(): boolean {
  return readPref(PREF) === '1';
}

export function rememberCompanySignIn(): void {
  writePref(PREF, '1', ONE_YEAR_SECONDS);
}

export function forgetCompanySignIn(): void {
  clearPref(PREF);
}
