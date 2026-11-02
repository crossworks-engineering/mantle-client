import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from './token-store';

/**
 * The owner's bearer, and the one-time migration that moves it out of
 * localStorage when the app is running inside the desktop shell. Untested until
 * now, which is uncomfortable for the module whose doc comment carries the
 * app's whole XSS posture: every branch here either holds a 30-day credential
 * or scrubs one.
 *
 * `environment: 'node'` — no jsdom — so `window` and `document` are stubbed to
 * the narrow shape this module actually touches, the way runtime-env.test.ts
 * does it.
 */

type Vault = { get: () => string | null; set: (t: string) => void; clear: () => void };

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** Records every `document.cookie` write; `cookies.at(-1)` is the last one. */
function fakeDocument() {
  const writes: string[] = [];
  return {
    writes,
    doc: {
      set cookie(v: string) {
        writes.push(v);
      },
      get cookie() {
        return writes.join('; ');
      },
    },
  };
}

function setup(opts: { storage?: ReturnType<typeof fakeStorage>; vault?: Vault; https?: boolean }) {
  const storage = opts.storage ?? fakeStorage();
  const { writes, doc } = fakeDocument();
  vi.stubGlobal('window', {
    localStorage: storage,
    location: { protocol: opts.https === false ? 'http:' : 'https:' },
    ...(opts.vault ? { mantleDesktop: { tokenVault: opts.vault } } : {}),
  });
  vi.stubGlobal('document', doc);
  return { storage, writes };
}

/** A vault backed by a plain cell, so a test can assert what it holds. */
function fakeVault(initial: string | null = null): Vault & { value: string | null } {
  const v = {
    value: initial,
    get: () => v.value,
    set: (t: string) => {
      v.value = t;
    },
    clear: () => {
      v.value = null;
    },
  };
  return v;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The presence flag as ui-prefs keeps it, or undefined. */
function presence(
  storage: ReturnType<typeof fakeStorage>,
): { v: string; exp?: number } | undefined {
  const raw = storage.map.get('mantle_pref:mantle_authed');
  return raw === undefined ? undefined : (JSON.parse(raw) as { v: string; exp?: number });
}

describe('tokenStore · browser (no desktop vault)', () => {
  it('round-trips the bearer through localStorage and sets the presence flag', () => {
    const { storage, writes } = setup({});
    expect(tokenStore.get()).toBeNull();

    tokenStore.set('bearer-1');
    expect(storage.map.get('mantle_token')).toBe('bearer-1');
    expect(tokenStore.get()).toBe('bearer-1');
    expect(presence(storage)?.v).toBe('1');
    expect(tokenStore.hasPresence()).toBe(true);
    // No cookie is written for it (the desktop scheme keeps none).
    expect(writes.filter((w) => w.startsWith('mantle_authed=1'))).toEqual([]);
  });

  it('keeps the presence flag for 30 days, as the cookie did', () => {
    const { storage } = setup({});
    const before = Date.now();
    tokenStore.set('x');
    const exp = presence(storage)?.exp ?? 0;
    expect(exp).toBeGreaterThanOrEqual(before + 30 * 86400_000);
    expect(exp).toBeLessThanOrEqual(Date.now() + 30 * 86400_000);
  });

  it('clear removes the token and the presence flag', () => {
    const { storage } = setup({
      storage: fakeStorage({
        mantle_token: 'bearer-1',
        'mantle_pref:mantle_authed': JSON.stringify({ v: '1' }),
      }),
    });
    tokenStore.clear();
    expect(storage.map.has('mantle_token')).toBe(false);
    expect(presence(storage)).toBeUndefined();
    expect(tokenStore.hasPresence()).toBe(false);
  });

  it('markPresence sets the flag without touching the token', () => {
    const { storage } = setup({ storage: fakeStorage({ mantle_token: 'bearer-1' }) });
    tokenStore.markPresence();
    expect(storage.map.get('mantle_token')).toBe('bearer-1');
    expect(presence(storage)?.v).toBe('1');
  });
});

describe('tokenStore · desktop shell vault', () => {
  it('reads and writes the vault, never localStorage', () => {
    const vault = fakeVault();
    const { storage } = setup({ vault });

    tokenStore.set('bearer-1');
    expect(vault.value).toBe('bearer-1');
    expect(storage.map.has('mantle_token')).toBe(false);
    expect(tokenStore.get()).toBe('bearer-1');
  });

  // The whole point of the migration branch: a shell session that predates the
  // vault left the bearer in plaintext, and merely reading it must move it.
  it('migrates a pre-vault localStorage bearer into the vault and scrubs the plaintext', () => {
    const vault = fakeVault(null);
    const { storage } = setup({ vault, storage: fakeStorage({ mantle_token: 'legacy' }) });

    expect(tokenStore.get()).toBe('legacy');
    expect(vault.value).toBe('legacy');
    expect(storage.map.has('mantle_token')).toBe(false);
  });

  it('does not migrate when the vault already holds a token', () => {
    const vault = fakeVault('current');
    const { storage } = setup({ vault, storage: fakeStorage({ mantle_token: 'stale' }) });

    expect(tokenStore.get()).toBe('current');
    expect(storage.map.get('mantle_token')).toBe('stale');
  });

  it('clear empties the vault as well as localStorage', () => {
    const vault = fakeVault('bearer-1');
    const { storage } = setup({ vault, storage: fakeStorage({ mantle_token: 'leftover' }) });

    tokenStore.clear();
    expect(vault.value).toBeNull();
    expect(storage.map.has('mantle_token')).toBe(false);
  });
});

describe('tokenStore · hostile environments', () => {
  it('is inert on the server, where there is no window at all', () => {
    vi.stubGlobal('window', undefined);
    expect(tokenStore.get()).toBeNull();
    expect(() => tokenStore.set('x')).not.toThrow();
    expect(() => tokenStore.clear()).not.toThrow();
  });

  // Private mode throws on ACCESS, not on read — a session that cannot persist
  // has to keep working for as long as the tab is open.
  it('swallows a storage that throws, rather than taking the app down', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    vi.stubGlobal('window', { localStorage: throwing, location: { protocol: 'https:' } });
    vi.stubGlobal('document', fakeDocument().doc);

    expect(tokenStore.get()).toBeNull();
    expect(() => tokenStore.set('x')).not.toThrow();
    expect(() => tokenStore.clear()).not.toThrow();
  });
});
