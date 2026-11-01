import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  safeStorage,
  session,
  shell,
  Tray,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { attentionMode, safeInAppPath } from './attention';
import {
  brainRequestFilter,
  frameNavigationAllowed,
  permissionAllowed,
  stripBrowserOnlyHeaders,
} from './brain-fence';
import {
  appearanceCache,
  createStaticHost,
  originOf,
  UI_HOST,
  UI_ORIGIN,
} from '@mantle/client-host/static-host';
import { createVault, type Vault } from './vault';

/**
 * Jackdaw desktop — shell around the owner UI.
 *
 * The UI is the static export of client/web, staged into ui/ by
 * scripts/build-ui.sh and served to each brain window by the shell itself, on
 * its own host, `http://mantle-ui.localhost` (static-host.ts, serveUi): no
 * server, no port, no second process. MANTLE_DESKTOP_RENDERER_URL overrides it for dev against a
 * client/web dev server, whose /env.js names ONE brain (MANTLE_SERVER_ORIGIN).
 * The shell is a NATIVE client in the same trust stance as the mobile
 * companion: the credential is the bearer token the login page mints; CORS is
 * a browser concern the shell fences inside its own network layer (see
 * fenceBrainSession), scoped strictly to the user-configured brain.
 */

type Profile = {
  id: string;
  origin: string;
  name: string;
  version?: string;
  lastUsedAt?: number;
};

// ── Small JSON stores under userData (config, never secrets — tokens live in
//    each profile's session partition, exactly like the browser) ─────────────

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

const profilesPath = () => join(app.getPath('userData'), 'profiles.json');
const loadProfiles = () => {
  const parsed = readJson<Profile[]>(profilesPath(), []);
  return Array.isArray(parsed) ? parsed : [];
};
const saveProfiles = (profiles: Profile[]) => writeJson(profilesPath(), profiles);

// ── Token vault ──────────────────────────────────────────────────────────────
//
// The bearers at rest live in ./vault (encrypted with safeStorage, one file per
// login held for a brain). What stays HERE is who may ask: only registered
// app-window webContents may use the IPC, each mapped to its own profile, so a
// window can reach the logins of its own brain and no other.

let vaultInstance: Vault | null = null;
/** Built on first use, not at import: `userData` is only final once the app is
 *  ready, and every caller is an IPC handler registered after that. */
function vault(): Vault {
  vaultInstance ??= createVault(app.getPath('userData'), safeStorage);
  return vaultInstance;
}

// webContents id → the profile the window was opened for, and the renderer
// origin it is allowed to be showing. Both are checked before the vault
// answers: the sender id says WHICH window asked, the frame origin says the
// window is still showing OUR UI and not something a navigation swapped in.
const windowProfiles = new Map<number, { profileId: string; origin: string }>();

function vaultProfileFor(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): string | null {
  const entry = windowProfiles.get(event.sender.id);
  const frame = event.senderFrame;
  if (!entry || !frame) return null;
  return originOf(frame.url) === entry.origin ? entry.profileId : null;
}

// ── Profile helpers ──────────────────────────────────────────────────────────

/** URL → origin. Unlike the mobile app, a bare host gets https:// prefixed. */
function normalizeOrigin(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('empty URL');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`unsupported protocol ${url.protocol}`);
  }
  return url.origin;
}

/** Probe-before-save, the mobile pattern: GET /api/version, require a version
 *  string. net.fetch runs in the main process — native HTTP, no CORS. */
