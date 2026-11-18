import { describe, expect, it } from 'vitest';
import { requestedItems } from './tree-move-request';

describe('requestedItems', () => {
  it('takes the one item of the header, or the several of a pick, each once', () => {
    const a = { id: 'a', title: 'A' };
    const b = { id: 'b', title: 'B' };
    expect(requestedItems({ kind: 'files', item: a })).toEqual([a]);
    expect(requestedItems({ kind: 'files', items: [a, b] })).toEqual([a, b]);
    expect(requestedItems({ kind: 'files', item: a, items: [a, b] })).toEqual([a, b]);
    expect(requestedItems({ kind: 'files' })).toEqual([]);
  });
});
