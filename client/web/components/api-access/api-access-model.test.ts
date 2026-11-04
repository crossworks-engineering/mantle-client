/**
 * Settings > API access, the pure half: the create body the dialog sends,
 * the scope line, the list order and the example commands.
 */
import { describe, expect, it } from 'vitest';
import type { AccessKeyView } from '@mantle/client-types';
import {
  createBody,
  defaultExpiryChoice,
  expiryChoicesFor,
  expiryLabel,
  exampleCommands,
  offersRiskyTools,
  scopeLine,
  sortKeys,
  type CreateForm,
} from './api-access-model';

const form = (patch: Partial<CreateForm> = {}): CreateForm => ({
  name: 'Backup script',
  access: 'read',
  allAreas: true,
  areas: [],
  expiry: '90',
  riskyTools: '',
  password: 'secret words',
  ...patch,
});

/** A login with the keys area (no longest expiry), and one without. */
const KEYS_AREA = { maxExpiryDays: null };
const MEMBER = { maxExpiryDays: 90 };

const key = (patch: Partial<AccessKeyView>): AccessKeyView => ({
  id: 'k',
  name: 'k',
  prefix: 'mtlk_abcdefgh',
  login: { id: 'l', email: 'a@example.com', displayName: null, role: 'admin' },
  access: 'read',
  areas: null,
  riskyTools: [],
  status: 'active',
  expiresAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  createdBy: null,
  lastUsedAt: null,
  lastUsedIp: null,
  revokedAt: null,
  ...patch,
});

describe('API access: create body', () => {
  it('sends all areas as null, never a login, the expiry in days and the password', () => {
    expect(createBody(form(), KEYS_AREA)).toEqual({
      body: {
        name: 'Backup script',
        access: 'read',
        areas: null,
        expiresInDays: 90,
        password: 'secret words',
      },
    });
    const never = createBody(form({ expiry: 'never', access: 'read_write' }), KEYS_AREA);
    expect(never).toEqual({
      body: {
        name: 'Backup script',
        access: 'read_write',
        areas: null,
        expiresInDays: null,
        password: 'secret words',
      },
    });
  });

  it('sends the ticked areas once each', () => {
    const r = createBody(form({ allAreas: false, areas: ['tasks', 'pages', 'tasks'] }), MEMBER);
    expect('body' in r && r.body.areas).toEqual(['tasks', 'pages']);
  });

  it('names the field that is wrong', () => {
    expect(createBody(form({ name: '  ' }), KEYS_AREA)).toMatchObject({ field: 'name' });
    expect(createBody(form({ allAreas: false, areas: [] }), KEYS_AREA)).toMatchObject({
      field: 'areas',
    });
    expect(createBody(form({ riskyTools: 'email_send, Bad-Name' }), KEYS_AREA)).toMatchObject({
      field: 'riskyTools',
    });
  });

  it('sends risky tools only for a login with the keys area (no longest expiry, W8)', () => {
    expect(offersRiskyTools(KEYS_AREA)).toBe(true);
    expect(offersRiskyTools(MEMBER)).toBe(false);
    const ok = createBody(form({ riskyTools: 'web_search, email_send web_search' }), KEYS_AREA);
    expect('body' in ok && ok.body.riskyTools).toEqual(['web_search', 'email_send']);
    const member = createBody(form({ riskyTools: 'web_search' }), MEMBER);
    expect('body' in member && member.body.riskyTools).toBeUndefined();
  });

  it('starts on the brain default expiry when it is a choice', () => {
    expect(defaultExpiryChoice(90)).toBe('90');
    expect(defaultExpiryChoice(30)).toBe('30');
    expect(defaultExpiryChoice(45)).toBe('365');
    expect(defaultExpiryChoice(90, 30)).toBe('30');
    expect(defaultExpiryChoice(90, 60)).toBe('60');
  });

  it('the expiry choices follow the brain maxExpiryDays, never the role (W8)', () => {
    expect(expiryChoicesFor(null)).toEqual(['30', '90', '365', 'never']);
    expect(expiryChoicesFor(90)).toEqual(['30', '90']);
    expect(expiryChoicesFor(30)).toEqual(['30']);
    // A longest expiry that is not a step is a choice of its own.
    expect(expiryChoicesFor(60)).toEqual(['30', '60']);
    expect(expiryChoicesFor(180)).toEqual(['30', '90', '180']);
    expect(expiryChoicesFor(7)).toEqual(['7']);
    expect(expiryChoicesFor(3650)).toEqual(['30', '90', '365', '3650']);
    expect(createBody(form({ expiry: 'never' }), MEMBER)).toMatchObject({ field: 'expiry' });
    expect(createBody(form({ expiry: '365' }), MEMBER)).toMatchObject({ field: 'expiry' });
    expect(createBody(form({ expiry: '60' }), { maxExpiryDays: 60 })).toMatchObject({
      body: { expiresInDays: 60 },
    });
  });

  it('words each choice', () => {
    expect(expiryLabel('30')).toBe('30 days');
    expect(expiryLabel('365')).toBe('1 year');
    expect(expiryLabel('1')).toBe('1 day');
    expect(expiryLabel('never')).toBe('Never');
  });

  it('with a company sign-in to confirm, asks for no password and sends none', () => {
    const ok = createBody(form({ password: '' }), { maxExpiryDays: 90 }, 'company');
    expect('body' in ok && 'password' in ok.body).toBe(false);
    const typed = createBody(form({ password: 'left over' }), { maxExpiryDays: 90 }, 'company');
    expect('body' in typed && 'password' in typed.body).toBe(false);
  });

  it('always asks for the password (needsPassword is always true since W8)', () => {
    for (const rules of [KEYS_AREA, MEMBER]) {
      expect(createBody(form({ password: '' }), rules)).toMatchObject({ field: 'password' });
      const ok = createBody(form({ password: 'pw' }), rules);
      expect('body' in ok && ok.body.password).toBe('pw');
    }
  });
});

describe('API access: list', () => {
  it('says what a key may do', () => {
    expect(scopeLine(key({}))).toBe('Read only · All areas');
    expect(scopeLine(key({ areas: ['search'] }))).toBe('Read only · Search (every kind)');
    expect(scopeLine(key({ access: 'read_write', areas: ['tasks', 'files'] }))).toBe(
      'Read and write · Tasks, Files',
    );
  });

  it('puts live keys first, newest first', () => {
    const sorted = sortKeys([
      key({ id: 'old', createdAt: '2026-09-01T00:00:00.000Z' }),
      key({ id: 'revoked', status: 'revoked', createdAt: '2026-10-05T00:00:00.000Z' }),
      key({ id: 'new', createdAt: '2026-10-02T00:00:00.000Z' }),
    ]);
    expect(sorted.map((k) => k.id)).toEqual(['new', 'old', 'revoked']);
  });

  it('builds the example commands on the brain origin', () => {
    const ex = exampleCommands('https://brain.example.com', 'mtlk_abcdefgh_secret');
    expect(ex.env).toBe("export MANTLE_KEY='mtlk_abcdefgh_secret'");
    expect(ex.http).toContain('https://brain.example.com/api/v1/whoami');
    expect(ex.http).toContain('Authorization: Bearer $MANTLE_KEY');
    expect(ex.mcp).toContain('https://brain.example.com/api/mcp');
    // The secret is on the export line only.
    expect(ex.http).not.toContain('mtlk_');
    expect(ex.mcp).not.toContain('mtlk_');
  });
});
