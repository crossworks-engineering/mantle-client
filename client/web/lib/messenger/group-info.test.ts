/**
 * A group's info: what the form sends, who edits it, what the details show.
 */
import { describe, expect, it } from 'vitest';
import {
  INFO_MAX,
  canEditInfo,
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
    expect(infoCounter('')).toEqual({ text: '0 / 2000', over: false });
    expect(infoCounter('x'.repeat(2000))).toEqual({ text: '2000 / 2000', over: false });
    expect(infoCounter('x'.repeat(2001))).toEqual({ text: '2001 / 2000', over: true });
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
    expect(infoChanged(null, 'Rules')).toBe(true);
  });
});
