import { describe, expect, it } from 'vitest';
import {
  banBody,
  banKeysText,
  banState,
  boxName,
  FLEET_HREF,
  fleetKeyProviders,
  fleetKeysOffered,
  fleetOffered,
  keyBoxText,
  keyUpdatePending,
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

describe('the fleet key update (phase 2)', () => {
  const at = '2026-11-10T00:00:00Z';
  const result = (ok: boolean, reason: string | null) => ({
    keyPending: null,
    keyResult: { service: 'openrouter', ok, reason, by: 'a@x', at },
  });
  it('offers the providers that need only a key', () => {
    const ids = fleetKeyProviders([{ id: 'openrouter' }, { id: 'custom' }, { id: 'local' }]).map(
      (p) => p.id,
    );
    expect(ids).toEqual(['openrouter']);
  });
  it('says what each box answered, never more', () => {
    expect(keyBoxText({ keyPending: null, keyResult: null })).toBeNull();
    expect(keyBoxText({ keyPending: { service: 'openrouter', by: 'a@x', at } })?.tone).toBe('wait');
    expect(keyBoxText(result(true, null))).toEqual({ tone: 'ok', text: 'Set and tested.' });
    expect(keyBoxText(result(false, 'untested'))?.tone).toBe('warn');
    expect(keyBoxText(result(false, 'failed'))?.text).toContain('keeps the key it had');
    expect(keyBoxText(result(false, 'expired'))?.text).toContain('deleted unsent');
    expect(keyBoxText(result(false, 'service'))?.text).toContain('Nothing was set');
    expect(keyBoxText(result(false, 'refused'))?.text).toContain('Nothing was set');
    expect(keyBoxText(result(false, 'unreachable'))?.text).toBe(
      'This box cannot reach the box over HTTPS. The box keeps the key it had.',
    );
  });
  it('is offered by a brain whose box rows carry the phase 2 fields', () => {
    const box = { url: 'https://b', label: null } as never as import('./fleet').FleetBox;
    expect(fleetKeysOffered([box])).toBe(false);
    expect(fleetKeysOffered([{ ...box, keyPending: null }])).toBe(true);
    expect(fleetKeysOffered([])).toBe(false);
  });
  it('reads again while a box waits', () => {
    const box = { url: 'https://b', label: null } as never as import('./fleet').FleetBox;
    expect(keyUpdatePending(undefined)).toBe(false);
    expect(keyUpdatePending([{ ...box, keyPending: null }])).toBe(false);
    expect(
      keyUpdatePending([{ ...box, keyPending: { service: 'openrouter', by: 'a@x', at } }]),
    ).toBe(true);
  });
});
