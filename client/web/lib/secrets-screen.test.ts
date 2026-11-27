import { describe, expect, it } from 'vitest';
import { ApiError } from '@mantle/web-ui/api-fetch';
import {
  SECRET_GONE_TEXT,
  secretFailureText,
  secretsFailureOf,
  secretsOffered,
  secretsOfferedOf,
  withKeptCaps,
  withSecrets,
} from './secrets-screen';

describe('secretsOfferedOf: who the shell offers the Secrets screen to', () => {
  it('a login with the keys area, on any brain', () => {
    expect(secretsOfferedOf({ areas: ['keys'], treeKinds: [] })).toBe(true);
    expect(secretsOfferedOf({ areas: ['settings', 'keys'] })).toBe(true);
    // A brain that names no areas answered the shell for an admin only.
    expect(secretsOfferedOf({})).toBe(true);
  });

  it('a member, only when the brain names secrets among its tree kinds', () => {
    expect(secretsOfferedOf({ areas: [], treeKinds: ['files', 'notes', 'secrets'] })).toBe(true);
    expect(secretsOfferedOf({ areas: [], treeKinds: ['files', 'notes'] })).toBe(false);
    expect(secretsOfferedOf({ areas: [] })).toBe(false);
    expect(secretsOfferedOf({ areas: [], treeKinds: 'secrets' })).toBe(false);
  });

  it('an Admin user without the keys area follows the tree kinds too', () => {
    expect(secretsOfferedOf({ areas: ['users'], treeKinds: ['secrets'] })).toBe(true);
    expect(secretsOfferedOf({ areas: ['users'], treeKinds: [] })).toBe(false);
  });

  it('no shell yet: nothing hides while it loads', () => {
    expect(secretsOfferedOf(null)).toBe(true);
    expect(secretsOfferedOf(undefined)).toBe(true);
  });
});

describe('withSecrets: the nav without the Secrets row', () => {
  const groups = [
    { label: 'Work', items: [{ href: '/pages' }, { href: '/secrets' }], defaultHead: ['/secrets'] },
    { label: 'Vault', items: [{ href: '/secrets' }] },
  ];

  it('keeps every row when the brain offers the screen', () => {
    expect(withSecrets(groups, true)).toEqual(groups);
  });

  it('drops the row, its cold-start head, and a group left empty', () => {
    expect(withSecrets(groups, false)).toEqual([
      { label: 'Work', items: [{ href: '/pages' }], defaultHead: [] },
    ]);
  });

  it('matches the screen and what is under it, nothing else', () => {
    expect(secretsOffered('/secrets', false)).toBe(false);
    expect(secretsOffered('/secrets/abc', false)).toBe(false);
    expect(secretsOffered('/secretsx', false)).toBe(true);
    expect(secretsOffered('/settings/keys', false)).toBe(true);
    expect(secretsOffered('/secrets', true)).toBe(true);
  });
});

describe('secretsFailureOf: fixed words, never the error text', () => {
  it('403 is refused, 404 is gone, the rest is an error to retry', () => {
    expect(secretsFailureOf(new ApiError('forbidden', 403, {}))).toBe('refused');
    expect(secretsFailureOf(new ApiError('not found', 404, {}))).toBe('gone');
    expect(secretsFailureOf(new ApiError('boom', 500, {}))).toBe('error');
    expect(secretsFailureOf(new Error('network'))).toBe('error');
  });
});

describe('withKeptCaps: a saved secret keeps the caps the screen holds', () => {
  const prev = {
    id: 's1',
    title: 'old',
    mayEdit: true,
    mayManage: false,
    mayMove: false,
    workspaces: [{ id: 'w1', name: 'Team' }],
    hasLink: false,
  };

  it('fills what the answer does not carry', () => {
    expect(withKeptCaps({ id: 's1', title: 'new' }, prev)).toEqual({ ...prev, title: 'new' });
  });

  it('the answer wins where it carries a cap', () => {
    const next = { id: 's1', title: 'new', mayEdit: false, mayManage: true };
    expect(withKeptCaps(next, prev)).toMatchObject({ mayEdit: false, mayManage: true });
  });

  it('adds nothing the screen never held', () => {
    expect(withKeptCaps({ id: 's1' }, { id: 's1' })).toEqual({ id: 's1' });
  });
});

describe('secretFailureText: fixed words for a failed act', () => {
  it('says who may not, by the act', () => {
    const refused = new ApiError('forbidden', 403, { reason: 'item-workspace' });
    expect(secretFailureText(refused, 'reveal')).toBe('You cannot read this secret.');
    expect(secretFailureText(refused, 'save')).toBe('You cannot change this secret.');
    expect(secretFailureText(refused, 'delete')).toBe('You cannot delete this secret.');
    expect(secretFailureText(refused, 'create')).toBe('You cannot add a secret here.');
  });

  it('a secret that is gone says so', () => {
    expect(secretFailureText(new ApiError('not found', 404), 'reveal')).toBe(SECRET_GONE_TEXT);
  });

  it("never repeats the brain's error text", () => {
    const leaky = new ApiError('fields.0.value: hunter2 is too long', 400, {
      error: 'hunter2',
    });
    for (const act of ['reveal', 'save', 'create', 'delete'] as const) {
      expect(secretFailureText(leaky, act)).not.toContain('hunter2');
    }
  });
});
