import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APP_SHELL_ROUTES,
  cutText,
  decodePath,
  elementRefusal,
  heldText,
  isAgentRefusal,
  isBookkeepingRequest,
  lessonCallTag,
  linkRefusal,
  nameMatches,
  parseTarget,
  pickByName,
  riskOfRequest,
  safeAgentRoute,
} from './model';

describe('riskOfRequest', () => {
  it('never holds a read', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS'])
      expect(riskOfRequest(m, '/api/files/files')).toBeNull();
  });

  it('always holds a delete', () => {
    expect(riskOfRequest('DELETE', '/api/tasks/1')).toBe('delete');
  });

  it('holds writes that send, share, publish or change a setting', () => {
    expect(riskOfRequest('POST', '/api/messenger/conversations/x/messages')).toBe('send');
    expect(riskOfRequest('POST', '/api/email/send')).toBe('send');
    expect(riskOfRequest('POST', '/api/grants/move')).toBe('share');
    expect(riskOfRequest('PATCH', 'https://brain.invalid/api/pages/1/publish')).toBe('publish');
    expect(riskOfRequest('PUT', '/api/profile/sounds')).toBe('settings');
    expect(riskOfRequest('POST', '/api/access-keys')).toBe('settings');
  });

  it('holds a new turn, a publish, a restore and a share by field', () => {
    expect(riskOfRequest('POST', '/api/assistant/turn')).toBe('send');
    expect(riskOfRequest('PATCH', '/api/recall/maps/1', '{"published":true}')).toBe('publish');
    expect(riskOfRequest('POST', '/api/recall/revisions/1/restore')).toBe('publish');
    expect(riskOfRequest('PATCH', '/api/pages/1', '{"visibility":"public"}')).toBe('share');
    expect(riskOfRequest('PATCH', '/api/pending/1')).toBe('settings');
  });

  it('lets an ordinary create or edit through', () => {
    expect(riskOfRequest('POST', '/api/tasks')).toBeNull();
    expect(riskOfRequest('POST', '/api/notes', '{"title":"Milk","content":"x"}')).toBeNull();
    expect(riskOfRequest('PATCH', '/api/notes/1')).toBeNull();
    expect(riskOfRequest('PUT', '/api/pages/1/draft')).toBeNull();
  });
});

describe('riskOfRequest reads the path decoded', () => {
  it('a percent-encoded risky path is held as its plain spelling', () => {
    expect(riskOfRequest('POST', '/api/%73hares')).toBe('share');
    expect(riskOfRequest('POST', '/api/pages/1/%70ublish')).toBe('publish');
    expect(riskOfRequest('PUT', '/api/%2573ettings/x')).toBe('settings');
    expect(riskOfRequest('POST', '/api/assistant/%74urn')).toBe('send');
  });

  it('a path that does not decode is held', () => {
    expect(riskOfRequest('POST', '/api/notes/%E0%A4%A')).toBe('settings');
    expect(decodePath('/a%zz')).toBeNull();
    expect(decodePath('/api/%2573hares')).toBe('/api/shares');
  });

  it('holds the Admin areas the brain refuses too', () => {
    for (const path of [
      '/api/network/x',
      '/api/peers',
      '/api/studio/reset',
      '/api/mcp-connectors/1',
      '/api/external-access',
      '/api/model-combos/1',
      '/api/updates/apply',
      '/api/tool-groups/1',
      '/api/gateway-services',
    ]) {
      expect(riskOfRequest('POST', path)).toBe('settings');
    }
    expect(riskOfRequest('POST', '/api/studio/pages')).toBeNull();
  });
});

describe('riskOfRequest keeps step with the brain (fix round 2)', () => {
  it('a write aimed at a workspace is workspace_target', () => {
    expect(riskOfRequest('POST', '/api/tasks?ws=1')).toBe('workspace_target');
    expect(riskOfRequest('PATCH', 'https://brain.invalid/api/notes/1?WS=b')).toBe(
      'workspace_target',
    );
  });

  it('a move field at any depth is move', () => {
    for (const f of ['move', 'copy_to', 'parentId', 'parent_id', 'folderId', 'folder_id']) {
      expect(riskOfRequest('PATCH', '/api/pages/1', JSON.stringify({ a: [{ [f]: 'x' }] }))).toBe(
        'move',
      );
    }
    const form = new FormData();
    form.set('folderId', 'f1');
    expect(riskOfRequest('POST', '/api/files/files', form)).toBe('move');
    expect(riskOfRequest('POST', '/api/tree/pages/move')).toBe('move');
  });

  it('a duplicate or copy route is copy, a commit is publish', () => {
    expect(riskOfRequest('POST', '/api/apps/1/duplicate')).toBe('copy');
    expect(riskOfRequest('POST', '/api/pages/1/copy')).toBe('copy');
    expect(riskOfRequest('POST', '/api/tables/1/commit')).toBe('publish');
  });

  it('the journal and contacts are admin_only', () => {
    expect(riskOfRequest('POST', '/api/journal')).toBe('admin_only');
    expect(riskOfRequest('PATCH', '/api/contacts/1')).toBe('admin_only');
  });

  it('a sharing field the brain names is share, in any case', () => {
    for (const f of ['shared', 'sharing', 'isPublic', 'access', 'members', 'owner'])
      expect(riskOfRequest('PATCH', '/api/pages/1', JSON.stringify({ [f]: 1 }))).toBe('share');
  });
});