async function probeBrain(origin: string): Promise<string> {
  const res = await net.fetch(`${origin}/api/version`, {
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { version?: unknown } | null;
  if (!body || typeof body.version !== 'string') throw new Error('not a MantleOS server');
  return body.version;
}

// ── The static UI ────────────────────────────────────────────────────────────

// The staged static export. Plain files read by the main process, so it can
// stay inside app.asar; an unpacked copy from an older build still wins.
const UI_DIR = (() => {
  const plain = join(__dirname, '../../ui');
  const unpacked = plain.replace('app.asar', 'app.asar.unpacked');
  return unpacked !== plain && existsSync(unpacked) ? unpacked : plain;
})();

const ICON_PATH = join(__dirname, '../../resources/icon.png').replace(
  'app.asar',
  'app.asar.unpacked',
);

/** The brain's public appearance for each window's /env.js. net.fetch runs in
 *  the main process: native HTTP, no CORS. */
const brainAppearance = appearanceCache(async (url, signal) => {
  const res = await net.fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
});

/** The URL a brain window loads: the dev override, or the shell's own scheme. */
function rendererUrlFor(): string {
  const override = process.env.MANTLE_DESKTOP_RENDERER_URL;
  if (override) return override;
  if (!existsSync(join(UI_DIR, '_mantle/routes.json'))) {
    throw new Error(
      'Embedded UI not found. Build it with:  pnpm -C client/desktop build:ui\n' +
        '(or point MANTLE_DESKTOP_RENDERER_URL at a client/web dev server)',
    );
  }
  return `${UI_ORIGIN}/`;
}

/** Serve the UI to one brain's session. The partition IS the brain, so the
 *  handler is made once per session and names that brain for good: its
 *  /env.js, its CSP.
 *
 *  It intercepts http for the session, not a custom scheme: Chromium gives a
 *  custom scheme no cookies, and the UI's login gate and layout live in
 *  cookies. Only UI_HOST is answered here, so it never touches the network;
 *  any other http request (a brain on plain http in dev) goes out unchanged. */
function serveUi(ses: Electron.Session, brainOrigin: string): void {
  if (ses.protocol.isProtocolHandled('http')) return;
  const host = createStaticHost({
    uiDir: UI_DIR,
    brainOrigin,
    appearance: () => brainAppearance(brainOrigin),
  });
  ses.protocol.handle('http', (request) =>
    new URL(request.url).host === UI_HOST
      ? host(request)
      : ses.fetch(request, { bypassCustomProtocolHandlers: true }),
  );
}

// ── Native-parity CORS fencing ────────────────────────────────────────────────
//
// The server's gate never rejects by Origin — it only decides whether to emit
// ACAO headers, and skips CORS entirely for requests with no Origin header
// (server/web/server/middleware/gate.ts). Native clients (the mobile app,
// curl) therefore need no CORS setup. Electron is native too; only the
// embedded Chromium enforces CORS on itself. So, for the configured brain
// origin ONLY: declare ourselves native (drop Origin and Sec-Fetch-* on the
// way out, see brain-fence.ts) and satisfy the renderer's own check (supply
// ACAO on the way in). Nothing about the server's browser-facing posture
// changes; a real browser tab can't do this.

function fenceBrainSession(
  ses: Electron.Session,
  brainOrigin: string,
  rendererOrigin: string,
): void {
  const brainUrls = brainRequestFilter(brainOrigin);
  ses.webRequest.onBeforeSendHeaders(brainUrls, ({ requestHeaders }, callback) => {
    callback({ requestHeaders: stripBrowserOnlyHeaders(requestHeaders) });
  });

  ses.webRequest.onHeadersReceived(brainUrls, ({ responseHeaders = {} }, callback) => {
    for (const key of Object.keys(responseHeaders)) {
      if (key.toLowerCase().startsWith('access-control-')) delete responseHeaders[key];
    }
    responseHeaders['Access-Control-Allow-Origin'] = ['*'];
    responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PATCH, PUT, DELETE, OPTIONS'];
    // Last-Event-ID rides SSE resume; Idempotency-Key rides turn POST retries.
    responseHeaders['Access-Control-Allow-Headers'] = [
      'Authorization, Content-Type, Idempotency-Key, Last-Event-ID',
    ];
    responseHeaders['Access-Control-Expose-Headers'] = ['*'];
    callback({ responseHeaders });
  });

  // The microphone, for a call (calls P1): audio only, for the app's own
  // page; every other permission keeps the answer it had before a handler
  // was set (granted). Both halves, as Electron asks: the check (the
  // page's query) and the request (the prompt).
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permissionAllowed(permission, details, rendererOrigin));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) =>
    permissionAllowed(
      permission,
      {
        requestingUrl: details.requestingUrl ?? requestingOrigin,
        isMainFrame: details.isMainFrame,
        // A check names one kind, or none (the page asked about media as
        // a whole): audio is what a call wants.
        mediaTypes: details.mediaType ? [details.mediaType] : ['audio'],
      },
      rendererOrigin,
    ),
  );
}

