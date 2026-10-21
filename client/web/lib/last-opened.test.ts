import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@mantle/web-ui/api-fetch';
import {
  itemRestore,
  failureOutcome,
  forgetLastOpened,
  lastOpenedKey,
  noteRoute,
  readLastOpened,
  rememberLastOpened,
  resetRouteTrail,
  routeBefore,
  sectionOf,
  shouldRestore,
  type LastOpenedStore,
} from './last-opened';

/**
 * "Open the last item" is a convenience, so its failures must all land on the
 * normal list: a junk or blocked store, a deleted item, a login that cannot
 * read it. And it must never leak: one login's last item is not another's.
 */

function fakeStore(): LastOpenedStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: LastOpenedStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const ID = '0b6f8a52-3c1e-4d7a-9a51-5f0e2b7c9d10';

describe('the stored entry', () => {
  it('is kept per brain, per login and per section', () => {
    const s = fakeStore();
    const owner = lastOpenedKey('https://brain.example', 'admin:a@example.invalid', 'pages');
    rememberLastOpened(s, owner, ID);
    expect(readLastOpened(s, owner)).toBe(ID);
    // Another login on the same device and brain sees nothing.
    expect(
      readLastOpened(s, lastOpenedKey('https://brain.example', 'member:m1', 'pages')),
    ).toBeNull();
    // Nor does the same login on another brain, or another section.
    expect(
      readLastOpened(s, lastOpenedKey('https://other.example', 'admin:a@example.invalid', 'pages')),
    ).toBeNull();
    expect(
      readLastOpened(s, lastOpenedKey('https://brain.example', 'admin:a@example.invalid', 'notes')),
    ).toBeNull();
  });

  it('keeps a key unambiguous when a login or brain holds the separator', () => {
    expect(lastOpenedKey('a:b', 'c', 'pages')).not.toBe(lastOpenedKey('a', 'b:c', 'pages'));
  });

  it('is replaced by the newest item and can be forgotten', () => {
    const s = fakeStore();
    const k = lastOpenedKey('b', 'l', 'files');
    rememberLastOpened(s, k, 'one');
    rememberLastOpened(s, k, 'two');
    expect(readLastOpened(s, k)).toBe('two');
    forgetLastOpened(s, k);
    expect(readLastOpened(s, k)).toBeNull();
  });

  it('reads junk, an odd shape or blocked storage as nothing', () => {
    const s = fakeStore();
    const k = lastOpenedKey('b', 'l', 'draw');
    s.data.set(k, '../../settings');
    expect(readLastOpened(s, k)).toBeNull();
    rememberLastOpened(s, k, 'has spaces');
    expect(s.data.get(k)).toBe('../../settings');
    expect(readLastOpened(throwing, k)).toBeNull();
    expect(() => rememberLastOpened(throwing, k, ID)).not.toThrow();
    expect(() => forgetLastOpened(throwing, k)).not.toThrow();
    expect(readLastOpened(null, k)).toBeNull();
  });
});

describe('when a section restores', () => {
  it('knows the sections by path, item routes included', () => {
    expect(sectionOf('/pages')).toBe('pages');
    expect(sectionOf('/pages/abc')).toBe('pages');
    expect(sectionOf('/draw/abc')).toBe('draw');
    expect(sectionOf('/')).toBeNull();
    expect(sectionOf('/pagesx')).toBeNull();
    expect(sectionOf('/settings/pages')).toBeNull();
    expect(sectionOf(null)).toBeNull();
  });

  it('restores on entry to the bare index from elsewhere, or on a cold start', () => {
    expect(shouldRestore('pages', '/pages', '', '/notes')).toBe(true);
    expect(shouldRestore('pages', '/pages', '', '/')).toBe(true);
    expect(shouldRestore('pages', '/pages', '', null)).toBe(true);
  });

  it('never redirects away from an item or a query', () => {
    expect(shouldRestore('pages', '/pages/abc', '', '/notes')).toBe(false);
    expect(shouldRestore('notes', '/notes', 'q=plan', '/')).toBe(false);
    expect(shouldRestore('files', '/files', '?path=files.docs', '/')).toBe(false);
    expect(shouldRestore('notes', '/notes', 'selected=x', '/')).toBe(false);
  });

  it('shows the list when the user comes back from one of its own items', () => {
    expect(shouldRestore('pages', '/pages', '', '/pages/abc')).toBe(false);
    expect(shouldRestore('draw', '/draw', '', '/draw/abc')).toBe(false);
  });
});

describe('the route trail', () => {
  beforeEach(() => resetRouteTrail());

  it('answers the route before, whichever effect ran first', () => {
    noteRoute('/notes');
    // The page reads before the shell has noted the new route…
    expect(routeBefore('/pages')).toBe('/notes');
    // …or after.
    noteRoute('/pages');
    expect(routeBefore('/pages')).toBe('/notes');
  });

  it('ignores a repeat of the same route', () => {
    noteRoute('/pages/abc');
    noteRoute('/pages');
    noteRoute('/pages');
    expect(routeBefore('/pages')).toBe('/pages/abc');
  });

  it('has nothing before a cold start', () => {
    expect(routeBefore('/pages')).toBeNull();
  });
});

describe('the restore (every login, W6b)', () => {
  const reads: string[] = [];
  const ok =
    (body: unknown = {}) =>
    async (path: string) => {
      reads.push(path);
      return body;
    };
  beforeEach(() => {
    reads.length = 0;
  });

  it('reads the item and opens it where its own screen opens it', async () => {
    expect(await itemRestore('pages', ID, ok())).toEqual({ href: `/pages/${ID}` });
    expect(await itemRestore('draw', ID, ok())).toEqual({ href: `/draw/${ID}` });
    expect(await itemRestore('notes', ID, ok())).toEqual({ href: `/notes/${ID}` });
    expect(await itemRestore('tables', ID, ok())).toEqual({ href: `/tables/${ID}` });
    expect(reads).toEqual([
      `/api/pages/${ID}`,
      `/api/draws/${ID}`,
      `/api/notes/${ID}`,
      `/api/tables/${ID}`,
    ]);
  });

  it('opens a file inside its folder', async () => {
    const r = await itemRestore('files', ID, ok({ file: { parentPath: 'files.reports' } }));
    expect(r).toEqual({ href: `/files?path=files.reports&file=${ID}` });
    expect(reads).toEqual([`/api/files/files/${ID}`]);
  });

  it('shows the list once for a file read with no folder', async () => {
    expect(await itemRestore('files', ID, ok({ file: {} }))).toBe('unknown');
  });

  it('forgets an item that is gone or no longer readable', async () => {
    for (const status of [400, 403, 404, 410]) {
      const r = await itemRestore('pages', ID, async () => {
        throw new ApiError('nope', status);
      });
      expect(r).toBe('gone');
    }
  });

  it('keeps the entry through a server or network failure', async () => {
    expect(
      await itemRestore('notes', ID, async () => {
        throw new ApiError('boom', 500);
      }),
    ).toBe('unknown');
    expect(
      await itemRestore('notes', ID, async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).toBe('unknown');
    expect(failureOutcome(new Error('x'))).toBe('unknown');
  });
});
