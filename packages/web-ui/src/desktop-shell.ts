/**
 * The Jackdaw desktop shell's injected API — `window.mantleDesktop`, exposed
 * by the shell's preload (client/desktop). Feature-detect via
 * `desktopShell()`: a browser returns null and every caller falls back to
 * plain web behavior. This module is the single owner of the global
 * declaration so client code and the shell agree on one shape.
 */
export type DesktopShellApi = {
  platform: string;
  /** A native notification. `path` (an in-app path, newer shells) is opened
   *  in this window when the notification is clicked. */
  notify(payload: { title: string; body?: string; path?: string }): void;
  setBadge(count: number): void;
  /** Ask for attention until the window is focused: the dock bounces
   *  (macOS, critical) or the taskbar flashes (Linux). Optional: older shells
   *  predate it. */
  attention?(): void;
  /** Register the in-app navigation a notification click asks for; returns
   *  the unsubscribe. Optional: older shells predate it. */
  onNavigate?(cb: (path: string) => void): () => void;
  /** The OS-keychain vault of a desktop shell, answered synchronously
   *  (Electron safeStorage via sendSync; the Tauri shell via a synchronous
   *  request to its own scheme). The shell keeps exactly one page per brain,
   *  each with its own storage area. Optional: older shells predate it, and
   *  callers must fall back to localStorage. */
  tokenVault?: {
    get(): string | null;
    set(token: string): void;
    clear(): void;
    /** One bearer per login. Optional as a group: an older shell without
     *  them holds one login per brain window. */
    getFor?(sessionId: string): string | null;
    setFor?(sessionId: string, token: string): void;
    clearFor?(sessionId: string): void;
    /** Move the one-slot bearer to a login that has none yet; returns it. */
    adopt?(sessionId: string): string | null;
    /** Drop this brain's per-login slots except these sessions', and only
     *  slots holding one of `strayBearers` (copies). Newer shells only. */
    keepOnly?(sessionIds: string[], strayBearers: string[]): void;
  };
  /** Other brains, from inside a brain window (newer shells only). The
   *  shell opens the named brain in ITS OWN window on its sign-in screen; the
   *  page hands over an address and an email, never a password. */
  brains?: {
    openForLogin(
      url: string,
      email?: string,
    ): Promise<
      | { ok: true; same: true }
      | { ok: true; same: false; name: string }
      | { ok: false; error: string }
    >;
    /** The email to prefill, once, when this window was opened by the above. */
    takeLoginHint(): Promise<{ email: string } | null>;
  };
  /** Company sign-in (newer shells only): open a sign-in on this window's brain
   *  in the system browser. The flow comes back as `mantle://oidc`, and the
   *  shell loads it on this window's /auth/oidc. False: not opened (the shell
   *  takes only this brain's sign-in start). */
  oidc?: {
    open(url: string): Promise<boolean>;
  };
};

declare global {
  interface Window {
    mantleDesktop?: DesktopShellApi;
  }
}

export function desktopShell(): DesktopShellApi | null {
  return typeof window === 'undefined' ? null : (window.mantleDesktop ?? null);
}
