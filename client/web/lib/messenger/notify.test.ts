/**
 * The messenger outside the Chats screen: the rail count, the 404 that hides
 * the entry, and when a message pops.
 */
import { describe, expect, it } from 'vitest';
import {
  messengerAvailability,
  noticeRoute,
  noticeText,
  openChatId,
  railCount,
  shouldPop,
} from './notify';

describe('messengerAvailability', () => {
  it('a 404 from /unread means no messenger on this brain', () => {
    expect(messengerAvailability({ data: { total: 0 } })).toBe('yes');
    expect(messengerAvailability({ error: { status: 404 } })).toBe('no');
    expect(messengerAvailability({ error: { status: 500 } })).toBe('unknown');
    expect(messengerAvailability({ error: new Error('offline') })).toBe('unknown');
    expect(messengerAvailability({})).toBe('unknown');
  });
});

describe('railCount', () => {
  it('is the brain total: people, groups and assistant replies', () => {
    expect(railCount({ total: 7, messenger: 4, agents: 3 })).toBe(7);
    expect(railCount({ total: 0, messenger: 0, agents: 0 })).toBe(0);
    expect(railCount(null)).toBe(0);
    expect(railCount({ total: -2, messenger: 0, agents: 0 })).toBe(0);
  });
});

describe('openChatId', () => {
  it('reads the chat in the address', () => {
    expect(openChatId('/chats/abc')).toBe('abc');
    expect(openChatId('/chats/a%3Ab?x=1')).toBe('a:b');
    expect(openChatId('/chats')).toBeNull();
    expect(openChatId('/pages/abc')).toBeNull();
    expect(openChatId(null)).toBeNull();
  });
});

describe('shouldPop', () => {
  const theirs = { authorKind: 'login' as const, authorId: 'ann', deletedAt: null };
  const base = { message: theirs, me: 'me', muted: false, onScreen: false };
  it('pops a message from someone else in a chat that is not on screen', () => {
    expect(shouldPop(base)).toBe(true);
  });
  it('never pops mine, a muted chat, a deleted message or the chat on screen', () => {
    expect(shouldPop({ ...base, message: { ...theirs, authorId: 'me' } })).toBe(false);
    expect(shouldPop({ ...base, muted: true })).toBe(false);
    expect(shouldPop({ ...base, message: { ...theirs, deletedAt: '2026-10-27' } })).toBe(false);
    expect(shouldPop({ ...base, onScreen: true })).toBe(false);
  });
});

describe('noticeText', () => {
  it('names the author (and the group) and carries the first line', () => {
    expect(noticeText({ authorName: 'Ann', body: '\nHello there\nsecond' }, null)).toEqual({
      title: 'Ann',
      body: 'Hello there',
    });
    expect(noticeText({ authorName: 'Ann', body: 'Hi' }, 'Design crew').title).toBe(
      'Ann in Design crew',
    );
    expect(noticeText({ authorName: null, body: 'x'.repeat(300) }, null).body).toHaveLength(120);
  });
});

describe('noticeRoute', () => {
  it('the OS only from a hidden desktop window, a toast otherwise', () => {
    expect(noticeRoute({ desktop: true, visible: false })).toBe('os');
    expect(noticeRoute({ desktop: true, visible: true })).toBe('toast');
    expect(noticeRoute({ desktop: false, visible: false })).toBe('toast');
  });
});
