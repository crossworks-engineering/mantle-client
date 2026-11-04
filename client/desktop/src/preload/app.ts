import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload for the Mantle UI window.
 *
 * Exposes window.mantleDesktop — the small desktop API the UI's DesktopBridge
 * and NeedsYouWatcher components feature-detect: OS notifications (a click
 * can open an in-app path), a dock/taskbar badge, asking for attention (dock
 * bounce, taskbar flash), the token vault and "add a login for another brain".
 *
 * It no longer injects window.__MANTLE_ENV__. The shell serves this window's
 * /env.js itself (static-host.ts): its brain's origin AND its appearance,
 * which the page needs before the first paint. A read-only value set here
 * would make that assignment fail, so the host's file is the one source.
 */

contextBridge.exposeInMainWorld('mantleDesktop', {
  platform: process.platform,
  notify: (payload: { title: string; body?: string; path?: string }) =>
    ipcRenderer.send('desktop:notify', payload),
  setBadge: (count: number) => ipcRenderer.send('desktop:badge', count),
  // Bounce the dock (macOS) or flash the taskbar (Linux) until focused.
  attention: () => ipcRenderer.send('desktop:attention'),
  // A notification click asks the UI to open an in-app path.
  onNavigate: (cb: (path: string) => void) => {
    const handler = (_event: unknown, path: unknown) => {
      if (typeof path === 'string') cb(path);
    };
    ipcRenderer.on('desktop:navigate', handler);
    return () => {
      ipcRenderer.removeListener('desktop:navigate', handler);
    };
  },
  // OS-keychain-backed bearer storage (packages/web-ui token-store detects
  // this and stops using localStorage). get() is a sync round-trip to main —
  // sub-millisecond, and always fresh across windows.
  tokenVault: {
    get: (): string | null => {
      const value = ipcRenderer.sendSync('vault:get') as unknown;
      return typeof value === 'string' ? value : null;
    },
    set: (token: string) => ipcRenderer.send('vault:set', token),
    clear: () => ipcRenderer.send('vault:clear'),
    // One bearer per LOGIN held for this window's brain (session-registry.ts).
    // Their presence is what tells the UI this shell can hold several; the
    // unscoped three above are the one slot earlier builds wrote, kept so the
    // first run after an update has something to adopt from.
    getFor: (sessionId: string): string | null => {
      const value = ipcRenderer.sendSync('vault:getFor', sessionId) as unknown;
      return typeof value === 'string' ? value : null;
    },
    setFor: (sessionId: string, token: string) =>
      ipcRenderer.send('vault:setFor', sessionId, token),
    clearFor: (sessionId: string) => ipcRenderer.send('vault:clearFor', sessionId),
    /** Move the one-slot bearer to a login that has none, and return it. */
    adopt: (sessionId: string): string | null => {
      const value = ipcRenderer.sendSync('vault:adopt', sessionId) as unknown;
      return typeof value === 'string' ? value : null;
    },
    /** Drop this brain's login slots except these sessions', where they hold
     *  one of these bearers (leftover copies). */
    keepOnly: (sessionIds: string[], strayBearers: string[]) =>
      ipcRenderer.send('vault:keepOnly', sessionIds, strayBearers),
  },
  // "Add login" for ANOTHER brain: the shell checks the address, saves the
  // brain and opens its own window on its sign-in screen. Only an address and
  // an email cross; a password never does.
  brains: {
    openForLogin: (url: string, email?: string) =>
      ipcRenderer.invoke('brains:openForLogin', url, email),
    takeLoginHint: () => ipcRenderer.invoke('brains:takeLoginHint'),
  },
  // Company sign-in runs in the system browser and comes back as mantle://oidc,
  // which the shell loads on this window's /auth/oidc.
  oidc: {
    open: (url: string): Promise<boolean> => ipcRenderer.invoke('oidc:open', url),
  },
});
