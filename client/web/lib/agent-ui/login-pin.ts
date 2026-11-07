/**
 * The login a window's agent acts as (fix round 7). Another tab can switch
 * the device's login at any moment, and every request reads the bearer
 * from storage as it goes, so a running turn would act as someone else.
 * The window pins the login when it claims a turn (and when a session
 * begins); before a call runs, and before a tagged write goes, it checks
 * that the login is still that one. If not, the agent's session ends and
 * nothing more is sent.
 */
import { activeSession } from '@mantle/web-ui/session-registry';
import { tokenLogin } from '@mantle/web-ui/token-claims';
import { tokenStore } from '@mantle/web-ui/token-store';

/** Who this window is signed in as now: the bearer's login, else the
 *  device's active login row, else null (signed out, or nothing to read). */
export function currentLoginKey(): string | null {
  try {
    const token = tokenStore.get();
    const login = token ? tokenLogin(token) : null;
    if (login) return `login:${login}`;
    const row = activeSession();
    return row ? `session:${row.id}` : null;
  } catch {
    return null;
  }
}

/** Whether `pinned` (a key read earlier) is no longer who is signed in. A
 *  pin of undefined is no pin. */
export function loginChangedFrom(pinned: string | null | undefined, now: string | null): boolean {
  return pinned !== undefined && pinned !== now;
}

/** A storage change that may be a login change in another tab: the
 *  bearer, the active login, the list of logins (null: storage cleared). */
export function isLoginStorageKey(key: string | null): boolean {
  return (
    key === null ||
    key.startsWith('mantle_token') ||
    key.startsWith('mantle_active_session') ||
    key === 'mantle_sessions'
  );
}
