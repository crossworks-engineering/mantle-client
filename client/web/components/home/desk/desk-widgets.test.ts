import { describe, expect, it } from 'vitest';
import { deskStorageKey } from './desk-data';
import { splitJot } from './widgets/misc';
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