// ── Windows ───────────────────────────────────────────────────────────────────

let connectWindow: BrowserWindow | null = null;
/** Most recent app window + the URL it serves — deep links and notification
 *  clicks land here. */
let appWindow: BrowserWindow | null = null;
let appRendererUrl: string | null = null;
/** One window per brain. Its partition is the brain's own, so a second window
 *  on the same brain would be a second view of the same cookies and the same
 *  logins, able to switch login under the first one's feet. */
const profileWindows = new Map<string, BrowserWindow>();
/** The renderer URL each brain window serves, to build in-app URLs for it. */
const profileRendererUrls = new Map<string, string>();

function reveal(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Go to a brain: its window if it has one, a new one if not. `path` lands
 *  it on a particular in-app screen, whether the window is new or already up. */
async function openBrain(profileId: string, path?: string): Promise<void> {
  const profiles = loadProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return openConnectWindow();
  profile.lastUsedAt = Date.now();
  saveProfiles(profiles);
  const open = profileWindows.get(profile.id);
  if (open && !open.isDestroyed()) {
    reveal(open);
    const rendererUrl = profileRendererUrls.get(profile.id);
    const target = path && rendererUrl ? inAppUrl(path, rendererUrl) : null;
    if (target) void open.loadURL(target);
  } else {
    await openAppWindow(profile, path);
  }
  refreshBrainMenus();
}

function focusOrOpen(): void {
  if (appWindow && !appWindow.isDestroyed()) {
    reveal(appWindow);
    return;
  }
  const lastUsed = loadProfiles()
    .filter((p) => p.lastUsedAt)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0];
  if (lastUsed) openAppWindow(lastUsed).catch(reportWindowError);
  else openConnectWindow();
}

// ── Deep links (mantle://) ────────────────────────────────────────────────────
//
// mantle://n/<id> (the canonical type-agnostic permalink responders embed)
// maps to the in-app /n/<id> route; any mantle://<path> maps the same way.
// The link names no brain — it lands in the current (or last-used) one.

let pendingDeepLinkPath: string | null = null;

function deepLinkToPath(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'mantle:') return null;
    const path = `/${url.host}${url.pathname}${url.search}`.replace(/\/+$/, '') || '/';
    // A PATH, and only a path. `mantle:///evil.example` parses with an EMPTY
    // host, which made this `//evil.example` — a scheme-relative URL that
    // `new URL(path, rendererUrl)` resolves to another origin, and loadURL
    // would then put that origin in the window whose preload exposes the
    // token vault (will-navigate does not fire for programmatic loads).
    // Chromium reads `/\` the same way as `//`, so both are rejected.
    return /^\/(?![/\\])/.test(path) ? path : null;
  } catch {
    return null;
  }
}

// The one place an in-app path becomes a URL for loadURL: whatever the path
// looked like, the result must sit on the renderer's own origin, or it is not
// loaded at all. Belt to deepLinkToPath's braces.
function inAppUrl(path: string, rendererUrl: string): string | null {
  try {
    const target = new URL(path, rendererUrl);
    return originOf(target.toString()) === originOf(rendererUrl) ? target.toString() : null;
  } catch {
    return null;
  }
}

function handleDeepLink(link: string): void {
  const path = deepLinkToPath(link);
  if (!path) return;
  if (appWindow && !appWindow.isDestroyed() && appRendererUrl) {
    appWindow.show();
    appWindow.focus();
    const target = inAppUrl(path, appRendererUrl);
    if (target) void appWindow.loadURL(target);
  } else {
    pendingDeepLinkPath = path;
    focusOrOpen();
  }
}

