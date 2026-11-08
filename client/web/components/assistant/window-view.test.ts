import { describe, expect, it } from 'vitest';
import type { MessengerListRow } from '@/lib/messenger/dto';
import { LIST_VIEW, othersUnread, parseView, stepsAsideOnRoute, viewToString } from './window-view';

const row = (id: string, unread: number, muted = false): MessengerListRow =>
  ({ kind: 'direct', id, unread, muted }) as MessengerListRow;

describe('window view', () => {
  it('round-trips each view', () => {
    for (const v of [LIST_VIEW, { kind: 'agent' } as const, { kind: 'chat', id: 'c-1' } as const]) {
      expect(parseView(viewToString(v))).toEqual(v);
    }
  });

  it('reads anything unknown as the list', () => {
    expect(parseView(null)).toEqual(LIST_VIEW);
    expect(parseView('')).toEqual(LIST_VIEW);
    expect(parseView('chat:')).toEqual(LIST_VIEW);
    expect(parseView(`chat:${'x'.repeat(65)}`)).toEqual(LIST_VIEW);
    expect(parseView('nonsense')).toEqual(LIST_VIEW);
    // New chat is not brought back by a reload.
    expect(parseView(viewToString({ kind: 'new' }))).toEqual(LIST_VIEW);
  });

  it('steps aside on a route change only in the full shape or below lg', () => {
    expect(stepsAsideOnRoute('full', true)).toBe(true);
    expect(stepsAsideOnRoute('docked', true)).toBe(false);
    expect(stepsAsideOnRoute('popout', true)).toBe(false);
    expect(stepsAsideOnRoute('docked', false)).toBe(true);
  });

  it('counts the unread lines of every chat but the one on screen, muted ones left out', () => {
    const rows = [row('a', 2), row('b', 3), row('c', 4, true)];
    expect(othersUnread(rows, (r) => r.id === 'a')).toBe(3);
    expect(othersUnread(rows, () => false)).toBe(5);
    expect(othersUnread([], () => false)).toBe(0);
  });
});
