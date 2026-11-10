import { describe, expect, it } from 'vitest';
import {
  REPLY_NOTE_MAX,
  REPLY_VERSION_MAX,
  checkReply,
  fromLabel,
  sendLabel,
  sentToLabel,
  submitErrorText,
} from './task-submit';

describe('labels', () => {
  it('names each send button by its entry', () => {
    expect(sendLabel('Admin')).toBe('Send to Admin');
    expect(sendLabel('Helpdesk')).toBe('Send to Helpdesk');
  });

  it("says where a task went in the box's own word, else the plain name", () => {
    const targets = [
      { to: 'admin' as const, label: 'Admin' },
      { to: 'it' as const, label: 'Helpdesk' },
    ];
    expect(sentToLabel('it', targets)).toBe('Helpdesk');
    expect(sentToLabel('admin', [])).toBe('Admin');
    expect(sentToLabel('it', [])).toBe('IT');
  });

  it('names the sender, and the box when there is one', () => {
    const by = { name: 'Ann', email: 'ann@example.com' };
    expect(fromLabel({ box: null, taskId: 't1', by })).toBe('From Ann (ann@example.com)');
    expect(fromLabel({ box: { id: 'b1', name: 'Plant box' }, taskId: 't1', by })).toBe(
      'From Ann (ann@example.com) on Plant box',
    );
  });
});

describe('checkReply', () => {
  it('trims the note and leaves an empty version out', () => {
    expect(checkReply('  Fixed  ', '  ')).toEqual({ ok: true, body: { note: 'Fixed' } });
    expect(checkReply('Fixed', ' 1.2.3 ')).toEqual({
      ok: true,
      body: { note: 'Fixed', version: '1.2.3' },
    });
  });

  it('refuses an empty note', () => {
    expect(checkReply('   ', '')).toEqual({ ok: false, error: 'Write a note for the reply.' });
  });

  it('refuses a note or a version over the cap', () => {
    expect(checkReply('a'.repeat(REPLY_NOTE_MAX), '').ok).toBe(true);
    expect(checkReply('a'.repeat(REPLY_NOTE_MAX + 1), '').ok).toBe(false);
    expect(checkReply('ok', 'v'.repeat(REPLY_VERSION_MAX)).ok).toBe(true);
    expect(checkReply('ok', 'v'.repeat(REPLY_VERSION_MAX + 1)).ok).toBe(false);
  });
});

describe('submitErrorText', () => {
  it('says a 409 in the screen words', () => {
    expect(submitErrorText('send', 409, 'conflict')).toBe('This task was sent already.');
    expect(submitErrorText('reply', 409, 'conflict')).toBe('This task has a reply already.');
  });

  it('passes any other refusal on, with a fallback', () => {
    expect(submitErrorText('send', 403, 'Not allowed')).toBe('Not allowed');
    expect(submitErrorText('reply', 400, '')).toBe('Could not send the reply.');
    expect(submitErrorText('send', undefined, undefined)).toBe('Could not send the task.');
  });
});
