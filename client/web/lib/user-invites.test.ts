import { describe, expect, it } from 'vitest';
import type { MemberInviteRow } from '@mantle/client-types';
import {
  CODE_NOT_VALID,
  acceptOutcome,
  inviteName,
  newLinkSeed,
  openInvites,
  inviteCreateErrorText,
  inviteLink,
  readInviteCode,
  validateInviteForm,
} from './user-invites';

describe('inviteLink', () => {
  it('prefixes the client origin to the brain link path', () => {
    expect(inviteLink('https://app.example.com', '/invite?code=AbC23xyz')).toBe(
      'https://app.example.com/invite?code=AbC23xyz',
    );
    // Brains with the client logins audit fixes: the code in the fragment.
    expect(inviteLink('https://app.example.com', '/invite#code=AbC23xyz')).toBe(
      'https://app.example.com/invite#code=AbC23xyz',
    );
  });

  it('never doubles or drops the slash', () => {
    expect(inviteLink('https://app.example.com/', '/invite?code=a')).toBe(
      'https://app.example.com/invite?code=a',
    );
    expect(inviteLink('https://app.example.com', 'invite?code=a')).toBe(
      'https://app.example.com/invite?code=a',
    );
  });
});

describe('readInviteCode', () => {
  it('keeps a bare code as typed, case and all', () => {
    expect(readInviteCode('  AbCd2345efGH6789 ')).toBe('AbCd2345efGH6789');
  });

  it('treats an old 8-character team code like any other code: the brain refuses it', () => {
    expect(readInviteCode('Xy7kPq2M')).toBe('Xy7kPq2M');
  });

  it('drops spaces a person typed inside the code', () => {
    expect(readInviteCode('AbCd 2345 efGH')).toBe('AbCd2345efGH');
  });

  it('pulls the code out of a pasted link', () => {
    expect(readInviteCode('https://app.example.com/invite?code=AbC23xyz')).toBe('AbC23xyz');
    expect(readInviteCode('/invite?code=AbC23xyz')).toBe('AbC23xyz');
    // Links from brains with the audit fixes carry it in the fragment.
    expect(readInviteCode('https://app.example.com/invite#code=AbC23xyz')).toBe('AbC23xyz');
    expect(readInviteCode('/invite#code=AbC23xyz')).toBe('AbC23xyz');
  });
});

describe('inviteCreateErrorText', () => {
  it('names an existing login by email', () => {
    expect(inviteCreateErrorText(409, { reason: 'email-has-login', error: 'x' })).toMatch(
      /already signs in with that email/,
    );
  });

  it('names an existing login for the contact', () => {
    expect(inviteCreateErrorText(409, { reason: 'contact-has-login' })).toMatch(
      /contact already has a login/,
    );
  });

  it('asks for an email when the contact has none', () => {
    expect(inviteCreateErrorText(400, { reason: 'no-email' })).toMatch(/Enter the email/);
  });

  it('says plainly that a former client login cannot come back (W8)', () => {
    expect(inviteCreateErrorText(409, { reason: 'email-was-client', error: 'x' })).toBe(
      'That email belonged to a client login. It cannot be invited or given a new login.',
    );
    expect(inviteCreateErrorText(409, { reason: 'contact-was-client' })).toBe(
      'That contact belonged to a client login. It cannot be invited or given a new login.',
    );
  });

  it('says a contact is gone', () => {
    expect(inviteCreateErrorText(400, { reason: 'contact-not-found' })).toMatch(
      /not in this brain/,
    );
  });

  it('reads a bare 400 as a bad email', () => {
    expect(inviteCreateErrorText(400, { error: 'Choose a contact or enter an email.' })).toMatch(
      /valid email/,
    );
  });

  it('falls back to the brain message, then a generic line', () => {
    expect(inviteCreateErrorText(500, { error: 'Boom.' })).toBe('Boom.');
    expect(inviteCreateErrorText(502, undefined)).toMatch(/Could not create the invite/);
  });
});

describe('validateInviteForm', () => {
  const ok = { code: 'AbCd2345efGH6789', password: 'long-enough', confirm: 'long-enough' };

  it('accepts a complete form', () => {
    expect(validateInviteForm(ok)).toEqual({});
  });

  it('needs a code', () => {
    expect(validateInviteForm({ ...ok, code: '   ' }).code).toBeDefined();
  });

  it('needs at least 8 characters on a brain from before the rule', () => {
    expect(validateInviteForm({ ...ok, password: 'short77', confirm: 'short77' }).password).toMatch(
      /at least 8/,
    );
    expect(validateInviteForm({ ...ok, password: 'eight888', confirm: 'eight888' })).toEqual({});
  });

  it('needs the repeat to match', () => {
    expect(validateInviteForm({ ...ok, confirm: 'something-else' }).confirm).toMatch(/differ/);
  });

  it('refuses over 1024 characters as too long, as the brain does (not as a bad code)', () => {
    const long = 'x'.repeat(1025);
    expect(validateInviteForm({ ...ok, password: long, confirm: long }).password).toBe(
      'That password is too long.',
    );
    const max = 'x'.repeat(1024);
    expect(validateInviteForm({ ...ok, password: max, confirm: max })).toEqual({});
  });
});

