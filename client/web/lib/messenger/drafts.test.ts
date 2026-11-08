import { afterEach, describe, expect, it } from 'vitest';
import { clearDrafts, getDraft, setDraft } from './drafts';

afterEach(clearDrafts);

describe('chat drafts', () => {
  it('keeps a draft by chat', () => {
    setDraft('a', { text: 'hi', picked: [1] });
    expect(getDraft('a')).toEqual({ text: 'hi', picked: [1] });
    expect(getDraft('b')).toBeUndefined();
  });

  it('forgets an empty draft', () => {
    setDraft('a', { text: 'hi', picked: [] });
    setDraft('a', { text: '', picked: [] });
    expect(getDraft('a')).toBeUndefined();
  });

  it('keeps at most 50, dropping the oldest', () => {
    for (let i = 0; i < 51; i++) setDraft(`c${i}`, { text: 'x', picked: [] });
    expect(getDraft('c0')).toBeUndefined();
    expect(getDraft('c50')).toBeDefined();
  });
});
