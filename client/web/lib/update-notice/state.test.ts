import { describe, expect, it } from 'vitest';
import {
  NOTICE_OFF,
  REMEMBER_MAX_MS,
  nextNotice,
  parseRemembered,
  probeOf,
  rememberAfter,
  type NoticeProbe,
  type NoticeState,
} from './state';

/**
 * The update notice as the client keeps it: the brain's answer rules while
 * it answers; while it cannot be reached the last "on" holds the notice, for
 * an hour from it at most (in an open tab as on a fresh page); an "off"
 * after an "on" is done (the screen finishes its bar and the page reloads).
 */
const NOW = 1_000_000_000;
const on: NoticeProbe = { kind: 'answer', view: { on: true, version: '1.0.0' } };
const off: NoticeProbe = { kind: 'answer', view: { on: false, version: '1.0.1' } };
const down: NoticeProbe = { kind: 'unreachable' };
const ON: NoticeState = { phase: 'on', seenOnAt: NOW };

describe('nextNotice', () => {
  it('shows while the brain says on, and keeps when it last said so', () => {
    expect(nextNotice(NOTICE_OFF, on, null, NOW)).toEqual(ON);
    expect(nextNotice(ON, on, null, NOW + 5)).toEqual({ phase: 'on', seenOnAt: NOW + 5 });
  });

  it('stays up while the brain is down after an on, and back on when it answers on', () => {
    const d: NoticeState = { phase: 'down', seenOnAt: NOW };
    expect(nextNotice(ON, down, null, NOW + 1)).toEqual(d);
    expect(nextNotice(d, down, null, NOW + 2)).toEqual(d);
    expect(nextNotice(d, on, null, NOW + 3)).toEqual({ phase: 'on', seenOnAt: NOW + 3 });
  });

  it('an open tab lets go an hour after the last on, with no answer since', () => {
    const d: NoticeState = { phase: 'down', seenOnAt: NOW };
    expect(nextNotice(d, down, null, NOW + REMEMBER_MAX_MS - 1).phase).toBe('down');
    expect(nextNotice(d, down, null, NOW + REMEMBER_MAX_MS)).toEqual(NOTICE_OFF);
  });

  it('a page opened while the brain is down shows it from a recent remembered on', () => {
    const r = { on: true, at: NOW - 60_000 };
    expect(nextNotice(NOTICE_OFF, down, r, NOW)).toEqual({ phase: 'down', seenOnAt: NOW - 60_000 });
  });

  it('but not from an old one, nor from a remembered off, nor from nothing', () => {
    expect(nextNotice(NOTICE_OFF, down, { on: true, at: NOW - REMEMBER_MAX_MS }, NOW)).toEqual(
      NOTICE_OFF,
    );
    expect(nextNotice(NOTICE_OFF, down, { on: false, at: NOW }, NOW)).toEqual(NOTICE_OFF);
    expect(nextNotice(NOTICE_OFF, down, null, NOW)).toEqual(NOTICE_OFF);
  });

  it('an off after an on is done, from on or from down; an off with nothing showing stays off', () => {
    expect(nextNotice(ON, off, null, NOW)).toEqual({ phase: 'done', seenOnAt: NOW });
    expect(nextNotice({ phase: 'down', seenOnAt: NOW }, off, null, NOW).phase).toBe('done');
    expect(nextNotice(NOTICE_OFF, off, null, NOW)).toEqual(NOTICE_OFF);
  });

  it('done stays done whatever comes after (the page reloads)', () => {
    const done: NoticeState = { phase: 'done', seenOnAt: NOW };
    for (const p of [on, off, down]) expect(nextNotice(done, p, null, NOW)).toEqual(done);
  });
});

describe('rememberAfter', () => {
  it('an answer replaces the memory, no answer keeps it', () => {
    const last = { on: true, at: NOW - 5 };
    expect(rememberAfter(off, last, NOW)).toEqual({ on: false, at: NOW });
    expect(rememberAfter(down, last, NOW)).toBe(last);
  });
});

describe('probeOf', () => {
  it('reads the brain answer', () => {
    expect(probeOf(200, { on: true, version: '1.0.0' })).toEqual(on);
  });
  it('a brain without the route is an off', () => {
    expect(probeOf(404, null)).toEqual({ kind: 'answer', view: { on: false, version: '' } });
  });
  it.each([
    [502, null],
    [503, { on: false }],
    [504, null],
    [200, null],
    [200, { ok: true }],
    [401, { error: 'unauthorized' }],
  ])('%i %j is unreachable', (status, body) => {
    expect(probeOf(status, body)).toEqual(down);
  });
});

describe('parseRemembered', () => {
  it('keeps a well-formed value and drops the rest', () => {
    expect(parseRemembered(JSON.stringify({ on: true, at: 5 }))).toEqual({ on: true, at: 5 });
    for (const raw of [null, '', 'nope', '{}', JSON.stringify({ on: 'yes', at: 5 })]) {
      expect(parseRemembered(raw)).toBeNull();
    }
  });
});
