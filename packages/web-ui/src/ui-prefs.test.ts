import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPref, readPref, writePref } from './ui-prefs';

/** A localStorage stand-in whose map a test can read. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** A document whose cookie jar behaves like the browser's for name=value
 *  pairs: a write sets or (Max-Age=0) drops one, a read lists them. */
function fakeDocument(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    jar,
    writes,
    doc: {
      set cookie(line: string) {
        writes.push(line);
        const [pair, ...attrs] = line.split(';');
        const eq = pair!.indexOf('=');
        const name = pair!.slice(0, eq).trim();
        if (attrs.some((a) => a.trim().toLowerCase() === 'max-age=0')) jar.delete(name);
        else jar.set(name, pair!.slice(eq + 1).trim());
      },
      get cookie() {
        return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      },
    },
  };
}

function setup(opts: { storage?: Record<string, string>; cookies?: Record<string, string> } = {}) {
  const storage = fakeStorage(opts.storage);
  const doc = fakeDocument(opts.cookies);
  vi.stubGlobal('window', { localStorage: storage });
  vi.stubGlobal('document', doc.doc);
  return { storage, ...doc };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ui-prefs', () => {
  it('keeps a value in localStorage, never in a cookie', () => {
    const { storage, writes } = setup();
    writePref('mantle_nav_w', '288');
    expect(readPref('mantle_nav_w')).toBe('288');
    expect(JSON.parse(storage.map.get('mantle_pref:mantle_nav_w')!)).toEqual({ v: '288' });
    expect(writes).toEqual([]);
  });

  it('a value with an end time is gone after it, and removed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { storage } = setup();
    writePref('mantle_authed', '1', 60);
    vi.setSystemTime(1_000_000 + 59_000);
    expect(readPref('mantle_authed')).toBe('1');
    vi.setSystemTime(1_000_000 + 60_000);
    expect(readPref('mantle_authed')).toBeUndefined();
    expect(storage.map.has('mantle_pref:mantle_authed')).toBe(false);
  });

  it('moves an older build’s cookie over once, and drops the cookie', () => {
    const { storage, jar } = setup({ cookies: { other: 'x', mantle_nav_collapsed: '1' } });
    expect(readPref('mantle_nav_collapsed')).toBe('1');
    expect(jar.has('mantle_nav_collapsed')).toBe(false);
    expect(jar.get('other')).toBe('x');
    const stored = JSON.parse(storage.map.get('mantle_pref:mantle_nav_collapsed')!);
    expect(stored.v).toBe('1');
    expect(typeof stored.exp).toBe('number');
    expect(readPref('mantle_nav_collapsed')).toBe('1');
  });

  it('keeps the cookie when its value could not be stored, so nothing is lost', () => {
    const { storage, jar } = setup({ cookies: { mantle_authed: '1' } });
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(readPref('mantle_authed')).toBe('1');
    expect(jar.get('mantle_authed')).toBe('1');
    expect(readPref('mantle_authed')).toBe('1');
  });

  it('writePref says whether the value was kept', () => {
    const { storage } = setup();
    expect(writePref('a', '1')).toBe(true);
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(writePref('b', '1')).toBe(false);
    vi.stubGlobal('window', undefined);
    expect(writePref('c', '1')).toBe(false);
  });

  it('a moved-over cookie keeps the lifetime its name was written with', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const day = 24 * 60 * 60 * 1000;
    const { storage } = setup({
      cookies: {
        mantle_authed: '1',
        mantle_nav_w: '288',
        'sidebar:state': 'true',
        'react-resizable-panels:collapsed': 'false',
      },
    });
    const expOf = (name: string) => {
      readPref(name);
      return JSON.parse(storage.map.get(`mantle_pref:${name}`)!).exp;
    };
    expect(expOf('mantle_authed')).toBe(1_000_000 + 30 * day);
    expect(expOf('mantle_nav_w')).toBe(1_000_000 + 365 * day);
    expect(expOf('sidebar:state')).toBe(1_000_000 + 7 * day);
    expect(expOf('react-resizable-panels:collapsed')).toBeUndefined();
  });

  it('a stored value wins over a leftover cookie', () => {
    setup({
      storage: { 'mantle_pref:mantle_spend_range': JSON.stringify({ v: 'week' }) },
      cookies: { mantle_spend_range: 'month' },
    });
    expect(readPref('mantle_spend_range')).toBe('week');
  });

  it('matches a cookie by its whole name only', () => {
    setup({ cookies: { not_mantle_authed: '1' } });
    expect(readPref('mantle_authed')).toBeUndefined();
  });

  it('clearPref drops the value and any cookie of that name', () => {
    const { storage, jar } = setup({
      storage: { 'mantle_pref:mantle_authed': JSON.stringify({ v: '1' }) },
      cookies: { mantle_authed: '1' },
    });
    clearPref('mantle_authed');
    expect(storage.map.has('mantle_pref:mantle_authed')).toBe(false);
    expect(jar.has('mantle_authed')).toBe(false);
    expect(readPref('mantle_authed')).toBeUndefined();
  });

  it('a damaged stored value reads as none', () => {
    setup({ storage: { 'mantle_pref:a': '{not json', 'mantle_pref:b': JSON.stringify({ v: 3 }) } });
    expect(readPref('a')).toBeUndefined();
    expect(readPref('b')).toBeUndefined();
  });

  it('works with no window or document (the static build)', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    expect(readPref('x')).toBeUndefined();
    expect(() => writePref('x', '1')).not.toThrow();
    expect(() => clearPref('x')).not.toThrow();
  });

  it('a storage that throws is no storage', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('denied');
      },
    });
    vi.stubGlobal('document', fakeDocument().doc);
    expect(readPref('x')).toBeUndefined();
    expect(() => writePref('x', '1')).not.toThrow();
  });
});
