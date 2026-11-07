import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APP_SHELL_ROUTES,
  cutText,
  decodePath,
  elementRefusal,
  linkRefusal,
  nameMatches,
  parseTarget,
  pickByName,
  safeAgentRoute,
} from './model';

describe('decodePath', () => {
  it('undoes percent-encoding until it holds, or says it does not decode', () => {
    expect(decodePath('/a%zz')).toBeNull();
    expect(decodePath('/api/%2573hares')).toBe('/api/shares');
    expect(decodePath('/tasks')).toBe('/tasks');
  });
});

describe('linkRefusal', () => {
  const page = 'https://app.test/tasks';
  it('lets a link to an app route through', () => {
    expect(linkRefusal('/files', page)).toBeNull();
    expect(linkRefusal('https://app.test/pages/1', page)).toBeNull();
    expect(linkRefusal('notes', page)).toBeNull();
    expect(linkRefusal(null, page)).toBeNull();
  });

  it('refuses a same-origin link with a query, but for a lesson’s offer', () => {
    expect(linkRefusal('/tasks?new=1', page)).toBe('unsafe_route');
    expect(linkRefusal('/pages?ws=b1b1', page)).toBe('unsafe_route');
    expect(linkRefusal('/?lesson=1e552222-2222-4222-8222-222222222222', page)).toBeNull();
    expect(linkRefusal('/?lesson=x&ws=1', page)).toBe('unsafe_route');
    // A hash only scrolls.
    expect(linkRefusal('/files#top', page)).toBeNull();
  });

  it('refuses a link that leaves the app or opens a refused route', () => {
    for (const href of [
      'https://elsewhere.invalid/',
      '//elsewhere.invalid/x',
      'http://app.test/tasks',
      'javascript:alert(1)',
      'mailto:a@example.invalid',
      '/login',
      '/%6Cogin',
      '/api/files/files',
      '/invite/abc',
    ]) {
      expect(linkRefusal(href, page)).toBe('unsafe_route');
    }
  });
});

describe('safeAgentRoute', () => {
  it('takes an app path', () => {
    expect(safeAgentRoute('/tasks')).toBe('/tasks');
    expect(safeAgentRoute('/pages/0b8c7f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f')).toBeTruthy();
  });

  it('refuses a query, a hash, another origin and the sign-in screens', () => {
    for (const p of [
      '/tasks?lesson=1',
      '/files#x',
      '//evil.invalid/x',
      'https://evil.invalid',
      '/a\\b',
      '/login',
      '/logout',
      '/api/files/files',
      '/x\u0000y',
      '/x/../login',
      '/tasks/./x',
      '/onboarding',
      '/pair',
      '/pair/abc',
      '/nowhere',
      '/invite',
      '/%6Cogin',
      '/%2Fevil.invalid',
      '/x/%2E%2E/login',
      '/Login',
      '',
      42,
    ]) {
      expect(safeAgentRoute(p)).toBeNull();
    }
  });
});

describe('the app shell routes', () => {
  it('are the folders of client/web/app/(app)', () => {
    const dir = new URL('../../app/(app)/', import.meta.url);
    const folders = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('(') && !d.name.startsWith('_'))
      .map((d) => d.name)
      .sort();
    expect([...APP_SHELL_ROUTES].sort()).toEqual(folders);
  });

  it('the Desk and every screen of the shell are open', () => {
    expect(safeAgentRoute('/')).toBe('/');
    expect(safeAgentRoute('/settings/profile')).toBe('/settings/profile');
    expect(safeAgentRoute('/dev-tools')).toBe('/dev-tools');
  });
});

describe('elementRefusal', () => {
  const plain = { inHost: false, risk: null, inAlertDialog: false, secret: false };

  it('the agent never presses its own controls', () => {
    expect(elementRefusal({ ...plain, inHost: true }, 'click')).toBe('host_control');
  });

  it('a risky control or anything in a confirm is the user’s', () => {
    expect(elementRefusal({ ...plain, risk: 'delete' }, 'click')).toBe('needs_user');
    for (const action of ['click', 'type', 'select'] as const)
      expect(elementRefusal({ ...plain, inAlertDialog: true }, action)).toBe('needs_user');
  });

  it('a secret field is never typed in, though it may be focused', () => {
    expect(elementRefusal({ ...plain, secret: true }, 'type')).toBe('secret_field');
    expect(elementRefusal({ ...plain, secret: true }, 'click')).toBeNull();
  });

  it('anything else may be used', () => {
    expect(elementRefusal(plain, 'type')).toBeNull();
  });
});

describe('targets and names', () => {
  it('reads a target by id, ref, or role and name', () => {
    expect(parseTarget({ id: 'nav:/tasks' })).toEqual({ id: 'nav:/tasks' });
    expect(parseTarget({ ref: 'r3' })).toEqual({ ref: 'r3' });
    expect(parseTarget({ role: 'button', name: 'New task' })).toEqual({
      role: 'button',
      name: 'New task',
    });
    expect(parseTarget({ selector: '#x' })).toBeNull();
    expect(parseTarget({ role: 'button' })).toBeNull();
  });

  it('matches a name exactly first, else by its start', () => {
    expect(nameMatches('New task', 'new task')).toBe('exact');
    expect(nameMatches('New task from template', 'New task')).toBe('prefix');
    expect(nameMatches('Delete', 'New')).toBeNull();
  });

  it('an exact name in any role wins over a prefix', () => {
    const entries = [
      { ref: 'r1', role: 'option', name: 'Weekly' },
      { ref: 'r2', role: 'menuitem', name: 'Week' },
      { ref: 'r3', role: 'tab', name: 'Week' },
    ];
    const roles = ['option', 'menuitem', 'tab'];
    expect(pickByName(entries, roles, 'Week')).toMatchObject({ ref: 'r2' });
    expect(pickByName(entries, roles, 'Weekl')).toMatchObject({ ref: 'r1' });
    expect(pickByName(entries, roles, 'Month')).toEqual({ error: 'not_found' });
    expect(
      pickByName([...entries, { ref: 'r4', role: 'menuitem', name: 'week' }], roles, 'Week'),
    ).toEqual({ error: 'ambiguous' });
  });

  it('cuts long text', () => {
    expect(cutText('a  b\n c')).toBe('a b c');
    expect(cutText('x'.repeat(100))).toHaveLength(80);
  });
});
