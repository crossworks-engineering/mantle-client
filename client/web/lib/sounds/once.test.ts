/** One sound per event across tabs (lib/sounds/once.ts). */
import { describe, expect, it } from 'vitest';
import { claimOnce, ONCE_KEY, ONCE_TTL_MS } from './once';

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('claimOnce', () => {
  it('lets the first tab play and keeps the second quiet', () => {
    const shared = memory();
    expect(claimOnce(shared, 'run:1', 1_000)).toBe(true);
    expect(claimOnce(shared, 'run:1', 2_000)).toBe(false);
    expect(claimOnce(shared, 'run:2', 2_000)).toBe(true);
  });

  it('lets the event sound again once the claim has expired, and drops old claims', () => {
    const shared = memory();
    claimOnce(shared, 'a', 0);
    expect(claimOnce(shared, 'a', ONCE_TTL_MS + 1)).toBe(true);
    claimOnce(shared, 'b', 0);
    claimOnce(shared, 'c', ONCE_TTL_MS * 3);
    const kept = JSON.parse(shared.data.get(ONCE_KEY)!) as Record<string, number>;
    expect(Object.keys(kept)).toEqual(['c']);
  });

  it('plays when there is no storage, or it is broken', () => {
    expect(claimOnce(null, 'x')).toBe(true);
    const broken = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(claimOnce(broken, 'x')).toBe(true);
  });
});
