import { defineConfig } from '@playwright/test';
import { MOCK_API_ORIGIN } from './workspace/mock-workspace-api';

/**
 * The workspace specs (phase W5c: one shell for every login): NO brain.
 * Every /api/* request goes to an in-memory brain the spec starts in its own
 * process (workspace/mock-workspace-api.ts), so these run on any machine with
 * this checkout and nothing else: `pnpm e2e:workspace`.
 *
 * The owner UI runs from THIS checkout (next dev) with MANTLE_SERVER_ORIGIN
 * pointed at that mock. `boot` first: next dev serves public/, and the boot
 * script (public/_mantle/boot.js) is generated, not committed. Kept apart from playwright.config.ts on purpose: that
 * one's global-setup signs in to a real brain, which these specs must not
 * need.
 *
 * Next allows one `next dev` per project directory, so stop a dev server
 * running in client/web first (or set E2E_WORKSPACE_URL to one already
 * serving this checkout with MANTLE_SERVER_ORIGIN set to MOCK_API_ORIGIN).
 */
const PORT = Number(process.env.E2E_WORKSPACE_PORT || 3921);
const external = process.env.E2E_WORKSPACE_URL?.replace(/\/+$/, '');
const baseURL = external || `http://localhost:${PORT}`;
// E2E_BROWSER_CHANNEL=chrome drives the installed Chrome instead of
// Playwright's bundled build (a machine whose browsers lag the package).
const channel = process.env.E2E_BROWSER_CHANNEL || undefined;
// E2E_NEXT_RUNTIME=bun runs the boot script and `next dev` on Bun
// (`pnpm e2e:workspace:bun`, docs/bun-tooling.md). Playwright itself stays on
// Node either way: Bun is not a runtime Playwright supports.
const runtime = process.env.E2E_NEXT_RUNTIME || 'node';
if (runtime !== 'node' && runtime !== 'bun') {
  throw new Error(`E2E_NEXT_RUNTIME must be node or bun, not ${runtime}`);
}
const devCommand =
  runtime === 'bun'
    ? `../scripts/bun.sh --cwd ../client/web boot && ../scripts/bun.sh --cwd ../client/web next dev --port ${PORT}`
    : `pnpm -C ../client/web run boot && pnpm -C ../client/web exec next dev --port ${PORT}`;

export default defineConfig({
  testDir: './workspace',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // The first request compiles the route in dev; the specs themselves are fast.
  timeout: 120_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
    ...(channel ? { channel } : {}),
  },
  ...(external
    ? {}
    : {
        webServer: {
          command: devCommand,
          url: `${baseURL}/env.js`,
          reuseExistingServer: false,
          timeout: 180_000,
          // The brain is the spec's in-memory one, never a real one. The
          // desktop shell's per-launch key, so a spec can name a window's
          // brain the way the shell does (login-brains.spec.ts).
          env: {
            MANTLE_SERVER_ORIGIN: MOCK_API_ORIGIN,
            NEXT_PUBLIC_MANTLE_API_BASE: '',
          },
        },
      }),
});
