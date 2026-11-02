/**
 * The split-topology client contract. The client app (client/web, Phase 4)
 * MUST implement these names — the split e2e project injects/reads them.
 *
 * - TOKEN_STORAGE_KEY: localStorage key holding the owner bearer
 *   (client/web/lib/token-store.ts is the implementation).
 * - PRESENCE_PREF_KEY: the localStorage key (ui-prefs) of the presence flag
 *   on the CLIENT origin, whose only job is letting the boot route guard
 *   send logged-out page loads to /login without a flash. UX, not security.
 *   It was a cookie (PRESENCE_COOKIE) until the desktop app's own URL scheme,
 *   which keeps no cookies.
 */
export const TOKEN_STORAGE_KEY = 'mantle_token';
export const PRESENCE_COOKIE = 'mantle_authed';
export const PRESENCE_PREF_KEY = `mantle_pref:${PRESENCE_COOKIE}`;
/** The stored presence flag, as ui-prefs writes it (no end time). */
export const PRESENCE_PREF_VALUE = JSON.stringify({ v: '1' });
