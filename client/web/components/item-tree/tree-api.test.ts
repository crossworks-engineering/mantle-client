import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => [] as Array<{ url: string; method: string; body: unknown }>);
/** A brain before `seen`: its strict folder PATCH refuses the field. */
const strictPatch = vi.hoisted(() => ({ on: false }));
const fetched = vi.hoisted(() => ({ answer: null as unknown }));
/** What each move call answers, in turn (an Error is thrown); empty = moved 1. */
const moveAnswers = vi.hoisted(() => [] as unknown[]);

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
      if (url.endsWith('/move') && moveAnswers.length) {
        const next = moveAnswers.shift();
        if (next instanceof Error) throw next;
        return next;
      }
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
  moveProgress,
  movesLeft,
  moveTreeItemsBatched,
  patchTreeFolder,
} from './tree-api';

beforeEach(() => {
  sent.length = 0;
  moveAnswers.length = 0;
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
    const progress = moveProgress();
    const res = await moveTreeItemsBatched('files', ids, 'f1', progress);
    const calls = sent.filter((s) => s.url === '/api/tree/files/move');
    expect(calls.map((c) => (c.body as { ids: string[] }).ids.length)).toEqual([200, 200, 50]);
    expect((calls[2]!.body as { ids: string[] }).ids[0]).toBe('i400');
    expect(res).toEqual({ moved: 3, failed: [] });
    expect([...progress.done]).toEqual([0, 1, 2]);
  });

  it('sends again only the runs not yet done (a repeat after a confirm)', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `i${i}`);
    const progress = { ...moveProgress(), done: new Set([0, 1]) };
    await moveTreeItemsBatched('files', ids, 'f1', progress, true, 'owner', 4);
    const calls = sent.filter((s) => s.url === '/api/tree/files/move');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ confirm: true, seen: 4, folderId: 'f1' });
    expect((calls[0]!.body as { ids: string[] }).ids).toHaveLength(50);
  });

  it('keeps what earlier runs did when a later run throws, and on the repeat', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `i${i}`);
    const failed = [
      { id: 'i3', error: 'name taken' },
      { id: 'i7', error: 'name taken' },
      { id: 'i9', error: 'locked' },
    ];
    const ask = new Error('would change who sees it');
    moveAnswers.push({ moved: 197, failed }, ask);
    const progress = moveProgress();
    await expect(moveTreeItemsBatched('files', ids, 'f1', progress)).rejects.toBe(ask);
    // Run 0 landed with its 3 failures; run 1 asked; nothing is lost.
    expect([...progress.done]).toEqual([0]);
    expect(progress.moved).toBe(197);
    expect(progress.failed).toEqual(failed);
    // Not moved yet: the 3 that failed, and all of runs 1 and 2.
    const left = movesLeft(ids, progress);
    expect(left).toHaveLength(3 + 250);
    expect(left.slice(0, 4)).toEqual(['i3', 'i7', 'i9', 'i200']);

    // After the confirm, the result covers every run, the first one too.
    moveAnswers.push({ moved: 200, failed: [] }, { moved: 50, failed: [] });
    const res = await moveTreeItemsBatched('files', ids, 'f1', progress, true, 'owner', 12);
    expect(res).toEqual({ moved: 447, failed });
    expect(movesLeft(ids, progress)).toEqual(['i3', 'i7', 'i9']);
  });

  it('sends confirm and seen on the first run not yet done only; later runs ask for themselves', async () => {
    const ids = Array.from({ length: 650 }, (_, i) => `i${i}`);
    const progress = { ...moveProgress(), done: new Set([0]) };
    await moveTreeItemsBatched('files', ids, 'f1', progress, true, 'owner', 12);
    const bodies = sent
      .filter((s) => s.url === '/api/tree/files/move')
      .map((c) => c.body as { ids: string[]; confirm?: boolean; seen?: number });
    expect(bodies.map((b) => b.ids[0])).toEqual(['i200', 'i400', 'i600']);
    expect(bodies[0]).toMatchObject({ confirm: true, seen: 12 });
    for (const b of bodies.slice(1)) {
      expect(b.confirm).toBeUndefined();
      expect(b.seen).toBeUndefined();
    }
  });

  it('stops at a later run that asks, and its own repeat confirms only that run', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `i${i}`);
    const ask = new Error('run 2 changes who sees it');
    moveAnswers.push({ moved: 200, failed: [] }, ask);
    const progress = { ...moveProgress(), done: new Set([0]) };
    await expect(moveTreeItemsBatched('files', ids, 'f1', progress, true, 'owner', 4)).rejects.toBe(
      ask,
    );
    expect([...progress.done]).toEqual([0, 1]);
    expect(progress.moved).toBe(200);
    sent.length = 0;
    await moveTreeItemsBatched('files', ids, 'f1', progress, true, 'owner', 9);
    const calls = sent.filter((s) => s.url === '/api/tree/files/move');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ confirm: true, seen: 9 });
    expect((calls[0]!.body as { ids: string[] }).ids[0]).toBe('i400');
  });
});