const deepLinkInArgv = (argv: string[]) => argv.find((a) => a.startsWith('mantle://'));

function openConnectWindow(): void {
  if (connectWindow && !connectWindow.isDestroyed()) {
    connectWindow.focus();
    return;
  }
  connectWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/connect.js'),
      sandbox: true,
    },
  });
  connectWindow.setMenuBarVisibility(false);
  if (process.env.ELECTRON_RENDERER_URL) {
    void connectWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void connectWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

async function openAppWindow(profile: Profile, path?: string): Promise<void> {
  const rendererUrl = rendererUrlFor();
  const rendererOrigin = originOf(rendererUrl) ?? UI_ORIGIN;
  const partition = `persist:brain-${profile.id}`;
  const ses = session.fromPartition(partition);
  fenceBrainSession(ses, profile.origin, rendererOrigin);
  if (rendererOrigin === UI_ORIGIN) serveUi(ses, profile.origin);

  // NO `title` here, deliberately. The window title follows the loaded page's
  // <title>, which the web app now sets from the brain's own name (site name,
  // else peer name, else Jackdaw — client/web/lib/brand.ts). That is what makes
  // two brains open side by side tellable apart in the window list, and it is
  // the same answer the browser tab gives.
  //
  // Electron's own contract, both halves of it: the `title` option is "ignored"
  // once the loaded document defines <title>, and `page-title-updated` keeps the
  // native title in step unless a listener calls preventDefault(). So hardcoding
  // a title here would either do nothing or, worse, freeze every window on one
  // string. If a default is ever needed for the moment before the page loads,
  // that is what it would be for — not an identity.
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    webPreferences: {
      partition,
      preload: join(__dirname, '../preload/app.js'),
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());

  // Chromium batch-flushes cookies; an abrupt exit can lose the presence
  // cookie while localStorage (the token) survives. Flush on close so a
  // normal quit never relies on the batch timer.
  win.on('close', () => {
    void session.fromPartition(partition).cookies.flushStore();
  });

  // A page holding unsaved edits (the Recall card editor) cancels
  // `beforeunload`. A browser asks the reader then; Electron asks nobody and
  // simply refuses to close or reload the window. Ask here instead.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      message: 'Leave with unsaved changes?',
      detail: 'This page has edits that are not saved. Leaving throws them away.',
    });
    // preventDefault here overrides the page's refusal, so the unload goes on.
    if (choice === 0) event.preventDefault();
  });

  // Everything that isn't the app UI opens in the system browser — share
  // links and doc links target the brain origin by design.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (originOf(url) !== rendererOrigin) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  // A sandboxed app or canvas frame may navigate itself; this refuses it
  // before the request leaves, unless it goes to another such frame on the
  // brain (frameNavigationAllowed).
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    const from = event.frame?.url ?? '';
    if (!frameNavigationAllowed(from, event.url, profile.origin)) event.preventDefault();
  });

  win.webContents.on('did-fail-load', (_event, _code, description, _url, isMainFrame) => {
    if (!isMainFrame) return;
    dialog.showErrorBox('MantleOS Desktop', `Could not load the owner UI (${description}).`);
    openConnectWindow();
    win.close();
  });

  appWindow = win;
  appRendererUrl = rendererUrl;
  profileWindows.set(profile.id, win);
  profileRendererUrls.set(profile.id, rendererUrl);
  // With several brains open, "the current one" is the one last looked at:
  // that is where a deep link or a notification click should land.
  win.on('focus', () => {
    if (appWindow === win) return;
    appWindow = win;
    appRendererUrl = rendererUrl;
    refreshBrainMenus(); // the mark on the brain in front
  });
  const webContentsId = win.webContents.id;
  windowProfiles.set(webContentsId, { profileId: profile.id, origin: rendererOrigin });
  win.on('closed', () => {
    windowProfiles.delete(webContentsId);
    if (profileWindows.get(profile.id) === win) {
      profileWindows.delete(profile.id);
      profileRendererUrls.delete(profile.id);
    }
    if (appWindow === win) {
      appWindow = null;
      appRendererUrl = null;
    }
  });

  const initialPath = path ?? pendingDeepLinkPath ?? '/';
  pendingDeepLinkPath = null;
  void win.loadURL(inAppUrl(initialPath, rendererUrl) ?? new URL('/', rendererUrl).toString());
}

