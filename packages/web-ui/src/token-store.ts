/**
 * Browser-side store for the owner's web bearer (kind-'m' token from
 * POST /api/auth/token). localStorage rather than an httpOnly cookie by
 * design: the zero-secret client Next server must never proxy or hold auth —
 * enforcement lives entirely in the server origin's 401s. XSS posture rests
 * on sanitized-HTML rendering, opaque-origin mini-app sandboxes, per-device
 * revocation + rotation, and the client app's CSP.
 *
 * The presence flag (ui-prefs, `mantle_authed`) is a UX signal ONLY. It lets
 * the boot route guard send logged-out page loads to /login before the first
 * paint. It authenticates nothing.
 *
 * Key names are contract with e2e/lib/contract.ts — the split suite seeds
 * them directly.
 *
 * This store is a VIEW over the active session in session-registry.ts: the
 * device may hold several logins, and `mantle_token` always means the active
 * one. Callers that only want "the bearer to send" never need to know that.
 */
import './desktop-shell'; // global Window.mantleDesktop declaration
import {
  activeSession,
  dropActiveCredential,
  reconcile,
  sessionToken,
  setSessionToken,
  signInSession,
  TOKEN_STORAGE_KEY,
} from './session-registry';
import { clearPref, PRESENCE_PREF, readPref, writePref } from './ui-prefs';

function canStore(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** Inside the Jackdaw desktop shell the bearer lives in the shell's OS-keychain-backed
 *  vault (safeStorage) instead of localStorage — same at-rest posture as the
 *  mobile companion's Keychain. Feature-detected; browsers get localStorage
 *  exactly as before. */
function vault() {
  return typeof window !== 'undefined' ? (window.mantleDesktop?.tokenVault ?? null) : null;
}

function setPresence(): void {
  writePref(PRESENCE_PREF, '1', 60 * 60 * 24 * 30);
}

export const tokenStore = {
  get(): string | null {
    if (!canStore()) return null;
    try {
      const v = vault();
      if (v && v.getFor) {
        // A shell with one slot per login. A pre-vault plaintext bearer still
        // moves into the vault first (its one slot), and the registry then
        // adopts that into the login it belongs to.
        const plain = window.localStorage.getItem(TOKEN_STORAGE_KEY);
        if (plain) {
          if (!activeSession() && !v.get()) v.set(plain);
          window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        }
        const active = activeSession(); // reconciles, which is what adopts
        return active ? sessionToken(active.id) : null;
      }
      if (v) {
        let token = v.get();
        if (!token) {
          // One-time migration: a pre-vault shell session left the bearer in
          // localStorage — move it into the vault and scrub the plaintext.
          token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
          if (token) {
            v.set(token);
            window.localStorage.removeItem(TOKEN_STORAGE_KEY);
          }
        }
        reconcile();
        return token;
      }
      const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
      // A bearer held from before sessions existed (or seeded by the e2e
      // suite, or rotated by an older tab) is listed here, on first sight.
      reconcile();
      return token;
    } catch {
      return null;
    }
  },
  /** A sign-in succeeded: hold the bearer as a session of its own (or refresh
   *  the row this login already has) and make it the active one. */
  signIn(login: { email: string; token: string; loginId?: string | null }): void {
    if (!canStore()) return;
    try {
      signInSession({
        email: login.email,
        token: login.token,
        ...(login.loginId !== undefined ? { loginId: login.loginId } : {}),
      });
      setPresence();
    } catch {
      /* storage unavailable (private mode etc.); the session just won't persist */
    }
  },
  /** Replace the ACTIVE session's bearer: a rotation. A sign-in goes through
   *  `signIn` below, which knows whose bearer it is. With no active session
   *  the bearer is held anyway and listed on the next read. */
  set(token: string): void {
    if (!canStore()) return;
    try {
      const active = activeSession();
      if (active) {
        setSessionToken(active.id, token);
      } else {
        const v = vault();
        if (v) {
          v.set(token);
          window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        } else {
          window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
        }
        reconcile();
      }
      setPresence();
    } catch {
      /* storage unavailable (private mode etc.) — the session just won't persist */
    }
  },
  clear(): void {
    if (!canStore()) return;
    try {
      // Forgets the active credential and nothing else: other logins held on
      // this device are not this call's to touch.
      dropActiveCredential();
      vault()?.clear();
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      clearPref(PRESENCE_PREF);
    } catch {
      /* ignore */
    }
  },
  /** Set ONLY the presence flag: the same-origin cookie-login path has no
   *  bearer to store but the boot route guard still keys off presence. */
  markPresence(): void {
    writePref(PRESENCE_PREF, '1', 60 * 60 * 24 * 365);
  },
  /** Whether the presence flag is set (a UX signal, never a credential). */
  hasPresence(): boolean {
    return readPref(PRESENCE_PREF) === '1';
  },
};
