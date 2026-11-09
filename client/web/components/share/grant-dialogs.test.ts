/**
 * The move dialog's lines (W5b2, 21.8 rows 1 and 9): what the item becomes
 * visible to, where it stops, and "Keep it readable in H" for the old home.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContentsLines,
  CREATE_HERE_TITLE,
  MOVE_TITLE,
  MovePreviewLines,
  sendMove,
} from './grant-dialogs';

const api = vi.hoisted(() => ({ answers: [] as unknown[], bodies: [] as unknown[] }));
vi.mock('@mantle/web-ui/api-fetch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiSend: vi.fn(async (_url: string, _method: string, body: unknown) => {
    api.bodies.push(body);
    return api.answers.shift();
  }),
}));

const lines = (over: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(MovePreviewLines, {
      preview: { alsoVisibleTo: [], removedFrom: [] },
      keep: false,
      onKeep: () => {},
      ...over,
    }),
  );

describe('MovePreviewLines', () => {
  it('says what it becomes visible to', () => {
    const html = lines({
      preview: { alsoVisibleTo: [{ wsId: 'c', name: 'Client A' }], removedFrom: [] },
    });
    expect(html).toContain('This will also be visible to: Client A.');
  });

  it('offers Keep it readable in the old home', () => {
    const html = lines({
      preview: {
        alsoVisibleTo: [{ wsId: 's', name: 'Sales' }],
        removedFrom: [{ wsId: 'h', name: 'Team' }],
      },
      oldHome: { wsId: 'h', name: 'Team' },
    });
    expect(html).toContain('It will no longer be readable in: Team.');
    expect(html).toContain('Keep it readable in Team');
  });

  it('no Keep offer for a workspace that is not the old home (a folder move)', () => {
    const html = lines({
      preview: { alsoVisibleTo: [], removedFrom: [{ wsId: 'f', name: 'Sales' }] },
    });
    expect(html).toContain('It will no longer be readable in: Sales.');
    expect(html).not.toContain('Keep it readable');
  });

  it('says when nothing changes', () => {
    expect(lines({})).toContain('Who can see it does not change.');
  });
});

describe('MovePreviewLines, fix round 1', () => {
  const p = {
    alsoVisibleTo: [{ wsId: 's', name: 'Sales' }],
    removedFrom: [{ wsId: 'h', name: 'Team' }],
  };

  it('ticking Keep it readable changes the no-longer line', () => {
    const off = lines({ preview: p, oldHome: { wsId: 'h', name: 'Team' }, keep: false });
    expect(off).toContain('It will no longer be readable in: Team.');
    const on = lines({ preview: p, oldHome: { wsId: 'h', name: 'Team' }, keep: true });
    expect(on).not.toContain('It will no longer be readable in');
    expect(on).toContain('It stays readable in Team, read only.');
  });

  it('an app move says its new workspaces see its data, and nothing about what it reads (2026-11-09)', () => {
    const html = lines({ preview: p, app: true });
    expect(html).toContain('This app&#x27;s data becomes visible to Sales.');
    expect(html).not.toContain('read only items');
    expect(lines({ preview: p })).not.toContain('This app');
  });

  it('a create in a folder has its own title, not Move', () => {
    expect(CREATE_HERE_TITLE).toBe('Create here and change who can see it?');
    expect(MOVE_TITLE).not.toBe(CREATE_HERE_TITLE);
  });
});

describe('a folder home move with what is inside it', () => {
  beforeEach(() => {
    api.answers = [];
    api.bodies = [];
  });
  const part = (moved: number, inside: number, remaining: number, failed: unknown[] = []) => ({
    moved,
    failed,
    contents: { moved: inside, remaining, leftAlone: [], leftAloneCount: 1, hidden: 0 },
  });

  it('calls again while items remain, and sums the answers', async () => {
    api.answers = [part(200, 200, 3), part(4, 3, 0, [{ id: 'x', error: 'no' }])];
    const res = await sendMove(['f'], { toWorkspaceId: 't' }, 'h', { fromWorkspaceId: 'h' });
    expect(res.moved).toBe(204);
    expect(res.failed).toEqual([{ id: 'x', error: 'no' }]);
    expect(res.contents?.remaining).toBe(0);
    expect(api.bodies).toHaveLength(2);
    expect(api.bodies[1]).toEqual({
      nodeIds: ['f'],
      toWorkspaceId: 't',
      confirm: true,
      keepReadableIn: 'h',
      withContents: true,
      fromWorkspaceId: 'h',
    });
  });

  it('stops when a call moves nothing', async () => {
    api.answers = [part(0, 0, 5, [{ id: 'y', error: 'busy' }])];
    const res = await sendMove(['f'], { toWorkspaceId: 't' }, null, { fromWorkspaceId: 'h' });
    expect(res.moved).toBe(0);
    expect(res.contents?.remaining).toBe(5);
    expect(api.bodies).toHaveLength(1);
  });

  it('an item that fails in two calls is counted once', async () => {
    api.answers = [
      part(199, 199, 2, [{ id: 'z', error: 'first' }]),
      part(2, 1, 0, [{ id: 'z', error: 'again' }]),
    ];
    const res = await sendMove(['f'], { toWorkspaceId: 't' }, null, { fromWorkspaceId: 'h' });
    expect(res.failed).toEqual([{ id: 'z', error: 'again' }]);
    expect(res.moved).toBe(201);
  });

  it('without the tick: one call, no withContents', async () => {
    api.answers = [{ moved: 1, failed: [] }];
    await sendMove(['f'], { toWorkspaceId: 't' }, null);
    expect(api.bodies).toEqual([{ nodeIds: ['f'], toWorkspaceId: 't', confirm: true }]);
  });

  it('says what stays where it is', () => {
    const html = renderToStaticMarkup(
      createElement(ContentsLines, {
        contents: {
          move: 5,
          apps: 0,
          otherHome: 2,
          notAllowed: 0,
          removedHere: 0,
          hidden: 1,
          calls: 1,
        },
      }),
    );
    expect(html).toContain(
      '2 items inside have another home and stay there, 1 of them you cannot open.',
    );
  });
});
