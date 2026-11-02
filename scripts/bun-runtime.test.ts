import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * scripts/bun.sh sets MANTLE_EXPECT_RUNTIME=bun, so a `:bun` run (verify:bun,
 * test:bun) fails here if it ended up on Node: this worker and the `node` its
 * tools find on PATH must both be the pinned Bun. A plain `pnpm verify` does
 * not set it, and then there is nothing to check.
 */
const expected = process.env.MANTLE_EXPECT_RUNTIME;
const pinned = readFileSync(join(__dirname, '..', '.bun-version'), 'utf8').trim();

describe('the runtime a :bun run asked for', () => {
  it('is the one this test runs on', () => {
    if (expected === undefined) return;
    expect(expected).toBe('bun');
    expect(process.versions.bun).toBe(pinned);
    const onPath = execFileSync('node', ['-p', 'process.versions.bun ?? "node"'], {
      encoding: 'utf8',
    });
    expect(onPath.trim()).toBe(pinned);
  });
});
