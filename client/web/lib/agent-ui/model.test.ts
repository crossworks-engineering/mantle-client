import { describe, expect, it } from 'vitest';
import {
  cutText,
  elementRefusal,
  nameMatches,
  parseTarget,
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
    expect(riskOfRequest('POST', '/api/tasks?ws=1')).toBeNull();
    expect(riskOfRequest('PATCH', '/api/notes/1')).toBeNull();
    expect(riskOfRequest('PUT', '/api/pages/1/draft')).toBeNull();
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
      '',
      42,
    ]) {
      expect(safeAgentRoute(p)).toBeNull();
    }
  });
});

describe('elementRefusal', () => {
  const plain = { inHost: false, risk: null, inAlertDialog: false, secret: false };

  it('the agent never presses its own controls', () => {
    expect(elementRefusal({ ...plain, inHost: true }, 'click')).toBe('host_control');
  });

  it('a risky control or a confirm is the user’s to press', () => {
    expect(elementRefusal({ ...plain, risk: 'delete' }, 'click')).toBe('needs_user');
    expect(elementRefusal({ ...plain, inAlertDialog: true }, 'click')).toBe('needs_user');
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

  it('cuts long text', () => {
    expect(cutText('a  b\n c')).toBe('a b c');
    expect(cutText('x'.repeat(100))).toHaveLength(80);
  });
});