describe('riskOfRequest, fix round 3', () => {
  it('an app PATCH that changes what it may reach is admin_only', () => {
    for (const f of ['mcpAccess', 'dataReadOnly', 'trustTools'])
      expect(riskOfRequest('PATCH', '/api/apps/a1', JSON.stringify({ [f]: true }))).toBe(
        'admin_only',
      );
    expect(riskOfRequest('PATCH', '/api/apps/a1', '{"title":"x"}')).toBeNull();
  });

  it('throwing a draft away is held; saving one is not', () => {
    for (const kind of ['pages', 'tables', 'draws'])
      expect(riskOfRequest('POST', `/api/${kind}/1/discard-draft`)).toBe('discard');
    expect(riskOfRequest('PUT', '/api/pages/1/draft', '{"doc":{}}')).toBeNull();
    expect(heldText('discard')).toBe('throw away a draft');
  });
});

describe('heldText', () => {
  it('says the brain’s reason in plain words', () => {
    expect(heldText('refused', 'workspace_target')).toBe('put something in a workspace');
    expect(heldText('refused', 'move')).toBe('move something to another place');
    expect(heldText('refused', 'tree_move')).toBe('move something to another place');
    expect(heldText('refused', 'copy')).toBe('make a copy of something');
    expect(heldText('refused', 'publish')).toBe('publish something');
    expect(heldText('refused', 'admin_only')).toBe(
      'change something only an Admin user may change',
    );
    expect(heldText('refused', 'sharing_field')).toBe('change who can see something');
  });

  it('an unknown or missing reason reads as the plain refusal', () => {
    expect(heldText('refused', 'toString')).toBe('do something only you may do');
    expect(heldText('refused', null)).toBe('do something only you may do');
    expect(heldText('settings')).toBe('change a setting');
  });
});

describe('the brain’s refusal', () => {
  it('is a 403 with error agent_refused, nothing else', () => {
    expect(isAgentRefusal(403, { error: 'agent_refused', reason: 'x' })).toBe(true);
    expect(isAgentRefusal(403, { error: 'forbidden' })).toBe(false);
    expect(isAgentRefusal(409, { error: 'agent_refused' })).toBe(false);
    expect(isAgentRefusal(403, null)).toBe(false);
  });

  it('a lesson tags its requests lesson:<uuid>', () => {
    expect(lessonCallTag('0a0a0a0a-0a0a-40a0-80a0-000000000001')).toBe(
      'lesson:0a0a0a0a-0a0a-40a0-80a0-000000000001',
    );
  });
});

describe('isBookkeepingRequest', () => {
  it('is a frame ticket or an open counted, by POST', () => {
    expect(isBookkeepingRequest('POST', '/api/apps/a1/frame-ticket')).toBe(true);
    expect(isBookkeepingRequest('post', 'https://brain.invalid/api/presents/p1/frame-ticket')).toBe(
      true,
    );
    expect(isBookkeepingRequest('POST', '/api/tree/items/i1/opened')).toBe(true);
    expect(isBookkeepingRequest('POST', '/api/tree/items/i1/%6Fpened')).toBe(true);
  });

  it('is nothing else: no other method, path or a write beside it', () => {
    expect(isBookkeepingRequest('PUT', '/api/apps/a1/frame-ticket')).toBe(false);
    expect(isBookkeepingRequest('POST', '/api/apps/a1/db-broker')).toBe(false);
    expect(isBookkeepingRequest('POST', '/api/apps/a1/frame-ticket/x')).toBe(false);
    expect(isBookkeepingRequest('POST', '/api/formulas/f1/evaluate')).toBe(false);
    expect(isBookkeepingRequest('POST', '/api/journal')).toBe(false);
    expect(isBookkeepingRequest('POST', '/api/files/files')).toBe(false);
    expect(isBookkeepingRequest('POST', '/api/tree/items/i1/pin')).toBe(false);
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
