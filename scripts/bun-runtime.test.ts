import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * scripts/bun.sh sets MANTLE_EXPECT_RUNTIME=bun, so a `:bun` run (verify:bun,
 * test:bun) fails here if it ended up on Node: this worker and the `node` its
 * tools find on PATH must both be the pinned Bun. A plain `pnpm verify` does
 * not set it, and then there is nothing to check.
 *
 * next.config.ts and the host build check it too, inside the tool, so a
 * dev:bun, build:bun or e2e:workspace:bun on Node fails. On Node this file
 * proves those checks fail, and that they do nothing when the variable is
 * unset.
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

describe('the runtime check in next.config.ts and the host build', () => {
  const ROOT = join(__dirname, '..');
  const onNode = process.versions.bun === undefined;
  const saved = process.env.MANTLE_EXPECT_RUNTIME;
  afterEach(() => {
    if (saved === undefined) delete process.env.MANTLE_EXPECT_RUNTIME;
    else process.env.MANTLE_EXPECT_RUNTIME = saved;
  });
  const loadNextConfig = async () => {
    vi.resetModules();
    return import('../client/web/next.config');
  };

  it('fails next.config.ts on Node when Bun was asked for, and passes unset', async () => {
    if (!onNode) return;
    process.env.MANTLE_EXPECT_RUNTIME = 'bun';
    await expect(loadNextConfig()).rejects.toThrow('but next runs on Node');
    delete process.env.MANTLE_EXPECT_RUNTIME;
    await expect(loadNextConfig()).resolves.toBeDefined();
  });

  it('fails the host build on Node, before it builds, when Bun was asked for', () => {
    if (!onNode) return;
    const r = spawnSync(process.execPath, [join(ROOT, 'client/host/scripts/build.mjs')], {
      env: { ...process.env, MANTLE_EXPECT_RUNTIME: 'bun' },
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('but the host build runs on Node');
  });
});
