// Bundles src/serve.ts into one dependency-free dist/server.mjs: the client
// image copies it beside the static export and runs `node server.mjs`.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

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
