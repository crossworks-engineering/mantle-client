import { describe, expect, it } from 'vitest';
import { ApiError } from '@mantle/web-ui/api-fetch';
import type { TreeFolder } from '@mantle/web-ui/types/tree';
import {
  canGrantFolder,
  mergeRefusals,
  refusalHeading,
  seenOf,
  visibilityRefusal,
  workspaceChangeWords,
} from './sharing';

const folder = (over: Partial<TreeFolder> = {}): TreeFolder => ({
  id: 'f',
  path: 'notes.f',
  name: 'f',
  icon: null,
  color: null,
  depth: 1,
  parentId: null,
  share: null,
  inherited: null,
  system: false,
  folderCount: 0,
  itemCount: 0,
  workspaces: [],
  hasLink: false,
  ...over,
});

describe('canGrantFolder', () => {
  it('offers Access on an ordinary folder of a shareable kind', () => {
    expect(canGrantFolder('notes', folder())).toBe(true);
  });
  it('never on a system folder or an admin-only kind', () => {
    expect(canGrantFolder('files', folder({ system: true }))).toBe(false);
    expect(canGrantFolder('contacts', folder())).toBe(false);
    expect(canGrantFolder('tasks', folder())).toBe(false);
  });
  it('not on Recall until the brain grants its folders', () => {
    expect(canGrantFolder('recall', folder())).toBe(false);
  });
  it('offers Access on a folder of secrets: a workspace kind (brain 0400)', () => {
    expect(canGrantFolder('secrets', folder())).toBe(true);
    expect(canGrantFolder('secrets', folder({ system: true }))).toBe(false);
  });
  it('reads no level: the kind spec decides (W8)', () => {
    expect(canGrantFolder('files', folder())).toBe(true);
    expect(canGrantFolder('pages', folder())).toBe(true);
  });
});

describe('visibilityRefusal, the tree (workspaces, contract 29)', () => {
  const ws = (wsId: string, name: string) => ({ wsId, name });
  const change = {
    id: 'a',
    title: 'Plan',
    alsoVisibleTo: [ws('s', 'Sales'), ws('o', 'Ops')],
    removedFrom: [ws('t', 'Team')],
  };

  it('reads each item with the workspaces it gains and loses', () => {
    const err = new ApiError('x', 409, { error: 'visibility', changes: [change], total: 4 });
    const r = visibilityRefusal(err)!;
    expect(r).toEqual({ error: 'visibility', changes: [change], total: 4 });
    expect(seenOf(r)).toBe(4);
    expect(workspaceChangeWords(change)).toEqual({ added: 'Sales, Ops', removed: 'Team' });
    expect(workspaceChangeWords({ ...change, removedFrom: [] }).removed).toBeNull();
  });

  it('keeps a new item (id empty), drops malformed refs and rows', () => {
    const fresh = {
      id: '',
      title: 'new.txt',
      alsoVisibleTo: [ws('s', 'Sales'), { x: 1 }],
      removedFrom: [],
    };
    const err = new ApiError('x', 409, {
      error: 'visibility',
      changes: [fresh, { id: 'b', title: 'B', alsoVisibleTo: 'Sales' }, null],
      total: 1,
    });
    expect(visibilityRefusal(err)!.changes).toEqual([
      { id: '', title: 'new.txt', alsoVisibleTo: [ws('s', 'Sales')], removedFrom: [] },
    ]);
  });

  it('merges batches, each new item counted on its own', () => {
    const fresh = (title: string) => ({
      id: '',
      title,
      alsoVisibleTo: [ws('s', 'S')],
      removedFrom: [],
    });
    const merged = mergeRefusals([
      { error: 'visibility', changes: [change, fresh('x')], total: 2 },
      { error: 'visibility', changes: [change, fresh('y')], total: 2 },
    ]);
    expect(merged.changes.map((c) => c.title)).toEqual(['Plan', 'x', 'y']);
    expect(merged.total).toBe(4);
  });
});

describe('visibilityRefusal, anything else', () => {
  const change = { id: 'a', title: 'Plan', alsoVisibleTo: [], removedFrom: [] };

  it('ignores any other 409 (a name clash)', () => {
    expect(visibilityRefusal(new ApiError('clash', 409, { error: 'clash' }))).toBeNull();
    expect(visibilityRefusal(new ApiError('clash', 409))).toBeNull();
  });
  it('ignores other statuses and non-API errors', () => {
    expect(visibilityRefusal(new ApiError('x', 400, { error: 'visibility', changes: [] }))).toBe(
      null,
    );
    expect(visibilityRefusal(new Error('x'))).toBeNull();
  });
  it('drops a level change (no levels since W8) and never reports fewer than it lists', () => {
    const level = { id: 'b', title: 'Old', from: 'admin', to: 'team' };
    const err = new ApiError('x', 409, {
      error: 'visibility',
      changes: [change, level, { id: 1 }, null],
      total: 0,
      alsoEmbeds: [level],
    });
    expect(visibilityRefusal(err)).toEqual({ error: 'visibility', changes: [change], total: 1 });
  });
  it('words the heading for one and for many', () => {
    expect(refusalHeading({ error: 'visibility', changes: [], total: 1 })).toMatch(/one item$/);
    expect(refusalHeading({ error: 'visibility', changes: [], total: 12 })).toMatch(/12 items$/);
    expect(seenOf({ error: 'visibility', changes: [], total: 4 })).toBe(4);
  });
});

describe('mergeRefusals', () => {
  const c = (id: string) => ({ id, title: id, alsoVisibleTo: [], removedFrom: [] });

  it('adds the totals and lists each item once', () => {
    const merged = mergeRefusals([
      { error: 'visibility', changes: [c('a'), c('b')], total: 5 },
      { error: 'visibility', changes: [c('b'), c('c')], total: 2 },
    ]);
    expect(merged.changes.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(merged.total).toBe(7);
  });

  it('keeps within one refusal’s list size', () => {
    const many = Array.from({ length: 80 }, (_, i) => c(`a${i}`));
    const more = Array.from({ length: 80 }, (_, i) => c(`b${i}`));
    const merged = mergeRefusals([
      { error: 'visibility', changes: many, total: 80 },
      { error: 'visibility', changes: more, total: 80 },
    ]);
    expect(merged.changes).toHaveLength(100);
    expect(merged.total).toBe(160);
  });
});
