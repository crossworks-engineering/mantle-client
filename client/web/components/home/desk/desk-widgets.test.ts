import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { folderKey, treeKey } from '@/components/item-tree/tree-api';
import { deskNewestKey, deskStorageKey, hubNewestOf } from './desk-data';
import { toolAvailable } from '@/lib/home-desk';
import { jotRequest, splitJot } from './widgets/misc';
import { greeting, monthGrid } from './widgets/time';

describe('quick note', () => {
  it('titles the note with the first line and keeps the rest', () => {
    expect(splitJot('  Call Sam\nabout the renewal\n\nby Thursday ')).toEqual({
      title: 'Call Sam',
      content: 'about the renewal\n\nby Thursday',
    });
  });

  it('drops a markdown heading mark from the title', () => {
    expect(splitJot('## Plan').title).toBe('Plan');
  });
});

describe('quick task', () => {
  it('posts the first line as the title and the rest as the body', () => {
    expect(jotRequest('task', 'Book the venue\nfor 40 people')).toEqual({
      route: '/api/tasks',
      body: { title: 'Book the venue', body: 'for 40 people' },
    });
  });

  it('names an untitled task, and sends nothing for blank text', () => {
    expect(jotRequest('task', '#\nonly a body')?.body.title).toBe('Quick task');
    expect(jotRequest('task', '  \n ')).toBeNull();
  });

  it('a note still posts title and content', () => {
    expect(jotRequest('note', 'Plan\nsteps')).toEqual({
      route: '/api/notes',
      body: { title: 'Plan', content: 'steps' },
    });
  });

  it('is offered only to a login that has tasks', () => {
    expect(toolAvailable('quick-task', ['notes', 'tasks'])).toBe(true);
    expect(toolAvailable('quick-task', ['notes', 'pages'])).toBe(false);
    expect(toolAvailable('quick-note', ['pages'])).toBe(true);
  });
});

describe('calendar', () => {
  it('lays a month out in whole Monday-first weeks', () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const cells = monthGrid(new Date(2026, 9, 15));
    expect(cells).toHaveLength(35);
    expect(cells[0]!.getDay()).toBe(1);
    expect(cells[3]!.getDate()).toBe(1);
    expect(cells.at(-1)!.getDate()).toBe(1);
  });
});

describe('clock', () => {
  it('greets by the hour', () => {
    expect([3, 9, 14, 19, 23].map(greeting)).toEqual([
      'Working late',
      'Good morning',
      'Good afternoon',
      'Good evening',
      'Good night',
    ]);
  });
});

describe("a kind widget's queries", () => {
  it("keeps the newest items under its own key, never the tree's infinite one", () => {
    const tree = folderKey('notes', null, 'updated', 'owner', 'w1');
    const desk = deskNewestKey('notes', 'updated', 'w1');
    expect(desk).not.toEqual(tree);
    // Still under ['tree', kind], so a tree refresh reaches the desk.
    expect(desk.slice(0, 2)).toEqual(treeKey('notes'));
  });

  it("reads the landing page's newest pages and apps as tree items", () => {
    const got = hubNewestOf({
      sections: [
        {
          token: 'p1',
          title: 'Handbook',
          icon: '📘',
          summary: null,
          updatedAt: '2026-10-26T00:00:00.000Z',
          parentToken: null,
        },
      ],
      apps: [{ token: 'a1', title: 'Board', description: null, updatedAt: '' }],
    });
    expect(got.pages?.[0]).toMatchObject({ id: 'p1', title: 'Handbook', icon: '📘' });
    expect(got.apps?.[0]).toMatchObject({ id: 'a1', title: 'Board', icon: null });
    expect(hubNewestOf(null)).toEqual({});
  });
});

describe('where a desk is kept', () => {
  it('is one per brain and per login', () => {
    expect(deskStorageKey('https://a.example', 'l1')).not.toBe(
      deskStorageKey('https://b.example', 'l1'),
    );
    expect(deskStorageKey('https://a.example', 'l1')).not.toBe(
      deskStorageKey('https://a.example', 'l2'),
    );
  });
});

describe('widget frame', () => {
  // The body scrolls, so it clips: a control at its top edge loses its focus
  // ring unless the body leaves room above it. The node runner cannot mount
  // the frame, so the class is pinned by reading it.
  it('leaves room above the first control of a carded widget for its focus ring', () => {
    const frame = readFileSync(
      fileURLToPath(new URL('./desk-widget.tsx', import.meta.url)),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(frame).toContain(
      "'relative min-h-0 flex-1 overflow-y-auto scrollbar-thin', !bare && 'pt-1',",
    );
  });
});