function reportWindowError(error: unknown): void {
  dialog.showErrorBox('MantleOS Desktop', error instanceof Error ? error.message : String(error));
  openConnectWindow();
}

// ── IPC (the connect screen's whole API) ──────────────────────────────────────

type AddResult = { ok: true; profile: Profile } | { ok: false; error: string };
type OpenForLoginResult =
  { ok: true; same: true } | { ok: true; same: false; name: string } | { ok: false; error: string };

/** profile id → the email to prefill on that brain's sign-in screen, once. */
const loginHints = new Map<string, string>();

/** Probe-before-save. A brain already in the list is refreshed, not doubled. */
async function addBrain(rawUrl: string): Promise<AddResult> {
  let origin: string;
  try {
    origin = normalizeOrigin(String(rawUrl));
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }
  try {
    const version = await probeBrain(origin);
    const profiles = loadProfiles();
    const existing = profiles.find((p) => p.origin === origin);
    if (existing) {
      existing.version = version;
      saveProfiles(profiles);
      return { ok: true, profile: existing };
    }
    const profile: Profile = {
      id: randomUUID(),
      origin,
      name: new URL(origin).hostname,
      version,
    };
    saveProfiles([...profiles, profile]);
    refreshBrainMenus();
    return { ok: true, profile };
  } catch {
    return { ok: false, error: `Couldn't reach a MantleOS server at ${origin}.` };
  }
}

