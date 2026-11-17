import { describe, expect, it } from 'vitest';
import { SYNC_HREFS, isSyncPath, syncOffOf, syncOffered, tourWithSync, withSync } from './sync';
import { TOURS } from './tour/tours';

const groups = [
  {
    label: 'Workspace',
    items: [{ href: '/' }, { href: '/inbox' }, { href: '/files' }, { href: '/contacts' }],
  },
  {
    label: 'People',
    defaultHead: ['/contacts', '/settings/users'],
    items: [{ href: '/contacts' }, { href: '/settings/users' }],
  },
  { label: 'Mail only', items: [{ href: '/inbox' }] },
];

describe('syncOffOf', () => {
  it('reads off only from an explicit false', () => {
    expect(syncOffOf({ features: { sync: false } })).toBe(true);
  });

  it('keeps Sync on for true, a missing field and an older brain', () => {
    expect(syncOffOf({ features: { sync: true } })).toBe(false);
    expect(syncOffOf({ features: { recallV2: true } })).toBe(false);
    expect(syncOffOf({ features: null })).toBe(false);
    expect(syncOffOf({ siteName: null })).toBe(false);
    expect(syncOffOf(undefined)).toBe(false);
    expect(syncOffOf(null)).toBe(false);
  });
});

describe('withSync', () => {
  it('off: drops the Sync rows, their heads and a group left empty', () => {
    const out = withSync(groups, true);
    expect(out.map((g) => g.label)).toEqual(['Workspace', 'People']);
    expect(out[0]!.items.map((i) => i.href)).toEqual(['/', '/files']);
    expect(out[1]!.items.map((i) => i.href)).toEqual(['/settings/users']);
    expect(out[1]!.defaultHead).toEqual(['/settings/users']);
    // Every Sync screen is gone from what is left.
    const left = out.flatMap((g) => g.items.map((i) => i.href));
    for (const h of SYNC_HREFS) expect(left).not.toContain(h);
  });

  it('on: keeps every row', () => {
    expect(withSync(groups, false)).toEqual(groups);
  });

  it('a group with no head keeps none', () => {
    expect('defaultHead' in withSync(groups, true)[0]!).toBe(false);
  });
});

describe('syncOffered', () => {
  it('hides a Sync screen only while off', () => {
    expect(syncOffered('/inbox', true)).toBe(false);
    expect(syncOffered('/inbox', false)).toBe(true);
    expect(syncOffered('/files', true)).toBe(true);
  });

  it('knows a screen under a Sync screen, not a look-alike', () => {
    expect(isSyncPath('/contacts/abc')).toBe(true);
    expect(isSyncPath('/inbox?account=1')).toBe(true);
    expect(isSyncPath('/inboxes')).toBe(false);
    expect(isSyncPath('/settings/agents')).toBe(false);
  });

  it('is the mail reader and contacts only: the linked-account screens are gone (M4)', () => {
    expect([...SYNC_HREFS].sort()).toEqual(['/contacts', '/inbox']);
    for (const gone of [
      '/settings/accounts',
      '/settings/microsoft',
      '/settings/calendar',
      '/settings/discover',
    ]) {
      expect(isSyncPath(gone)).toBe(false);
    }
  });
});

describe('tourWithSync', () => {
  const demo = TOURS.demo!;

  it('off: skips the stop on the mail screen', () => {
    const out = tourWithSync(demo, true);
    expect(out.steps.length).toBe(demo.steps.length - 1);
    expect(out.steps.some((s) => s.route === '/inbox' || s.target === 'nav:/inbox')).toBe(false);
  });

  it('on: keeps every stop', () => {
    expect(tourWithSync(demo, false)).toBe(demo);
  });
});
