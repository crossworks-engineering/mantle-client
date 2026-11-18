import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => [] as Array<{ url: string; method: string; body: unknown }>);
/** A brain before `seen`: its strict folder PATCH refuses the field. */
const strictPatch = vi.hoisted(() => ({ on: false }));
const fetched = vi.hoisted(() => ({ answer: null as unknown }));

vi.mock('@mantle/web-ui/api-fetch', () => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly body?: Record<string, unknown>,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    apiFetch: vi.fn(async () => fetched.answer),
    apiSend: vi.fn(async (url: string, method: string, body?: unknown) => {
      sent.push({ url, method, body });
      if (
        strictPatch.on &&
        method === 'PATCH' &&
        body &&
        typeof body === 'object' &&
        'seen' in body
      ) {
        throw new ApiError("Unrecognized key(s) in object: 'seen'", 400);
      }
      return { folder: { id: 'f1' }, ok: true, moved: 1, failed: [] };
    }),
  };
});

import {
  batchesOf,
  createTreeFolder,
  deleteTreeFolder,
  fetchFolderPage,
  MOVE_BATCH,
  moveTreeItems,
  moveTreeItemsBatched,
  patchTreeFolder,
} from './tree-api';

beforeEach(() => {
  sent.length = 0;
  strictPatch.on = false;
});

describe('tree writes', () => {
  it('go to the owner tree by default', async () => {
    await createTreeFolder('notes', null, 'A');
    await patchTreeFolder('notes', 'f1', { name: 'B' });
    await deleteTreeFolder('notes', 'f1', true);
    await moveTreeItems('notes', ['i1'], 'f1', true);
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      'POST /api/tree/notes/folders',
      'PATCH /api/tree/notes/folders/f1',
      'DELETE /api/tree/notes/folders/f1?confirm=true',
      'POST /api/tree/notes/move',
    ]);
  });

  it('sends a new folder’s icon and colour in the same POST, and nothing for none', async () => {
    await createTreeFolder('notes', null, 'A', 'owner', {
      icon: 'lucide:briefcase',
      color: 'cyan',
    });
    expect(sent.at(-1)).toEqual({
      url: '/api/tree/notes/folders',
      method: 'POST',
      body: { parentId: null, name: 'A', icon: 'lucide:briefcase', color: 'cyan' },
    });
    await createTreeFolder('notes', 'p1', 'B', 'owner', { icon: '', color: null });
    expect(sent.at(-1)).toEqual({
      url: '/api/tree/notes/folders',
      method: 'POST',
      body: { parentId: 'p1', name: 'B' },
    });
  });

  it('every login writes to /api/tree (W6b: the member tree is gone)', async () => {
    await createTreeFolder('files', 'p1', 'Mine');
    await patchTreeFolder('files', 'f1', { name: 'Ours' });
    await deleteTreeFolder('files', 'f1', false);
    await moveTreeItems('files', ['i1'], null, false);
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([
      'POST /api/tree/files/folders',
      'PATCH /api/tree/files/folders/f1',
      'DELETE /api/tree/files/folders/f1',
      'POST /api/tree/files/move',
    ]);
    expect(sent.some((s) => s.url.startsWith(['/api', 'member'].join('/')))).toBe(false);
  });
});

describe('a confirmed write says what it was shown (seen)', () => {
  it('sends seen on a confirmed folder change, move and delete', async () => {
    await patchTreeFolder('notes', 'f1', { parentId: 'f2', confirm: true, seen: 3 });
    await moveTreeItems('notes', ['i1'], 'f1', true, 'owner', 2);
    await deleteTreeFolder('notes', 'f1', true, 'owner', 4);
    expect(sent[0]!.body).toEqual({ parentId: 'f2', confirm: true, seen: 3 });
    expect(sent[1]!.body).toEqual({ ids: ['i1'], folderId: 'f1', confirm: true, seen: 2 });
    expect(sent[2]!.url).toBe('/api/tree/notes/folders/f1?confirm=true&seen=4');
  });

  it('sends no seen without confirm', async () => {
    await moveTreeItems('notes', ['i1'], null, false, 'owner', 2);
    await deleteTreeFolder('notes', 'f1', false, 'owner', 4);
    expect(sent[0]!.body).toEqual({ ids: ['i1'], folderId: null });
    expect(sent[1]!.url).toBe('/api/tree/notes/folders/f1');
  });

  it('repeats a folder change without seen for a brain that refuses the field', async () => {
    strictPatch.on = true;
    await patchTreeFolder('notes', 'f1', { parentId: null, confirm: true, seen: 1 });
    expect(sent.map((x) => x.body)).toEqual([
      { parentId: null, confirm: true, seen: 1 },
      { parentId: null, confirm: true },
    ]);
  });
});

describe('the owner tree answer', () => {
  it('leaves an owner page as it came', async () => {
    const owner = {
      kind: 'notes',
      folder: null,
      crumbs: [],
      folders: [],
      items: [],
      sort: 'updated',
      nextCursor: null,
    };
    fetched.answer = owner;
    expect(await fetchFolderPage('notes', null, 'updated', null)).toBe(owner);
  });
});

describe('a move of many items', () => {
  it('cuts the ids in runs of the brain cap, in order', () => {
    expect(MOVE_BATCH).toBe(200);
    expect(batchesOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batchesOf([])).toEqual([]);
  });

  it('sends one call per run of 200 and adds up what moved', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `i${i}`);
    const done = new Set<number>();
    const res = await moveTreeItemsBatched('files', ids, 'f1', done);
    const calls = sent.filter((s) => s.url === '/api/tree/files/move');
    expect(calls.map((c) => (c.body as { ids: string[] }).ids.length)).toEqual([200, 200, 50]);
    expect((calls[2]!.body as { ids: string[] }).ids[0]).toBe('i400');
    expect(res).toEqual({ moved: 3, failed: [] });
    expect([...done]).toEqual([0, 1, 2]);
  });

  it('sends again only the runs not yet done (a repeat after a confirm)', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `i${i}`);
    await moveTreeItemsBatched('files', ids, 'f1', new Set([0, 1]), true, 'owner', 4);
    const calls = sent.filter((s) => s.url === '/api/tree/files/move');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ confirm: true, seen: 4, folderId: 'f1' });
    expect((calls[0]!.body as { ids: string[] }).ids).toHaveLength(50);
  });
});
