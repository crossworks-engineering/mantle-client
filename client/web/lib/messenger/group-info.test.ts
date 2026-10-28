/**
 * A group's info: what the form sends, who edits it, what the details show.
 */
import { describe, expect, it } from 'vitest';
import {
  INFO_MAX,
  canEditInfo,
  droppedOnCreate,
  infoChanged,
  infoCounter,
  infoShown,
  infoToSend,
  keepsGroupInfo,
} from './group-info';

const me = { admin: true, lastReadSeq: 0, clearedBeforeSeq: 0, muted: false, leftSeq: null };

describe('infoToSend', () => {
  it('trims, and sends null for nothing', () => {
    expect(infoToSend('  Rules:\nbe kind  \n')).toBe('Rules:\nbe kind');
    expect(infoToSend('')).toBeNull();
    expect(infoToSend('   \n ')).toBeNull();
  });
});

describe('infoCounter', () => {
  it('counts against the limit', () => {
    expect(INFO_MAX).toBe(2000);
    expect(infoCounter('')).toEqual({ text: '0 / 2000', near: false, over: false });
    expect(infoCounter('x'.repeat(1799)).near).toBe(false);
    expect(infoCounter('x'.repeat(1800)).near).toBe(true);
    expect(infoCounter('x'.repeat(2000))).toEqual({ text: '2000 / 2000', near: true, over: false });
    expect(infoCounter('x'.repeat(2001))).toEqual({ text: '2001 / 2000', near: true, over: true });
  });
});

describe('droppedOnCreate', () => {
  it('says what a brain before it dropped, nothing when it kept all', () => {
    expect(droppedOnCreate({ look: false, info: false })).toBeNull();
    expect(droppedOnCreate({ look: true, info: false })).toBe(
      'Group created. This brain does not keep a group’s icon and colour yet.',
    );
    expect(droppedOnCreate({ look: false, info: true })).toBe(
      'Group created. This brain does not keep a group’s info yet.',
    );
    expect(droppedOnCreate({ look: true, info: true })).toBe(
      'Group created. This brain does not keep a group’s icon and colour or info yet.',
    );
  });
});

describe('canEditInfo', () => {
  it('only an admin of a group who is still in it', () => {
    expect(canEditInfo({ kind: 'group', me })).toBe(true);
    expect(canEditInfo({ kind: 'group', me: { ...me, admin: false } })).toBe(false);
    expect(canEditInfo({ kind: 'group', me: { ...me, leftSeq: 9 } })).toBe(false);
    expect(canEditInfo({ kind: 'direct', me })).toBe(false);
  });
});

describe('infoShown', () => {
  it('shows a group’s text with its line breaks, nothing otherwise', () => {
    expect(infoShown({ kind: 'group', info: 'Line one\n\nLine two' })).toBe('Line one\n\nLine two');
    expect(infoShown({ kind: 'group', info: null })).toBeNull();
    expect(infoShown({ kind: 'group', info: '  ' })).toBeNull();
    expect(infoShown({ kind: 'group' })).toBeNull();
    expect(infoShown({ kind: 'direct', info: 'x' })).toBeNull();
  });
});

describe('keepsGroupInfo', () => {
  it('reads the key on the chat the brain answers', () => {
    expect(keepsGroupInfo({ info: null })).toBe(true);
    expect(keepsGroupInfo({ info: 'Rules' })).toBe(true);
    expect(keepsGroupInfo({ title: 'x' })).toBe(false);
    expect(keepsGroupInfo(null)).toBe(false);
    expect(keepsGroupInfo(undefined)).toBe(false);
  });
});

describe('infoChanged', () => {
  it('compares the trimmed text with what the brain holds', () => {
    expect(infoChanged('Rules', ' Rules ')).toBe(false);
    expect(infoChanged(null, '')).toBe(false);
    expect(infoChanged(undefined, '  ')).toBe(false);
    expect(infoChanged('Rules', '')).toBe(true);
    expect(infoChanged('Rules', '  ')).toBe(true);
    expect(infoChanged(null, 'Rules')).toBe(true);
  });
});
