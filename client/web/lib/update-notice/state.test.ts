import { describe, expect, it } from 'vitest';
import {
  NOTICE_OFF,
  REMEMBER_MAX_MS,
  nextNotice,
  parseRemembered,
  probeOf,
  rememberAfter,
  reloadsWhenDone,
  type NoticeProbe,
  type NoticeState,
} from './state';

/**
 * The update notice as the client keeps it: the brain's answer rules while
 * it answers; while it cannot be reached the last answer holds the notice,
 * for an hour at most; an "off" after an "on" finishes the bar and reloads
 * only when the box came back on another version.
 */
const NOW = 1_000_000_000;
const on = (version = '1.0.0'): NoticeProbe => ({ kind: 'answer', view: { on: true, version } });
const off = (version = '1.0.0'): NoticeProbe => ({ kind: 'answer', view: { on: false, version } });
const down: NoticeProbe = { kind: 'unreachable' };
const ON: NoticeState = { phase: 'on', onVersion: '1.0.0' };

describe('nextNotice', () => {
  it('shows while the brain says on, and keeps the version it was first on', () => {
    expect(nextNotice(NOTICE_OFF, on(), null, NOW)).toEqual(ON);
    expect(nextNotice(ON, on('1.0.1'), null, NOW)).toEqual(ON);
  });

  it('stays up while the brain is down after an on', () => {
    expect(nextNotice(ON, down, null, NOW)).toEqual({ phase: 'down', onVersion: '1.0.0' });
    const d: NoticeState = { phase: 'down', onVersion: '1.0.0' };
    expect(nextNotice(d, down, null, NOW)).toEqual(d);
    expect(nextNotice(d, on(), null, NOW)).toEqual(ON);
  });

  it('a page opened while the brain is down shows it from a recent remembered on', () => {
    const r = { on: true, version: '1.0.0', at: NOW - 60_000 };
    expect(nextNotice(NOTICE_OFF, down, r, NOW)).toEqual({ phase: 'down', onVersion: '1.0.0' });
  });

  it('but not from an old one, nor from a remembered off', () => {
    const old = { on: true, version: '1.0.0', at: NOW - REMEMBER_MAX_MS };
    expect(nextNotice(NOTICE_OFF, down, old, NOW)).toEqual(NOTICE_OFF);
    expect(nextNotice(NOTICE_OFF, down, { ...old, on: false, at: NOW }, NOW)).toEqual(NOTICE_OFF);
    expect(nextNotice(NOTICE_OFF, down, null, NOW)).toEqual(NOTICE_OFF);
  });

  it('an off after an on is done; an off with nothing showing stays off', () => {
    expect(nextNotice(ON, off(), null, NOW)).toEqual({ phase: 'done', onVersion: '1.0.0' });
    expect(nextNotice({ phase: 'down', onVersion: '1.0.0' }, off('1.0.1'), null, NOW).phase).toBe(
      'done',
    );
    expect(nextNotice(NOTICE_OFF, off(), null, NOW)).toEqual(NOTICE_OFF);
  });

  it('done stays done until the screen lets it go', () => {
    const done: NoticeState = { phase: 'done', onVersion: '1.0.0' };
    expect(nextNotice(done, off(), null, NOW)).toEqual(done);
    expect(nextNotice(done, down, null, NOW)).toEqual(done);
  });
});

describe('reloadsWhenDone', () => {
  it('reloads only when the box came back on another version', () => {
    expect(reloadsWhenDone(ON, '1.0.1')).toBe(true);
    expect(reloadsWhenDone(ON, '1.0.0')).toBe(false);
    expect(reloadsWhenDone(ON, '')).toBe(false);
    expect(reloadsWhenDone(NOTICE_OFF, '1.0.1')).toBe(false);
  });
});

describe('rememberAfter', () => {
  it('an answer replaces the memory, no answer keeps it', () => {
    const last = { on: true, version: '1.0.0', at: NOW - 5 };
    expect(rememberAfter(off('1.0.1'), last, NOW)).toEqual({
      on: false,
      version: '1.0.1',
      at: NOW,
    });
    expect(rememberAfter(down, last, NOW)).toBe(last);
  });
});

describe('probeOf', () => {
  it('reads the brain answer', () => {
    expect(probeOf(200, { on: true, version: '1.0.0' })).toEqual(on());
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
    expect(parseRemembered(JSON.stringify({ on: true, version: '1', at: 5 }))).toEqual({
      on: true,
      version: '1',
      at: 5,
    });
    for (const raw of [
      null,
      '',
      'nope',
      '{}',
      JSON.stringify({ on: 'yes', version: '1', at: 5 }),
    ]) {
      expect(parseRemembered(raw)).toBeNull();
    }
  });
});