function registerIpc(): void {
  ipcMain.handle('shell:info', () => ({ version: app.getVersion() }));

  // Fired by the UI's DesktopBridge and NeedsYouWatcher — only while its
  // window is not in front, so a notification is a "come back" signal. A
  // `path` (an in-app path) opens in the window that sent it on click.
  ipcMain.on(
    'desktop:notify',
    (event, payload: { title?: unknown; body?: unknown; path?: unknown }) => {
      const title = typeof payload?.title === 'string' ? payload.title.slice(0, 120) : 'MantleOS';
      const body = typeof payload?.body === 'string' ? payload.body.slice(0, 300) : undefined;
      const path = safeInAppPath(payload?.path);
      const sender = BrowserWindow.fromWebContents(event.sender);
      const notification = new Notification({ title, body, icon: ICON_PATH });
      notification.on('click', () => {
        if (!sender || sender.isDestroyed()) return focusOrOpen();
        if (sender.isMinimized()) sender.restore();
        sender.show();
        sender.focus();
        if (path) sender.webContents.send('desktop:navigate', path);
      });
      notification.show();
    },
  );

  // "Needs you" (NeedsYouWatcher): ask for attention until the window that
  // asked is focused. macOS: a critical dock bounce (it bounces until the app
  // is activated). Linux: the taskbar entry flashes until focused.
  ipcMain.on('desktop:attention', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const mode = attentionMode(process.platform, win.isFocused());
    if (mode === 'bounce') {
      const id = app.dock?.bounce('critical');
      if (id !== undefined) win.once('focus', () => app.dock?.cancelBounce(id));
    } else if (mode === 'flash') {
      win.flashFrame(true);
      win.once('focus', () => win.flashFrame(false));
    }
  });

  ipcMain.on('desktop:badge', (_event, count: unknown) => {
    if (typeof count === 'number' && Number.isFinite(count)) {
      app.setBadgeCount(Math.max(0, Math.floor(count)));
    }
  });

  // The one slot every earlier build used. Still answered: it is what a login
  // is adopted FROM on the first run after the update.
  ipcMain.on('vault:get', (event) => {
    const profileId = vaultProfileFor(event);
    event.returnValue = profileId ? vault().read(profileId) : null;
  });
  ipcMain.on('vault:set', (event, token: unknown) => {
    const profileId = vaultProfileFor(event);
    if (profileId && typeof token === 'string' && token.length > 0) {
      vault().write(profileId, token);
    }
  });
  ipcMain.on('vault:clear', (event) => {
    const profileId = vaultProfileFor(event);
    if (profileId) vault().clear(profileId);
  });

  // One bearer per login held for this window's brain. The session id is the
  // page's; ./vault validates it before it is anywhere near a path.
  ipcMain.on('vault:getFor', (event, sessionId: unknown) => {
    const profileId = vaultProfileFor(event);
    event.returnValue = profileId ? vault().readFor(profileId, sessionId) : null;
  });
  ipcMain.on('vault:setFor', (event, sessionId: unknown, token: unknown) => {
    const profileId = vaultProfileFor(event);
    if (profileId) vault().writeFor(profileId, sessionId, token);
  });
  ipcMain.on('vault:clearFor', (event, sessionId: unknown) => {
    const profileId = vaultProfileFor(event);
    if (profileId) vault().clearFor(profileId, sessionId);
  });
  ipcMain.on('vault:adopt', (event, sessionId: unknown) => {
    const profileId = vaultProfileFor(event);
    event.returnValue = profileId ? vault().adopt(profileId, sessionId) : null;
  });
  ipcMain.on('vault:keepOnly', (event, sessionIds: unknown, strayBearers: unknown) => {
    const profileId = vaultProfileFor(event);
    if (profileId) vault().keepOnly(profileId, sessionIds, strayBearers);
  });

  ipcMain.handle('profiles:list', () => loadProfiles());

  ipcMain.handle('profiles:add', (_event, rawUrl: string) => addBrain(rawUrl));

  // "Add login" inside a brain window, naming ANOTHER brain. The page hands
  // over an address and, as a courtesy, the email typed so far; never a
  // password. The brain is checked and saved exactly as the connect screen
  // does it, and its own window opens on its sign-in screen: a credential is
  // only ever typed into the window of the brain it is for, which is what
  // keeps the rule that a window reaches its own brain's logins and no other.
  ipcMain.handle(
    'brains:openForLogin',
    async (event, rawUrl: unknown, email: unknown): Promise<OpenForLoginResult> => {
      const fromProfileId = vaultProfileFor(event);
      if (!fromProfileId) return { ok: false, error: 'Not available here.' };
      if (typeof rawUrl !== 'string' || rawUrl.length > 2048) {
        return { ok: false, error: 'That does not look like a valid URL.' };
      }
      let origin: string;
      try {
        origin = normalizeOrigin(rawUrl);
      } catch {
        return { ok: false, error: 'That does not look like a valid URL.' };
      }
      const here = loadProfiles().find((p) => p.id === fromProfileId);
      // This window's own brain: nothing for the shell to do, the page signs in.
      if (here && here.origin === origin) return { ok: true, same: true };

      const added = await addBrain(origin);
      if (!added.ok) return added;
      if (typeof email === 'string' && email.length > 0 && email.length <= 320) {
        loginHints.set(added.profile.id, email);
      }
      try {
        await openBrain(added.profile.id, '/login?add=1');
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      return { ok: true, same: false, name: added.profile.name };
    },
  );

  // Read once by the sign-in screen of the window that was just opened for it.
  // Kept here rather than put in the URL: an address bar is no place for an
  // email, even a local one.
  ipcMain.handle('brains:takeLoginHint', (event): { email: string } | null => {
    const profileId = vaultProfileFor(event);
    const email = profileId ? loginHints.get(profileId) : undefined;
    if (!profileId || !email) return null;
    loginHints.delete(profileId);
    return { email };
  });

  ipcMain.handle('profiles:remove', (_event, id: string) => {
    const profiles = loadProfiles();
    // Only an id this app minted: the id names a directory to delete.
    if (!profiles.some((p) => p.id === id)) return;
    saveProfiles(profiles.filter((p) => p.id !== id));
    // A removed brain leaves no bearer behind on disk.
    vault().removeProfile(id);
    refreshBrainMenus();
  });

  ipcMain.handle('profiles:connect', async (event, id: string) => {
    if (!loadProfiles().some((p) => p.id === id)) {
      return { ok: false, error: 'Unknown brain. Refresh the list.' };
    }
    try {
      await openBrain(id);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    BrowserWindow.fromWebContents(event.sender)?.close();
    return { ok: true };
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

/**
 * The brains this app knows, most recently used first, one click each. Someone
 * looking after several brains should not have to open a dialog and pick from
 * a list every time they change which one they are looking at.
 *
 * A radio mark on the one in front; the others are a click away whether their
 * window is open or not. Logins WITHIN a brain are switched inside its window
 * (the profile menu): the shell knows brains, the page knows logins.
 */
function brainMenuItems(): Electron.MenuItemConstructorOptions[] {
  const brains = loadProfiles().sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
  if (brains.length === 0) return [];
  const front = [...profileWindows.entries()].find(([, win]) => win === appWindow)?.[0];
  return [
    ...brains.map((brain): Electron.MenuItemConstructorOptions => ({
      label: brain.name,
      type: 'radio',
      checked: brain.id === front,
      click: () => void openBrain(brain.id).catch(reportWindowError),
    })),
    { type: 'separator' },
  ];
}

/** Rebuild both menus: the list in them is a snapshot, and it changes when a
 *  brain is added, removed or brought to the front. */
function refreshBrainMenus(): void {
  buildMenu();
  tray?.setContextMenu(trayMenu());
}

function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      {
        label: 'Brain',
        submenu: [
          ...brainMenuItems(),
          {
            label: 'Add or Remove a Brain…',
            accelerator: 'CmdOrCtrl+Shift+B',
            click: () => openConnectWindow(),
          },
        ],
      },
    ]),
  );
}

