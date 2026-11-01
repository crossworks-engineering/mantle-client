// Writes the files a static-UI host needs from this build, into public/
// (generated, gitignored), from pre(dev|build) like copy-excalidraw-assets:
//
//   public/_mantle/boot.js   lib/boot/boot-apply.ts bundled as one blocking
//                            script: maps the host's raw appearance onto
//                            <html> before the first paint.
//   public/_mantle/csp.txt   the full Content-Security-Policy as a template,
//                            with {brain} and {brain_ws} for the host to fill
//                            (lib/csp.ts stays the one source of the policy).
//   public/_mantle/routes.json  the dynamic routes (`/notes/[id]`), read from
//                            app/: the host serves a route's one exported
//                            placeholder page (`_`) for every value.
//
// The host contract is docs/static-ui-host.md.
import { build } from 'esbuild';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(appRoot, 'public/_mantle');
mkdirSync(outDir, { recursive: true });

// share-ui's avatar table pulls in @dicebear's art (about 2.5 MB) only to list
// the style ids; boot.js needs the ids and never draws an avatar. So the art is
// cut from THIS bundle alone: the core becomes an empty stub and each style's
// lazy JSON import stays an unexecuted import(). The clean fix is upstream: a
// light ids-only avatar module in share-ui (mantle repo).
const noAvatarArt = {
  name: 'no-avatar-art',
  setup(b) {
    b.onResolve({ filter: /^@dicebear\/core$/ }, () => ({
      path: 'dicebear-core',
      namespace: 'stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export class Avatar {}; export class Style {};',
      loader: 'js',
    }));
    b.onResolve({ filter: /^@dicebear\/styles\// }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

await build({
  entryPoints: [join(appRoot, 'lib/boot/boot-apply.ts')],
  plugins: [noAvatarArt],
  outfile: join(outDir, 'boot.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

// The policy (lib/csp.ts) and the placeholder (lib/static-param.ts) are code,
// so bundle them and read them rather than copy them.
const cspModule = await build({
  stdin: {
    contents: "export * from './lib/csp'; export { STATIC_PARAM } from './lib/static-param';",
    resolveDir: appRoot,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'warning',
});
const { buildRuntimeCsp, CSP_ENFORCED_STATIC, STATIC_PARAM } = await import(
  `data:text/javascript;base64,${Buffer.from(cspModule.outputFiles[0].text).toString('base64')}`
);
const HOST = 'brain-origin.invalid';
const template = `${buildRuntimeCsp({ brainOrigin: `https://${HOST}` })}; ${CSP_ENFORCED_STATIC}`
  .replaceAll(`https://${HOST}`, '{brain}')
  .replaceAll(`wss://${HOST}`, '{brain_ws}');
if (template.includes(HOST)) throw new Error(`[build-boot] unreplaced host in CSP: ${template}`);
writeFileSync(join(outDir, 'csp.txt'), `${template}\n`);

// Route groups `(app)` are not in the URL; private folders `_x` are not routes.
function dynamicRoutes(dir, route) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const group = /^\(.*\)$/.test(entry.name);
    const next = group ? route : `${route}/${entry.name}`;
    if (!group && entry.name.startsWith('[')) found.push(next);
    found.push(...dynamicRoutes(join(dir, entry.name), next));
  }
  return found;
}
const routes = dynamicRoutes(join(appRoot, 'app'), '').sort();
writeFileSync(
  join(outDir, 'routes.json'),
  `${JSON.stringify({ placeholder: STATIC_PARAM, routes }, null, 2)}\n`,
);

console.log(`[build-boot] wrote public/_mantle/boot.js, csp.txt, routes.json (${routes.length})`);
