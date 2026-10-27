/**
 * The words and times of the chat list and the transcript.
 */
import { describe, expect, it } from 'vitest';
import type { MessengerListRow, MessengerParticipant } from './dto';
import {
  agentIdOf,
  badgeCount,
  directPeer,
  initials,
  listTime,
  otherPeople,
  presenceLine,
  previewLine,
  rowAddress,
  rowMatches,
  stampLabel,
} from './format';

const NOW = new Date(2026, 9, 27, 15, 0, 0);
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;

function person(id: string, name: string, leftAt: string | null = null): MessengerParticipant {
  return { kind: 'login', id, name, admin: false, leftAt };
}

function row(over: Partial<MessengerListRow> = {}): MessengerListRow {
  return {
    kind: 'direct',
    id: 'c1',
    title: 'Ann Lee',
    lastSeq: 4,
    lastMessageAt: ago(MIN),
    preview: { authorName: 'Ann Lee', text: 'See you', authorKind: 'login' },
    unread: 0,
    mention: false,
    muted: false,
    favourite: false,
    participants: [person('me', 'Jo Me'), person('ann', 'Ann Lee')],
    ...over,
  };
}

describe('listTime', () => {
  it('reads like the reference list: minutes, hours, Yesterday, days', () => {
    expect(listTime(null, NOW)).toBe('');
    expect(listTime(ago(10_000), NOW)).toBe('Just now');
    expect(listTime(ago(MIN), NOW)).toBe('1 minute');
    expect(listTime(ago(10 * MIN), NOW)).toBe('10 minutes');
    expect(listTime(ago(3 * 60 * MIN), NOW)).toBe('3 hours');
    expect(listTime(new Date(2026, 9, 26, 23, 0).toISOString(), NOW)).toBe('Yesterday');
    expect(listTime(new Date(2026, 9, 14, 12, 0).toISOString(), NOW)).toBe('13 days');
    expect(listTime(new Date(2026, 9, 26, 12, 0).toISOString(), NOW)).toBe('Yesterday');
    expect(listTime('nonsense', NOW)).toBe('');
  });

  it('a long-ago chat shows its date', () => {
    expect(listTime(new Date(2026, 4, 1).toISOString(), NOW)).toMatch(/2026/);
  });
});

describe('stampLabel', () => {
  it('says Today and Yesterday, then the weekday and date', () => {
    expect(stampLabel(new Date(2026, 9, 27, 9, 5).toISOString(), NOW)).toMatch(/^Today /);
    expect(stampLabel(new Date(2026, 9, 26, 9, 5).toISOString(), NOW)).toMatch(/^Yesterday /);
    expect(stampLabel(new Date(2026, 9, 12, 9, 5).toISOString(), NOW)).toMatch(/12/);
  });
});

describe('initials', () => {
  it('takes the first and last word, or two letters of one', () => {
    expect(initials('Ann Marie Lee')).toBe('AL');
    expect(initials('ann')).toBe('AN');
    expect(initials('  ')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

describe('people', () => {
  it('the others are everyone but me still in the chat', () => {
    const ps = [person('me', 'Me'), person('a', 'A'), person('b', 'B', '2026-10-01')];
    expect(otherPeople(ps, 'me').map((p) => p.id)).toEqual(['a']);
  });

  it('a direct chat has one peer; a group has none', () => {
    expect(directPeer(row(), 'me')?.id).toBe('ann');
    expect(directPeer(row({ kind: 'group' }), 'me')).toBeNull();
  });
});

describe('previewLine', () => {
  it('their line plain, mine with a tick', () => {
    expect(previewLine(row(), 'me')).toEqual({ mine: false, text: 'See you' });
    const mine = row({ preview: { authorName: 'Jo Me', text: 'Ok', authorKind: 'login' } });
    expect(previewLine(mine, 'me')).toEqual({ mine: true, text: 'Ok' });
  });

  it('a group says You: on mine and the first name on theirs', () => {
    const g = row({ kind: 'group' });
    expect(previewLine(g, 'me')?.text).toBe('Ann: See you');
    const mine = row({
      kind: 'group',
      preview: { authorName: 'Jo Me', text: 'Ok', authorKind: 'login' },
    });
    expect(previewLine(mine, 'me')).toEqual({ mine: true, text: 'You: Ok' });
  });

  it('a deleted last line says so; no line at all is null', () => {
    const d = row({ preview: { authorName: 'Ann Lee', text: '', authorKind: 'login' } });
    expect(previewLine(d, 'me')?.text).toBe('This message was deleted');
    expect(previewLine(row({ preview: null }), 'me')).toBeNull();
  });

  it('one line, whatever the body holds', () => {
    const r = row({ preview: { authorName: 'Ann Lee', text: 'a\n\n b', authorKind: 'login' } });
    expect(previewLine(r, 'me')?.text).toBe('a b');
  });
});

describe('rowMatches', () => {
  it('finds a chat by title, a person or the last line', () => {
    expect(rowMatches(row(), '')).toBe(true);
    expect(rowMatches(row(), 'ann')).toBe(true);
    expect(rowMatches(row(), 'jo')).toBe(true);
    expect(rowMatches(row(), 'see')).toBe(true);
    expect(rowMatches(row(), 'zebra')).toBe(false);
  });
});

describe('presenceLine', () => {
  it('a direct chat says Online or Offline; a group counts its members', () => {
    expect(presenceLine(row(), 'me', new Set(['ann']))).toBe('Online');
    expect(presenceLine(row(), 'me', new Set())).toBe('Offline');
    const g = row({
      kind: 'group',
      participants: [person('me', 'Me'), person('a', 'A'), person('b', 'B')],
    });
    expect(presenceLine(g, 'me', new Set(['a']))).toBe('3 members, 1 online');
    expect(presenceLine(g, 'me', new Set())).toBe('3 members');
  });
});

describe('badgeCount', () => {
  it('caps at 99+', () => {
    expect(badgeCount(3)).toBe('3');
    expect(badgeCount(120)).toBe('99+');
  });
});

describe('row addresses', () => {
  it('keeps conversation ids and agent ids apart', () => {
    expect(rowAddress(row())).toBe('c1');
    expect(rowAddress(row({ kind: 'agent', id: 'a9' }))).toBe('agent:a9');
    expect(agentIdOf('agent:a9')).toBe('a9');
    expect(agentIdOf('c1')).toBeNull();
    expect(agentIdOf('agent:')).toBeNull();
    expect(agentIdOf(null)).toBeNull();
  });
});
