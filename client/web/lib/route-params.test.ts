import { describe, expect, it } from 'vitest';
import { matchRouteParams } from './route-params';
import { toSearchRecord } from './search-params';

/**
 * A static build exports one placeholder page per dynamic route, so a page
 * reads its real params from the address bar instead (lib/route-params.ts).
 */
describe('matchRouteParams', () => {
  it('reads a single segment', () => {
    expect(matchRouteParams('/notes/[id]', '/notes/abc123')).toEqual({ id: 'abc123' });
  });

  it('reads a segment in the middle of a longer route', () => {
    expect(matchRouteParams('/settings/accounts/[id]/edit', '/settings/accounts/a1/edit')).toEqual({
      id: 'a1',
    });
  });

  it('reads a catch-all as the rest of the path', () => {
    expect(matchRouteParams('/docs/[collection]/[...slug]', '/docs/handbook/guide/intro')).toEqual({
      collection: 'handbook',
      slug: ['guide', 'intro'],
    });
  });

  it('keeps segments percent-encoded, as Next params were', () => {
    expect(matchRouteParams('/docs/[collection]/[...slug]', '/docs/a%20b/c%2Fd')).toEqual({
      collection: 'a%20b',
      slug: ['c%2Fd'],
    });
  });

  it('ignores a trailing slash', () => {
    expect(matchRouteParams('/notes/[id]', '/notes/abc/')).toEqual({ id: 'abc' });
  });

  it('gives nothing for a path of another route', () => {
    expect(matchRouteParams('/notes/[id]', '/tasks/abc')).toEqual({});
    expect(
      matchRouteParams('/settings/accounts/[id]/edit', '/settings/accounts/a1/folders'),
    ).toEqual({});
  });

  it('leaves a missing segment absent', () => {
    expect(matchRouteParams('/notes/[id]', '/notes')).toEqual({});
  });
});

describe('toSearchRecord', () => {
  it('gives a key seen once as a string and a repeated key as an array', () => {
    expect(toSearchRecord(new URLSearchParams('page=2&kind=a&kind=b&q='))).toEqual({
      page: '2',
      kind: ['a', 'b'],
      q: '',
    });
  });

  it('gives an empty record for no query', () => {
    expect(toSearchRecord(new URLSearchParams(''))).toEqual({});
  });
});