describe('the link code leaves the address at once (B12)', () => {
  const read = async (rel: string) => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  };

  it('the page renders the inline script first, before the brand image', async () => {
    for (const rel of ['../app/invite/page.tsx']) {
      const page = await read(rel);
      expect(page, rel).toMatch(/<main[^>]*>\s*<LinkCodeScript \/>/);
    }
  });

  it('the client takes the code in a layout effect (before the first paint)', async () => {
    for (const rel of ['../app/invite/invite-client.tsx']) {
      const client = await read(rel);
      expect(client, rel).toMatch(
        /useLayoutEffect\(\(\) => \{\s*const (code|taken) = read\w+Code\(takeLinkCode\(window, document\.documentElement\)\);/,
      );
    }
  });
});

describe('acceptOutcome', () => {
  it('carries a login that must link', () => {
    expect(acceptOutcome(200, { ok: true, email: 's@example.com', linkRequired: true })).toEqual({
      kind: 'ok',
      email: 's@example.com',
      linkRequired: true,
    });
  });
  it('is ok on a 200, with the login email', () => {
    expect(acceptOutcome(200, { ok: true, email: 'sam@example.com' })).toEqual({
      kind: 'ok',
      email: 'sam@example.com',
    });
  });

  it('reads a 401 as a bad code, never as signed out', () => {
    expect(acceptOutcome(401, { error: 'This invite is not valid. Ask for a new one.' })).toEqual({
      kind: 'bad-code',
      message: CODE_NOT_VALID,
    });
    expect(CODE_NOT_VALID).toMatch(/^That code is not valid/);
  });

  it('shows the brain rule on a 400', () => {
    expect(acceptOutcome(400, { error: 'Choose a password of at least 8 characters.' })).toEqual({
      kind: 'error',
      message: 'Choose a password of at least 8 characters.',
    });
  });

  it('says to wait on a 429', () => {
    expect(acceptOutcome(429, {}).kind).toBe('error');
    expect((acceptOutcome(429, {}) as { message: string }).message).toMatch(/Too many/);
  });

  it('is a generic error for anything else', () => {
    expect(acceptOutcome(502, 'nope')).toEqual({
      kind: 'error',
      message: 'Could not accept the invite. Try again.',
    });
  });
});

describe('the open invites in Settings > Users', () => {
  const row = (over: Partial<MemberInviteRow>): MemberInviteRow => ({
    id: 'i1',
    contactId: null,
    contactName: null,
    email: 'sam@example.invalid',
    displayName: null,
    state: 'open',
    createdAt: '2026-10-09T08:00:00.000Z',
    expiresAt: '2026-10-12T08:00:00.000Z',
    redeemedAt: null,
    redeemedLoginId: null,
    createdBy: null,
    ...over,
  });

  it('keeps only the open ones, in order', () => {
    const list = [
      row({ id: 'a' }),
      row({ id: 'b', state: 'redeemed', redeemedLoginId: 'L1' }),
      row({ id: 'c', state: 'expired' }),
      row({ id: 'd' }),
    ];
    expect(openInvites(list).map((i) => i.id)).toEqual(['a', 'd']);
    expect(openInvites(undefined)).toEqual([]);
  });

  it('names an invite by its name, else the contact, else the email', () => {
    expect(inviteName(row({ displayName: 'Sam', contactName: 'Sam B' }))).toBe('Sam');
    expect(inviteName(row({ contactName: 'Sam B' }))).toBe('Sam B');
    expect(inviteName(row({}))).toBe('sam@example.invalid');
  });

  it('labels each copy and the revoke', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const ui = readFileSync(
      fileURLToPath(new URL('../app/(app)/settings/users/invites.tsx', import.meta.url)),
      'utf8',
    );
    expect(ui).toContain('ariaLabel="Copy the invite link"');
    expect(ui).toContain('ariaLabel="Copy the code"');
    expect(ui).toMatch(/<HeaderIconButton\s+label="Revoke invite"/);
  });

  it('a New link starts with what the invite was made with', () => {
    expect(newLinkSeed(row({ displayName: 'Sam', email: 'sam@example.invalid' }))).toEqual({
      contact: null,
      email: 'sam@example.invalid',
      name: 'Sam',
    });
    expect(newLinkSeed(row({ contactId: 'c1', contactName: 'Sam B', displayName: 'Sam' }))).toEqual(
      {
        contact: { id: 'c1', name: 'Sam B', email: 'sam@example.invalid' },
        email: 'sam@example.invalid',
        name: 'Sam',
      },
    );
  });

  it('the one-time link outlives the invite pane, and closes only by Done', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
    const ui = read('../app/(app)/settings/users/invites.tsx');
    const screen = read('../app/(app)/settings/users/users-client.tsx');
    // The screen owns the dialog (a New link replaces the pane's invite).
    expect(screen).toMatch(/<InviteDialog\s+key=\{inviteSeed\.key\}/);
    expect(ui.slice(ui.indexOf('export function InviteDetail('))).not.toContain('<InviteDialog');
    // Selected only once the link is put away.
    expect(ui).toMatch(
      /if \(!o\) reset\(\);\s*onOpenChange\(o\);\s*if \(made\) onCreated\?\.\(made\.invite\.id\);/,
    );
    expect(ui).toContain('hideClose={!!created}');
    expect(ui).toContain('onEscapeKeyDown={(e) => created && e.preventDefault()}');
    expect(ui).toContain('onInteractOutside={(e) => created && e.preventDefault()}');
  });
});