let tray: Tray | null = null;

function trayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Open MantleOS Desktop', click: focusOrOpen },
    { type: 'separator' },
    ...brainMenuItems(),
    { label: 'Add or Remove a Brain…', click: () => openConnectWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function setupTray(): void {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 22, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip('MantleOS Desktop');
  tray.setContextMenu(trayMenu());
  tray.on('click', focusOrOpen);
}

/** Updates ride GitHub releases (the repo's tag-push publish flow). Download
 *  in the background, notify once, install on QUIT — never a surprise
 *  restart. Packaged builds only; on macOS electron-updater additionally
 *  requires a signed app before it will apply anything. */
function setupAutoUpdate(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    const notification = new Notification({
      title: 'MantleOS Desktop update ready',
      body: `v${info.version} installs when you quit the app.`,
      icon: ICON_PATH,
    });
    notification.show();
  });
  autoUpdater.on('error', () => {
    /* offline / no release yet — silent; next interval retries */
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  void check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

// One instance only: one window per brain, one vault, and a mantle:// link on
// Linux/Windows arrives as a second instance that hands it over.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // On Linux/Windows a mantle:// activation arrives as a second instance.
    const link = deepLinkInArgv(argv);
    if (link) handleDeepLink(link);
    else focusOrOpen();
  });

  // macOS delivers deep links as open-url events instead.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  void app.whenReady().then(() => {
    if (app.isPackaged) app.setAsDefaultProtocolClient('mantle');
    registerIpc();
    buildMenu();
    setupTray();
    setupAutoUpdate();

    // A cold start via deep link carries the URL in argv (Linux/Windows).
    const link = deepLinkInArgv(process.argv);
    if (link) pendingDeepLinkPath = deepLinkToPath(link);

    // Relaunch lands you back in the brain you were using; the persisted
    // partition still holds the bearer, so no re-login.
    const lastUsed = loadProfiles()
      .filter((p) => p.lastUsedAt)
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))[0];
    if (lastUsed) openAppWindow(lastUsed).catch(reportWindowError);
    else openConnectWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) focusOrOpen();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
