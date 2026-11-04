import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The company sign-in calls: what each one sends, and what each answer means.
 * A held login's link start carries no credential at all, or another login held
 * on this device would be read as the one linking.
 */

type Call = { url: string; init: RequestInit };
let calls: Call[];
let store: Map<string, string>;
let local: Map<string, string>;
let answer: () => Response;
let assign: ReturnType<typeof vi.fn>;
const BRAIN = 'https://brain.example';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const storage = (map: Map<string, string>) => ({
  getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => void map.set(k, v),
  removeItem: (k: string) => void map.delete(k),
});

beforeEach(() => {
  calls = [];
  store = new Map();
  local = new Map();
  assign = vi.fn();
  answer = () => json(200, { url: `${BRAIN}/api/auth/oidc/start?ticket=t` });
  vi.resetModules();
  vi.stubGlobal('window', {
    localStorage: storage(local),
    sessionStorage: storage(store),
    location: { protocol: 'https:', origin: BRAIN, href: `${BRAIN}/settings`, assign },
    __MANTLE_ENV__: {},
  });
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return answer();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const load = () => import('./actions');
const bodyOf = (c: Call) => JSON.parse(String(c.init.body)) as Record<string, unknown>;
const authOf = (c: Call) => new Headers(c.init.headers).get('authorization');

describe('startLink: a held login', () => {
  it('sends the ticket and no credential, even with another login held here', async () => {
    const { tokenStore } = await import('@mantle/web-ui/token-store');
    tokenStore.signIn({ email: 'other@example.com', token: 'other.sig' });
    const { startLink } = await load();

    const res = await startLink({ held: { ticket: 'held.t' } });

    expect(res).toEqual({ kind: 'started', how: 'leaving' });
    expect(calls[0]!.url).toMatch(/\/api\/auth\/oidc\/link$/);
    expect(calls[0]!.init.credentials).toBe('omit');
    expect(authOf(calls[0]!)).toBeNull();
    expect(bodyOf(calls[0]!)).toMatchObject({ ticket: 'held.t' });
    expect(bodyOf(calls[0]!)).not.toHaveProperty('password');
    expect(assign).toHaveBeenCalledWith(`${BRAIN}/api/auth/oidc/start?ticket=t`);
  });

  it('hands the flow to this client, with a challenge, and keeps the verifier here', async () => {
    const { startLink } = await load();
    await startLink({ held: { ticket: 'held.t' } });
    const { handoff } = bodyOf(calls[0]!) as { handoff: { redirect: string; challenge: string } };
    expect(handoff.redirect).toBe(`${BRAIN}/auth/oidc`);
    expect(handoff.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const kept = JSON.parse(store.get('mantle.oidc.flow')!) as { verifier: string; held: boolean };
    expect(kept.held).toBe(true);
    expect(kept.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(bodyOf(calls[0]!))).not.toContain(kept.verifier);
  });
});

describe('startLink: a held login on a device that holds another', () => {
  it('a stop goes back to a sign-in screen that login does not answer', async () => {
    const { tokenStore } = await import('@mantle/web-ui/token-store');
    tokenStore.signIn({ email: 'other@example.com', token: 'other.sig' });
    const { startLink } = await load();
    await startLink({ held: { ticket: 'held.t' } });
    const kept = JSON.parse(store.get('mantle.oidc.flow')!) as { add?: boolean };
    expect(kept.add).toBe(true);
  });
});

describe('startLink: what the brain answers', () => {
  it('a session sends its own bearer', async () => {
    const { tokenStore } = await import('@mantle/web-ui/token-store');
    tokenStore.signIn({ email: 'me@example.com', token: 'me.sig' });
    const { startLink } = await load();
    await startLink({ ticket: 'offer.t' });
    expect(authOf(calls[0]!)).toBe('Bearer me.sig');
    expect(bodyOf(calls[0]!)).toMatchObject({ ticket: 'offer.t' });
  });

  it.each([
    [401, { error: 'x', code: 'password-needed' }, 'password-needed'],
    [401, { error: 'Current password is incorrect.' }, 'wrong-password'],
    // A dead session answers 401 too, whatever was typed.
    [401, { error: 'Not signed in.' }, 'signed-out'],
    [409, { error: 'x', code: 'already-linked' }, 'already-linked'],
    [403, { error: 'password_change_required', message: 'Change it first.' }, 'error'],
    [429, { error: 'Too many.' }, 'error'],
  ])('%i %j is %s, and leaves no flow waiting', async (status, body, kind) => {
    answer = () => json(status, body);
    const { startLink } = await load();
    const res = await startLink({ password: 'typed' });
    expect(res.kind).toBe(kind);
    expect(store.has('mantle.oidc.flow')).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('says the words the password rule gave, not its code', async () => {
    answer = () => json(403, { error: 'password_change_required', message: 'Change it first.' });
    const { startLink } = await load();
    expect(await startLink({ password: 'typed' })).toEqual({
      kind: 'error',
      message: 'Change it first.',
    });
  });

  it('never leaves for an address that is not this brain', async () => {
    answer = () => json(200, { url: 'javascript:alert(1)' });
    const { startLink } = await load();
    await expect(startLink({})).rejects.toThrow(/public address/);
    answer = () => json(200, { url: 'https://evil.example/api/auth/oidc/start' });
    await expect(startLink({})).rejects.toThrow(/public address/);
    expect(assign).not.toHaveBeenCalled();
    expect(store.has('mantle.oidc.flow')).toBe(false);
  });
});

describe('a desktop shell', () => {
  const withShell = (open: (url: string) => Promise<boolean>) => {
    (window as unknown as { mantleDesktop: unknown }).mantleDesktop = { oidc: { open } };
  };

  it('asks for mantle://oidc and opens the browser, and the page does not leave', async () => {
    const open = vi.fn(async (_url: string) => true);
    withShell(open);
    const { startSignIn } = await load();
    expect(await startSignIn({})).toBe('in-browser');
    const url = new URL(open.mock.calls[0]![0]);
    expect(url.searchParams.get('redirect')).toBe('mantle://oidc');
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ['says no', async () => false],
    ['throws', async () => Promise.reject(new Error('no browser'))],
  ])('a shell that %s leaves no flow waiting', async (_name, open) => {
    withShell(open);
    const { startSignIn } = await load();
    await expect(startSignIn({})).rejects.toThrow(/did not open/);
    expect(store.has('mantle.oidc.flow')).toBe(false);
  });

  it('a shell from before it cannot end a flow here', async () => {
    (window as unknown as { mantleDesktop: unknown }).mantleDesktop = {};
    const { companySignInWorksHere } = await load();
    expect(companySignInWorksHere()).toBe(false);
  });
});

describe('abandonFlow', () => {
  const pending = (purpose: string) =>
    store.set(
      'mantle.oidc.flow',
      JSON.stringify({ purpose, verifier: 'v', brain: BRAIN, startedAt: Date.now() }),
    );

  it('forgets the flow and tells the shell', async () => {
    const cancel = vi.fn();
    (window as unknown as { mantleDesktop: unknown }).mantleDesktop = {
      oidc: { open: vi.fn(), cancel },
    };
    pending('signin');
    const { abandonFlow } = await load();
    abandonFlow();
    expect(store.has('mantle.oidc.flow')).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('for one purpose, leaves another flow going', async () => {
    const cancel = vi.fn();
    (window as unknown as { mantleDesktop: unknown }).mantleDesktop = {
      oidc: { open: vi.fn(), cancel },
    };
    pending('link');
    const { abandonFlow } = await load();
    abandonFlow('fresh');
    expect(store.has('mantle.oidc.flow')).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    abandonFlow('link');
    expect(store.has('mantle.oidc.flow')).toBe(false);
  });

  it('a sign-out or a switch forgets what the last login had out', async () => {
    pending('link');
    store.set('mantle.oidc.key-draft', '{}');
    store.set('mantle.oidc.outcome', '{}');
    await load();
    const { runSignOutResets } = await import('@mantle/web-ui/session-reset');
    runSignOutResets();
    expect(store.size).toBe(0);
  });
});

describe('readOidcConfig', () => {
  it('a brain from before it is off; on brains the label comes along', async () => {
    const { readOidcConfig } = await load();
    answer = () => json(404, {});
    expect(await readOidcConfig()).toEqual({ mode: 'off' });
    answer = () => json(200, { mode: 'required', label: 'Co' });
    expect(await readOidcConfig()).toEqual({ mode: 'required', label: 'Co' });
    answer = () => json(200, { mode: 'nonsense' });
    expect(await readOidcConfig()).toEqual({ mode: 'off' });
  });

  it('a read that fails is no answer: it throws, to be asked again', async () => {
    const { readOidcConfig } = await load();
    answer = () => json(500, {});
    await expect(readOidcConfig()).rejects.toThrow();
    answer = () => {
      throw new TypeError('offline');
    };
    await expect(readOidcConfig()).rejects.toThrow();
  });

  it('sends no credential', async () => {
    const { tokenStore } = await import('@mantle/web-ui/token-store');
    tokenStore.signIn({ email: 'me@example.com', token: 'me.sig' });
    const { readOidcConfig } = await load();
    answer = () => json(200, { mode: 'off' });
    await readOidcConfig();
    expect(calls[0]!.init.credentials).toBe('omit');
    expect(authOf(calls[0]!)).toBeNull();
  });
});

describe('spendCode', () => {
  it('sends the code and the verifier and no credential', async () => {
    const { spendCode } = await load();
    answer = () => json(200, { linked: true });
    expect(await spendCode('c', 'v')).toEqual({ ok: true, answer: { linked: true } });
    expect(calls[0]!.init.credentials).toBe('omit');
    expect(authOf(calls[0]!)).toBeNull();
    expect(bodyOf(calls[0]!)).toMatchObject({ code: 'c', verifier: 'v' });
  });

  it('a refusal is its code, and anything else is an ended flow', async () => {
    const { spendCode } = await load();
    answer = () => json(409, { error: 'x', code: 'taken' });
    expect(await spendCode('c', 'v')).toEqual({ ok: false, result: 'taken' });
    answer = () => new Response('oops', { status: 500 });
    expect(await spendCode('c', 'v')).toEqual({ ok: false, result: 'expired' });
  });
});

describe('unlinkSelf', () => {
  it('a login with no password is told what to do', async () => {
    const { unlinkSelf } = await load();
    answer = () => json(409, { error: 'Set a password before you remove the link.' });
    expect(await unlinkSelf()).toEqual({
      ok: false,
      message: 'This login has no password. Ask an admin to set one, then remove the link.',
    });
  });
});
