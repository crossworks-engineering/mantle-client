import { afterEach, describe, expect, it } from 'vitest';
import {
  createWsRewrite,
  createWorkspace,
  isCreateRoute,
  setCreateWorkspace,
  withCreateWs,
} from './create-workspace';

const WS = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';

afterEach(() => setCreateWorkspace(null));

describe('create routes name the switcher workspace (W6b)', () => {
  it('knows the eight create routes of the contract', () => {
    for (const p of [
      '/api/pages',
      '/api/notes',
      '/api/draws',
      '/api/tables',
      '/api/apps',
      '/api/files/files',
      '/api/files/folders',
      '/api/tree/pages/folders',
      '/api/tree/files/folders?x=1',
    ]) {
      expect(isCreateRoute(p), p).toBe(true);
    }
    for (const p of [
      '/api/pages/abc',
      '/api/pages/abc/commit',
      '/api/tree/pages/folders/f1',
      '/api/tree/pages/move',
      '/api/files/files/abc',
      '/api/apps/abc/build',
    ]) {
      expect(isCreateRoute(p), p).toBe(false);
    }
  });

  it('adds ws only on a create route with a workspace picked', () => {
    expect(withCreateWs('/api/pages')).toBe('/api/pages');
    setCreateWorkspace(WS);
    expect(createWorkspace()).toBe(WS);
    expect(withCreateWs('/api/pages')).toBe(`/api/pages?ws=${WS}`);
    expect(withCreateWs('/api/files/files?parent=a')).toBe(`/api/files/files?parent=a&ws=${WS}`);
    expect(withCreateWs('/api/pages/abc')).toBe('/api/pages/abc');
    setCreateWorkspace(null);
    expect(withCreateWs('/api/pages')).toBe('/api/pages');
  });

  it('takes an explicit workspace over the held one', () => {
    setCreateWorkspace(WS);
    expect(withCreateWs('/api/notes', null)).toBe('/api/notes');
    expect(withCreateWs('/api/notes', 'x')).toBe('/api/notes?ws=x');
  });
});

describe('the apiFetch rewrite', () => {
  it('names the workspace on a POST to a create route only', () => {
    setCreateWorkspace(WS);
    expect(createWsRewrite('/api/pages', 'POST')).toBe(`/api/pages?ws=${WS}`);
    expect(createWsRewrite('/api/pages', 'GET')).toBe('/api/pages');
    expect(createWsRewrite('/api/files/files', 'DELETE')).toBe('/api/files/files');
    expect(createWsRewrite('/api/pages/abc/commit', 'POST')).toBe('/api/pages/abc/commit');
  });
});

describe('every item kind the brain creates names the workspace', () => {
  it('knows the create routes W6b left out', () => {
    for (const p of [
      '/api/tasks',
      '/api/events',
      '/api/formulas',
      '/api/presents',
      '/api/recall/maps',
    ]) {
      expect(isCreateRoute(p), p).toBe(true);
    }
    for (const p of [
      '/api/tasks/abc',
      '/api/events/abc',
      '/api/formulas/abc',
      '/api/presents/abc/poster',
      '/api/recall/maps/abc',
      '/api/recall/maps/abc/publish',
    ]) {
      expect(isCreateRoute(p), p).toBe(false);
    }
  });

  it('knows that a duplicated or imported app is a new app', () => {
    for (const p of ['/api/apps/abc/duplicate', '/api/apps/import', '/api/apps/import-package']) {
      expect(isCreateRoute(p), p).toBe(true);
    }
    for (const p of ['/api/apps/a/b/duplicate', '/api/apps/abc/duplicates', '/api/apps/imports']) {
      expect(isCreateRoute(p), p).toBe(false);
    }
    setCreateWorkspace(WS);
    expect(createWsRewrite('/api/apps/abc/duplicate', 'POST')).toBe(
      `/api/apps/abc/duplicate?ws=${WS}`,
    );
  });

  it('adds ws to a new task, so it lands in the picked workspace', () => {
    setCreateWorkspace(WS);
    expect(createWsRewrite('/api/tasks', 'POST')).toBe(`/api/tasks?ws=${WS}`);
    expect(createWsRewrite('/api/tasks', 'GET')).toBe('/api/tasks');
    expect(createWsRewrite('/api/tasks/abc', 'PATCH')).toBe('/api/tasks/abc');
  });
});
