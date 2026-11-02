import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * .bun-version is the one place the Bun version is stated (docs/bun-tooling.md).
 * The box image runs Bun too, and scripts/install-bun.sh (the Bun lane's
 * install) holds the checksum for one version, so all three must agree: a
 * Node and Bun compare made on one Bun says nothing about another.
 */
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const pinned = read('.bun-version').trim();

describe('the Bun version', () => {
  it('is one exact version', () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is the version the box image runs', () => {
    const images = [...read('Dockerfile').matchAll(/^FROM\s+oven\/bun:(\S+?)(?:-slim)?(?:\s|$)/gm)];
    expect(images.length).toBeGreaterThan(0);
    for (const m of images) expect(m[1]).toBe(pinned);
  });

  it('is the version install-bun.sh holds a checksum for', () => {
    const pin = read('scripts/install-bun.sh').match(/^PINNED="(\S+) ([0-9a-f]{64})"$/m);
    expect(pin?.[1]).toBe(pinned);
  });

  it('is installed by the Bun lane through install-bun.sh only', () => {
    const lane = read('.github/workflows/bun-lane.yml');
    expect(lane).toContain('scripts/install-bun.sh');
    expect(lane).not.toMatch(/setup-bun|bun\.sh\/install/);
  });
});
