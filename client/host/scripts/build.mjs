// Bundles src/serve.ts into one dependency-free dist/server.mjs: the client
// image copies it beside the static export and runs `node server.mjs`.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// A `:bun` build (scripts/bun.sh sets MANTLE_EXPECT_RUNTIME=bun) must not end
// up on Node. Unset, as on the Node path and in the image build, this does
// nothing.
if (process.env.MANTLE_EXPECT_RUNTIME === 'bun') {
  const pinned = readFileSync(join(root, '../../.bun-version'), 'utf8').trim();
  const have = process.versions.bun;
  if (have !== pinned) {
    const on = have ? `Bun ${have}` : `Node ${process.versions.node}`;
    throw new Error(
      `MANTLE_EXPECT_RUNTIME=bun, but the host build runs on ${on} (.bun-version: ${pinned})`,
    );
  }
}

await build({
  entryPoints: [join(root, 'src/serve.ts')],
  outfile: join(root, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  logLevel: 'warning',
});

console.log('[client-host] wrote dist/server.mjs');
