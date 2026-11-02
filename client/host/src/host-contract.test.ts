import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createStaticHost, fillCsp, UI_ORIGIN } from './static-host';

/**
 * The host contract as a shared table. The Tauri shell answers the same
 * cases from its Rust port (client/tauri/src/host.rs, `cargo test`), over the
 * same fixture tree, so a rule changed in one host and not the other fails
 * one of the two runs.
 */

type HostCase = {
  path: string;
  status: number;
  file: string | null;
  env?: boolean;
  type?: string;
  cache?: string;
  csp?: boolean;
  noReferrer?: boolean;
};

const root = fileURLToPath(new URL('../test-fixtures/host-contract/', import.meta.url));
const table = JSON.parse(readFileSync(join(root, 'cases.json'), 'utf8')) as {
  brain: string;
  cases: HostCase[];
};
const uiDir = join(root, 'ui');
const csp = fillCsp(readFileSync(join(uiDir, '_mantle/csp.txt'), 'utf8'), table.brain);

describe('the shared host cases', () => {
  const host = createStaticHost({
    uiDir,
    brainOrigin: table.brain,
    appearance: async () => ({ siteName: 'Acme' }),
  });

  it('has enough cases to cover every rule', () => {
    expect(table.cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of table.cases) {
    it(c.path, async () => {
      const res = await host(new Request(`${UI_ORIGIN}${c.path}`));
      expect(res.status).toBe(c.status);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      const body = Buffer.from(await res.arrayBuffer());
      if (c.file) {
        expect(body.equals(readFileSync(join(uiDir, c.file)))).toBe(true);
      } else if (c.env) {
        const text = body.toString('utf8');
        const env = JSON.parse(text.replace(/^window\.__MANTLE_ENV__ = /, '').replace(/;$/, ''));
        expect(env).toMatchObject({
          apiBase: table.brain,
          serverOrigin: table.brain,
          appearance: { siteName: 'Acme' },
        });
      } else {
        expect(body.toString('utf8')).toBe('Not found');
      }
      if (c.type) expect(res.headers.get('content-type')).toBe(c.type);
      if (c.cache) expect(res.headers.get('cache-control')).toBe(c.cache);
      expect(res.headers.get('content-security-policy')).toBe(c.csp ? csp : null);
      expect(res.headers.get('referrer-policy')).toBe(c.noReferrer ? 'no-referrer' : null);
    });
  }
});
