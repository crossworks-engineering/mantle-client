import { describe, expect, it } from 'vitest';
import {
  banBody,
  banKeysText,
  banState,
  boxName,
  FLEET_HREF,
  fleetOffered,
  liftLabel,
  liftText,
  parseEmails,
  previewLine,
  reasonText,
  tickIsStale,
  withFleet,
} from './fleet';

describe('boxName', () => {
  it('takes the label, else the host', () => {
    expect(boxName({ url: 'https://box.example.com', label: 'Box 3' })).toBe('Box 3');
    expect(boxName({ url: 'https://box.example.com', label: null })).toBe('box.example.com');
    expect(boxName({ url: 'not a url', label: null })).toBe('not a url');
  });
});

describe('reasonText', () => {
  it('says nothing after a good run', () => {
    expect(reasonText(null)).toBeNull();
  });
  it('has words for each code', () => {
    for (const code of ['off', 'time', 'sig', 'unreachable', 'bad-reply', 'reply-too-large']) {
      expect(reasonText(code)).toMatch(/\.$/);
    }
    expect(reasonText('http-503')).toBe('The box answered HTTP 503.');
    expect(reasonText('something-new')).toBe('The last run failed.');
  });
});

describe('tickIsStale', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  it('is stale with no tick, or none in the last minute', () => {
    expect(tickIsStale(null, now)).toBe(true);
    expect(tickIsStale('2026-11-09T11:58:30Z', now)).toBe(true);
    expect(tickIsStale('2026-11-09T11:59:30Z', now)).toBe(false);
    expect(tickIsStale('garbage', now)).toBe(true);
  });
});

describe('parseEmails and banBody', () => {
  it('splits, lowercases and keeps each once', () => {
    expect(parseEmails(' A@x.com, b@x.com\na@X.com ;c@x.com ')).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ]);
    expect(parseEmails('   ')).toEqual([]);
  });
  it('sends empty fields as null', () => {
    expect(
      banBody({ kind: 'archive', emails: 'a@x.com', issuer: ' ', oid: '', reason: ' left ' }),
    ).toEqual({ kind: 'archive', emails: ['a@x.com'], issuer: null, oid: null, reason: 'left' });
  });
});

describe('previewLine', () => {
  const box = { boxId: '1', url: 'https://b3.example.com', label: 'box 3' };
  it('names the box and the count', () => {
    expect(previewLine({ ...box, matched: 1, owners: 0 })).toBe('box 3: 1 login');
    expect(previewLine({ ...box, matched: 2, owners: 0 })).toBe('box 3: 2 logins');
    expect(previewLine({ ...box, matched: 1, owners: 1 })).toBe(
      'box 3: 1 login, the owner among them',
    );
    expect(previewLine({ ...box, matched: null, owners: 0 })).toBe('box 3: no login list yet');
  });
});

describe('bans', () => {
  it('an archive ban retires, never lifts', () => {
    expect(banState({ kind: 'disable', liftedAt: null })).toBe('active');
    expect(banState({ kind: 'disable', liftedAt: '2026-11-09T00:00:00Z' })).toBe('lifted');
    expect(banState({ kind: 'archive', liftedAt: '2026-11-09T00:00:00Z' })).toBe('retired');
    expect(liftLabel('disable')).toBe('Lift');
    expect(liftLabel('archive')).toBe('Retire');
    expect(liftText('archive')).toContain('never enables');
  });
  it('lists the keys', () => {
    expect(banKeysText({ emails: ['a@x.com'], issuer: 'https://i', oid: 'o1' })).toBe(
      'a@x.com, sign-in id o1',
    );
    expect(banKeysText({ emails: ['a@x.com'], issuer: null, oid: null })).toBe('a@x.com');
  });
});

describe('withFleet', () => {
  const icon = (() => null) as never;
  const groups = [
    {
      label: 'Settings',
      items: [
        { name: 'Users', href: '/settings/users', icon },
        { name: 'Fleet', href: FLEET_HREF, icon },
      ],
    },
    { label: 'Other', items: [{ name: 'Fleet', href: FLEET_HREF, icon }] },
  ];
  it('keeps Fleet on a Control Center', () => {
    expect(withFleet(groups, true)).toEqual(groups);
    expect(fleetOffered(FLEET_HREF, true)).toBe(true);
  });
  it('drops Fleet elsewhere, and a group it leaves empty', () => {
    expect(withFleet(groups, false)).toEqual([
      { label: 'Settings', items: [{ name: 'Users', href: '/settings/users', icon }] },
    ]);
    expect(fleetOffered(FLEET_HREF, false)).toBe(false);
    expect(fleetOffered('/settings/users', false)).toBe(true);
  });
});
