import { describe, expect, it } from 'vitest';
import {
  LINK_CODE_PAGES,
  LINK_CODE_ATTR,
  LINK_CODE_GLOBAL,
  LINK_CODE_SCRIPT,
  readLinkCode,
  takeLinkCode,
} from './link-code';

/**
 * A sign-in or invite link's code (client logins audit B12): read from the
 * fragment first, still from the query (links already issued), and out of
 * the address at once, by the inline script while the page parses and by the
 * page's first effect if the script did not run.
 */
const ORIGIN = 'https://app.example.invalid';

describe('readLinkCode', () => {
  it('reads the fragment, and drops it from the address', () => {
    expect(readLinkCode(`${ORIGIN}/client-signin#code=AbCd1234efGH`)).toEqual({
      code: 'AbCd1234efGH',
      clean: '/client-signin',
    });
  });

  it('still reads the query (a link issued before), and drops it', () => {
    expect(readLinkCode(`${ORIGIN}/invite?code=Zz99`)).toEqual({ code: 'Zz99', clean: '/invite' });
  });

  it('the fragment wins over the query, and both leave the address', () => {
    expect(readLinkCode(`${ORIGIN}/client-signin?code=OLD#code=NEW`)).toEqual({
      code: 'NEW',
      clean: '/client-signin',
    });
  });

  it('keeps everything else in the address', () => {
    expect(readLinkCode(`${ORIGIN}/invite?x=1&code=Zz99#code=Q1&y=2`)).toEqual({
      code: 'Q1',
      clean: '/invite?x=1#y=2',
    });
    expect(readLinkCode(`${ORIGIN}/invite?code=Zz99#top`)).toEqual({
      code: 'Zz99',
      clean: '/invite#top',
    });
  });

  it('no code: nothing to drop', () => {
    expect(readLinkCode(`${ORIGIN}/client-signin`)).toEqual({ code: '', clean: null });
    expect(readLinkCode(`${ORIGIN}/client-signin?x=1#y`)).toEqual({ code: '', clean: null });
  });

  it('drops whitespace (a code never holds any)', () => {
    expect(readLinkCode(`${ORIGIN}/client-signin#code=Ab%20Cd`).code).toBe('AbCd');
  });
});

/** Runs the inline script against a fake window, as the browser would. */
function runScript(href: string) {
  const url = new URL(href);
  const calls: string[] = [];
  const attrs = new Set<string>();
  const win: Record<string, unknown> = {
    location: { pathname: url.pathname, search: url.search, hash: url.hash },
    history: {
      state: null,
      replaceState: (_d: unknown, _u: string, to: string) => calls.push(to),
    },
  };
  const documentStub = { documentElement: { setAttribute: (n: string) => attrs.add(n) } };
  new Function('window', 'document', LINK_CODE_SCRIPT)(win, documentStub);
  return { stashed: win[LINK_CODE_GLOBAL], replaced: calls, attrs };
}

describe('LINK_CODE_SCRIPT (the inline script)', () => {
  const cases = [
    '/client-signin#code=AbCd1234efGH',
    '/invite?code=Zz99',
    '/client-signin?code=OLD#code=NEW',
    '/invite?x=1&code=Zz99#code=Q1&y=2',
    '/invite?code=Zz99#top',
    '/client-signin#code=Ab%20Cd',
  ];

  it('takes the same code as readLinkCode, and leaves the same address', () => {
    for (const path of cases) {
      const want = readLinkCode(`${ORIGIN}${path}`);
      const got = runScript(`${ORIGIN}${path}`);
      expect(got.stashed, path).toBe(want.code);
      expect(got.replaced, path).toEqual([want.clean]);
      expect(got.attrs.has(LINK_CODE_ATTR), path).toBe(true);
    }
  });

  it('no code: touches nothing', () => {
    const got = runScript(`${ORIGIN}/client-signin?x=1#y`);
    expect(got.stashed).toBeUndefined();
    expect(got.replaced).toEqual([]);
    expect(got.attrs.size).toBe(0);
  });
});

describe('takeLinkCode (the page, in its first effect)', () => {
  const fakeWindow = (href: string, stashed?: string) => {
    const replaced: string[] = [];
    const win = {
      location: { href },
      history: {
        state: null,
        replaceState: (_d: unknown, _u: string, to: string) => void replaced.push(to),
      },
      ...(stashed !== undefined ? { [LINK_CODE_GLOBAL]: stashed } : {}),
    } as Parameters<typeof takeLinkCode>[0];
    return { win, replaced };
  };

  it('takes what the script stashed, once', () => {
    const { win, replaced } = fakeWindow(`${ORIGIN}/client-signin`, 'Stashed1');
    const removed: string[] = [];
    expect(takeLinkCode(win, { removeAttribute: (n) => void removed.push(n) })).toBe('Stashed1');
    expect((win as unknown as Record<string, unknown>)[LINK_CODE_GLOBAL]).toBeUndefined();
    expect(replaced).toEqual([]);
    expect(removed).toEqual([LINK_CODE_ATTR]);
  });

  it('without the script: reads the address and drops the code from it', () => {
    const { win, replaced } = fakeWindow(`${ORIGIN}/client-signin#code=Late1`);
    expect(takeLinkCode(win)).toBe('Late1');
    expect(replaced).toEqual(['/client-signin']);
  });

  it('nothing anywhere: empty', () => {
    const { win, replaced } = fakeWindow(`${ORIGIN}/client-signin`);
    expect(takeLinkCode(win)).toBe('');
    expect(replaced).toEqual([]);
  });
});

describe('Referrer-Policy on the link pages (served by the host)', () => {
  it('lists /auth/oidc, /client-signin and /invite (and below) for the no-referrer header', () => {
    expect([...LINK_CODE_PAGES].sort()).toEqual(
      ['/auth/oidc', '/client-signin', '/client-signin/:path*', '/invite', '/invite/:path*'].sort(),
    );
  });
});
